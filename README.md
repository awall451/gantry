# Gantry

Smart local reverse proxy + Docker management UI. Auto-discovers containers, routes `*.localhost` subdomains, manages routes and containers via web UI.

## Features

- Auto-discovers running Docker containers and creates `*.localhost` proxy routes
- Manage routes, containers, images, volumes, and networks from a single UI
- Live container logs, stats, and terminal (xterm.js)
- Request analytics with time-range charts
- WebSocket push for real-time UI updates
- Optional Tailscale access: reach every route from your phone or another machine on your tailnet as `<container>.gantry.internal`

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

## Tailscale access (optional)

Off by default. Turn it on under **Settings → Tailscale** and Gantry will:

1. Match every route on a second suffix (default `gantry.internal`) in addition to `.localhost`.
2. Run a tiny built-in DNS responder on this host's Tailscale IP, port 53, that answers `*.gantry.internal` with that IP.

Then, once, in the [Tailscale admin console → DNS](https://login.tailscale.com/admin/dns): **Add nameserver → Custom**, nameserver = this host's Tailscale IP, **Restrict to domain** = `gantry.internal`. The Settings page shows these steps with your values filled in. Any device on the tailnet can now open `http://<container>.gantry.internal`, and `http://gantry.internal` is the Gantry UI.

Traffic is plain HTTP inside Tailscale's encrypted tunnel. Nothing is exposed outside the tailnet.

## Requirements

- Docker with socket access (`/var/run/docker.sock`)
- Port 80 free (Caddy)
- Ports 3001 and 2019 free (backend + Caddy Admin API)
- With Tailscale access on: UDP 53 free on the Tailscale interface (systemd-resolved only binds 127.0.0.53, so this is normally fine)
