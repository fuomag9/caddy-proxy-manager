#!/bin/sh
set -e

DB_PATH="${DATABASE_PATH:-/app/data/caddy-proxy-manager.db}"
DB_DIR=$(dirname "$DB_PATH")

echo "Ensuring database directory exists..."
mkdir -p "$DB_DIR"

echo "Starting application..."
exec env HOSTNAME=0.0.0.0 bun server.js
