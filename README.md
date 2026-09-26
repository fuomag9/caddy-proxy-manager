# Caddy Proxy Manager

Web interface for managing [Caddy Server](https://caddyserver.com/) reverse proxies and certificates.

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://mit-license.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)

[Report Bug](https://github.com/fuomag9/caddy-proxy-manager/issues) • [Request Feature](https://github.com/fuomag9/caddy-proxy-manager/issues)

<img width="100%" alt="Dashboard" src="site/assets/screenshots/dashboard-main.png" />

## Overview

This project provides a web UI for Caddy Server, eliminating the need to manually edit JSON configurations or Caddyfiles. It handles reverse proxies, access lists, and certificate management through a shadcn/ui interface. Built with Next.js 16, React 19, shadcn/ui, Tailwind CSS, Drizzle ORM, and TypeScript. Analytics data (traffic events, WAF events) is stored in ClickHouse for fast aggregation queries, with automatic retention via TTL (30 days by default, configurable).

---

## Installation

```bash
git clone https://github.com/fuomag9/caddy-proxy-manager.git
cd caddy-proxy-manager
cp .env.example .env
# Fill in SESSION_SECRET, ADMIN_PASSWORD and CLICKHOUSE_PASSWORD
# (generate the secrets with: openssl rand -base64 32)
docker compose up -d
```

Access at `http://localhost:3000/login`

Upgrading an existing installation? Read the [Upgrade Notes](#upgrade-notes) first.

Data persists in Docker volumes (caddy-manager-data, caddy-data, caddy-config, caddy-logs).

---

## Features

- **Proxy Hosts** - Reverse proxies with custom headers, multiple upstreams, load balancing (8 policies), active/passive health checks, retries, and enable/disable toggle
- **L4 Proxy Hosts** - TCP/UDP stream proxying with TLS SNI matching, proxy protocol (v1/v2), load balancing, health checks, and per-host geo blocking. Automatic Docker Compose port management via sidecar
- **Location Rules** - Path-based routing to different upstreams per proxy host (e.g. `/api/*` to one backend, `/ws/*` to another)
- **Redirect & Rewrite** - Per-host redirect rules (301/302/307/308) and path prefix rewriting
- **Forward Auth Portal** - Built-in identity provider for protecting proxy hosts without an external IdP. Credential and OAuth login portal, user groups with membership management, per-host access control by user or group, and excluded paths that bypass authentication
- **WAF** - Web Application Firewall powered by Coraza with optional OWASP Core Rule Set (SQLi, XSS, LFI, RCE). Per-host enable/disable, global and per-host rule suppression, custom SecLang directives, and a searchable event log with severity and blocked/detected classification
- **Analytics** - Live traffic charts, protocol breakdown, country map, top user agents, and blocked request log with configurable time ranges
- **Geo Blocking** - Block or allow traffic by country, continent, ASN, CIDR range, or exact IP per proxy host. Allow rules override block rules. Fail-closed mode, custom response codes/bodies, and trusted proxy support
- **Access Lists** - Multi-account HTTP basic auth protection (bcrypt-hashed) assignable per proxy host
- **Certificates** - Automatic HTTPS for every proxy host via Caddy ACME (Let's Encrypt / ZeroSSL), manual SSL/TLS import with expiry monitoring, and a built-in CA for issuing and revoking internal client certificates (mTLS)
- **mTLS** - Mutual TLS per proxy host using built-in CA certificates. Issue, track, and revoke client certificates. Fail-closed revocation (all certs revoked = all connections rejected)
- **mTLS RBAC** - Role-based access control for mTLS client certificates. Define roles, assign certs to roles, and create path-based access rules per proxy host (e.g. `/admin/*` requires the "ops" role)
- **User Roles** - Three-tier role system (Viewer, User, Admin) controlling dashboard access, API permissions, and feature visibility
- **User Management** - Admin page for managing users: edit roles, status, profiles; disable or delete accounts; search and filter
- **Groups** - Organize users into groups for forward auth access control. Assign groups to proxy hosts to grant access to all members at once
- **Authentik Integration** - Forward-auth SSO per proxy host with configurable header forwarding and protected paths
- **DNS Controls** - Custom DNS resolvers per host, upstream DNS pinning with IPv4/IPv6/both address family selection
- **REST API** - Full REST API under `/api/v1/` with Bearer token authentication, covering all resources. Interactive OpenAPI 3.1.0 docs at `/api-docs`
- **API Tokens** - Create and manage API tokens with optional expiration for programmatic access
- **Instance Sync** - Master/slave configuration sync for multi-instance deployments. The master pushes proxy hosts, certificates, access lists, and settings to slaves on every change, with secrets sealed to each slave's own key
- **Default Response** - Replace Caddy's native behavior for unknown hosts or direct-IP requests with a custom status/body/headers, redirect, or connection abort
- **OAuth / SSO** - OAuth2/OIDC authentication with any compliant provider (Authentik, Keycloak, Auth0, etc.). Account linking from the Profile page
- **DNS Providers** - Multi-provider DNS-01 challenge support for ACME certificates: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, netcup, Spaceship, deSEC, Dynu, acme-dns, Infomaniak, ClouDNS, and RFC2136 (BIND/TSIG). Credentials encrypted at rest. Per-certificate provider override supported. Configurable DNS propagation delay/timeout per provider (netcup ships with slow-propagation defaults)
- **Settings** - ACME email, default response, DNS provider configuration, upstream DNS pinning defaults, Authentik outpost, Prometheus metrics, logging format
- **Audit Log** - Searchable configuration change history with user attribution and pagination
- **Search & Pagination** - Server-side search and pagination on all data tables
- **Dark Mode** - Full dark/light theme support with system preference detection
- **Mobile UI** - Fully responsive interface optimised for iPhone and other narrow viewports

---

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SESSION_SECRET` | Session encryption key (32+ chars). Also encrypts stored secrets | None | **Yes** |
| `SESSION_SECRET_PREVIOUS` | Earlier `SESSION_SECRET` values (comma-separated), only used to decrypt stored secrets after a rotation. See [Rotating SESSION_SECRET](#rotating-session_secret) | None | No |
| `ADMIN_USERNAME` | Admin login username: 3–255 characters from `A-Z a-z 0-9 _ . @ -` (the login page refuses others and ignores case) | `admin` | **Yes** |
| `ADMIN_PASSWORD` | Admin password (see requirements below) | `admin` (dev only) | **Yes** |
| `BASE_URL` | Public URL where users access the dashboard.<br/>**Required for OAuth** - must match redirect URI | `http://localhost:3000` | **Yes** (if using OAuth) |
| `CADDY_API_URL` | Caddy Admin API endpoint | `http://caddy:2019` (prod)<br/>`http://localhost:2019` (dev) | No |
| `DATABASE_URL` | SQLite database URL | `file:/app/data/caddy-proxy-manager.db` | No |
| `CERTS_DIRECTORY` | Certificate storage directory | `./data/certs` | No |
| `LOGIN_MAX_ATTEMPTS` | Max login attempts before rate limit | `5` | No |
| `LOGIN_WINDOW_MS` | Rate limit window in milliseconds | `300000` (5 min) | No |
| `LOGIN_BLOCK_MS` | Rate limit block duration in milliseconds | `900000` (15 min) | No |
| `FORWARD_AUTH_ALLOWED_PORTS` | Non-standard ports (comma-separated, e.g. `8443`) on which browsers reach forward-auth protected sites | None | No (required for such ports) |
| `TRUSTED_CLIENT_IP_HEADER` | Header holding the real client IP for the portal login and sync endpoint rate limits (e.g. `cf-connecting-ip` behind a CDN). Leave unset when Caddy is the outermost proxy; set it only if every route to CPM overwrites that header. See [Login rate limits](#login-rate-limits) | None (rightmost `X-Forwarded-For`) | No |
| `OAUTH_ENABLED` | Enable OAuth2/OIDC authentication | `false` | No |
| `OAUTH_PROVIDER_NAME` | Display name for OAuth provider | `OAuth2` | No |
| `OAUTH_CLIENT_ID` | OAuth2 client ID | None | No |
| `OAUTH_CLIENT_SECRET` | OAuth2 client secret | None | No |
| `OAUTH_ISSUER` | OAuth2 OIDC issuer URL | None | No |
| `OAUTH_AUTHORIZATION_URL` | Optional OAuth authorization endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_TOKEN_URL` | Optional OAuth token endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_USERINFO_URL` | Optional OAuth userinfo endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_ALLOW_AUTO_LINKING` | Allow auto-linking OAuth identities to existing users | `false` | No |
| `AUTH_TRUST_HOST` | Trust the Host header for URL construction (only behind proxies that rewrite Host) | `false` | No |
| `AUTH_ALLOW_SELF_REGISTRATION` | Allow public email/password account registration | `false` | No |
| `AUTH_ALLOW_OAUTH_REGISTRATION` | Allow first-time OAuth/OIDC identities to create user accounts | `false` | No |
| `AUTH_RATE_LIMIT_ENABLED` | Enable Better Auth rate limiting | `true` | No |
| `AUTH_RATE_LIMIT_WINDOW` | Rate limit window in seconds | `60` | No |
| `AUTH_RATE_LIMIT_MAX` | Max requests per window | `5` | No |
| `INSTANCE_MODE` | Instance role: `standalone`, `master`, or `slave` | `standalone` | No |
| `INSTANCE_SYNC_TOKEN` | Bearer token slaves use to authenticate sync requests (32+ characters) | None | No (required if `slave`) |
| `INSTANCE_SLAVES` | JSON array of slave instances for the master to push to (tokens must be 32+ characters) | None | No |
| `INSTANCE_SYNC_INTERVAL` | Periodic sync interval in seconds (`0` = disabled) | `0` | No |
| `INSTANCE_SYNC_ALLOW_HTTP` | Allow sync over HTTP (for internal Docker networks) | `false` | No |
| `INSTANCE_SYNC_TIMEOUT_MS` | Master only: time limit for one sync request to a slave, including the slave's apply (clamped to `5000`–`300000`) | `60000` (60 s) | No |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint for analytics | `http://clickhouse:8123` | No |
| `CLICKHOUSE_USER` | ClickHouse username | `cpm` | No |
| `CLICKHOUSE_PASSWORD` | ClickHouse password (`openssl rand -base64 32`). Required when the `clickhouse` profile is active. | None | No (required if analytics enabled) |
| `CLICKHOUSE_DB` | ClickHouse database name | `analytics` | No |

**Production Requirements:**
- `SESSION_SECRET`: 32+ characters (`openssl rand -base64 32`), not an example value from the documentation
- `ADMIN_PASSWORD`: 12+ chars with uppercase, lowercase, numbers, and special characters, not an example password from the documentation

Development mode (`NODE_ENV=development`) allows default `admin`/`admin` credentials.

---

## Upgrade Notes

Pull the new images and recreate the containers with `docker compose pull && docker compose up -d`. (`docker compose restart` does not re-read `.env`.)

### Upgrading from v1.12.0 or earlier

**Check before upgrading:**

- **Example secrets are rejected.** The web container refuses to start when `SESSION_SECRET` is a shipped placeholder (including the old `.env.example` value `your-secure-session-secret-here-min-32-chars`) or `ADMIN_PASSWORD` is an example password from an earlier README or `.env.example`. Generate a new secret with `openssl rand -base64 32`. Stored secrets encrypted under the placeholder are re-encrypted automatically on the next start, so nothing has to be re-entered. With instance sync, the master and each slave can generate their own (see the next item). `.env.example` now leaves `SESSION_SECRET`, `ADMIN_PASSWORD` and `CLICKHOUSE_PASSWORD` empty.
- **Instance sync: upgrade slaves before, or together with, the master.** A master on this release seals certificate private keys and the secrets inside synced settings (DNS provider credentials) to each slave's own key, and each slave stores them encrypted with its own `SESSION_SECRET`, so master and slaves no longer need to share it (see [Instance Sync](#instance-sync)). A slave still on v1.12.0 or earlier gets what older masters sent: certificate private keys unsealed and DNS provider credentials encrypted with the master's `SESSION_SECRET`, so until it is upgraded it needs the master's secret as its own `SESSION_SECRET`, or applying the synced config fails. The master logs `Instance sync: slave "<name>" does not publish a sync key (older release)…` once per such slave. A master still on v1.12.0 or earlier sends DNS provider credentials encrypted with its own `SESSION_SECRET`, so while it does, every slave needs the master's secret as its `SESSION_SECRET` or in `SESSION_SECRET_PREVIOUS`; otherwise the slave cannot decrypt them and applying the synced config fails. Nothing is needed while the master uses the old placeholder secret, since values encrypted under it always decrypt.
- **Proxies in front of a slave** must pass `GET` as well as `POST` on `/api/instances/sync`, with the `Authorization` header, and must not cache the `GET` reply. The master uses it to fetch the slave's sync key before every sync. A proxy that answers `GET` with `405` makes an upgraded slave look like an older release (previous item); any other refusal fails the sync with *"Sync key request failed with HTTP <status>"*.
- **Forward auth on a non-standard port.** If browsers reach forward-auth protected sites as `host:8443` (Caddy published as `8443:443`, or NAT), set `FORWARD_AUTH_ALLOWED_PORTS=8443`. Otherwise existing forward-auth sessions stop validating, the portal shows *"This site is served on port 8443, which is not allowed for forward authentication…"*, and the web container logs `[forward-auth] Rejected host:8443 … FORWARD_AUTH_ALLOWED_PORTS`.
- **CA private keys stay on the master.** CA private keys are now encrypted at rest with `SESSION_SECRET` and are no longer synced; the first sync removes the copies older versions stored on slaves. Slaves keep validating client certificates, but a slave promoted to master cannot issue certificates from the existing CAs. Back up the master's database together with its `SESSION_SECRET`.
- **WAF custom directives.** Rules that read files or change the Caddy process (`@pmFromFile`, `@ipMatchFromFile`, `@inspectFile`, `@validateSchema`, `setenv`, `ctl:ruleEngine`, …), lines whose structure Coraza cannot parse, and rules reusing the `id:` of an earlier rule are no longer sent to Caddy. Stored rules are kept but left out of the generated config, and the web container logs `[waf] <source>: N custom directive line(s) are not sent to Caddy and have no effect: …`. Operator names and other rule content are not validated, so a typo such as `@contians` still reaches Caddy and makes it refuse the whole config. See [WAF](#waf-web-application-firewall) for the full list.
- **Host placeholders are literal.** In default responses, error pages, path-block bodies and redirect rule targets, `{env.*}`, `{system.*}` and `{file.*}` are now sent as written. Request placeholders such as `{http.request.uri}` and `{http.request.host}` still expand, so rewrite e.g. `https://{env.PRIMARY_DOMAIN}{http.request.uri}` with a literal host.
- **Database file permissions.** On startup the SQLite database and its `-journal`/`-wal`/`-shm` files lose their world permission bits. Owner and group bits are unchanged, so a host backup job in the files' group keeps working; one running as an unrelated user no longer can.

**Behaviour changes:**

- **Admin credentials** from the environment are applied when the admin is created and whenever `ADMIN_USERNAME`/`ADMIN_PASSWORD` change, no longer on every start (see [User Roles](#user-roles)). On the first start after upgrading, a stored admin password that differs from `ADMIN_PASSWORD` (and is not `admin` or a documented example) is kept, since it was probably changed in the UI, and a warning is logged. Change `ADMIN_PASSWORD` again and recreate the web container (`docker compose up -d`) to force it. A changed `ADMIN_USERNAME` is still applied on that start, and re-applying unchanged credentials does not re-activate a disabled primary admin.
- **Passwords.** The password policy (12+ characters, upper- and lowercase, a digit and a special character) now applies to every way of setting a password: admin-created users (dashboard and `POST /api/v1/users`), password changes, and Better Auth self-registration (`AUTH_ALLOW_SELF_REGISTRATION=true`) and reset. Changing or setting a password signs out the user's other dashboard sessions and all their forward-auth sessions. API tokens are kept; revoke them under **Profile → API Tokens** if needed. Adding a first password to an OAuth-only account requires a sign-in within the last 10 minutes. The user can then sign in at `/login` with the **Sign-in username** shown on the Profile page, a username made from their email address (see the next item).
- **Sign-in usernames.** The login page signs in by username only, ignoring case. CPM gives each account a username made from its email: the lowercased email when it is 3–255 characters from `A-Z a-z 0-9 _ . @ -`; otherwise each run of other characters becomes `-` (`alice+cpm@example.com` → `alice-cpm@example.com`, `+alice@example.com` → `-alice@example.com`). When that is another account's username or email, `-2`, `-3`, … is added before the `@`. Accounts with a password whose stored username the login page cannot use (older releases could store an email with `+`, or a mixed-case username) get one on startup, and when their password or profile is changed; working usernames are never changed. OAuth-only accounts get one when they set a password. The Profile page shows it as **Sign-in username** and `/api/v1/users` responses include it as `username`; tell users whose username differs from their email. If every candidate is taken, the Profile page asks the user to have an administrator change their email address.
- **Unlinking OAuth** requires a working username/password sign-in. Users who set a password on an older version must change it once before the **Unlink** button appears.
- **Better Auth self-service endpoints** that CPM does not use are disabled: `/api/auth/update-user`, `/change-password`, `/change-email`, `/delete-user`, `/unlink-account`, `/update-session`, `/verify-password` and `/is-username-available`. Use the Profile page or `/api/v1/` instead. With `AUTH_ALLOW_OAUTH_REGISTRATION=false`, an OAuth sign-in can no longer create an account even if the client asks for sign-up.
- **Deleting a user** also deletes their sessions, API tokens, sign-in methods, pending OAuth links, forward-auth sessions and grants, and group memberships; what they owned or created and their audit log entries are kept without a user (see [User Roles](#user-roles)). Older releases deleted only the user row; on startup, the rows those deletions left behind are removed (logged as `Cleared rows left by deleted user id(s) <ids>`), so a new account that gets a deleted user's id (the primary admin is always id 1) does not inherit their API tokens, sessions or OAuth links. Nothing needs to be done.
- **Portal login rate limits** no longer trust a client-sent `X-Real-IP`, and now also count failures per account. See [Login rate limits](#login-rate-limits) and `TRUSTED_CLIENT_IP_HEADER`.
- **Forward-auth header stripping.** Client-supplied identity headers are now removed in every `-`/`_` spelling (`X_CPM_User`, `Remote_User`, …), so upstreams that fold `_` into `-` (CGI/WSGI) cannot read forged ones. Authentik identity headers are stripped on every route that reaches the upstream. For Authentik and generic forward auth, `Authorization`, `Proxy-Authorization` and `Cookie` are no longer stripped before authentication, even when listed in the copy headers: clients' own credentials reach excluded paths, access-list basic auth and the outpost again, and the auth server's values still replace them.
- **Instance sync.** The master no longer follows redirects from a slave, applies `INSTANCE_SYNC_TIMEOUT_MS` to each request (default 60 s; reported as *"Sync timed out"*), and requires the slave's acknowledgement. A login page in front of a slave is reported as *"Slave returned an invalid sync key"*, or *"Sync key request failed with HTTP 302"* when it redirects. `INSTANCE_SLAVES` entries go through the same URL checks as instances added in the UI, and invalid ones are skipped with the warning `Skipping INSTANCE_SLAVES entry <index>: <reason>`. Instance URLs containing `?` or `#` are rejected. Before each sync the master fetches the slave's sync key, so a wrong token or a URL that does not reach CPM now shows as *"Sync key request failed with HTTP 401"* or *"… HTTP 404"*. New slave-side errors are listed under [Instance Sync](#instance-sync).
- **DNS provider credentials** stored in plaintext (saved through `PUT /api/v1/settings/dns-provider`, a Cloudflare token migrated from the legacy `cloudflare` setting, and the legacy `cloudflare` setting itself) are encrypted on startup, which logs `Encrypted N DNS provider credential(s) that were stored in plaintext`.
- **WAF events.** Credential header values (`Authorization`, `Cookie`, `Set-Cookie`, API-key and token headers, …) and the cookie or credential values that rule messages echo are stored as `[redacted]`. Events stored before the upgrade are not scrubbed; they expire with the analytics retention.

**New optional environment variables:** `SESSION_SECRET_PREVIOUS`, `FORWARD_AUTH_ALLOWED_PORTS`, `TRUSTED_CLIENT_IP_HEADER` and `INSTANCE_SYNC_TIMEOUT_MS` (see [Environment Variables](#environment-variables)). `docker-compose.yml` passes them to the web container.

---

## Security

- Production enforces strong passwords (12+ chars, mixed case, numbers, special characters)
- 32+ character session secrets required
- Login rate limiting: 5 attempts per 60 seconds
- Audit trail for all configuration changes
- Supports OAuth2/OIDC for SSO

**Production Setup:**
```bash
export SESSION_SECRET=$(openssl rand -base64 32)
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="<choose-your-own: 12+ chars, upper, lower, digit, symbol>"
docker compose up -d
```

**Limitations:**
- In-memory rate limiting (not suitable for multi-instance deployments)

### Rotating SESSION_SECRET

`SESSION_SECRET` also encrypts stored secrets: DNS provider credentials, OAuth client secrets and tokens, imported certificate keys, CA private keys and instance sync tokens. To rotate it:

1. Set `SESSION_SECRET` to the new value and `SESSION_SECRET_PREVIOUS` to the old one (comma-separated if there are several).
2. Recreate the web container (`docker compose up -d`). On startup every stored secret, including a slave's synced settings, is re-encrypted with the new `SESSION_SECRET` (logged as `Re-encrypted N stored secret(s) with the current SESSION_SECRET`); `SESSION_SECRET_PREVIOUS` is only ever used to decrypt.
3. Remove `SESSION_SECRET_PREVIOUS` after one successful start. This applies to slaves too, unless their master runs v1.12.0 or earlier (see below).

A value that no key decrypts is left as stored and logged as `[secret] … cannot be decrypted with SESSION_SECRET or SESSION_SECRET_PREVIOUS`, followed by `N stored secret(s) listed above could not be decrypted…`; re-enter it in the UI, or set `SESSION_SECRET_PREVIOUS` to the secret it was stored with. OAuth sign-in tokens that no key decrypts are cleared instead (`Cleared N stored OAuth sign-in token(s)…`), since CPM does not use them and the next OAuth sign-in stores new ones. Values stored under an old example `SESSION_SECRET` are re-encrypted without any extra configuration. If a CA private key can no longer be decrypted, issuing a client certificate fails with *"The CA private key cannot be decrypted with the current SESSION_SECRET…"*; certificates already issued keep working, because only the CA certificate is needed to validate them.

With instance sync, the master and each slave can use their own `SESSION_SECRET` and rotate it independently: the master seals synced secrets (DNS provider credentials, certificate private keys) to the slave's sync key, and the slave stores them encrypted with its own `SESSION_SECRET`. The slave derives its sync key from `SESSION_SECRET`, so the key changes with it; the master fetches the key before every sync, so nothing changes on the master side; a sync that fetched the key just before the slave restarted fails with HTTP 409, and the next one succeeds. A synced setting the master itself cannot decrypt is sent as stored, and the master logs `Instance sync: setting <path> cannot be decrypted with SESSION_SECRET or SESSION_SECRET_PREVIOUS; sending it as stored` once per value, not on every sync. A master on v1.12.0 or earlier sends DNS provider credentials encrypted with its own `SESSION_SECRET` instead, so while it does, every slave must keep the master's secret as `SESSION_SECRET` or in `SESSION_SECRET_PREVIOUS`, or applying the synced config fails (values encrypted under the old placeholder secret always decrypt). A slave on v1.12.0 or earlier receives them encrypted with the master's current `SESSION_SECRET` from any master, so it must use that same secret until it is upgraded.

---

## User Roles

CPM has three roles with increasing privileges:

| Capability | Viewer | User | Admin |
|------------|:------:|:----:|:-----:|
| Log in to the dashboard | Yes | Yes | Yes |
| View own profile | Yes | Yes | Yes |
| Access forward-auth-protected apps (when granted) | Yes | Yes | Yes |
| Manage proxy hosts, certificates, access lists | No | No | Yes |
| Manage users, groups, and settings | No | No | Yes |
| View analytics, audit log, and API docs | No | No | Yes |
| Create and manage own API tokens | Yes | Yes | Yes |
| Access role-appropriate REST API endpoints (`/api/v1/`) | Yes | Yes | Yes |

New users default to the **user** role. The initial admin account is created from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables. They are applied again only when they change, so a password later changed in the UI is kept across restarts. To recover a lost admin password, change `ADMIN_PASSWORD` (or `ADMIN_USERNAME`) and recreate the web container (`docker compose up -d`; `docker compose restart` keeps the old values): this resets the primary admin's password, restores its admin role, re-activates it if it was disabled, and, when the password changed, signs out all of its dashboard and forward-auth sessions.

Deleting a user (**Users** page or `DELETE /api/v1/users/:id`) also deletes their sessions, the API tokens they created, their sign-in methods (password and OAuth accounts) and pending OAuth links, their forward-auth sessions and access grants, and their group memberships. Proxy hosts, L4 hosts, certificates, CAs, client certificates, access lists, mTLS roles and rules, and groups they owned or created are kept without an owner, and their audit log entries are kept without a user.

API tokens can only be created from an authenticated dashboard session; an
existing bearer token cannot mint replacement credentials. Viewer and user
tokens are restricted to the same user-scoped API capabilities as their owner.

> **Forward Auth access** is separate from role — all roles must be explicitly granted access to each protected host via the forward auth access list.

---

## Certificate Management

Caddy automatically obtains Let's Encrypt certificates for all proxy hosts.

**DNS-01 Challenge** (optional): Configure a DNS provider in **Settings → DNS Providers** for wildcard certificates and environments where ports 80/443 are not public. Supported providers: Cloudflare, Route 53, DigitalOcean, Duck DNS, Hetzner, Vultr, Porkbun, GoDaddy, Namecheap, OVH, IONOS, Linode, Njalla, netcup, Spaceship, deSEC, Dynu, acme-dns, Infomaniak, ClouDNS, and RFC2136 (BIND/TSIG). Credentials are encrypted at rest with AES-256-GCM. You can override the DNS provider per certificate.

**Custom Certificates** (optional): Import your own certificates via the Certificates page. Private keys are encrypted at rest with AES-256-GCM, migrated from legacy plaintext storage on startup, and treated as write-only by ordinary API responses and browser payloads.

**Built-in CA** (mTLS): CA private keys are encrypted at rest the same way and never leave the master (see [Instance Sync](#instance-sync)). Back them up with the database and `SESSION_SECRET`.

---

## Geo Blocking

Geo blocking is configured per proxy host. It requires MaxMind GeoLite2 databases (see [GeoIP Setup](#geoip-setup)).

### Rule types

| Type | Example | Description |
|------|---------|-------------|
| Country | `DE` | ISO 3166-1 alpha-2 country code |
| Continent | `EU` | `AF`, `AN`, `AS`, `EU`, `NA`, `OC`, `SA` |
| ASN | `24940` | Autonomous System Number |
| CIDR | `91.98.150.0/24` | IP range in CIDR notation |
| IP | `91.98.150.103` | Exact IP address |

Rules can be **block** or **allow**. Allow rules take precedence over block rules — you can block an entire continent and then allow specific IPs or ASNs through.

### GeoIP Setup

Geo blocking requires MaxMind GeoLite2 Country and/or ASN databases. Use the bundled `geoipupdate` service:

1. Register for a free MaxMind account at [maxmind.com](https://www.maxmind.com/)
2. Generate a license key with `GeoLite2-Country` and `GeoLite2-ASN` permissions
3. Add to your `.env`:
   ```
   GEOIPUPDATE_ACCOUNT_ID=your-account-id
   GEOIPUPDATE_LICENSE_KEY=your-license-key
   ```
4. Start with the `geoipupdate` profile:
   ```bash
   docker compose --profile geoipupdate up -d
   ```

The databases are stored in the `geoip-data` Docker volume and shared between the web and Caddy containers.

---

## Analytics

Analytics uses a bundled ClickHouse instance for storing and querying traffic events and WAF events. Data is retained for **30 days** by default via ClickHouse's TTL. Change the window with the `CLICKHOUSE_RETENTION_DAYS` environment variable — on the next startup the existing tables' TTL is migrated to the new value and expired data is purged.

### Enabling analytics (recommended)

Analytics is enabled via the `clickhouse` Docker Compose profile. The default `.env.example` has it on:

```env
COMPOSE_PROFILES=clickhouse
CLICKHOUSE_PASSWORD=
```

Set `CLICKHOUSE_PASSWORD` to a generated value (`openssl rand -base64 32`); compose refuses to start the `clickhouse` profile while it is empty.

Then start (or recreate) the stack:

```bash
docker compose up -d
```

### Disabling analytics

Remove `clickhouse` from `COMPOSE_PROFILES` (or leave the variable empty) and omit `CLICKHOUSE_PASSWORD`:

```env
COMPOSE_PROFILES=
```

The web container starts normally without ClickHouse. The Analytics page shows a notice explaining that ClickHouse is not enabled, and no data is collected.

### Combining profiles

To run both analytics and GeoIP updates simultaneously, list both profiles:

```env
COMPOSE_PROFILES=clickhouse,geoipupdate
CLICKHOUSE_PASSWORD=…
GEOIPUPDATE_ACCOUNT_ID=…
GEOIPUPDATE_LICENSE_KEY=…
```

---

## WAF (Web Application Firewall)

The WAF is powered by [Coraza](https://coraza.io/) and integrates the OWASP Core Rule Set.

Enable globally in **WAF → Settings**, then optionally override per proxy host. Two modes:
- **Block** — requests matching rules are rejected with 403
- **Detect** — requests are logged but not blocked

**OWASP CRS** covers SQLi, XSS, LFI, RCE, and more (enabled by default when WAF is on).

**Rule suppression** — suppress noisy rules globally or per host from the event detail drawer or the Suppressed Rules tab.

**Custom directives** — `SecRule`, `SecAction`, `SecMarker` and `SecDefaultAction` lines (plus the request body limit directives) are accepted, e.g.:
```
SecRule REQUEST_URI "@beginsWith /admin/" "id:9001,phase:1,deny,status:403,log,msg:'Admin path blocked'"
```

Lines that could read files, run programs or switch the WAF off are not sent to Caddy, nor are some that would make Caddy refuse the whole config:

- `Include`, rule-engine and rule-mutation directives (`SecRuleEngine`, `SecRuleRemoveById`, `SecRuleUpdateActionById`, …)
- the operators `@pmFromFile`/`@pmf`, `@ipMatchFromFile`/`@ipMatchF`, `@inspectFile` and `@validateSchema`. The data-file operators are allowed with a single `@owasp_crs/<name>.data` argument when the CRS is loaded for that host or the global handler. The operator must use Coraza's exact, case-sensitive spelling (`@pmFromFile`, `@pmf`, `@ipMatchFromFile`, `@ipMatchF`; `@pmfromfile` or `@PMF` is dropped), and `<name>.data` must be one of the 21 data files shipped with coraza-coreruleset v4.25.0 (e.g. `unix-shell.data`, `scanners-user-agents.data`)
- the `setenv` action and `ctl:ruleEngine`, in any spacing or quoting
- `SecRule`/`SecAction`/`SecDefaultAction` lines whose structure Coraza cannot parse (e.g. a `SecRule` without a quoted operator), and any directive continued over several lines with a trailing `\` (write each directive on one line)
- a rule whose `id:` an earlier rule already uses, including a merge-mode host rule that reuses a global rule id (the global directives come first), since Coraza refuses duplicate ids. Ids that clash with OWASP CRS rules are not checked, so avoid 900000–999999 and the 2000xx ids of `coraza.conf-recommended` when the CRS is loaded

Operator names and other rule content are not validated: a typo such as `@contians` still reaches Caddy, which then refuses the whole config.

When one rule of a chain is dropped, the whole chain is dropped. Rules stored before these checks existed are not deleted: they are left out of the generated config and reported in the web container log (`[waf] <source>: N custom directive line(s) are not sent to Caddy…`). Saving a proxy host or the global WAF settings (dashboard or `PUT /api/v1/settings/waf`) is rejected only for lines the save newly drops, including turning **Load OWASP CRS** off while a rule reads an `@owasp_crs/` file, so a stored rule does not block unrelated edits. A merge-mode host that inherits the global CRS setting is not re-checked when the global CRS is turned off; its `@owasp_crs/` rules are then only reported in the log.

---

## Instance Sync

Run a master instance that pushes configuration to one or more slaves on every change.

```bash
# Generate once, then configure the same 64-character value on both sides.
openssl rand -hex 32

# Master
INSTANCE_MODE=master
INSTANCE_SLAVES='[{"name":"replica","url":"https://replica.example.com","token":"<64-hex-character-token>"}]'

# Slave
INSTANCE_MODE=slave
INSTANCE_SYNC_TOKEN=<64-hex-character-token>
```

Sync tokens shorter than 32 characters, longer than 512 characters, or padded with whitespace are rejected.

Synced data: proxy hosts, certificates, access lists, and settings. User accounts are **not** synced. CA certificates are synced without their private keys: slaves validate client certificates but cannot issue them, so back up the master's database and `SESSION_SECRET`.

**Sealed secrets.** Before every sync the master fetches the slave's sync public key and a single-use nonce with an authenticated `GET /api/instances/sync` (same bearer token as the sync). It seals certificate private keys and the secrets inside synced settings (DNS provider credentials) to that key (X25519, HKDF-SHA256, AES-256-GCM), and the slave opens them and stores them encrypted with its own `SESSION_SECRET`. The slave derives the key from its `SESSION_SECRET`, so there is nothing to configure and master and slaves do not need to share a secret.

- Anything that reads request bodies on the way to a slave (a TLS-terminating proxy, CDN or tunnel in front of it, request body logging, or a passive observer of a sync over HTTP) sees these secrets only as ciphertext; the rest of the configuration is not sealed. Each sealed secret is bound to the nonce and to the exact payload it came with, so a captured sync body cannot be replayed or changed (for example to point an acme-dns `server_url` elsewhere) to get its secrets onto a slave, even by someone who also has the sync token.
- Sealing does not stop anyone holding the sync token from pushing a configuration of their own, and it does not authenticate the slave: over plain HTTP the token is exposed, and an active attacker can answer the key request with a key of their own. HTTPS is still required.
- Proxies in front of a slave must pass `GET` as well as `POST` on `/api/instances/sync`, with the `Authorization` header, and must not cache the `GET` reply (it is sent with `Cache-Control: no-store`). Key requests have their own rate limit, with the same limits as syncs, so they do not use up the sync budget.
- A nonce is kept in the slave process's memory for 10 minutes, so the key request and the sync must reach the same process, as they always do with a single CPM web container.
- A slave on v1.12.0 or earlier answers the key request with `405`. The master then sends what older masters sent: certificate private keys unsealed and DNS provider credentials encrypted with the master's `SESSION_SECRET`, which that slave needs as its own `SESSION_SECRET`. It logs `Instance sync: slave "<name>" does not publish a sync key (older release)…` once per slave. Once a slave has served a key, the master does not send it unsealed secrets again until the master restarts: a later `405` fails the sync with *"Sync key request failed with HTTP 405"*, so restart the master after downgrading a slave. A `404` always fails the sync (*"Sync key request failed with HTTP 404"*); it usually means a wrong base URL, or a proxy or virtual host answering instead of CPM.

A master on v1.12.0 or earlier seals nothing and sends DNS provider credentials encrypted with its own key; see [Rotating SESSION_SECRET](#rotating-session_secret).

The slave's Settings page shows why a sealed sync was refused (the master reports *"Sync failed with HTTP 409"* or *"… HTTP 400"*):

- *"Sync payload was sealed for a different key; retry"* (409): the slave's `SESSION_SECRET` changed after the master fetched its key.
- *"Sync payload was sealed for an expired or already used key request; retry"* (409): the slave restarted between the key request and the sync, or the payload was replayed.
- *"Sealed secrets in the sync payload could not be opened"* (400): the payload was changed in transit or did not come from the master. Nothing is stored.

Both 409s clear on the next sync. A key reply the master cannot use is reported as *"Slave returned an invalid sync key"*.

Use HTTPS slave URLs in production. Set `INSTANCE_SYNC_ALLOW_HTTP=true` only for internal Docker networks; it exposes the sync token to anyone on the path. Slave URLs (from the UI, the API or `INSTANCE_SLAVES`) must not contain credentials, a query string or a fragment; invalid `INSTANCE_SLAVES` entries are skipped with a warning. The master does not follow redirects, and a request that exceeds `INSTANCE_SYNC_TIMEOUT_MS` (default 60 s) is reported as *"Sync timed out"*; the slave may still finish applying the config.

See the [Environment Variables Reference](https://github.com/fuomag9/caddy-proxy-manager/wiki/Environment-Variables-Reference) for all `INSTANCE_*` options.

---

## Default Response

Configure **Settings → Default Response** to preserve Caddy's native behavior for unmatched HTTP requests (such as an automatic HTTPS redirect or empty response, depending on the generated server config), or replace it with:

- a custom HTTP status, body, and response headers (including custom HTML);
- a redirect; or
- an aborted connection with no HTTP response (the Caddy equivalent of an nginx `444`).

Configured proxy hosts always take precedence over this catch-all. For HTTPS, Caddy can only send the response after TLS succeeds; an unknown hostname or direct-IP request may fail the certificate handshake first.

Request placeholders such as `{http.request.uri}` and `{http.request.host}` are expanded in the body, headers and redirect target. Host placeholders (`{env.*}`, `{system.*}`, `{file.*}`) are sent literally, here and in error pages, path-block bodies and redirect rules.

---

## Upstream DNS Pinning

You can enable upstream DNS pinning globally (**Settings → Upstream DNS Pinning**) and override per host (**Proxy Host → Upstream DNS Pinning**).

When enabled, hostname upstreams are resolved during config save/reload and written to Caddy as concrete IP dials. Address family selection supports:
- `both` (preferred, resolves AAAA then A with IPv6 preference)
- `ipv6`
- `ipv4`

### Important HTTPS Limitation

If one reverse proxy handler contains multiple different HTTPS upstream hostnames, HTTPS pinning is skipped for those HTTPS upstreams to avoid TLS SNI mismatch. In that case, hostname dials are kept for those HTTPS upstreams.

HTTP upstreams in the same handler are still eligible for pinning.

---

## OAuth Authentication

Supports any OIDC-compliant provider (Authentik, Keycloak, Auth0, etc.). Providers can be configured via environment variables or the **Settings → OAuth Providers** UI.

### Option A: Configure via UI (Recommended)

1. Log in as admin and navigate to **Settings → OAuth Providers**
2. Click **Add Provider** and fill in the details
3. Copy the displayed **Callback URL** and add it to your OAuth provider's allowed redirect URIs

### Option B: Configure via Environment Variables

```bash
# Set your public URL (REQUIRED for OAuth to work)
BASE_URL=https://caddy-manager.example.com

OAUTH_ENABLED=true
OAUTH_PROVIDER_NAME="Authentik"  # Display name
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_ISSUER=https://auth.example.com/application/o/app/
```

**Redirect URI Configuration:**

The callback URL format is:
```
{BASE_URL}/api/auth/callback/{provider-id}
```

For environment-configured providers, the provider ID is derived from `OAUTH_PROVIDER_NAME` (lowercased, non-alphanumeric replaced with `-`). The exact callback URL is shown in **Settings → OAuth Providers** after the provider is synced.

Examples:
- `https://caddy-manager.example.com/api/auth/callback/authentik-QXV0aG` (production)
- `http://localhost:3000/api/auth/callback/authentik-QXV0aG` (development)

The `BASE_URL` environment variable must match exactly where users access your dashboard.

> **Upgrading from < 1.0-RC:** The old callback URL (`/api/auth/callback/oauth2`) no longer works. Update your OAuth provider's redirect URI to the new format shown in **Settings → OAuth Providers**.

OAuth login appears on the login page alongside credentials.

**Account linking:**

Attaching an OAuth identity to an existing CPM user requires **Auto-link accounts** to be enabled for that provider (**Settings → OAuth Providers**, or `OAUTH_ALLOW_AUTO_LINKING=true` for environment-configured providers). The switch marks the provider as trusted to prove that its identity owns the CPM account carrying the same email address, so leave it off for any IdP where users can register an arbitrary email themselves.

With it enabled:

- Signing in through the provider links the identity to the existing user with the matching email.
- **Profile → OAuth Connections** can link the provider to the signed-in account. The provider's email must match the signed-in user's email.

With it disabled, both paths are refused and the provider redirects to `/api/auth/error?error=account_not_linked`.

---

## Forward Auth Portal

CPM includes a built-in forward auth identity provider — no external IdP (Authentik, Authelia, etc.) required.

### How it works

1. Enable **Forward Auth** on a proxy host and choose which users or groups may access it.
2. Unauthenticated visitors are redirected to the CPM login portal.
3. After login, CPM issues a session cookie and redirects back to the protected app.
4. Caddy's `forward_auth` directive validates every subsequent request against CPM.

### Groups

Create groups on the **Groups** page to organise users. When you grant a group access to a proxy host, all current and future members of that group gain access automatically.

### Per-host access control

Each forward-auth-protected host has its own access list of allowed users and/or groups. Access is separate from the user's role — even admins must be explicitly granted access.

### Non-standard ports

Protected sites are expected on the default ports 80/443. If browsers reach them on another port (e.g. Caddy published as `8443:443`), list it in `FORWARD_AUTH_ALLOWED_PORTS` (comma-separated) and recreate the web container (`docker compose up -d`). Logins, redirects and sessions on any other non-default port are refused, and the web container logs a warning naming the port.

### Login rate limits

Portal logins use `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MS` and `LOGIN_BLOCK_MS`:

- `LOGIN_MAX_ATTEMPTS` failures from one client block that client, and `LOGIN_MAX_ATTEMPTS` failures from one client against one account block that client for that account, for `LOGIN_BLOCK_MS`. IPv6 clients are counted per /64 prefix.
- Failures against one account from all clients combined are counted over one hour (or `LOGIN_WINDOW_MS` if longer) from the first failure. Reaching the ceiling blocks the account for `LOGIN_BLOCK_MS`. The ceiling is `LOGIN_MAX_ATTEMPTS` × (⌈window ÷ min(`LOGIN_WINDOW_MS`, `LOGIN_BLOCK_MS`)⌉ + 1), and at least 10 × `LOGIN_MAX_ATTEMPTS`: 65 with the defaults, more than one client can reach under its own limits. A successful login clears the client's own counters but not this one.
- One client cannot lock an account, but a few together can: with the defaults each can make about 48 failures per hour (4 per 5-minute window) without being blocked, so e.g. a dual-stack host (IPv4 plus IPv6) or two /64s can reach the account ceiling. This is inherent to a per-account limit.
- Attempts still being checked count towards every limit; extra concurrent attempts get `429`.

The client address is the rightmost `X-Forwarded-For` entry, which is the real client when clients connect to Caddy directly (Caddy is the outermost proxy in front of CPM). When port 3000 is reached directly, clients control that header and the per-IP limits are only best effort, so expose the portal (`BASE_URL`) through Caddy or another proxy that overwrites `X-Forwarded-For` rather than publishing port 3000 to untrusted networks. Behind a CDN, the rightmost entry is the CDN edge: set `TRUSTED_CLIENT_IP_HEADER` (e.g. `cf-connecting-ip`), but only if the origin accepts connections from the CDN alone, since clients could otherwise forge the header. Leave it unset when Caddy is the outermost proxy, because Caddy passes `X-Real-IP` and `CF-Connecting-IP` through unchanged. The same client address is used for the rate limit of the slave sync endpoint.

---

## Roadmap

[Open an issue](https://github.com/fuomag9/caddy-proxy-manager/issues) for feature requests.

---

## Contributing

Contributions welcome:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/name`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/name`)
5. Open a Pull Request

- Follow the existing code style (TypeScript, Prettier formatting)
- Add tests for new features when applicable
- Update documentation for user-facing changes
- Keep commits focused and write clear commit messages

---

## Support

- **Issues:** [GitHub Issues](https://github.com/fuomag9/caddy-proxy-manager/issues) for bugs and feature requests
- **Discussions:** [GitHub Discussions](https://github.com/fuomag9/caddy-proxy-manager/discussions) for questions and ideas

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **[Caddy Server](https://caddyserver.com/)** – The amazing web server that powers this project
- **[Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager)** – The original project
- **[Next.js](https://nextjs.org/)** – React framework for production
- **[shadcn/ui](https://ui.shadcn.com/)** – Beautifully designed components built on Radix UI and Tailwind CSS
- **[Drizzle ORM](https://orm.drizzle.team/)** – Lightweight SQL migrations and type-safe queries

---

<div align="center">

[⬆ back to top](#caddy-proxy-manager)

</div>
