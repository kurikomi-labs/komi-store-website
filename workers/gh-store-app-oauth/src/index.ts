interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  OAUTH_STATE: KVNamespace;
  RATE_LIMITER: RateLimit;
  OAUTH_SERVICE_TOKEN: string;
  GITHUB_CLIENT_ID: string;
  BACKEND_EXCHANGE_URL: string;
  APP_SCHEME: string;
}

const STATE_RE = /^[A-Za-z0-9_-]{32,256}$/;
const HANDOFF_RE = /^[A-Za-z0-9_-]{8,256}$/;
const REASON_RE = /^[a-z0-9_]{1,64}$/i;

const STATE_TTL_SECONDS = 60;
const APP_SCOPE = "repo read:user";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const CALLBACK_URL = "https://github-store.org/auth/callback";
const KV_PREFIX = "oauth:state:";

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (url.pathname === "/auth/start") {
      return handleStart(req, url, env);
    }
    if (url.pathname === "/auth/callback") {
      return handleCallback(url, env);
    }
    return new Response("Not Found", { status: 404 });
  },
};

async function handleStart(req: Request, url: URL, env: Env): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.RATE_LIMITER.limit({ key: ip });
  if (!success) {
    return new Response("rate_limited", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const state = url.searchParams.get("state");
  const challengeMethod = url.searchParams.get("code_challenge_method");

  if (!state || !STATE_RE.test(state)) {
    return new Response("invalid_state", { status: 400 });
  }
  if (challengeMethod && challengeMethod !== "S256") {
    return new Response("invalid_challenge_method", { status: 400 });
  }

  await env.OAUTH_STATE.put(`${KV_PREFIX}${state}`, new Date().toISOString(), {
    expirationTtl: STATE_TTL_SECONDS,
  });

  const authorize = new URL(GITHUB_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", CALLBACK_URL);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", APP_SCOPE);

  return Response.redirect(authorize.toString(), 302);
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
  const stored = await env.OAUTH_STATE.get(key);
  if (stored === null) {
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
        "X-Oauth-Service-Token": env.OAUTH_SERVICE_TOKEN,
      },
      body: JSON.stringify({ code }),
    });
  } catch {
    return renderError(env, "exchange_unreachable", safeState);
  }

  if (!exchangeResp.ok) {
    return renderError(env, "exchange_failed", safeState);
  }

  let handoff: string;
  try {
    const body = (await exchangeResp.json()) as { handoff_id?: unknown };
    if (typeof body.handoff_id !== "string" || !HANDOFF_RE.test(body.handoff_id)) {
      return renderError(env, "exchange_invalid_response", safeState);
    }
    handoff = body.handoff_id;
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
