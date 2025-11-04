# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by:

1. **DO NOT** open a public issue
2. Email the maintainers or use GitHub's private vulnerability reporting
3. Include detailed information about the vulnerability:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and provide regular updates on the fix progress.

## Security Measures

### Build Pipeline Security

Our CI/CD pipeline implements multiple security layers:

1. **Fork PR Protection**: Pull requests from forks require manual approval (via `safe-to-build` label) before builds run
2. **Vulnerability Scanning**: All images are scanned with Trivy for CRITICAL and HIGH vulnerabilities
3. **SBOM Generation**: Software Bill of Materials is generated for all builds
4. **Provenance Attestation**: Build provenance is recorded for supply chain security
5. **SHA-Pinned Actions**: All GitHub Actions are pinned to specific SHA commits
6. **Limited Permissions**: Workflows use minimal required permissions
7. **No Push from PRs**: Pull requests only build images locally, never push to registry

### Container Security

- Multi-architecture support (amd64, arm64)
- Regular base image updates
- Minimal attack surface
- Non-root user execution where possible

### Dependency Management

- Automated dependency updates via Dependabot
- Security alerts enabled
- Regular security audits

## Security Best Practices for Contributors

When contributing:

1. Never commit secrets, tokens, or credentials
2. Use environment variables for sensitive configuration
3. Keep dependencies up to date
4. Follow principle of least privilege
5. Validate and sanitize all user inputs
6. Use parameterized queries for database operations

## Automated Security Checks

Our repository includes:

- **Trivy vulnerability scanning** on every build
- **Dependabot** for dependency updates
- **GitHub Security Advisories** monitoring
- **SARIF upload** to GitHub Security tab for vulnerability tracking

## Safe-to-Build Label

For maintainers reviewing fork PRs:

1. Review the PR code thoroughly for malicious content
2. Check for suspicious file modifications
3. Verify no secrets or credentials are exposed
4. Only add `safe-to-build` label if code is verified safe
5. Remove label immediately if concerns arise

## Security Updates

Security updates are prioritized and released as soon as possible. Subscribe to repository releases to stay informed.
