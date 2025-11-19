<div align="center">

# Caddy Proxy Manager

### Modern Web UI for Caddy Server

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/fuomag9/caddy-proxy-manager)
[![License](https://img.shields.io/badge/license-MIT-green.svg)]([LICENSE](https://mit-license.org))
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)

[Website](https://caddyproxymanager.com) • [Documentation](#getting-started) • [Report Bug](https://github.com/fuomag9/caddy-proxy-manager/issues) • [Request Feature](https://github.com/fuomag9/caddy-proxy-manager/issues)

</div>

---

## Welcome! 👋

Caddy Proxy Manager brings a beautiful, intuitive web interface to [Caddy Server](https://caddyserver.com/), the modern web server with automatic HTTPS. Whether you're managing reverse proxies, configuring redirects, or handling SSL/TLS certificates, we've designed this tool to make your life easier.

**No complex multi-tenancy. No unnecessary bloat. Just a clean, secure, and powerful admin interface for your Caddy infrastructure.**

<img width="1525" height="873" alt="image" src="https://github.com/user-attachments/assets/297cc5b9-5185-4ce3-83ef-b5d87d16fcb4" />


---

## Why Caddy Proxy Manager?

### Built for Simplicity
- **Point-and-click configuration** – No need to manually edit JSON config files or learn Caddyfile syntax
- **Works out of the box** – Deploy with Docker Compose in under 2 minutes
- **Automatic HTTPS** – Leverage Caddy's built-in ACME support with Cloudflare DNS-01 challenges
- **Visual dashboard** – Beautiful Material UI dark theme that's easy on the eyes

### Built for Control
- **Complete audit trail** – Every configuration change is logged with timestamp, actor, and details
- **Access management** – Create and assign HTTP basic-auth access lists to protect your services
- **Certificate lifecycle** – Manage ACME certificates or import your own PEM files
- **Upstream health** – Configure reverse proxy pools with custom headers and health checks

### Built for Security
- **Hardened by default** – Login throttling, strict session management, HSTS injection
- **Admin-first design** – Single admin account with production credential enforcement
- **Secure secrets** – API tokens never displayed after initial entry, restrictive file permissions
- **Modern stack** – Built on Next.js 16, React 19, and Drizzle ORM with TypeScript throughout

---

## Quick Start

### Docker Compose (Recommended)

Get up and running in 2 minutes with our Docker setup:

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/caddy-proxy-manager.git
cd caddy-proxy-manager

# 2. Configure your environment
cp .env.example .env

# 3. Edit .env with secure credentials
# ADMIN_USERNAME=your-admin
# ADMIN_PASSWORD=your-strong-password-min-12-chars
# SESSION_SECRET=$(openssl rand -base64 32)

# 4. Launch the stack
docker compose up -d
```

**What you get:**
- `web` – Next.js application server with SQLite database
- `caddy` – Custom Caddy build with Cloudflare DNS and Layer4 modules

**Data persistence:**
- `./data` → Application database and imported certificates
- `./caddy-data` → ACME certificates and storage
- `./caddy-config` → Caddy runtime configuration

### Local Development

Prefer to run locally? No problem:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Set your credentials in .env
# ADMIN_USERNAME=admin
# ADMIN_PASSWORD=your-password
# SESSION_SECRET=$(openssl rand -base64 32)

# 4. Start the development server
npm run dev
```

Visit `http://localhost:3000/login` and sign in with your credentials.

**Note:** Login attempts are rate-limited to 5 tries per 5 minutes. After repeated failures, wait 15 minutes before trying again.

---

## Features

### Core Modules

| Module | Description |
|--------|-------------|
| **Proxy Hosts** | Configure HTTP/HTTPS reverse proxies with upstream pools, custom headers, and Authentik forward auth |
| **Redirects** | Set up 301/302 redirects with optional query string preservation |
| **Dead Hosts** | Display branded maintenance pages with custom status codes |
| **Access Lists** | Create HTTP basic-auth user lists and assign them to proxy hosts |
| **Certificates** | Import custom SSL/TLS certificates (internal CA, wildcards, etc.) - Caddy auto-manages public certs |
| **Settings** | Configure primary domain, ACME email, and Cloudflare DNS automation |
| **Audit Log** | Review chronological feed of all administrative actions |

### Technical Highlights

- **Next.js 16 App Router** – Server components, streaming, and server actions
- **Material UI Components** – Responsive design with dark theme
- **Direct Caddy Integration** – Generates JSON config and pushes via Caddy Admin API
- **Drizzle ORM** – Type-safe SQLite access with checked-in SQL migrations
- **SQLite Database** – Zero-configuration persistence with full ACID compliance
- **Cloudflare DNS-01** – Automated wildcard certificate issuance
- **bcrypt Authentication** – Industry-standard password hashing for access lists

---

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SESSION_SECRET` | Session encryption key (32+ chars) | None | **Yes** |
| `ADMIN_USERNAME` | Admin login username | `admin` | **Yes** |
| `ADMIN_PASSWORD` | Admin password (see requirements below) | `admin` (dev only) | **Yes** |
| `BASE_URL` | Public URL of the dashboard | `http://localhost:3000` | No |
| `CADDY_API_URL` | Caddy Admin API endpoint | `http://caddy:2019` | No |
| `DATABASE_PATH` | SQLite file path | `/app/data/caddy-proxy-manager.db` | No |
| `PRIMARY_DOMAIN` | Default domain for Caddy config | `caddyproxymanager.com` | No |

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
├── app/                        # Next.js App Router
│   ├── (auth)/                 # Authentication pages
│   ├── (dashboard)/            # Dashboard layout and feature modules
│   ├── api/                    # API routes (NextAuth, health checks)
│   ├── globals.css             # Global styles
│   └── providers.tsx           # Theme and context providers
├── src/lib/                    # Core business logic
│   ├── models/                 # Database models and operations
│   ├── caddy/                  # Caddy config generation
│   └── auth/                   # Authentication helpers
├── drizzle/                    # Database migrations
├── docker/
│   ├── web/                    # Next.js production Dockerfile
│   └── caddy/                  # Custom Caddy build (xcaddy + modules)
├── docker-compose.yml          # Production deployment stack
└── data/                       # Runtime data (SQLite + certificates)
```

---

## Security Features

We take security seriously. Here's what's built-in:

### Authentication & Authorization
- **Strict Credential Enforcement** – Application refuses to start in production with weak/default credentials
- **Password Complexity** – Enforced minimum 12 chars with uppercase, lowercase, numbers, and special characters
- **Session Secret Validation** – 32+ character secrets required with automatic detection of insecure placeholders
- **Login Throttling** – IP + username based rate limiting (5 attempts / 5 minutes)
- **Admin-Only Mutations** – All configuration changes require admin privileges
- **Fail-Fast Validation** – Security checks run at server startup, not at first request

### Data Protection
- **Certificate Protection** – Imported certificates stored with `0600` permissions
- **Session Encryption** – All sessions encrypted with validated secrets
- **Secret Redaction** – API tokens never rendered back to the browser
- **Audit Trail** – Immutable log of all administrative actions

### Infrastructure Security
- **HSTS Headers** – Strict-Transport-Security automatically applied to managed hosts
- **Secure Defaults** – All security features enabled by default
- **Docker Security** – Minimal attack surface with multi-stage builds
- **Privilege Dropping** – Containers run as non-root users

### Security Best Practices

**For Production Deployments:**
```bash
# 1. Generate a secure session secret
export SESSION_SECRET=$(openssl rand -base64 32)

# 2. Create strong admin credentials
export ADMIN_USERNAME="admin"  # Any username is fine
export ADMIN_PASSWORD="Your-Str0ng-P@ssw0rd!"  # 12+ chars, mixed case, numbers, special chars

# 3. Store credentials securely
echo "SESSION_SECRET=$SESSION_SECRET" > .env
echo "ADMIN_USERNAME=$ADMIN_USERNAME" >> .env
echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> .env
chmod 600 .env  # Restrict file permissions
```

**For Development:**
```bash
# Development mode allows default credentials
export NODE_ENV=development
npm run dev
# Login with admin/admin
```

**Known Limitations:**
- Imported certificate keys stored in SQLite without encryption (planned enhancement)
- In-memory rate limiting (requires Redis/Memcached for multi-instance deployments)
- No 2FA support yet (planned enhancement)

---

## Certificate Management

### Automatic HTTPS (Default)

Caddy automatically handles SSL/TLS certificates for all proxy hosts:

- **Zero Configuration**: Just add a domain to a proxy host - certificates are obtained automatically
- **Auto-Renewal**: Certificates renew automatically before expiration
- **Multiple Domains**: Each proxy host can have multiple domains with automatic cert management
- **Wildcard Support**: Use Cloudflare DNS-01 challenge for wildcard certificates

**No action required** - this works out of the box!

### Custom Certificates (Optional)

Import your own certificates when you need to:

- **Internal CA**: Use certificates from your organization's Certificate Authority
- **Pre-existing Certs**: Reuse certificates you already have
- **Special Requirements**: Compliance, security policies, or specific certificate features
- **Wildcard from DNS Provider**: Import wildcard certificates from your DNS provider

**How to import:**
1. Navigate to **Certificates** page
2. Click **Import Custom Certificate**
3. Provide certificate name and domains
4. Paste certificate PEM (full chain recommended)
5. Paste private key PEM
6. Save and assign to proxy hosts as needed

**Security Note**: Imported private keys are stored in the database. Ensure your `.env` file and database have restricted permissions (`chmod 600`).

---

## Cloudflare DNS Automation

To enable automatic SSL certificates with Cloudflare DNS-01 challenges:

1. Navigate to **Settings** in the dashboard
2. Generate a Cloudflare API token with `Zone.DNS:Edit` permissions
3. Enter your token (it's never pre-filled or displayed again for security)
4. Optionally provide Zone ID / Account ID for multi-zone setups
5. Configure ACME email address for certificate notifications

**To revoke a token:** Select "Remove existing token" in Settings and submit.

---

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Create optimized production build |
| `npm start` | Run production server |
| `npm run typecheck` | Run TypeScript type checking |

### Development Notes

- **Database:** Drizzle migrations live in `/drizzle`. Run `npm run db:migrate` to apply them to your local SQLite file.
- **Caddy Config:** Rebuilt on each mutation and pushed to Caddy Admin API. Errors are surfaced in the UI.
- **Rate Limiting:** Kept in-memory per Node process. For horizontal scaling, use Redis/Memcached.
- **Authentication:** Currently supports single admin user. Multi-role support requires architecture changes.

---

## Roadmap

We're actively working on these improvements:

- [ ] Multi-user support with role-based access control
- [ ] Additional DNS providers (Namecheap, Route53, etc.)
- [ ] Metrics and monitoring dashboard
- [ ] Backup and restore functionality
- [ ] API for programmatic configuration

Have ideas? [Open an issue](https://github.com/yourusername/caddy-proxy-manager/issues) or submit a PR!

---

## Contributing

We welcome contributions from the community! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request**

### Development Guidelines

- Follow the existing code style (TypeScript, Prettier formatting)
- Add tests for new features when applicable
- Update documentation for user-facing changes
- Keep commits focused and write clear commit messages

---

## Support

Need help? We're here for you:

- **Documentation:** Check this README and inline code comments
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

Made with ❤️ by the Caddy Proxy Manager community

[⬆ back to top](#caddy-proxy-manager)

</div>
