# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gantry

Smart local reverse proxy + Docker management UI: auto-discovers containers, routes `*.localhost` subdomains, manages routes and containers via web UI (Portainer-style).

## Commands

```bash
# Production (builds frontend into backend image)
docker compose up --build

# Dev mode: Caddy in Docker, backend + frontend hot-reload
./dev.sh

# Backend only (from repo root, env vars match dev.sh)
cd backend && PORT=3001 CADDY_ADMIN=http://localhost:2019 DB_PATH=../data/proxy.db LOG_PATH=../logs/access.log npm run dev

# Frontend only
cd frontend && npm run dev -- --port 5173
```

No test suite or linter configured.

**Frontend changes in production mode require `docker compose up --build`** — compiled assets are baked into the Docker image (no volume mount). In dev mode (`./dev.sh`), Vite HMR picks up changes immediately.

Management UI: http://gantry.localhost  
Backend API: http://localhost:3001/api

## Architecture

Three components on `network_mode: host` so they can dial each other by port without container NAT:

- **Caddy** — reverse proxy on `:80`, dynamic config via Admin API on `:2019`
- **Node.js backend** (`backend/src/`) — Express on `:3001`, Docker socket watcher, Caddy config pusher, WebSocket server, SQLite (better-sqlite3)
- **SvelteKit frontend** (`frontend/`) — built into `backend/public/` (served as static files by Express); in dev mode runs separately on `:5173` and proxies API calls via Vite to `:3001`

### Backend file map

| File | Purpose |
|------|---------|
| `index.js` | Express server, WS servers (broadcast + exec), upgrade routing |
| `docker-client.js` | Shared dockerode singleton (`/var/run/docker.sock`) — import from here, don't create new instances |
| `docker-watcher.js` | Docker event listener, `syncContainers()` (exported), `getLiveContainers()` |
| `caddy-client.js` | Builds + pushes full Caddy JSON config via Admin API |
| `db.js` | SQLite layer — routes + analytics tables |
| `log-tail.js` | Tails Caddy access log, aggregates into analytics table |
| `stats-manager.js` | Per-container CPU/mem polling, subscriber registry |
| `api/containers.js` | Container CRUD + lifecycle + SSE logs + inspect |
| `api/routes.js` | Proxy route CRUD |
| `api/analytics.js` | Analytics query |
| `api/images.js` | Docker image list + remove |
| `api/volumes.js` | Docker volume list + remove |
| `api/networks.js` | Docker network list (read-only) |

### Data flow: container → route → Caddy

1. `docker-watcher.js` — listens to Docker events (`start`, `die`, `destroy`) → calls `syncContainers()`
2. `syncContainers()` — upserts routes in SQLite, pushes Caddy config, broadcasts `routes:updated` over WebSocket
3. `caddy-client.js` — builds full Caddy JSON config from enabled routes, POSTs to `/load` (atomic replace)
4. `gantry.localhost` always first route, hard-coded to backend port

### WebSocket architecture

Two separate WS servers, both `noServer: true`, routed by path in `server.on('upgrade')`:

- **`/ws`** — broadcast WS (`wss`). Server→client: `routes:updated`, `container:started/stopped/restarted`, `stats:update`. Client→server: `stats:subscribe / stats:unsubscribe` (handled by `stats-manager.js`).
- **`/ws/exec/:id`** — exec terminal relay (`execWss`). Pipes browser↔`container.exec()`. JSON messages starting with `{` are control frames (`{ type: 'resize', cols, rows }`); everything else is raw terminal input.

### Stats monitoring

`stats-manager.js` maintains `Map<containerId, Set<WebSocket>>`. When a container has ≥1 subscriber, polls `container.stats({ stream: false })` every 2s and sends `stats:update` to subscribers only. Polling stops when subscriber count hits 0. Frontend subscribes on component mount, unsubscribes on destroy.

### Container log streaming

`GET /api/containers/:id/logs` — SSE (`text/event-stream`).

Two critical implementation details:
- Docker log streams are multiplexed (8-byte frame headers). Must call `docker.modem.demuxStream(logStream, stdout, stderr)` or binary garbage appears in output.
- Must set `X-Accel-Buffering: no` header — Caddy buffers proxy responses by default, which silently breaks SSE.

### Analytics pipeline

`log-tail.js` tails `/logs/access.log` (Caddy JSON). Each line parsed → aggregated per `(hostname, hour)` into `analytics` table with running avg for `avg_duration_ms`.

