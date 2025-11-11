# syntax=docker/dockerfile:1.6

FROM ubuntu:24.04 AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    golang-go \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install xcaddy
RUN wget -O /usr/local/bin/xcaddy "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/caddyserver/xcaddy" \
    && chmod +x /usr/local/bin/xcaddy

# Build Caddy with plugins
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare \
    --with github.com/mholt/caddy-l4 \
    --output /usr/bin/caddy

FROM ubuntu:24.04

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile

# Create caddy user and directories
RUN groupadd -g 1000 caddy && useradd -r -u 1000 -g caddy caddy \
    && mkdir -p /data /config \
    && chown -R caddy:caddy /data /config

EXPOSE 80 443 2019

USER caddy
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
