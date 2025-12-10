# Caddy Proxy Manager

Web interface for managing [Caddy Server](https://caddyserver.com/) reverse proxies, redirects, and certificates.

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://mit-license.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)

[Report Bug](https://github.com/fuomag9/caddy-proxy-manager/issues) • [Request Feature](https://github.com/fuomag9/caddy-proxy-manager/issues)

<img width="1525" height="873" alt="Dashboard screenshot" src="https://github.com/user-attachments/assets/297cc5b9-5185-4ce3-83ef-b5d87d16fcb4" />

## Overview

This project provides a web UI for Caddy Server, eliminating the need to manually edit JSON configurations or Caddyfiles. It handles reverse proxies, redirects, dead hosts (maintenance pages), access lists, and certificate management through a Material UI interface.

**Key features:**
- Reverse proxy configuration with upstream pools and custom headers
- HTTP basic auth access lists
- Automatic HTTPS via Caddy's ACME (Let's Encrypt) with Cloudflare DNS-01 support
- Custom certificate import (internal CA, wildcards, etc.)
- Audit logging of all configuration changes
- Login rate limiting and session management
- Built with Next.js 16, React 19, Drizzle ORM, and TypeScript

---

## Installation

### Docker Compose

```bash
git clone https://github.com/fuomag9/caddy-proxy-manager.git
cd caddy-proxy-manager
cp .env.example .env
# Edit .env with your credentials (see Configuration section below)
docker compose up -d
```

The stack includes:
- `web` - Next.js app with SQLite database
- `caddy` - Custom Caddy build (includes Cloudflare DNS and Layer4 modules)

Data is persisted in:
- `./data` - Application database and certificates
- `./caddy-data` - ACME certificates
- `./caddy-config` - Caddy runtime config

### Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

Access the interface at `http://localhost:3000/login`.

Login attempts are rate-limited (5 attempts per 5 minutes, 15 minute lockout after repeated failures).

---

## Features

| Module | Description |
|--------|-------------|
| **Proxy Hosts** | HTTP/HTTPS reverse proxies with upstream pools, custom headers, Authentik forward auth |
| **Redirects** | 301/302 redirects with optional query string preservation |
| **Dead Hosts** | Maintenance pages with custom status codes |
| **Access Lists** | HTTP basic auth user management for proxy hosts |
| **Certificates** | Custom SSL/TLS certificate import (Caddy auto-manages Let's Encrypt) |
| **Settings** | ACME email and Cloudflare API configuration |
| **Audit Log** | Chronological log of all configuration changes |

**Technical Stack:**
- Next.js 16 App Router with React 19
- Material UI (dark theme)
- Drizzle ORM with SQLite
- Direct integration with Caddy Admin API
- Cloudflare DNS-01 challenge support
- bcrypt for access list password hashing

---

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SESSION_SECRET` | Session encryption key (32+ chars) | None | **Yes** |
| `ADMIN_USERNAME` | Admin login username | `admin` | **Yes** |
| `ADMIN_PASSWORD` | Admin password (see requirements below) | `admin` (dev only) | **Yes** |
| `BASE_URL` | Public URL of the dashboard | `http://localhost:3000` | No |
| `CADDY_API_URL` | Caddy Admin API endpoint | `http://caddy:2019` (prod)<br/>`http://localhost:2019` (dev) | No |
| `DATABASE_URL` | SQLite database URL | `file:/app/data/caddy-proxy-manager.db` | No |
| `CERTS_DIRECTORY` | Certificate storage directory | `./data/certs` | No |
| `LOGIN_MAX_ATTEMPTS` | Max login attempts before rate limit | `5` | No |
| `LOGIN_WINDOW_MS` | Rate limit window in milliseconds | `300000` (5 min) | No |
| `LOGIN_BLOCK_MS` | Rate limit block duration in milliseconds | `900000` (15 min) | No |

**Production Security Requirements (Strictly Enforced):**

The application will **fail to start** in production if these requirements are not met:

- **`SESSION_SECRET`**:
  - Must be at least 32 characters long
  - Cannot be a known placeholder value
  - Generate with: `openssl rand -base64 32`

- **`ADMIN_USERNAME`**:
  - Must be set (any value is acceptable, including `admin`)

- **`ADMIN_PASSWORD`**:
  - Minimum 12 characters
  - Must include uppercase letters (A-Z)
  - Must include lowercase letters (a-z)
  - Must include numbers (0-9)
  - Must include special characters (!@#$%^&* etc.)
  - Cannot be `admin` in production

**Development Mode:**
- Default credentials (`admin`/`admin`) are allowed in development
- Set `NODE_ENV=development` to use relaxed validation

---

## Architecture

```
caddy-proxy-manager/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Authentication pages
│   ├── (dashboard)/        # Dashboard and feature modules
│   ├── api/                # API routes
│   └── providers.tsx       # Theme providers
├── src/lib/                # Core business logic
│   ├── models/             # Database models
│   ├── caddy/              # Caddy config generation
│   └── auth/               # Authentication
├── drizzle/                # Database migrations
├── docker/
│   ├── web/                # Next.js Dockerfile
│   └── caddy/              # Custom Caddy build
├── docker-compose.yml      # Deployment stack
└── data/                   # SQLite + certificates
```

---

## Security

**Authentication:**
- Production mode enforces strong credentials (12+ chars, mixed case, numbers, special characters)
- Application refuses to start with weak passwords in production
- 32+ character session secrets required
- Login rate limiting: 5 attempts per 5 minutes, 15 minute lockout
- Single admin user model

**Data Protection:**
- Imported certificates stored with `0600` permissions
- Session encryption with validated secrets
- API tokens redacted after initial entry
- Audit trail for all configuration changes
- HSTS headers applied to managed hosts

**Production Setup:**
```bash
export SESSION_SECRET=$(openssl rand -base64 32)
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="YourStr0ng-P@ssw0rd123!"
echo "SESSION_SECRET=$SESSION_SECRET" > .env
echo "ADMIN_USERNAME=$ADMIN_USERNAME" >> .env
echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> .env
chmod 600 .env
```

**Development Mode:**
```bash
export NODE_ENV=development
npm run dev
# Login with admin/admin
```

**Limitations:**
- Certificate private keys stored unencrypted in SQLite
- In-memory rate limiting (not suitable for multi-instance deployments)
- No 2FA support

---

## Certificate Management

**Automatic HTTPS (Default):**

Caddy automatically obtains and renews Let's Encrypt certificates for all proxy hosts. Just add a domain and certificates are handled automatically.

For automatic certificates, configure Cloudflare DNS-01 in Settings (see below).

**Custom Certificates (Optional):**

Import your own certificates for:
- Internal CA certificates
- Certificates from other providers
- Compliance requirements

To import:
1. Go to Certificates page
2. Click Import Custom Certificate
3. Enter certificate name and domains
4. Paste certificate PEM (full chain recommended)
5. Paste private key PEM
6. Assign to proxy hosts as needed

Note: Private keys are stored in SQLite without encryption.

---

## Cloudflare DNS-01 Setup

For automatic certificates via DNS-01 challenge:

1. Go to Settings
2. Create a Cloudflare API token with `Zone.DNS:Edit` permissions
3. Enter token (not displayed again after saving)
4. Optionally add Zone ID / Account ID
5. Set ACME email for certificate notifications

To revoke: Select "Remove existing token" in Settings.

---

## Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Run production server |
| `npm run typecheck` | TypeScript type checking |
| `npm run db:migrate` | Apply database migrations |

**Notes:**
- Drizzle migrations are in `/drizzle`
- Caddy config regenerated on each mutation and pushed via Admin API
- Rate limiting is in-memory (not suitable for multi-instance deployments)
- Single admin user architecture

---

## Roadmap

- [ ] Multi-user RBAC
- [ ] Additional DNS providers (Route53, Namecheap, etc.)
- [ ] Backup/restore
- [ ] API for programmatic configuration

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

- **Issues:** [GitHub Issues](https://github.com/yourusername/caddy-proxy-manager/issues) for bugs and feature requests
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/caddy-proxy-manager/discussions) for questions and ideas

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
