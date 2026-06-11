# gh-store-app-oauth

Cloudflare Worker that runs the GitHub OAuth register/callback hop for the
Komi Store mobile app with full PKCE. The Jekyll site continues to serve
every other path on `github-store.org`; this Worker only owns `/auth/*`.

This is **separate** from the Decap CMS OAuth worker. Do not merge them — they
have different scopes, different audiences, and different lifecycles.

## Flow (PKCE Pattern A, stateless Worker)

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
 │                              │ verify PKCE challenge at the edge     │
 │                              │ POST /v1/oauth/state { state,         │
 │                              │   code_challenge }                    │
 │                              │   X-Oauth-Service-Token: <T>          │
 │                              │ ─────────────────────────────────────▶│
 │                              │ ◀── 2xx (or 409 if duplicate)         │
 │                              │ blob = AES-GCM(STATE_ENC_KEY,         │
 │                              │   {v: verifier, e: now+60s})          │
 │                              │ combined = "<state>.<blob>"           │
 │ ◀── 200 { auth_url }         │                                       │
 │                                                                      │
 │ app opens auth_url in system browser                                 │
 │                              │                                       │
 │  (user signs in on GitHub)                                           │
 │                              │ ◀── GitHub 302 /auth/callback?code=<G>&state=<state>.<blob>
 │                              │ split combined on "."                 │
 │                              │ decrypt blob → recover verifier, exp  │
 │                              │   tamper / wrong key / expired → 4xx  │
 │                              │ POST /v1/oauth/exchange { code,       │
 │                              │   state, code_verifier }              │
 │                              │   X-Oauth-Service-Token: <T>          │
 │                              │ ─────────────────────────────────────▶│
 │                              │ ◀── { handoff_id }                    │
 │                              │ render HTML with deep link            │
 │ ◀── githubstore://auth?handoff=<H>&state=<original-state>            │
 │                                                                      │
 │ POST /v1/oauth/handoff/<H>                                           │
 │ ────────────────────────────────────────────────────────────────────▶│
 │ ◀── { access_token }                                                 │
```

The `code_verifier` never leaves the Worker on a user-visible URL **in
plaintext**. It travels:

- App → Worker as JSON POST.
- Worker → GitHub redirect URL **encrypted with AES-GCM-256** (key never leaves
  the Worker, decryption keyless to anyone else).
- Worker → backend on the server-to-server exchange hop after Worker decrypts
  the blob locally.

There is **no KV, no Durable Object, no per-flow storage**. Replay protection
and state uniqueness are owned by the backend (`/v1/oauth/state` returns 409 on
duplicate; `/v1/oauth/exchange` atomically burns the state row on first read).

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
| 409    | `{ "error": "state_already_registered" }`  | Backend rejected this `state` as a duplicate     |
| 413    | `{ "error": "payload_too_large" }`         | Body exceeds 2 KiB                               |
| 415    | `{ "error": "invalid_content_type" }`      | Missing/wrong `Content-Type`                     |
| 429    | `{ "error": "rate_limited" }`              | Per-IP limit hit (see Rate limiting)             |
| 500    | `{ "error": "encryption_unavailable" }`    | `STATE_ENC_KEY` missing or malformed             |
| 502    | `{ "error": "backend_unreachable" }`       | Worker → backend `/v1/oauth/state` failed (network) |
| 502    | `{ "error": "backend_register_failed" }`   | Backend `/v1/oauth/state` returned non-2xx       |

Notes:

- `auth_url` is `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=https://github-store.org/auth/callback&state=<state>.<blob>&scope=repo+read:user`.
  GitHub treats the whole `<state>.<blob>` value as an opaque round-trip token.
- The `409` is produced by the backend's `INSERT … ON CONFLICT (namespace, key)
  DO NOTHING` constraint and surfaced verbatim by the Worker. The app contract
  is unchanged from the previous KV-based implementation.
- The app **must not** open `/auth/register` in a browser. Browsers cache and
  history-log URLs; native HTTP clients do not.

### `GET /auth/callback`

Hit by the user's browser after GitHub completes the authorize step. Returns
HTML that redirects via custom scheme to the app.

Query params (set by GitHub):

- `state` — full `<original-state>.<blob>` round-tripped from `/auth/register`.
- `code` (on success) **or** `error` (on user-cancel / GitHub error).

Worker behavior:

1. Split `state` on `.`. Reject if not exactly two parts.
2. Validate `<original-state>` matches `STATE_RE` and `<blob>` matches `BLOB_RE`.
3. Decrypt `<blob>` with `STATE_ENC_KEY`. Tamper, wrong-key, or expired-TTL → error page.
4. If GitHub returned `error`, render error page passing the sanitized reason.
5. Otherwise POST backend `/v1/oauth/exchange` with `{ code, state, code_verifier }`.
6. On 2xx → render success HTML with `githubstore://auth?handoff=<H>&state=<original-state>`.
7. On any failure → render error HTML with `githubstore://auth?error=<reason>&state=<original-state>`.

The deep link returned to the app contains the **original** state value (without
the encrypted blob), so the app's local state-matching code keeps comparing the
same value it generated.

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
| `invalid_state`              | `state` missing, malformed, tampered, expired, or already redeemed   |
| `missing_code`               | GitHub redirected without `code` and without `error`                 |
| `encryption_unavailable`     | Worker `STATE_ENC_KEY` is missing or malformed (operator error)      |
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