### DB schema

**`routes`**: `id, container_id, container_name, hostname (UNIQUE), target_port, enabled, is_auto, created_at`
- `is_auto=1` → Docker-discovered; `0` → manually added
- `container_id` updated on restart (same name, new ID) — no duplicate routes
- `markContainerStopped` is intentional no-op: stopped containers stay visible as offline

**`analytics`**: `hostname, hour (PK), request_count, status_2xx, status_4xx, status_5xx, avg_duration_ms`

### Frontend pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — expandable horizontal container rows |
| `/routes` | Proxy route management table |
| `/analytics` | Request charts (line + bar, Chart.js) — time range dropdown (5m/15m/30m/1h/6h/24h/1w + custom date range) |
| `/containers` | Container list table |
| `/containers/[id]` | Container detail: Overview (stats chart), Logs (SSE), Inspect (raw JSON), Terminal (xterm.js) |
| `/images` | Image list + remove |
| `/volumes` | Volume list + remove |
| `/networks` | Network list (read-only) |

### Frontend lib

- `lib/ws.js` — WS client. Exports: `connectWs`, `wsSend(data)`, `wsMessage` store, `statsStore` store. Routes `stats:update` messages to `statsStore`, everything else to `wsMessage`.
- `lib/api.js` — fetch wrapper for all REST endpoints
- `lib/components/ContainerCard.svelte` — expandable horizontal row (click to expand detail panel)

### Nav

Left collapsible sidebar (200px expanded / 52px icon-only collapsed). Two groups: Proxy (Dashboard, Routes, Analytics) and Docker (Containers, Images, Volumes, Networks). Toggle with `‹/›` button. State is in-memory only (resets on reload).

### Frontend packages

`xterm` + `@xterm/addon-fit` — terminal emulator on the container detail Terminal tab. Note: `xterm` 5.x is deprecated upstream; successor is `@xterm/xterm`. Works but can be migrated by updating imports.

### Vite dev proxy

`'^/ws'` (regex) proxies both `/ws` and `/ws/exec/:id` to `ws://localhost:3001`.

### CSS conventions

**Never put `display: flex` directly on a `<td>`.** It detaches the cell from table row height equalization — `border-bottom` renders at content-height instead of row-bottom, causing visual misalignment when rows have varying heights.

Correct pattern (used in routes, images, volumes pages):
```svelte
<td>
  <div class="action-cell"><!-- flex content here --></div>
</td>
```

Wrong pattern:
```svelte
<td class="action-cell"><!-- .action-cell has display:flex --></td>
```

## Known Issues / Future Work

### Multi-container apps and CORS

Apps with separate frontend + API containers break when accessed via `*.localhost`. Frontend JS calls API at hardcoded `localhost:PORT`, changing origin → CORS rejection.

**Workaround:** Add `allow_origin_regex=r"http://.*\.localhost(:\d+)?"` to each API's CORS config.

**Better fix:** Sub-path routing — e.g., `timelog.localhost/api/*` → `timelog-vibed-api-1:8888`. Requires:
- UI: "linked routes" — path prefix on one route → another route's upstream
- DB: `sub_routes` table (`parent_route_id`, `path_prefix`, `target_port`)
- Caddy config builder: emit path-matched routes before catch-all host route

### Container name collision
Two containers with same sanitized name (e.g., `my_app` and `my-app`) — second `INSERT OR IGNORE` silently dropped. Should surface conflict warning in UI.

### Analytics timing
Log tail aggregates after Caddy writes access log. First request to new route won't appear until next log flush (~1s).

### xterm deprecation
`xterm` 5.x is deprecated. Migrate to `@xterm/xterm` + update imports in `frontend/src/routes/containers/[id]/+page.svelte`.

### Port conflict: leftover harbor containers
Project was renamed from `harbor` to `gantry`. Old `harbor-backend-1` / `harbor-caddy-1` containers share `network_mode: host` and bind port 3001 — conflicts with gantry. Stop them if they reappear: `docker stop harbor-backend-1 harbor-caddy-1`.

### Prometheus (future — multi-host visibility)
Current analytics storage is SQLite (single-host, no alerting). If multi-host visibility or alerting becomes a requirement, add Prometheus:
- `stats-manager.js` already polls per-container CPU/mem — expose a `/metrics` endpoint (prom-client) and point Prometheus at it
- Grafana for dashboards, Alertmanager for alerting
- Not worth the ops overhead for single-host use
