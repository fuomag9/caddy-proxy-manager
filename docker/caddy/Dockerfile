# syntax=docker/dockerfile:1.6

FROM golang:1.25 AS builder

# Install xcaddy
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

# Build Caddy with plugins
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare \
    --with github.com/mholt/caddy-l4 \
    --with github.com/trea/caddy-loki-logger \
    --output /usr/bin/caddy

FROM ubuntu:24.04

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile

# Create caddy user and directories
RUN groupadd caddy && useradd -r -g caddy -m -d /home/caddy caddy \
    && mkdir -p /data /config \
    && chown -R caddy:caddy /data /config /home/caddy

EXPOSE 80 443 2019

# Set environment variables to use /data and /config like official Caddy image
ENV XDG_CONFIG_HOME=/config
ENV XDG_DATA_HOME=/data

USER caddy
CMD ["caddy", "run", "--resume", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
