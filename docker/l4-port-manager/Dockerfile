FROM docker:cli

# Only need docker compose CLI and basic shell tools
RUN apk add --no-cache bash

COPY docker/l4-port-manager/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Runs as root intentionally: this sidecar executes `docker compose` to
# recreate the caddy container and writes status files to the shared
# caddy-manager-data volume (owned by the web container's UID).
# Access to the Docker API is scoped via the docker-socket-proxy service
# which restricts to GET/POST on /containers/ and /compose/ only.

ENTRYPOINT ["/entrypoint.sh"]
