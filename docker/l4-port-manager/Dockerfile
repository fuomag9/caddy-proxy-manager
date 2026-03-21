FROM docker:cli

# Only need docker compose CLI and basic shell tools
RUN apk add --no-cache bash

COPY docker/l4-port-manager/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
