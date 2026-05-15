# gh-store-app-oauth

Cloudflare Worker that runs the GitHub OAuth register/callback hop for the
GitHub Store mobile app with full PKCE. The Jekyll site continues to serve
every other path on `github-store.org`; this Worker only owns `/auth/*`.

This is **separate** from the Decap CMS OAuth worker. Do not merge them — they
have different scopes, different audiences, and different lifecycles.

## Flow (PKCE Pattern A)

```
App                       Worker (this)                              Backend
 │                              │                                       │
 │ generate locally:                                                    │
 │   state         (32B → b64url, 43 chars)                             │
 │   code_verifier (43-128 char b64url)                                 │
 │   code_challenge = b64url(SHA-256(verifier))                         │
 │                                                                      │
 │ POST /auth/register                                                  │
 │   { state, code_verifier, code_challenge }                           │
 │ ────────────────────────────▶│                                       │
 │                              │ validate formats                      │
 │                              │ POST /v1/oauth/state { state,         │
 │                              │   code_challenge }                    │
 │                              │   X-Oauth-Service-Token: <T>          │
 │                              │ ─────────────────────────────────────▶│
 │                              │ ◀── 2xx                               │
 │                              │ KV.put oauth:verifier:<S> = verifier  │
 │                              │   ttl=60s                             │
 │ ◀── 200 { auth_url }         │                                       │
 │                                                                      │
 │ app opens auth_url in system browser                                 │
 │                              │                                       │
 │  (user signs in on GitHub)                                           │
 │                              │ ◀── GitHub 302 /auth/callback?code=<G>&state=<S>
 │                              │ KV.get oauth:verifier:<S>             │
 │                              │   miss → error page                   │
 │                              │ KV.delete (one-shot)                  │
 │                              │ POST /v1/oauth/exchange { code,       │
 │                              │   state, code_verifier }              │
 │                              │   X-Oauth-Service-Token: <T>          │
 │                              │ ─────────────────────────────────────▶│
 │                              │ ◀── { handoff_id }                    │
 │                              │ render HTML with deep link            │
 │ ◀── githubstore://auth?handoff=<H>&state=<S>                         │
 │                                                                      │
 │ POST /v1/oauth/handoff/<H>                                           │
 │ ────────────────────────────────────────────────────────────────────▶│
 │ ◀── { access_token }                                                 │
```

The `code_verifier` never leaves the Worker on a user-visible URL — it travels
only on the server-to-server hop to the backend's exchange endpoint, keyed by
the single-use `state`.

## Endpoints

### `POST /auth/register`

Called by the app (server-style; not browser-loaded). Expects JSON.

Request:

```json
{
  "state":           "<43-256 char base64url>",
  "code_verifier":   "<43-128 char base64url>",
  "code_challenge":  "<43 char base64url, == base64url(SHA-256(verifier))>"
}
```

Headers:

- `Content-Type: application/json`

Responses:

| status | body                                       | meaning                                          |
| -----: | ------------------------------------------ | ------------------------------------------------ |
| 200    | `{ "auth_url": "https://github.com/…" }`   | App opens this URL in the system browser         |
| 400    | `{ "error": "invalid_state" }`             | `state` missing or not `^[A-Za-z0-9_-]{32,256}$` |
| 400    | `{ "error": "invalid_verifier" }`          | `code_verifier` not `^[A-Za-z0-9_-]{43,128}$`    |
| 400    | `{ "error": "invalid_challenge" }`         | `code_challenge` not `^[A-Za-z0-9_-]{43}$`       |
| 400    | `{ "error": "challenge_mismatch" }`        | `code_challenge` ≠ `base64url(SHA-256(code_verifier))` |
| 400    | `{ "error": "invalid_json" }`              | Body unparseable or not an object                |
| 409    | `{ "error": "state_already_registered" }`  | This `state` is already pinned in KV             |
| 413    | `{ "error": "payload_too_large" }`         | Body exceeds 2 KiB                               |
| 415    | `{ "error": "invalid_content_type" }`      | Missing/wrong `Content-Type`                     |
| 429    | `{ "error": "rate_limited" }`              | Per-IP limit hit (see Rate limiting)             |
| 502    | `{ "error": "backend_unreachable" }`       | Worker → backend `/v1/oauth/state` failed (network) |
| 502    | `{ "error": "backend_register_failed" }`   | Backend `/v1/oauth/state` returned non-2xx       |

Notes:

