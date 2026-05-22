interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  RATE_LIMITER: RateLimit;
  OAUTH_SERVICE_TOKEN: string;
  STATE_ENC_KEY: string;
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
const BLOB_RE = /^[A-Za-z0-9_-]{32,512}$/;

const VERIFIER_TTL_SECONDS = 60;
const MAX_BODY_BYTES = 2048;
const APP_SCOPE = "public_repo read:user";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const CALLBACK_URL = "https://github-store.org/auth/callback";
const USER_AGENT = "gh-store-app-oauth-worker/0.2.0";

const STATE_BLOB_SEPARATOR = ".";
const ENC_VERSION = 0x01;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const ENC_KEY_BYTES = 32;

let cachedEncKey: CryptoKey | null = null;

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
  // Backend enforces state uniqueness via INSERT … ON CONFLICT DO NOTHING and
  // returns 409 on a duplicate. Pass that through verbatim so the app's
  // handling of state_already_registered stays identical to the KV-era contract.
  if (backendResp.status === 409) {
    return jsonResponse({ error: "state_already_registered" }, 409);
  }
  if (!backendResp.ok) {
    return jsonResponse({ error: "backend_register_failed" }, 502);
  }

  let blob: string;
  try {
    blob = await encryptVerifier(code_verifier, env);
  } catch {
    return jsonResponse({ error: "encryption_unavailable" }, 500);
  }

  const combinedState = `${state}${STATE_BLOB_SEPARATOR}${blob}`;

  const authorize = new URL(GITHUB_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", CALLBACK_URL);
  authorize.searchParams.set("state", combinedState);
  authorize.searchParams.set("scope", APP_SCOPE);

  return jsonResponse({ auth_url: authorize.toString() }, 200);
}

async function handleCallback(url: URL, env: Env): Promise<Response> {
  const rawState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const ghError = url.searchParams.get("error");

  const parts = rawState ? rawState.split(STATE_BLOB_SEPARATOR) : [];
  if (parts.length !== 2) {
    return renderError(env, "invalid_state", "");
  }
  const [originalState, blob] = parts as [string, string];

  if (!STATE_RE.test(originalState)) {
    return renderError(env, "invalid_state", "");
  }
  if (!BLOB_RE.test(blob)) {
    return renderError(env, "invalid_state", originalState);
  }

  let verifier: string | null;
  try {
    verifier = await decryptVerifier(blob, env);
  } catch {
    return renderError(env, "encryption_unavailable", originalState);
  }
  if (verifier === null) {
    return renderError(env, "invalid_state", originalState);
  }

  if (ghError) {
    return renderError(env, sanitizeReason(ghError), originalState);
  }
  if (!code) {
    return renderError(env, "missing_code", originalState);
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
      body: JSON.stringify({ code, state: originalState, code_verifier: verifier }),
    });
  } catch {
    return renderError(env, "exchange_unreachable", originalState);
  }

  if (!exchangeResp.ok) {
    return renderError(env, "exchange_failed", originalState);
  }

  let handoff: string;
  try {
    const responseBody = (await exchangeResp.json()) as { handoff_id?: unknown };
    if (typeof responseBody.handoff_id !== "string" || !HANDOFF_RE.test(responseBody.handoff_id)) {
      return renderError(env, "exchange_invalid_response", originalState);
    }
    handoff = responseBody.handoff_id;
  } catch {
    return renderError(env, "exchange_invalid_response", originalState);
  }

  return renderSuccess(env, handoff, originalState);
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

async function getEncKey(env: Env): Promise<CryptoKey> {
  if (cachedEncKey) return cachedEncKey;
  if (typeof env.STATE_ENC_KEY !== "string" || env.STATE_ENC_KEY.length === 0) {
    throw new Error("STATE_ENC_KEY not configured");
  }
  const raw = base64StdDecode(env.STATE_ENC_KEY);
  if (raw.length !== ENC_KEY_BYTES) {
    throw new Error(`STATE_ENC_KEY must decode to ${ENC_KEY_BYTES} bytes`);
  }
  cachedEncKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedEncKey;
}

// encryptVerifier returns a compact base64url blob that the callback handler can
// decrypt to recover the original code_verifier together with its expiry deadline.
// Layout (before base64url):
//   [1 byte: ENC_VERSION][NONCE_BYTES: random nonce][AES-GCM ciphertext+tag]
// Plaintext is JSON: { "v": "<verifier>", "e": <expiryEpochMs> }.
async function encryptVerifier(verifier: string, env: Env): Promise<string> {
  const key = await getEncKey(env);
  const exp = Date.now() + VERIFIER_TTL_SECONDS * 1000;
  const payload = JSON.stringify({ v: verifier, e: exp });
  const plaintext = new TextEncoder().encode(payload);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext),
  );
  const blob = new Uint8Array(1 + NONCE_BYTES + ct.length);
  blob[0] = ENC_VERSION;
  blob.set(nonce, 1);
  blob.set(ct, 1 + NONCE_BYTES);
  return base64UrlEncode(blob);
}

// decryptVerifier returns the original verifier string if the blob is a valid,
// non-expired ciphertext signed by the current STATE_ENC_KEY. Returns null on
// any tampering, version mismatch, malformed payload, or expired deadline.
async function decryptVerifier(blobB64: string, env: Env): Promise<string | null> {
  let blob: Uint8Array;
  try {
    blob = base64UrlDecode(blobB64);
  } catch {
    return null;
  }
  if (blob.length < 1 + NONCE_BYTES + GCM_TAG_BYTES) return null;
  if (blob[0] !== ENC_VERSION) return null;

  const nonce = blob.subarray(1, 1 + NONCE_BYTES);
  const ct = blob.subarray(1 + NONCE_BYTES);
  const key = await getEncKey(env);

  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct),
    );
  } catch {
    return null;
  }

  let payload: { v?: unknown; e?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintextBytes));
  } catch {
    return null;
  }
  if (typeof payload.v !== "string" || !VERIFIER_RE.test(payload.v)) return null;
  if (typeof payload.e !== "number" || !Number.isFinite(payload.e)) return null;
  if (payload.e < Date.now()) return null;

  return payload.v;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64StdDecode(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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
