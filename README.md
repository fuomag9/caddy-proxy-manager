# Caddy Proxy Manager

Web interface for managing [Caddy Server](https://caddyserver.com/) reverse proxies and certificates.

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://mit-license.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)

[Report Bug](https://github.com/fuomag9/caddy-proxy-manager/issues) • [Request Feature](https://github.com/fuomag9/caddy-proxy-manager/issues)

<img width="100%" alt="Dashboard screenshot" src="site/assets/screenshots/dashboard-main.png" />

## Overview

This project provides a web UI for Caddy Server, eliminating the need to manually edit JSON configurations or Caddyfiles. It handles reverse proxies, access lists, and certificate management through a Material UI interface.

**Key features:**
- Reverse proxy configuration with multiple upstreams, load balancing, and custom headers
- Server-side search and pagination across all data tables
- HTTP basic auth access lists with multi-account support
- OAuth2/OIDC authentication support
- Automatic HTTPS via Caddy's ACME (Let's Encrypt) with Cloudflare DNS-01 support
- ACME certificate visibility with real issuer, expiry status, and per-host tracking
- Optional upstream DNS pinning (resolve upstream hostnames on config apply)
- Geo blocking per proxy host — block/allow by country, continent, ASN, CIDR, or IP
- Custom certificate import (internal CA, wildcards, etc.)
- Audit logging of all configuration changes with full-text search
- Built with Next.js 16, React 19, Drizzle ORM, and TypeScript

<img width="49%" alt="Proxy Hosts" src="site/assets/screenshots/proxy-hosts.png" /> <img width="49%" alt="Certificates" src="site/assets/screenshots/certificates.png" />
<img width="49%" alt="Proxy Editor" src="site/assets/screenshots/proxy-editor.png" /> <img width="49%" alt="Audit Log" src="site/assets/screenshots/audit-log.png" />

<img width="100%" alt="Analytics" src="site/assets/screenshots/analytics.png" />

---

## Installation

```bash
git clone https://github.com/fuomag9/caddy-proxy-manager.git
cd caddy-proxy-manager
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

Access at `http://localhost:3000/login`

Data persists in Docker volumes (caddy-manager-data, caddy-data, caddy-config, caddy-logs).

---

## Features

- **Proxy Hosts** - Reverse proxies with custom headers, multiple upstreams, load balancing, and enable/disable toggle
- **Analytics** - Live traffic charts, country map, top user agents, and blocked request log with configurable time ranges
- **Search & Pagination** - Server-side search and pagination on all data tables (proxy hosts, access lists, audit log, certificates)
- **Geo Blocking** - Block or allow traffic by country, continent, ASN, CIDR range, or exact IP per proxy host
- **Access Lists** - Multi-account HTTP basic auth protection assignable per proxy host
- **Certificates** - Automatic HTTPS for every proxy host via Caddy ACME (Let's Encrypt / ZeroSSL), with issuer and expiry visibility + manual SSL/TLS import
- **Settings** - ACME email, Cloudflare DNS-01, and upstream DNS pinning defaults
- **Audit Log** - Searchable configuration change history with user attribution

---

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SESSION_SECRET` | Session encryption key (32+ chars) | None | **Yes** |
| `ADMIN_USERNAME` | Admin login username | `admin` | **Yes** |
| `ADMIN_PASSWORD` | Admin password (see requirements below) | `admin` (dev only) | **Yes** |
| `BASE_URL` | Public URL where users access the dashboard.<br/>**Required for OAuth** - must match redirect URI | `http://localhost:3000` | **Yes** (if using OAuth) |
| `CADDY_API_URL` | Caddy Admin API endpoint | `http://caddy:2019` (prod)<br/>`http://localhost:2019` (dev) | No |
| `DATABASE_URL` | SQLite database URL | `file:/app/data/caddy-proxy-manager.db` | No |
| `CERTS_DIRECTORY` | Certificate storage directory | `./data/certs` | No |
| `CADDY_CERTS_DIR` | Caddy cert storage path used for ACME metadata scanning (non-default deployments) | `/caddy-data/caddy/certificates` | No |
| `LOGIN_MAX_ATTEMPTS` | Max login attempts before rate limit | `5` | No |
| `LOGIN_WINDOW_MS` | Rate limit window in milliseconds | `300000` (5 min) | No |
| `LOGIN_BLOCK_MS` | Rate limit block duration in milliseconds | `900000` (15 min) | No |
| `OAUTH_ENABLED` | Enable OAuth2/OIDC authentication | `false` | No |
| `OAUTH_PROVIDER_NAME` | Display name for OAuth provider | `OAuth2` | No |
| `OAUTH_CLIENT_ID` | OAuth2 client ID | None | No |
| `OAUTH_CLIENT_SECRET` | OAuth2 client secret | None | No |
| `OAUTH_ISSUER` | OAuth2 OIDC issuer URL | None | No |
| `OAUTH_AUTHORIZATION_URL` | Optional OAuth authorization endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_TOKEN_URL` | Optional OAuth token endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_USERINFO_URL` | Optional OAuth userinfo endpoint override | Auto-discovered from `OAUTH_ISSUER` | No |
| `OAUTH_ALLOW_AUTO_LINKING` | Allow auto-linking OAuth identities to existing users | `false` | No |

**Production Requirements:**
- `SESSION_SECRET`: 32+ characters (`openssl rand -base64 32`)
- `ADMIN_PASSWORD`: 12+ chars with uppercase, lowercase, numbers, and special characters

Development mode (`NODE_ENV=development`) allows default `admin`/`admin` credentials.

---


## Security

- Production enforces strong passwords (12+ chars, mixed case, numbers, special characters)
- 32+ character session secrets required
- Login rate limiting: 5 attempts per 5 minutes
- Audit trail for all configuration changes
- Supports OAuth2/OIDC for SSO

**Production Setup:**
```bash
export SESSION_SECRET=$(openssl rand -base64 32)
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="YourStr0ng-P@ssw0rd123!"
docker compose up -d
```

**Limitations:**
- Certificate private keys stored unencrypted in SQLite
- In-memory rate limiting (not suitable for multi-instance deployments)

---

## Certificate Management

Caddy automatically obtains Let's Encrypt certificates for all proxy hosts.

**Cloudflare DNS-01** (optional): Configure in Settings with a Cloudflare API token (`Zone.DNS:Edit` permissions).

**Custom Certificates** (optional): Import your own certificates via the Certificates page. Private keys are stored unencrypted in SQLite.

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

Supports any OIDC-compliant provider (Authentik, Keycloak, Auth0, etc.).

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

You must configure this redirect URI in your OAuth provider:
```
{BASE_URL}/api/auth/callback/oauth2
```

Examples:
- `http://localhost:3000/api/auth/callback/oauth2` (development)
- `https://caddy-manager.example.com/api/auth/callback/oauth2` (production)

The `BASE_URL` environment variable must match exactly where users access your dashboard.

OAuth login appears on the login page alongside credentials. Users can link OAuth to existing accounts from the Profile page.

---

## Roadmap

- [ ] Multi-user RBAC
- [ ] Additional DNS providers (Route53, Namecheap, etc.)

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
- **[Material UI](https://mui.com/)** – Beautiful React components
- **[Drizzle ORM](https://orm.drizzle.team/)** – Lightweight SQL migrations and type-safe queries

---

<div align="center">

[⬆ back to top](#caddy-proxy-manager)

</div>
