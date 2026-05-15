interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  OAUTH_STATE: KVNamespace;
  RATE_LIMITER: RateLimit;
  OAUTH_SERVICE_TOKEN: string;
  GITHUB_CLIENT_ID: string;
  BACKEND_STATE_URL: string;
  BACKEND_EXCHANGE_URL: string;
  APP_SCHEME: string;
}

const STATE_RE = /^[A-Za-z0-9_-]{32,256}$/;
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const HANDOFF_RE = /^[A-Za-z0-9_-]{8,256}$/;
const REASON_RE = /^[a-z0-9_]{1,64}$/i;

const VERIFIER_TTL_SECONDS = 60;
const MAX_BODY_BYTES = 2048;
const APP_SCOPE = "repo read:user";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const CALLBACK_URL = "https://github-store.org/auth/callback";
const KV_PREFIX = "oauth:verifier:";
const USER_AGENT = "gh-store-app-oauth-worker/0.1.0";

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/auth/register") {
      if (req.method !== "POST") {
        return methodNotAllowed("POST");
      }
      return handleRegister(req, env);
    }
    if (url.pathname === "/auth/callback") {
      if (req.method !== "GET") {
        return methodNotAllowed("GET");
      }
      return handleCallback(url, env);
    }
    return new Response("Not Found", { status: 404 });
  },
};

async function handleRegister(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.RATE_LIMITER.limit({ key: ip });
  if (!success) {
    return jsonResponse({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }

  const contentType = req.headers.get("Content-Type") ?? "";
  if (!/^application\/json(\s*;.*)?$/i.test(contentType)) {
    return jsonResponse({ error: "invalid_content_type" }, 415);
  }

  const lenHeader = req.headers.get("Content-Length");
  if (lenHeader !== null) {
    const len = Number(lenHeader);
    if (!Number.isFinite(len) || len > MAX_BODY_BYTES) {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { state, code_verifier, code_challenge } = body as Record<string, unknown>;
  if (typeof state !== "string" || !STATE_RE.test(state)) {
    return jsonResponse({ error: "invalid_state" }, 400);
  }
  if (typeof code_verifier !== "string" || !VERIFIER_RE.test(code_verifier)) {
    return jsonResponse({ error: "invalid_verifier" }, 400);
  }
  if (typeof code_challenge !== "string" || !CHALLENGE_RE.test(code_challenge)) {
    return jsonResponse({ error: "invalid_challenge" }, 400);
  }

  if (!(await verifyPkceChallenge(code_verifier, code_challenge))) {
    return jsonResponse({ error: "challenge_mismatch" }, 400);
  }

  const key = `${KV_PREFIX}${state}`;
  const existing = await env.OAUTH_STATE.get(key);
  if (existing !== null) {
    return jsonResponse({ error: "state_already_registered" }, 409);
  }

  let backendResp: Response;
  try {
    backendResp = await fetch(env.BACKEND_STATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
        "X-Oauth-Service-Token": env.OAUTH_SERVICE_TOKEN,
      },
      body: JSON.stringify({ state, code_challenge }),
    });
  } catch {
    return jsonResponse({ error: "backend_unreachable" }, 502);
  }
  if (!backendResp.ok) {
    return jsonResponse({ error: "backend_register_failed" }, 502);
  }

  await env.OAUTH_STATE.put(key, code_verifier, {
    expirationTtl: VERIFIER_TTL_SECONDS,
  });

  const authorize = new URL(GITHUB_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", CALLBACK_URL);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", APP_SCOPE);

  return jsonResponse({ auth_url: authorize.toString() }, 200);
}

async function handleCallback(url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const ghError = url.searchParams.get("error");

  const safeState = state && STATE_RE.test(state) ? state : "";
  if (!safeState) {
    return renderError(env, "invalid_state", "");
  }

  const key = `${KV_PREFIX}${safeState}`;
  const verifier = await env.OAUTH_STATE.get(key);
  if (verifier === null) {
    return renderError(env, "invalid_state", safeState);
  }
  await env.OAUTH_STATE.delete(key);

  if (ghError) {
    return renderError(env, sanitizeReason(ghError), safeState);
  }
  if (!code) {
    return renderError(env, "missing_code", safeState);
  }

  let exchangeResp: Response;
  try {
    exchangeResp = await fetch(env.BACKEND_EXCHANGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
        "X-Oauth-Service-Token": env.OAUTH_SERVICE_TOKEN,
      },
      body: JSON.stringify({ code, state: safeState, code_verifier: verifier }),
    });
  } catch {
    return renderError(env, "exchange_unreachable", safeState);
  }

  if (!exchangeResp.ok) {
    return renderError(env, "exchange_failed", safeState);
  }

  let handoff: string;
  try {
    const responseBody = (await exchangeResp.json()) as { handoff_id?: unknown };
    if (typeof responseBody.handoff_id !== "string" || !HANDOFF_RE.test(responseBody.handoff_id)) {
      return renderError(env, "exchange_invalid_response", safeState);
    }
    handoff = responseBody.handoff_id;
  } catch {
    return renderError(env, "exchange_invalid_response", safeState);
  }

  return renderSuccess(env, handoff, safeState);
}

function renderSuccess(env: Env, handoff: string, state: string): Response {
  const deepLink = `${env.APP_SCHEME}://auth?handoff=${encodeURIComponent(handoff)}&state=${encodeURIComponent(state)}`;
  return htmlResponse(deepLinkPage(deepLink, "Sign-in complete. Returning to the app…"), 200);
}

function renderError(env: Env, reason: string, state: string): Response {
  const params = new URLSearchParams({ error: reason });
  if (state) params.set("state", state);
  const deepLink = `${env.APP_SCHEME}://auth?${params.toString()}`;
  return htmlResponse(deepLinkPage(deepLink, `Sign-in failed (${escapeText(reason)}). Returning to the app…`), 200);
}

function deepLinkPage(deepLink: string, message: string): string {
  const jsLiteral = JSON.stringify(deepLink).replace(/</g, "\\u003c");
  const safeHref = escapeAttr(deepLink);
  const safeMessage = escapeText(message);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Returning to GitHub Store…</title>
<meta name="robots" content="noindex">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #222; }
  a { color: #0a66c2; word-break: break-all; }
</style>
</head>
<body>
<script>location.replace(${jsLiteral});</script>
<p>${safeMessage}</p>
<p>If the app didn't open, <a href="${safeHref}">tap here to return</a>.</p>
</body>
</html>`;
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

function jsonResponse(body: object, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function methodNotAllowed(allowed: string): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: allowed },
  });
}

async function verifyPkceChallenge(verifier: string, challenge: string): Promise<boolean> {
  // RFC 7636 §4.6: code_challenge MUST equal BASE64URL-ENCODE(SHA256(ASCII(code_verifier))).
  // VERIFIER_RE restricts verifier to base64url alphabet, so its UTF-8 encoding
  // is byte-identical to ASCII — TextEncoder is safe here.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const expected = base64UrlEncode(new Uint8Array(digest));
  return constantTimeEqual(expected, challenge);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function sanitizeReason(raw: string): string {
  return REASON_RE.test(raw) ? raw : "github_error";
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}
