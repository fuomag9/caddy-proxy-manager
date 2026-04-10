FROM docker:cli

# Only need docker compose CLI and basic shell tools
RUN apk add --no-cache bash

COPY docker/l4-port-manager/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
USER appuser

ENTRYPOINT ["/entrypoint.sh"]