- `auth_url` is `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=https://github-store.org/auth/callback&state=<S>&scope=repo+read:user`.
- Worker registers `state → code_verifier` in KV (TTL 60 s, single-use) **only
  after** the backend confirms the `state → code_challenge` registration.
- The app **must not** open `/auth/register` in a browser. Browsers cache and
  history-log URLs; native HTTP clients do not.

### `GET /auth/callback`

Hit by the user's browser after GitHub completes the authorize step. Returns
HTML that redirects via custom scheme to the app.

Query params (set by GitHub):

- `state`
- `code` (on success) **or** `error` (on user-cancel / GitHub error)

Worker behavior:

1. Validate `state` format. KV-lookup `oauth:verifier:<state>` (miss → error page).
2. `KV.delete` (single-use).
3. If GitHub returned `error`, render error page passing the sanitized reason.
4. Otherwise POST backend `/v1/oauth/exchange` with `{ code, state, code_verifier }`.
5. On 2xx → render success HTML with `githubstore://auth?handoff=<H>&state=<S>`.
6. On any failure → render error HTML with `githubstore://auth?error=<reason>&state=<S>`.

## Deep-link contract (app must honor)

**Success:**

```
githubstore://auth?handoff=<id>&state=<original-state>
```

**Failure:**

```
githubstore://auth?error=<reason>&state=<original-state>
```

`reason` is one of:

| reason                       | meaning                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `invalid_state`              | `state` missing, malformed, expired, or already redeemed             |
| `missing_code`               | GitHub redirected without `code` and without `error`                 |
| `exchange_unreachable`       | Worker could not reach `BACKEND_EXCHANGE_URL`                        |
| `exchange_failed`            | Backend `/v1/oauth/exchange` returned non-2xx                        |
| `exchange_invalid_response`  | Backend response missing/malformed `handoff_id`                      |
| `github_error`               | Catch-all sanitized GitHub `?error=` payload                         |
| `access_denied`, …           | GitHub-supplied error code, passed through if it matches `[a-z0-9_]` |

The app should treat any unknown `reason` as a fatal failure and surface a
generic "sign-in failed" message to the user.

## Client contract (app side)

The app generates three values locally before calling `/auth/register`:

```kotlin
val random = SecureRandom()

val stateBytes = ByteArray(32).also { random.nextBytes(it) }
val state = Base64.encodeToString(
    stateBytes,
    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
)

// PKCE: 32 random bytes → 43-char base64url verifier is the recommended
// minimum. Worker accepts up to 128 chars.
val verifierBytes = ByteArray(32).also { random.nextBytes(it) }
val codeVerifier = Base64.encodeToString(
    verifierBytes,
    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
)

val challengeBytes = MessageDigest.getInstance("SHA-256")
    .digest(codeVerifier.toByteArray(Charsets.US_ASCII))
val codeChallenge = Base64.encodeToString(
    challengeBytes,
    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
)
```

