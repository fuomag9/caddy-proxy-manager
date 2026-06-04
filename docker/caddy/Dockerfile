# syntax=docker/dockerfile:1.6

# Always run the builder on the host arch (BUILDPLATFORM) and let xcaddy
# cross-compile Caddy for the target arch via GOOS/GOARCH. This avoids QEMU
# emulation when producing the linux/arm64 image on an x86 GitHub runner —
# native cross-compilation is several times faster.
FROM --platform=$BUILDPLATFORM golang:1.26 AS builder

ARG TARGETOS
ARG TARGETARCH

# Install xcaddy
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

# Build Caddy with plugins.
# Track Caddy master until the v2.11.3 client TLS regression fix
# (caddyserver/caddy#7724) is available in a stable release.
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH xcaddy build master \
    --with github.com/caddy-dns/cloudflare \
    --with github.com/caddy-dns/route53 \
    --with github.com/caddy-dns/digitalocean \
    --with github.com/caddy-dns/duckdns \
    --with github.com/caddy-dns/hetzner \
    --with github.com/caddy-dns/vultr \
    --with github.com/caddy-dns/porkbun \
    --with github.com/caddy-dns/godaddy \
    --with github.com/caddy-dns/namecheap \
    --with github.com/caddy-dns/ovh \
    --with github.com/caddy-dns/ionos \
    --with github.com/caddy-dns/linode \
    --with github.com/caddy-dns/njalla \
    --with github.com/caddy-dns/spaceship \
    --with github.com/mholt/caddy-l4 \
    --with github.com/fuomag9/caddy-blocker-plugin \
    --with github.com/corazawaf/coraza-caddy/v2 \
    --output /usr/bin/caddy

FROM ubuntu:26.04

# Accept build args for user/group IDs to support rootless operation
# Using 10000 as default to avoid conflicts with system users
ARG PUID=10000
ARG PGID=10000

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy caddy binary from builder
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Create caddy user and directories with configurable IDs for rootless operation
# Remove any existing users/groups with the same UID/GID to avoid conflicts
RUN (getent group ${PGID} && groupdel $(getent group ${PGID} | cut -d: -f1) || true) && \
    (getent passwd ${PUID} && userdel $(getent passwd ${PUID} | cut -d: -f1) || true) && \
    groupadd -g ${PGID} caddy && \
    useradd -r -u ${PUID} -g caddy -m -d /home/caddy caddy && \
    mkdir -p /data /config /logs && \
    chown -R caddy:caddy /data /config /logs /home/caddy

COPY --chown=caddy:caddy docker/caddy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443 2019

# Set environment variables to use /data and /config like official Caddy image
ENV XDG_CONFIG_HOME=/config
ENV XDG_DATA_HOME=/data

# Run as non-root user (fully rootless)
USER caddy

CMD ["caddy", "run", "--resume", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
