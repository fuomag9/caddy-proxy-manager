# API Security Review

Date: 2026-08-22
Reviewed revision: `184858b` (`develop`)
Scope: Next.js Route Handlers, Server Actions, authentication and forward-auth flows, persistence boundaries, Caddy/Docker integration, production deployment defaults, and locked dependencies.

> The detailed findings below preserve the evidence from the reviewed baseline. The status table records the remediation implemented after that review.

## Remediation status

| Finding | Status | Remediation |
|---|---|---|
| CPM-API-001 | Remediated | Forward-auth intents, exchanges, and sessions now bind the exact scheme/host/port and proxy-host ID. Generated Caddy subrequests preserve non-default ports, Caddy authenticates callback/verify subrequests with a derived HMAC proof, redemption is atomic, and legacy global sessions are invalidated by migration. |
| CPM-API-002 | Largely remediated (PR #296) | Portal login validates the redirect intent before hashing and resets only the completed flow's budget. Limiters are bounded, and portal logins are limited per client, per account and client, and per account over an hour. Oversized usernames and bodies are refused before any work. Client identity is the rightmost `X-Forwarded-For` entry or an operator-chosen `TRUSTED_CLIENT_IP_HEADER`, and the sync endpoint uses the same helper and a bounded limiter. The stock compose file still publishes port 3000; the README documents binding it to loopback. |
| CPM-API-004 | Remediated (read side earlier; write side in PR #296) | Both DNS-provider GET paths return credential-free metadata only, and DNS settings are redacted before crossing the Server Component/browser boundary. The REST write path now encrypts provider credentials, and startup encrypts plaintext DNS-provider and legacy Cloudflare credentials, including a slave's synced copies. |
| CPM-API-005 | Remediated | Bearer-authenticated requests cannot mint replacement API tokens; interactive session authentication is required. |
| CPM-API-006 | Remediated (PR #296) | Changing or adding a password revokes the user's other management sessions and all forward-auth sessions in the same transaction (the current session is kept). Adding a first password to an OAuth-only account requires a sign-in within the last 10 minutes. API tokens are kept by design, and the response says so. |
| CPM-API-007 | Remediated | Routine certificate API and browser payloads use allowlisted DTOs and never include private keys. Imported keys are encrypted at rest, legacy rows are migrated idempotently, synced keys are re-encrypted on the receiving instance, and legacy/local/synced provider options are scrubbed to the provider identifier only. |
| CPM-API-008 | Remediated | OAuth provider API and browser payloads expose only `hasClientSecret`; blank updates preserve the existing secret and explicit non-empty values rotate it. |
| CPM-API-009 | Remediated | Swagger UI JavaScript and CSS are bundled from exact package versions, and the admin CSP no longer permits jsDelivr. |
| CPM-API-011 | Remediated | Caddy, xcaddy, all plugins, the Dockerfile frontend, and build/runtime images are pinned. Dependabot updates Go/Docker dependencies, and a scheduled build-gated workflow derives Caddy's compatibility pin, verifies the image, and opens an update PR. |
| CPM-API-012 | Remediated (PR #296) | One server-side password policy applies to admin-created accounts (dashboard and REST), password changes, and Better Auth self-registration and reset, with API and Server Action tests. |
| CPM-API-013 | Remediated | Unexpected failures return a stable generic 500 plus correlation ID and use redacted structured logging. Raw Caddy responses, malformed environment values, and legacy synchronization errors are not disclosed. Token deletion combines ownership with deletion and returns the same not-found result for absent and inaccessible IDs. |
| CPM-API-014 | Remediated | Sync tokens use one strict policy across environment, settings, model, and REST paths; production slave startup fails closed; comparisons hash to fixed-length buffers; weak legacy outbound targets are skipped; environment target tokens are explicitly removed before browser serialization. |
| CPM-API-015 | Remediated | Every settings group has strict runtime validation, including unknown-key, type, range, enum, and size limits. Settings mutations share process-wide serialization across REST and dashboard paths, and failed Caddy application restores the exact prior stored value and reports failure. |

## Executive verdict

The API has a solid authorization foundation, but it is **not yet safe to describe as fully production-secure** because findings outside the requested remediation scope remain open.

No direct unauthenticated admin-API authorization bypass, IDOR across protected resources, SQL injection, command injection, request-derived filesystem path traversal, permissive CORS policy, or client-side token storage was found. All 82 `/api/v1` methods have a local `requireApiAdmin` or `requireApiUser` guard, and all protected non-v1 handlers and Server Actions inspected also enforce authentication locally.

The baseline review found two high-severity attack paths. This change remediates the forward-auth path; the ingress/rate-limit path remains open:

1. The forward-auth exchange code is sent to a user-influenced origin and is not bound to the origin that redeems it. Under wildcard/delegated-domain or alternate-port conditions, this can disclose a seven-day forward-auth session.
2. Public login and sync throttles trust spoofable proxy headers in the stock deployment. Custom limiters are unbounded, and public handlers buffer bodies or perform database/bcrypt work before trustworthy admission controls.

The review also found nine medium and four low findings, including plaintext DNS credentials through one REST path, recursively mintable API tokens, ineffective password-change incident remediation, over-broad private-key responses, secret serialization into the admin browser, and direct HTTP deployment defaults.

| Baseline severity | Count |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 9 |
| Low | 4 |

## Findings

### CPM-API-001 — Forward-auth exchange codes are not origin-bound

**Severity: High**

#### Evidence

- The portal accepts `rd` from the query string, retains its scheme and port, and checks only whether `parsed.hostname` is covered by a forward-auth-enabled host: `app/(auth)/portal/page.tsx:12-31`.
- Wildcard proxy-host patterns are accepted for this check: `src/lib/models/forward-auth.ts:388-421` and `src/lib/host-pattern-priority.ts:80-95`.
- A redirect intent accepts any HTTP(S) URL without credentials and stores that full URL: `src/lib/models/forward-auth.ts:25-50`.
- Credential and existing-session login authorize only `targetUrl.hostname`, then send the one-time exchange code to `targetUrl.origin`: `app/api/forward-auth/login/route.ts:85-125` and `app/api/forward-auth/session-login/route.ts:38-77`.
- The callback redeems a code without comparing its request host/protocol to the exchange's intended origin: `app/api/forward-auth/callback/route.ts:11-34` and `src/lib/models/forward-auth.ts:189-229`.
- The resulting token is a global forward-auth session. Host authorization occurs only later, when the token is presented to `/api/forward-auth/verify`: `app/api/forward-auth/verify/route.ts:13-35`.

#### Attack scenario

1. A forward-auth proxy host covers `*.example.com`, and an attacker controls or can route `evil.example.com`. An alternate attacker-controlled port on an exact configured hostname is another viable condition.
2. A victim with an active CPM management session visits `/portal?rd=https://evil.example.com/` on the trusted CPM origin.
3. The portal accepts the hostname match and automatically creates an exchange for the victim.
4. The browser sends the exchange code to the attacker's origin.
5. The attacker redeems the code through a legitimate CPM callback host. Because redemption is not audience-bound, the response yields a forward-auth cookie for the victim's global session.
6. The token grants the attacker access to any forward-auth host the victim is authorized to use.

The exchange is random, hashed, single-use, and expires after 60 seconds, but those controls do not prevent disclosure to the wrong origin.

#### Recommendation

- Bind redirect intents, exchange codes, and resulting sessions to an explicit audience containing the expected scheme, host, port, and preferably proxy-host ID.
- On callback, compare the trusted Caddy-provided request origin with that audience before atomically redeeming the code.
- Make forward-auth sessions host/proxy-host scoped so a code disclosed for one host cannot authorize another.
- Do not accept an unsigned portal `rd` as proof that a request originated from Caddy. Use a short-lived, server-created intent or an authenticated/signed handoff.
- Block direct access to the Next.js origin so clients cannot forge the callback's forwarded host/protocol.
- Add regression tests for wildcard subdomains, alternate ports/schemes, and cross-host code redemption.

#### Exploitability caveat

An exact-host-only deployment with no attacker-controlled service on another port and no delegated/wildcard subdomains substantially reduces practical exploitability. The missing origin/audience binding remains a protocol flaw.

---

### CPM-API-002 — Public authentication defenses trust spoofable IPs and permit resource exhaustion

**Severity: High**

#### Evidence

- Compose publishes the Next.js service on all host interfaces: `docker-compose.yml:15-16`.
- Better Auth rate limiting is enabled, but no trusted proxy/IP-header configuration is supplied: `src/lib/auth-server.ts:103-122`.
- Better Auth's configured/default client-IP header can be spoofed when the origin is directly reachable. Its own guidance requires a trusted proxy boundary for forwarded IPs: [Better Auth security guidance](https://better-auth.com/docs/reference/security) and [rate-limit guidance](https://better-auth.com/docs/beta/concepts/rate-limit).
- Forward-auth login trusts `X-Real-IP`, then the rightmost `X-Forwarded-For` value: `app/api/forward-auth/login/route.ts:39-44`.
- It accepts any nonempty `rid`, performs user lookup/bcrypt first, and validates the redirect intent only afterward: `app/api/forward-auth/login/route.ts:27-37,52-90`.
- A successful password check resets the IP-only bucket before the `rid` is validated: `app/api/forward-auth/login/route.ts:82-90`.
- Its process-global `Map` has no size cap or global expiry sweep; stale keys are removed only when the same key is looked up again: `src/lib/rate-limit.ts:12-35,52-77`.
- Every failed forward-auth attempt also writes an audit row, including an attacker-controlled username: `app/api/forward-auth/login/route.ts:58-78` and `src/lib/audit.ts:4-25`.
- Slave sync repeats the spoofable forwarded-IP/unbounded-`Map` pattern and allocates a key before bearer authentication: `app/api/instances/sync/route.ts:13,27-55,299-320`.
- Public forward-auth and account-linking routes call `request.json()` before a repository-level byte limit or trustworthy rate-limit decision: `app/api/forward-auth/login/route.ts:18-44` and `app/api/auth/link-account/route.ts:6-20`. The 2 MiB setting in `next.config.mjs:24-27` applies to Server Actions, not these Route Handlers.

#### Impact

- Rotating a syntactically valid forwarded IP bypasses per-IP brute-force limits.
- A known username forces repeated bcrypt work.
- Unique IP keys permanently grow the two custom maps until process restart.
- Invalid usernames grow the SQLite audit database.
- Oversized/chunked public request bodies can create memory pressure before authentication.

Caddy normally sanitizes incoming `X-Forwarded-*` headers when it is the mandatory ingress, but that protection does not cover a directly published Next.js port: [Caddy `reverse_proxy` documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

#### Recommendation

- Remove the public `3000:3000` mapping or bind it to loopback/internal networking, and make Caddy or another trusted edge the only ingress.
- Configure Better Auth's exact trusted proxies and IP-header behavior.
- Derive custom limiter identities only from a trusted connection/proxy chain.
- Use a bounded TTL/LRU or external atomic rate limiter with IP, normalized-account, and global budgets.
- Validate/claim `rid` before password hashing, and reset only the completed account/flow's budget.
- Authenticate sync before allocating attacker-selected limiter keys, while retaining a cheap bounded global unauthenticated limit at the edge.
- Enforce connection, timeout, and body-size ceilings at both the edge and public handlers before full JSON buffering.

#### Exploitability caveat

A firewall that blocks direct port 3000 access and a mandatory proxy that strips and overwrites client-IP headers mitigate spoofing. The repository's stock Compose setup does not establish either guarantee, and the unbounded custom maps remain unsafe.

---

### CPM-API-003 — The stock production path permits direct plaintext management traffic

**Severity: Medium; High when exposed to an untrusted network**

#### Evidence

- The web service is published as `3000:3000` on every host interface: `docker-compose.yml:15-16`.
- `BASE_URL` defaults to `http://localhost:3000`: `docker-compose.yml:29-30` and `src/lib/config.ts:158-164`.
- `.env.example` explicitly presents `http://192.168.1.100:3000` as a production-with-IP example: `.env.example:43-56`.
- Production validation checks the session secret and admin credentials but does not require HTTPS or an explicit insecure-network opt-out: `src/lib/config.ts:194-206`.
- Better Auth receives the HTTP base URL: `src/lib/auth-server.ts:103-112`. With an HTTP base URL, its session cookie is not marked `Secure` by default.
- No repository-managed TLS ingress protects the manager port. The Caddy service handles proxy-host traffic, not the published management port.

[Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting) recommends placing a reverse proxy in front of the Next.js server for malformed/slow-request handling, payload limits, rate limiting, and related edge controls.

#### Impact

On an untrusted LAN or Internet-reachable host, a network attacker can observe or modify administrator passwords, session cookies, bearer API tokens, imported private keys, and configuration changes. A public port also bypasses any header sanitization and limits configured only at an external edge.

#### Recommendation

- Expose the manager only through HTTPS; bind the origin to `127.0.0.1` or an internal Docker network.
- Fail production startup when `BASE_URL` is not HTTPS, except behind an explicit, clearly named local-network opt-out.
- Set HSTS at the TLS edge after HTTPS-only operation is established.
- Document the edge topology and trusted proxy configuration as part of the supported production deployment.

#### Exploitability caveat

Plain HTTP is acceptable for loopback-only development or a genuinely isolated management network. Publishing on all interfaces makes that an operator-dependent assumption rather than a secure default.

---

### CPM-API-004 — REST DNS-provider credentials bypass encryption at rest

**Severity: Medium**

#### Evidence

- `PUT /api/v1/settings/dns-provider` passes the parsed body unchanged through the generic settings handler: `app/api/v1/settings/[group]/route.ts:37,85-87,113-120`.
- `saveDnsProviderSettings` directly calls `setSetting`, which only serializes the object and writes it to SQLite: `src/lib/settings.ts:172-189,275-276`.
- The dashboard separately calls `encryptProviderCredentials` before the same save function: `app/(dashboard)/settings/actions.ts:245-270`.
- The encryption helper uses authenticated AES-256-GCM for password-type provider fields: `src/lib/dns-providers.ts:271-288` and `src/lib/secret.ts:21-31`.
- Plaintext remains operational because decryption intentionally returns unencrypted legacy values unchanged: `src/lib/secret.ts:44-46`.
- GET returns the stored settings object as-is: `app/api/v1/settings/[group]/route.ts:68-74`.
- The documented behavior promises encrypted DNS-provider credentials: `README.md:161-165`.

#### Impact

An administrator using the REST API stores DNS API credentials in plaintext. A copied SQLite database, volume, or backup can then disclose tokens capable of changing DNS records or satisfying DNS-01 challenges. Later REST reads also return that plaintext value.

#### Recommendation

- Move encryption to the shared `saveDnsProviderSettings` persistence boundary; do not rely on individual callers.
- Validate known providers and credential fields, preserve already encrypted values idempotently, and migrate plaintext legacy/synced rows.
- Return redacted provider metadata rather than stored ciphertext/plaintext from GET.
- Add an integration test that PUTs plaintext, asserts an `enc:v1:` database value, and verifies Caddy receives the decrypted credential.

#### False-positive caveat

Encryption derived from `SESSION_SECRET` does not protect a live host where the database and environment are both compromised. It still protects separated database copies/backups and is the behavior the project documents.

---

### CPM-API-005 — Bearer tokens can recursively mint non-expiring replacements

**Severity: Medium**

#### Evidence

- A bearer token is accepted as full API authentication: `src/lib/api-auth.ts:27-47`.
- `POST /api/v1/tokens` uses `requireApiUser`, so either a session or an existing bearer token can create a new token: `app/api/v1/tokens/route.ts:15-41`.
- Expiration is optional and stored as `null` when omitted: `src/lib/models/api-tokens.ts:55-80`.
- Viewer and user roles can create and manage their own tokens. Tests explicitly encode this behavior: `tests/e2e/api-security.spec.ts:143-146,294-321`.
- The README role matrix says only admins may create API tokens or access `/api/v1`: `README.md:140-153`.

#### Impact

A stolen token with a short expiry can mint a non-expiring replacement. Expiring or revoking only the original credential therefore does not contain the compromise. This is persistence amplification, not a role escalation: child tokens inherit the owner's current role and are rejected when the account is disabled.

#### Recommendation

- Do not permit bearer-authenticated requests to issue new credentials without recent interactive/session authentication.
- If delegated token issuance is intentional, require scopes, constrain child scopes to a subset, and cap child expiry at or before the parent expiry.
- Record token lineage and support cascading revocation.
- Decide whether self-service token creation is intended for viewer/user roles and align code, tests, and documentation.

---

### CPM-API-006 — Password changes do not remediate stolen sessions, and OAuth-only accounts can add a password without reauthentication

**Severity: Medium**

#### Evidence

- Password change updates only the user and Better Auth credential hashes: `app/api/user/change-password/route.ts:84-88` and `src/lib/models/user.ts:142-159`.
- Management sessions last seven days: `src/lib/auth-server.ts:135-139`.
- Forward-auth sessions independently last seven days: `src/lib/models/forward-auth.ts:14,101-127`.
- Authentication refreshes current user status/role but has no password-version or changed-at check: `src/lib/auth.ts:60-75`.
- Session-revocation helpers exist but are not called after password change: `src/lib/models/sessions.ts:42-72`.
- When an OAuth-only account has no `passwordHash`, the route skips current-password verification and requires no recent OAuth reauthentication: `app/api/user/change-password/route.ts:62-79`.

#### Impact

A victim cannot rely on password rotation to evict an attacker holding an existing management or forward-auth session. If an OAuth-only account's session is stolen, the attacker can add a password and establish a durable credential without proving recent control of the original authentication method.

#### Recommendation

- Require recent reauthentication before adding a password or performing sensitive credential changes.
- Revoke all other management and forward-auth sessions after a password is added/changed, and rotate the current session.
- Offer an explicit API-token revocation choice; automatic token revocation is policy-dependent because tokens may represent intentional automation.

#### False-positive caveat

Preserving sessions can be an intentional UX decision. It weakens incident response and is especially unsafe for adding a new password-based authentication method.

---

### CPM-API-007 — Certificate APIs return imported private keys by default and store them plaintext

**Severity: Medium**

#### Evidence

- The public certificate model contains `privateKeyPem`, and both list/get models populate it from the database: `src/lib/models/certificates.ts:9-20,34-58`.
- Admin list and item GET endpoints serialize those objects directly: `app/api/v1/certificates/route.ts:5-10` and `app/api/v1/certificates/[id]/route.ts:5-16`.
- Create/update persist private keys directly to SQLite: `src/lib/models/certificates.ts:72-90,108-137`.
- E2E coverage deliberately expects byte-for-byte private-key readback: `tests/e2e/certificates.spec.ts:223-235`.
- The README acknowledges plaintext private-key storage: `README.md:134-136,167`.

#### Impact

A stolen admin session or API token can bulk-export all imported TLS private keys through the list endpoint. Database/backup disclosure has the same permanent impact. Possession of these keys can outlive revocation of the CPM credential.

#### Recommendation

- Make private keys write-only in ordinary list/get/create/update responses; return `hasPrivateKey` metadata.
- If export is a required feature, put it behind a dedicated audited endpoint with recent reauthentication and explicit operator intent.
- Encrypt imported keys at rest with a key separated from the database, and document backup/key-rotation procedures.
- Add `Cache-Control: no-store` to sensitive administration responses.

#### False-positive caveat

The routes are admin-only and the current behavior may be an intentional export feature. Returning secrets in every ordinary list response is still unnecessary exposure and increases the consequence of an admin credential compromise.

---

### CPM-API-008 — OAuth client secrets are serialized into the admin browser

**Severity: Medium**

#### Evidence

- Provider parsing decrypts `clientId` and `clientSecret`: `src/lib/models/oauth-providers.ts:27-44`.
- The settings Server Component loads the full providers and passes them into a Client Component: `app/(dashboard)/settings/page.tsx:17-32,57-73`.
- Client state receives the full objects and pre-fills the existing secret: `app/(dashboard)/settings/OAuthProvidersSection.tsx:27-30,58-62,80-93`.
- The REST API correctly redacts these fields, demonstrating a safer established pattern: `app/api/v1/oauth-providers/route.ts:8-24` and `app/api/v1/oauth-providers/[id]/route.ts:8-28`.

#### Impact

Plaintext IdP client secrets appear in the React Server Component payload and browser memory. A same-origin script compromise, malicious extension, browser debugging capture, or support recording can recover a long-lived credential usable outside CPM.

#### Recommendation

- Pass a server-only safe DTO containing `hasClientSecret`, never the existing secret.
- Treat a blank update field as “preserve existing secret,” with a distinct explicit rotation operation.
- Add a test asserting that the secret is absent from HTML, RSC payloads, and JSON responses.

#### False-positive caveat

Only an authenticated admin page receives the value. Administrators can manage providers, but they do not need the existing plaintext secret for normal editing.

---

### CPM-API-009 — API documentation executes mutable third-party JavaScript in the admin origin

**Severity: Medium**

#### Evidence

- The API docs page is admin-only: `app/(dashboard)/api-docs/page.tsx:8-11`.
- It dynamically loads `swagger-ui-dist@5` JavaScript and CSS from jsDelivr without an exact patch version or Subresource Integrity: `app/(dashboard)/api-docs/ApiDocsClient.tsx:13-17,34-50`.
- The CSP explicitly authorizes scripts from that CDN: `proxy.ts:21-29`.

#### Impact

A compromised CDN response, package release, or dependency-owner account can execute arbitrary same-origin JavaScript while an admin is logged in. That script can perform authenticated API operations and exfiltrate the secrets exposed to the browser.

#### Recommendation

- Install, exactly pin, and self-host Swagger UI assets.
- Remove the third-party script origin from CSP after self-hosting.
- If remote delivery is unavoidable, pin an immutable exact asset URL and use reviewed SRI hashes with `crossOrigin="anonymous"`.

#### False-positive caveat

Exploitation requires a supply-chain/CDN failure or malicious upstream release, not an ordinary untrusted API request. The potential impact is administrator-origin code execution.

---

### CPM-API-010 — A web-container compromise can cross into Docker host control through the L4 sidecar

**Severity: Medium (defense-in-depth; High impact)**

#### Evidence

- The web process writes a Compose override and trigger into `/app/data`: `src/lib/l4-ports.ts:24-27,125-159`.
- The web and privileged L4 sidecar share the same data volume: `docker-compose.yml:69-76,167-181`.
- The sidecar consumes that override and invokes `docker compose up` through a Docker socket proxy: `docker/l4-port-manager/entrypoint.sh:92-106`.
- The proxy permits container, image, network, volume, and POST operations: `docker-compose.yml:134-160`. Repository comments correctly note that container creation can become host-root control.

#### Impact

Any future arbitrary-file-write or code-execution flaw in the web container can replace the Compose override consumed by the sidecar and request a malicious Caddy container definition. This defeats the intended web/container isolation and can lead to Docker-host compromise.

#### Recommendation

- Never execute a Compose document from a web-writable volume.
- Send only a tightly validated numeric port list to a small broker that constructs a fixed Docker API update internally.
- Minimize the socket proxy to the exact operations and target container required; prefer rootless orchestration where feasible.

#### False-positive caveat

Normal API-generated L4 values are constrained to terminal digits before YAML generation: `src/lib/l4-ports.ts:48-68`. No API-input YAML injection was found. This finding requires a separate web-process arbitrary-write/RCE primitive and describes the resulting privilege escalation boundary.

---

### CPM-API-011 — The security-critical Caddy build is not reproducible

**Severity: Medium (supply-chain)**

#### Evidence

- The image installs `xcaddy@latest`, builds Caddy from `master`, and adds unversioned plugins: `docker/caddy/Dockerfile:7-38`.
- Several plugins directly affect TLS, DNS credentials, WAF behavior, L4 handling, and request authorization.

#### Impact

Two builds from the same CPM revision can compile different, unaudited proxy code. An upstream branch/tag compromise or accidental breaking release can silently alter the component enforcing API-adjacent TLS and proxy trust boundaries.

#### Recommendation

- Pin xcaddy, Caddy, each plugin, and base images to reviewed versions/digests.
- Generate an SBOM and retain the resolved Go module graph with build artifacts.
- Add image scanning and Caddy configuration/security regression tests before publishing.

---

### CPM-API-012 — Admin-created accounts can use arbitrarily weak passwords

**Severity: Low**

#### Evidence

- `POST /api/v1/users` accepts any nonempty password and can create an administrator: `app/api/v1/users/route.ts:23-47`.
- The dashboard Server Action enforces the same nonempty-only rule: `app/(dashboard)/users/actions.ts:17-41`.
- Client-side creation uses only a bypassable eight-character minimum: `app/(dashboard)/users/UsersClient.tsx:125`.
- Password change and production bootstrap require at least 12 characters plus mixed case, number, and special character: `app/api/user/change-password/route.ts:31-53` and `src/lib/config.ts:100-125`.

#### Impact

An administrator can create a user or administrator with a one-character password, making remote compromise far easier and contradicting the project's stated production password policy.

#### Recommendation

Use one shared server-side password-policy validator at the account persistence/service boundary, including all creation, reset, and change paths. Add API and Server Action tests for rejection.

#### False-positive caveat

An existing administrator must choose the weak credential. This is a secure-default and policy-consistency failure, not an unauthenticated bypass.

---

### CPM-API-013 — Generic API failures disclose internal messages and token-ID existence

**Severity: Low**

#### Evidence

- `apiErrorResponse` returns unexpected `error.message` values verbatim in a 500 response: `src/lib/api-auth.ts:97-115`.
- Caddy apply errors can contain raw Caddy response content and internal API URLs: `src/lib/caddy.ts:2739-2767`.
- Token deletion fetches an arbitrary ID first, returns 404 if absent, and throws plain `Forbidden` if it exists but is owned by another user: `src/lib/models/api-tokens.ts:105-125`.
- The generic handler turns that authorization error into a distinguishable 500 response containing `Forbidden`: `src/lib/api-auth.ts:97-115`.
- Existing unit coverage explicitly expects a raw unexpected message: `tests/unit/api-auth.test.ts:193-198`.

#### Impact

Authenticated clients can learn internal implementation details and enumerate allocated token IDs through 404-versus-500 behavior. No raw token value or unauthorized deletion was found.

#### Recommendation

- Return a stable generic 500 with a correlation ID; log structured, redacted detail server-side.
- Use typed safe 4xx errors for validation, authorization, and not-found cases.
- Authorize ownership in the query or return the same not-found response for inaccessible objects.

---

### CPM-API-014 — Instance-sync authentication has configuration and malformed-input edge cases

**Severity: Low**

#### Evidence

- UI and REST settings require a sync token of at least 32 characters: `app/(dashboard)/settings/actions.ts:19-33` and `app/api/v1/settings/[group]/route.ts:101-109`.
- The environment-variable path accepts any nonempty `INSTANCE_SYNC_TOKEN`, and production startup does not validate it: `src/lib/instance-sync.ts:145-181` and `src/lib/config.ts:194-206`.
- `secureTokenCompare` pads/slices by JavaScript UTF-16 length, then creates UTF-8 buffers and calls `timingSafeEqual`: `app/api/instances/sync/route.ts:18-24`.
- A non-ASCII bearer value can make those buffers different byte lengths and raise `RangeError` before the handler's try/catch at `app/api/instances/sync/route.ts:314-322`.

#### Impact

An operator can accidentally deploy a brute-forceable slave credential, compounded by CPM-API-002. Malformed unauthenticated Unicode bearer values produce a 500 response and log/noise availability issue.

#### Recommendation

- Fail startup in slave mode unless the environment token meets the same minimum and is generated from at least 256 bits of randomness.
- Hash both presented and expected tokens to fixed-length SHA-256 buffers before `timingSafeEqual`, and treat malformed input as 401.

#### Verification note

A local proof reproduced the comparison failure: a two-code-unit emoji padded to a 32-character ASCII secret created 34-byte versus 32-byte buffers, causing Node's `timingSafeEqual` to throw.

---

### CPM-API-015 — Generic settings writes lack runtime schemas and report failed Caddy application as success

**Severity: Low**

#### Evidence

- Most settings groups cast arbitrary parsed JSON to TypeScript types and call persistence without a runtime schema: `app/api/v1/settings/[group]/route.ts:113-120`.
- Only default-response and a few special groups have explicit route-level validation: `app/api/v1/settings/[group]/route.ts:89-127`.
- Settings are persisted before Caddy application. An apply failure is logged and the API still returns `200 {"ok":true}`: `app/api/v1/settings/[group]/route.ts:130-138`.
- Unit coverage explicitly asserts this success response after apply failure: `tests/unit/api-routes/settings.test.ts:322-330`.

#### Impact

An authenticated administrator can persist malformed settings, silently fail to apply them, and leave stored state different from active Caddy state. This is primarily an integrity/operational risk rather than a lower-privilege security bypass.

#### Recommendation

- Define strict per-group runtime schemas with size/range/enum/unknown-key policies.
- Validate and dry-run the resulting Caddy configuration before committing, or transactionally roll back persistence on apply failure.
- Return an accurate non-2xx response or an explicit partial-failure status.

## Strong controls observed

- **Route-level authorization:** 68 Route Handler files and 108 exported methods were inventoried. All 82 `/api/v1` methods invoke `requireApiAdmin` or `requireApiUser`; intentionally public exceptions are authentication protocol endpoints, health, and token-protected slave sync.
- **Server Actions:** All 66 exported actions across 10 `"use server"` files invoke `requireAdmin` or `requireUser`.
- **Fresh authorization state:** Session and bearer authorization reload current database status/role, so account disablement and demotion take effect immediately: `src/lib/auth.ts:60-75` and `src/lib/models/api-tokens.ts:151-173`.
- **CSRF:** Cookie-authenticated mutations require an `Origin` matching `Host`; bearer authentication correctly does not rely on browser-CSRF protection: `src/lib/api-auth.ts:69-91` and `src/lib/auth.ts:127-153`.
- **Fail-closed auth configuration:** Better Auth pins `baseURL`, keeps `trustHost` off by default, restricts trusted origins, disables registration by default, and prevents IdP role/status injection unless explicitly enabled: `src/lib/auth-server.ts:103-130,156-189`.
- **Token storage:** API tokens are generated with 32 random bytes and stored only as SHA-256 hashes; expiry and current account status are checked: `src/lib/models/api-tokens.ts:29-31,55-87,130-173`.
- **OAuth storage/API redaction:** OAuth tokens and provider credentials use authenticated encryption at rest, and REST provider responses redact credentials: `src/lib/models/oauth-providers.ts:64-72` and `app/api/v1/oauth-providers/route.ts:8-24`.
- **Database query safety:** Drizzle queries are parameterized. ClickHouse request filters use typed query parameters. No request-controlled SQL string concatenation was found: `src/lib/clickhouse/client.ts:316-366`.
- **Code execution and files:** No runtime `child_process`, `eval`, request-derived filesystem path sink, or API-input YAML/command injection was found. L4 port YAML derives only terminal numeric ports: `src/lib/l4-ports.ts:48-68,125-159`.
- **Structured Caddy input:** Proxy domains, default-response headers, error pages, WAF directives, and prototype-pollution-sensitive custom JSON merges have meaningful validation: `src/lib/proxy-host-domains.ts:3-51`, `src/lib/caddy-default-response.ts:16-123`, `src/lib/caddy-waf.ts:91-187`, and `src/lib/caddy-utils.ts:37-51`.
- **Forward-auth primitives:** Redirect IDs, exchange codes, and session tokens are random and hashed; intent/exchange claims are atomic and expiring: `src/lib/models/forward-auth.ts:25-90,101-127,167-229`.
- **Identity-header handling:** Caddy strips client-supplied CPM identity headers and overwrites forwarded host/protocol for internal verification: `src/lib/caddy.ts:1398-1456`.
- **Uploads:** Avatar inputs are MIME-allowlisted and size-bounded: `app/api/user/update-avatar/route.ts:20-45`.

## Verification performed

### Automated tests

After remediation, `bun run test` passed:

- 95 test files
- 1,133 tests
- 0 failures

The new regression coverage exercises wrong-origin, wrong-port, and wrong-proxy-host forward-auth redemption; forged direct-origin proof headers; recursive bearer-token minting; DNS/OAuth/certificate browser and REST secret boundaries; certificate-key encryption, migration, and hostile synchronization input; weak and malformed sync tokens; structured error responses and legacy-error scrubbing; token-ID non-enumeration; strict settings validation, rollback, and cross-entrypoint serialization; environment-token browser redaction; self-hosted API documentation; and reproducible/autobumpable Caddy pins.

`bun run typecheck`, `bun run lint`, and `git diff --check` also passed. A real multi-stage Caddy image build completed with Caddy `v2.11.4`, the compatibility updater, and every pinned plugin. The Next.js webpack build completed compilation and type checking; page-data collection is still blocked by the repository's existing `bun:sqlite`/Next worker-runtime incompatibility.

The Docker E2E stack was not run, so live Playwright/API security tests were not executed. Playwright successfully discovered and compiled 812 tests across 58 files, including the updated security assertions.

### Baseline coverage gaps at reviewed revision

- The API security matrix contains 77 methods while the repository exports 82 `/api/v1` methods. It omits `POST /users`, `GET /dns-providers`, `GET /sessions`, `DELETE /sessions`, and `DELETE /sessions/:id`.
- The matrix authenticates with bearer tokens and therefore does not exercise cookie-authenticated mutation/CSRF behavior: `tests/e2e/api-security.spec.ts:210-220`.
- Unit tests mock `checkSameOrigin`; they verify orchestration rather than the real Origin/Host parser: `tests/unit/api-auth.test.ts:8-12,130-167`.
- No regression test covers cross-origin/cross-host forward-auth exchange redemption, spoofed client-IP cardinality, limiter reset ordering, weak account creation passwords, or DNS-provider encryption through REST.

### Dependency audit

`bun audit --production` reported 19 advisories (9 high, 9 moderate, 1 low), but that aggregate substantially overstates shipped runtime exposure:

- Overrides now resolve every `js-yaml` and `brace-expansion` path to patched `4.3.1` and `5.0.9` releases respectively; neither package appears in the remaining audit report.
- Vite, Vitest, YAML, esbuild, picomatch, and affected nested Nanoid/PostCSS copies are build/development paths in this project. The production image copies `.next/standalone`, not the complete development `node_modules` tree: `docker/web/Dockerfile:38-45`.
- Root PostCSS `8.5.26` and Nanoid `3.3.18` are fixed versions; affected copies are nested under build tooling.
- `protocol-buffers-schema@3.6.0` is locked through MapLibre/PBF tooling and is affected by [GHSA-j452-xhg8-qg39](https://github.com/advisories/GHSA-j452-xhg8-qg39), fixed in `3.6.1`. MapLibre's observed runtime imports use `PbfReader`, while the schema parser is used by PBF CLI/tooling, so runtime exploitability was not demonstrated. Upgrade/override it regardless to prevent future reachability.

Do not represent the audit aggregate as nine proven production High vulnerabilities.

## Baseline prioritized remediation

1. **Immediately:** origin/audience-bind the forward-auth flow and add cross-host/wildcard regression tests.
2. **Immediately:** make a trusted TLS edge mandatory, remove direct port 3000 exposure, configure trusted proxies, bound the rate limiters, validate intent before bcrypt, and add public body-size limits.
3. **Next:** encrypt DNS-provider credentials at the shared persistence boundary and migrate plaintext rows.
4. **Next:** prevent bearer-token credential minting, add token scope/lineage/expiry constraints, and align the role documentation.
5. **Next:** require recent reauthentication for password addition/change and revoke other management/forward-auth sessions.
6. **Next:** remove private keys and OAuth secrets from routine response/browser payloads; encrypt imported keys at rest.
7. **Then:** self-host pinned Swagger assets, redesign the L4 sidecar broker boundary, and pin the Caddy build supply chain.
8. **Then:** enforce password policy on every creation path, normalize error responses, harden sync token validation, and add strict settings schemas/transactional apply behavior.

## Bottom line

The core RBAC, CSRF, token hashing, database query construction, and Caddy input validation are thoughtfully implemented. The requested remediations materially strengthen the forward-auth protocol, secret boundaries, error handling, instance sync, settings integrity, documentation supply chain, and Caddy build. The stock ingress/rate-limit design in CPM-API-002 and other findings outside this change remain sufficient to answer the broader review question with **“not yet”** for an untrusted production network.
