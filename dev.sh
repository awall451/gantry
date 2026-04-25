#!/usr/bin/env bash
set -e

# Start Caddy via Docker Compose
docker compose up caddy -d

# Install deps if needed
(cd backend && [ -d node_modules ] || npm install)
(cd frontend && [ -d node_modules ] || npm install)

# Run backend + frontend in parallel
trap 'kill %1 %2 2>/dev/null' EXIT
(cd backend && PORT=3001 CADDY_ADMIN=http://localhost:2019 DB_PATH=../data/proxy.db LOG_PATH=../logs/access.log npm run dev) &
(cd frontend && npm run dev -- --port 5173) &
wait