All three values match `^[A-Za-z0-9_-]+$`. The challenge is the base64url
encoding of the **SHA-256 of the verifier's ASCII bytes**, per
[RFC 7636 §4.2](https://datatracker.ietf.org/doc/html/rfc7636#section-4.2).
Anything else 400s at `/auth/register`.

## Configuration

### Vars (committed in `wrangler.toml`)

| name                   | value                                              |
| ---------------------- | -------------------------------------------------- |
| `GITHUB_CLIENT_ID`     | `Ov23linTY28VFpFjFiI9` — public per OAuth spec     |
| `BACKEND_STATE_URL`    | `https://api.github-store.org/v1/oauth/state`      |
| `BACKEND_EXCHANGE_URL` | `https://api.github-store.org/v1/oauth/exchange`   |
| `APP_SCHEME`           | `githubstore`                                      |

### Secrets (NEVER commit — set via `wrangler secret put`)

| name                  | source                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| `OAUTH_SERVICE_TOKEN` | Long random string shared with the backend. Same value in both places.  |

Generate:

```
openssl rand -base64 48 | tr -d '=' | tr '+/' '-_'
```

Hand the value to the backend agent via your shared secret manager (1Password,
Bitwarden, Doppler — not Slack/email).

### KV namespace

`OAUTH_STATE` — holds `oauth:verifier:<state>` for 60 s. Free-tier 1000 ops/day
is plenty for current auth volume.

```
wrangler kv namespace create OAUTH_STATE
wrangler kv namespace create OAUTH_STATE --preview
```

Paste the returned IDs into `wrangler.toml`.

## Local development

```
cp .dev.vars.example .dev.vars
# edit .dev.vars and put a real OAUTH_SERVICE_TOKEN value

npm install
npm run dev
```

The dev server runs at `http://localhost:8787`. Exercise registration with:

```
curl -sS -X POST http://localhost:8787/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "state":           "AAAA…43 chars…",
    "code_verifier":   "BBBB…43 chars…",
    "code_challenge":  "CCCC…43 chars…"
  }'
```

The full flow requires the GitHub OAuth app callback to be pointed at the dev
URL — easier to test in staging.

## Deploy

### One-time

1. Authenticate: `wrangler login`
2. Create KV namespaces (production + preview) and paste IDs into `wrangler.toml`.
3. Set the secret: `wrangler secret put OAUTH_SERVICE_TOKEN`
4. Make sure `github-store.org` zone is on this Cloudflare account.

### Each release

```
npm run typecheck
npm run deploy
```

After deploy, Cloudflare claims `github-store.org/auth/*` and the Jekyll site
keeps serving everything else.

### GitHub OAuth app

Before the production cutover, flip the callback URL on the `OpenHub-Store`
GitHub OAuth app from `githubstore://callback` to
`https://github-store.org/auth/callback`. The client secret stays on the
backend; this Worker never sees it.

## Rate limiting

`/auth/register` is rate-limited per client IP via the Workers Rate Limiting
binding (`RATE_LIMITER`). Current limit: **2 requests per 60 s sliding window
per IP** — the closest expressible cap to the agreed 60/hr/IP intent given the
binding's 10 s / 60 s period constraint. Effective ceiling ≈ 120 reqs/hr/IP,
which still blocks scrapers (which run thousands/hr) while leaving headroom for
shared NAT (school/cafe Wi-Fi).

If an exact hourly cap is required, layer a Cloudflare WAF rate-limiting rule
on the zone with `period = 3600, limit = 60` matching `http.request.uri.path
eq "/auth/register"`. The WAF rule and the binding compose; both must allow
the request to pass.

`/auth/callback` is not rate-limited at the Worker layer because it is gated by
a 60 s single-use verifier in KV — abuse there self-throttles via KV misses.

## Security notes

- No tokens, codes, or verifiers in user-visible URLs. `/auth/register` is a
  JSON POST. The verifier moves only on server-to-server hops (app → Worker,
  Worker → backend) and is keyed in KV by the single-use `state`.
- `state`, `code_verifier`, `code_challenge`, and `handoff_id` are each
  strictly format-validated before any KV access or backend call.
- **PKCE challenge is verified at the edge** (defense in depth). After format
  validation, the Worker computes `base64url(SHA-256(code_verifier))` via
  `crypto.subtle.digest` and constant-time compares it with the supplied
  `code_challenge`. Mismatch → `400 challenge_mismatch` before any KV write or
  backend round-trip. This is independent of, and additional to, the backend's
  later verification at `/v1/oauth/exchange` — catches client bugs (and any
  pre-OAuth tampering) before the GitHub authorize hop, not after.
- KV `oauth:verifier:<state>` TTL is 60 s and is deleted immediately on first
  read. KV has no atomic GETDEL — the read-then-delete pair is effectively
  single-use because subsequent reads will miss either due to the prior delete
  or the TTL.
- Worker → backend calls send `X-Oauth-Service-Token` (shared secret). The
  `Host` header is `api.github-store.org` (derived from the request URL —
  Cloudflare Workers does not let you override Host, so the URL is the source
  of truth).
- The Worker never logs `code`, `state`, `code_verifier`, `code_challenge`,
  `handoff_id`, or `OAUTH_SERVICE_TOKEN`. Status codes and durations only.
  `wrangler tail` will show no sensitive values.
- Response pages set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`.
- The HTML deep-link page embeds the URL in a `JSON.stringify`d JS literal with
  an additional `</script>` escape, plus an attribute-escaped anchor fallback.
  `state` and `handoff_id` are pre-validated, so the embedding is a
  defense-in-depth measure.
- The Worker never sees the GitHub `client_secret`. The backend holds it and
  performs the `code → access_token` exchange.

## Files

```
workers/gh-store-app-oauth/
├── README.md
├── package.json
├── tsconfig.json
├── wrangler.toml
├── .gitignore
├── .dev.vars.example
└── src/
    └── index.ts
```
