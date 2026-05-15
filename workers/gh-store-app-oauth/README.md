# gh-store-app-oauth

Cloudflare Worker that runs the GitHub OAuth start/callback hop for the GitHub
Store mobile app. The Jekyll site continues to serve every other path on
`github-store.org`; this Worker only owns `/auth/*`.

This is **separate** from the Decap CMS OAuth worker. Do not merge them — they
have different scopes, different audiences, and different lifecycles.

## Flow

```
App                       Worker (this)                         Backend
 │                              │                                  │
 │ generate state (32B b64url)  │                                  │
 │ open https://github-store.org/auth/start?state=<S>              │
 │ ────────────────────────────▶│                                  │
 │                              │ KV.put oauth:state:<S> ttl=60s   │
 │                              │ 302 → github.com/login/oauth/authorize
 │                              │                                  │
 │  (user signs in on GitHub)                                      │
 │                              │ ◀── GitHub 302 /auth/callback?code=<G>&state=<S>
 │                              │ KV.get + KV.delete (one-shot)    │
 │                              │ POST /v1/oauth/exchange { code } │
 │                              │   X-Oauth-Service-Token: <T>     │
 │                              │ ─────────────────────────────────▶
 │                              │ ◀── { handoff_id }               │
 │                              │ render HTML with deep link       │
 │ ◀── githubstore://auth?handoff=<H>&state=<S>                    │
 │                              │                                  │
 │ POST /v1/oauth/handoff/<H>   │                                  │
 │ ─────────────────────────────────────────────────────────────── ▶
 │ ◀── { access_token }                                            │
```

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

## Configuration

### Vars (committed in `wrangler.toml`)

| name                   | value                                              |
| ---------------------- | -------------------------------------------------- |
| `GITHUB_CLIENT_ID`     | `Ov23linTY28VFpFjFiI9` — public per OAuth spec     |
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

`OAUTH_STATE` — holds `oauth:state:<state>` for 60 s. Free-tier 1000 ops/day is
plenty for current auth volume.

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

The dev server runs at `http://localhost:8787`. Hit
`http://localhost:8787/auth/start?state=<32+ b64url chars>` to exercise the
redirect path. The full flow requires the GitHub OAuth app callback to be
pointed at the dev URL — easier to test in staging.

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

## State contract (app must honor)

The app generates `state` as **32 cryptographically random bytes**, encoded as
**Base64URL without padding** (no `=` characters). That produces a 43-character
string matching `^[A-Za-z0-9_-]{32,256}$`. Anything shorter, padded, or with
non-URL-safe alphabet characters 400s at `/auth/start`.

```kotlin
val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
val state = Base64.encodeToString(
    bytes,
    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
)
```

## Rate limiting

`/auth/start` is rate-limited per client IP via the Workers Rate Limiting
binding (`RATE_LIMITER`). Current limit: **2 requests per 60 s sliding window
per IP** — the closest expressible cap to the agreed 60/hr/IP intent given the
binding's 10 s / 60 s period constraint. Effective ceiling ≈ 120 reqs/hr/IP,
which still blocks scrapers (which run thousands/hr) while leaving headroom for
shared NAT (school/cafe Wi-Fi).

If an exact hourly cap is required, layer a Cloudflare WAF rate-limiting rule
on the zone with `period = 3600, limit = 60` matching `http.request.uri.path
eq "/auth/start"`. The WAF rule and the binding compose; both must allow the
request to pass.

`/auth/callback` is not rate-limited at the Worker layer because it is gated by
a 60 s single-use `state` token — abuse there self-throttles via KV misses.

## Security notes

- No tokens in URLs. Only `state` (CSRF) and `handoff_id` (opaque) cross the
  wire on the redirect/deep-link path.
- `state` is strictly validated (`^[A-Za-z0-9_-]{32,256}$`) on both endpoints
  before any KV access.
- KV is the only store this Worker uses; `state` TTL is 60 s and is deleted
  immediately on first read (KV has no atomic GETDEL — the read + delete pair
  is effectively single-use because subsequent reads will miss either due to
  the prior delete or the TTL).
- The Worker never logs `code`, `state`, `handoff_id`, or `OAUTH_SERVICE_TOKEN`.
  Status codes and durations only. `wrangler tail` will show no sensitive
  values.
- Response pages set `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`.
- The HTML deep-link page embeds the URL in a `JSON.stringify`d JS literal with
  an additional `</script>` escape, plus an attribute-escaped anchor fallback.
  `state` and `handoff_id` are pre-validated, so the embedding is a
  defense-in-depth measure.

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
