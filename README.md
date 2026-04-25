# Gantry

Smart local reverse proxy + Docker management UI. Auto-discovers containers, routes `*.localhost` subdomains, manages routes and containers via web UI.

## Features

- Auto-discovers running Docker containers and creates `*.localhost` proxy routes
- Manage routes, containers, images, volumes, and networks from a single UI
- Live container logs, stats, and terminal (xterm.js)
- Request analytics with time-range charts
- WebSocket push for real-time UI updates

## Quick Start

```bash
docker compose up --build
```

- **UI:** http://gantry.localhost
- **API:** http://localhost:3001/api

Caddy listens on `:80`. Any running container with an exposed port gets a `<container-name>.localhost` route automatically.

## Development

```bash
./dev.sh
```

Runs Caddy in Docker, backend and frontend with hot-reload.

| Service | URL |
|---------|-----|
| UI (Vite HMR) | http://localhost:5173 |
| Backend API | http://localhost:3001/api |
| Caddy proxy | http://\*.localhost |

Or run individually:

```bash
# Backend
cd backend && PORT=3001 CADDY_ADMIN=http://localhost:2019 DB_PATH=../data/proxy.db LOG_PATH=../logs/access.log npm run dev

# Frontend
cd frontend && npm run dev -- --port 5173
```

## Stack

| Component | Tech |
|-----------|------|
| Reverse proxy | Caddy (dynamic config via Admin API) |
| Backend | Node.js + Express + better-sqlite3 |
| Frontend | SvelteKit + Chart.js + xterm.js |
| Container API | Dockerode (`/var/run/docker.sock`) |

## How Routes Work

1. Docker event listener watches for container `start`/`stop`/`destroy`
2. On change, routes are upserted in SQLite and Caddy config is rebuilt atomically
3. `<container-name>.localhost` → container's first exposed port
4. Manual routes can be added via the Routes page

Stopped containers remain visible in the UI as offline. Routes persist across restarts.

## Requirements

- Docker with socket access (`/var/run/docker.sock`)
- Port 80 free (Caddy)
- Ports 3001 and 2019 free (backend + Caddy Admin API)
