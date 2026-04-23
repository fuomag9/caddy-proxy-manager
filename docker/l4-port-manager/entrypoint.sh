#!/bin/sh
#
# L4 Port Manager Sidecar
#
# On startup: always applies the current L4 ports override so the caddy
# container has the correct ports bound (the main compose stack starts caddy
# without the L4 ports override file).
#
# During runtime: watches the trigger file for changes and re-applies when
# the web app signals that port configuration has changed.
#
# Only ever recreates the caddy container — never touches any other service.
#
# Environment variables:
#   DATA_DIR              - Path to shared data volume (default: /data)
#   COMPOSE_DIR           - Path to compose files (default: /compose)
#   CADDY_CONTAINER_NAME  - Caddy container name for project auto-detection (default: caddy-proxy-manager-caddy)
#   COMPOSE_PROJECT_NAME  - Override compose project name (auto-detected from caddy container labels if unset)
#   POLL_INTERVAL         - Seconds between trigger file checks (default: 2)

set -e

DATA_DIR="${DATA_DIR:-/data}"
COMPOSE_DIR="${COMPOSE_DIR:-/compose}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"
CADDY_CONTAINER_NAME="${CADDY_CONTAINER_NAME:-caddy-proxy-manager-caddy}"

TRIGGER_FILE="$DATA_DIR/l4-ports.trigger"
STATUS_FILE="$DATA_DIR/l4-ports.status"
OVERRIDE_FILE="$DATA_DIR/docker-compose.l4-ports.yml"

log() {
  echo "[l4-port-manager] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

write_status() {
  state="$1"
  message="$2"
  applied_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  error="${3:-}"

  cat > "$STATUS_FILE" <<STATUSEOF
{
  "state": "$state",
  "message": "$message",
  "appliedAt": "$applied_at"$([ -n "$error" ] && echo ",
  \"error\": \"$error\"" || echo "")
}
STATUSEOF
}

# Auto-detect the Docker Compose project name from the running caddy container's labels.
# This ensures we operate on the correct project regardless of where compose files are mounted.
detect_project_name() {
  if [ -n "$COMPOSE_PROJECT_NAME" ]; then
    echo "$COMPOSE_PROJECT_NAME"
    return
  fi
  detected=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$CADDY_CONTAINER_NAME" 2>/dev/null || echo "")
  if [ -n "$detected" ]; then
    echo "$detected"
  else
    echo "caddy-proxy-manager"
  fi
}

# Apply the current port override — recreates only the caddy container.
do_apply() {
  COMPOSE_PROJECT="$(detect_project_name)"
  log "Using compose project: $COMPOSE_PROJECT"

  # Build compose args. Files are read from COMPOSE_DIR (container path).
  # COMPOSE_HOST_DIR (when set) is passed as --project-directory so the Docker
  # daemon resolves relative bind-mount paths (e.g. ./geoip-data) against the
  # actual host project directory rather than the sidecar's /compose mount.
  COMPOSE_ARGS="-p $COMPOSE_PROJECT"
  if [ -n "$COMPOSE_HOST_DIR" ]; then
    COMPOSE_ARGS="$COMPOSE_ARGS --project-directory $COMPOSE_HOST_DIR"
  fi
  # Explicitly supply the .env file so required variables are available even
  # when --project-directory points to a host path not mounted in the sidecar.
  if [ -f "$COMPOSE_DIR/.env" ]; then
    COMPOSE_ARGS="$COMPOSE_ARGS --env-file $COMPOSE_DIR/.env"
  fi
  COMPOSE_ARGS="$COMPOSE_ARGS -f $COMPOSE_DIR/docker-compose.yml"
  if [ -f "$COMPOSE_DIR/docker-compose.override.yml" ]; then
    COMPOSE_ARGS="$COMPOSE_ARGS -f $COMPOSE_DIR/docker-compose.override.yml"
  fi
  if [ -f "$OVERRIDE_FILE" ]; then
    COMPOSE_ARGS="$COMPOSE_ARGS -f $OVERRIDE_FILE"
  fi

  write_status "applying" "Recreating caddy container with updated ports..."

  # shellcheck disable=SC2086
  COMPOSE_OUTPUT=$(docker compose $COMPOSE_ARGS up -d --no-deps --pull never --force-recreate caddy 2>&1)
  COMPOSE_EXIT=$?
  log "$COMPOSE_OUTPUT"
  if [ $COMPOSE_EXIT -eq 0 ]; then
    log "Caddy container recreated successfully."

    # Wait for caddy healthcheck to pass
    HEALTH_TIMEOUT=30
    HEALTH_WAITED=0
    HEALTH="unknown"
    while [ "$HEALTH_WAITED" -lt "$HEALTH_TIMEOUT" ]; do
      HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$CADDY_CONTAINER_NAME" 2>/dev/null || echo "unknown")
      if [ "$HEALTH" = "healthy" ]; then
        break
      fi
      sleep 1
      HEALTH_WAITED=$((HEALTH_WAITED + 1))
    done

    if [ "$HEALTH" = "healthy" ]; then
      write_status "applied" "Caddy container recreated and healthy with updated ports."
      log "Caddy is healthy."
    else
      write_status "applied" "Caddy container recreated but health check status: $HEALTH (may still be starting)."
      log "Warning: Caddy health status is '$HEALTH' after ${HEALTH_TIMEOUT}s."
    fi
  else
    # Truncate output to avoid oversized status files
    SHORT_OUTPUT=$(echo "$COMPOSE_OUTPUT" | tail -5)
    ERROR_MSG="Failed to recreate caddy container: $SHORT_OUTPUT"
    write_status "failed" "$ERROR_MSG" "$ERROR_MSG"
    log "ERROR: $ERROR_MSG"
  fi

  # Delete the trigger file after processing so stale triggers don't cause
  # "Waiting for port manager sidecar..." on the next boot.
  rm -f "$TRIGGER_FILE"
}

# ---------------------------------------------------------------------------
# Startup: always apply the override so caddy has the correct ports bound.
# (The main compose stack starts caddy without the L4 ports override file.)
# Only apply if the override file exists — it is created on first "Apply Ports".
# ---------------------------------------------------------------------------
if [ -f "$OVERRIDE_FILE" ]; then
  log "Startup: applying existing L4 port override..."
  do_apply
else
  write_status "idle" "Port manager sidecar is running and ready."
  log "Started. No L4 port override file yet."
fi

# Capture the current trigger content so the poll loop doesn't re-apply
# a trigger that was already handled (either above or before this boot).
# Use explicit assignment — do NOT use ${VAR:-fallback} which treats empty as unset.
LAST_TRIGGER=$(cat "$TRIGGER_FILE" 2>/dev/null || echo "")

log "Watching $TRIGGER_FILE for changes (poll every ${POLL_INTERVAL}s)"

while true; do
  sleep "$POLL_INTERVAL"

  CURRENT_TRIGGER=$(cat "$TRIGGER_FILE" 2>/dev/null || echo "")
  if [ "$CURRENT_TRIGGER" = "$LAST_TRIGGER" ]; then
    continue
  fi

  # Empty trigger means the file was just deleted — nothing to do.
  if [ -z "$CURRENT_TRIGGER" ]; then
    LAST_TRIGGER=""
    continue
  fi

  LAST_TRIGGER="$CURRENT_TRIGGER"
  log "Trigger changed. Applying port changes..."
  do_apply
done
