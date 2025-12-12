#!/bin/sh
set -e

export UID=${PUID:-1001}
export GID=${PGID:-1001}

DB_PATH="${DATABASE_PATH:-/app/data/caddy-proxy-manager.db}"
DB_DIR=$(dirname "$DB_PATH")

echo "Ensuring database directory exists..."
if [ ! -d "$DB_DIR" ]; then
  mkdir -p "$DB_DIR"
fi

chown -R $UID:$GID "$DB_DIR" || true

echo "Starting application..."
exec gosu $UID:$GID env HOSTNAME=0.0.0.0 node server.js