The client contract is **unchanged** from the previous KV-based implementation.
The encrypted-state design is server-internal — already-installed apps keep
working after the cutover without an update.

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
| `STATE_ENC_KEY`       | AES-GCM-256 key, base64 of exactly 32 random bytes (44-char string).    |

Generate `OAUTH_SERVICE_TOKEN`:

```
openssl rand -base64 48 | tr -d '=' | tr '+/' '-_'
```

Generate `STATE_ENC_KEY`:

```
openssl rand 32 | base64
```

Hand `OAUTH_SERVICE_TOKEN` to the backend agent via your shared secret manager
(1Password, Bitwarden, Doppler — not Slack/email). `STATE_ENC_KEY` is
Worker-only — the backend never sees it and does not need it.

### State encryption key

`STATE_ENC_KEY` is the symmetric key the Worker uses to encrypt the PKCE
`code_verifier` into the opaque blob carried inside the GitHub `state`
parameter. AES-GCM-256, 12-byte random nonce per encryption, 16-byte GCM tag.

**Rotation:**

The current implementation supports a single key. Rotation requires a short
maintenance window because in-flight callbacks (up to 60 s old) will fail
decryption with the new key. Procedure:

1. Generate a new 32-byte key: `openssl rand 32 | base64`.
2. `wrangler secret put STATE_ENC_KEY` and paste the new value.
3. `npm run deploy`.
4. In-flight `/auth/callback` requests started before the deploy will fail with
   `invalid_state` for up to 60 s; the app surfaces this as a normal sign-in
   failure and the user can retry. No persistent damage.

If zero-downtime rotation is required later, extend `getEncKey` /
`decryptVerifier` to support a versioned ciphertext header that selects between
`STATE_ENC_KEY_V1` and `STATE_ENC_KEY_V2` during the overlap window.

## Local development

```
cp .dev.vars.example .dev.vars
# edit .dev.vars and set real values for both OAUTH_SERVICE_TOKEN and
# STATE_ENC_KEY (use `openssl rand 32 | base64` for the latter)

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
2. Set both secrets:
   - `wrangler secret put OAUTH_SERVICE_TOKEN`
   - `wrangler secret put STATE_ENC_KEY`  (paste `openssl rand 32 | base64`)
3. Make sure `github-store.org` zone is on this Cloudflare account.

### Each release

```
npm run typecheck
npm run deploy
```

After deploy, Cloudflare claims `github-store.org/auth/*` and the Jekyll site
keeps serving everything else.

### GitHub OAuth app

Before the production cutover, flip the callback URL on the `kurikomi-labs`
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

`/auth/callback` is not rate-limited at the Worker layer. Abuse there is
naturally throttled by two independent gates:

- The encrypted blob's 60 s `exp` field — any replay older than that returns
  `invalid_state`.
- The backend's atomic single-use state burn in `/v1/oauth/exchange` — any
  second exchange for the same `state` returns `invalid_state`.

## Security notes

- **No plaintext tokens, codes, or verifiers in user-visible URLs.**
  `/auth/register` is a JSON POST. The verifier in the GitHub `state` parameter
  is AES-GCM-256 ciphertext; the symmetric key (`STATE_ENC_KEY`) is a Worker
  secret and never leaves the Worker.
- `state`, `code_verifier`, `code_challenge`, and `handoff_id` are each
  strictly format-validated before any crypto or backend call.
- **PKCE challenge is verified at the edge** (defense in depth). After format
  validation, the Worker computes `base64url(SHA-256(code_verifier))` via
  `crypto.subtle.digest` and constant-time compares it with the supplied
  `code_challenge`. Mismatch → `400 challenge_mismatch` before any crypto or
  backend round-trip. This is independent of, and additional to, the backend's
  later verification at `/v1/oauth/exchange` — catches client bugs (and any
  pre-OAuth tampering) before the GitHub authorize hop, not after.
- **AES-GCM-256** via `crypto.subtle.encrypt`/`decrypt`. 12-byte random nonce
  per encryption (96-bit, safe for ~2^32 messages under one key). 16-byte GCM
  auth tag — any tampering of the blob fails decryption and is rejected as
  `invalid_state`. Plaintext payload is JSON `{ "v": verifier, "e": expiryMs }`
  so the TTL travels inside the ciphertext and the Worker cannot be fooled into
  accepting a stale verifier by URL manipulation.
- **State uniqueness / replay protection** is owned by the backend, not the
  Worker. `/v1/oauth/state` enforces uniqueness via `INSERT … ON CONFLICT
  (namespace, key) DO NOTHING` (the Worker surfaces the resulting 409 as
  `state_already_registered`). `/v1/oauth/exchange` atomically burns the state
  row on first read via `getDel` (Postgres `DELETE … RETURNING`). GitHub also
  invalidates the `code` after first exchange as an independent third gate.
- Worker → backend calls send `X-Oauth-Service-Token` (shared secret). The
  `Host` header is `api.github-store.org` (derived from the request URL —
  Cloudflare Workers does not let you override Host, so the URL is the source
  of truth).
- The Worker never logs `code`, `state`, `code_verifier`, `code_challenge`,
  `handoff_id`, `OAUTH_SERVICE_TOKEN`, or `STATE_ENC_KEY`. Status codes and
  durations only. `wrangler tail` will show no sensitive values.
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
