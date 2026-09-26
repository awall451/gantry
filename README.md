# Gantry

Smart local reverse proxy + Docker management UI. Auto-discovers containers, routes `*.localhost` subdomains, manages routes and containers via web UI.

## Features

- Auto-discovers running Docker containers and creates `*.localhost` proxy routes
- Manage routes, containers, images, volumes, and networks from a single UI
- Live container logs, stats, and terminal (xterm.js)
- Request analytics with time-range charts
- WebSocket push for real-time UI updates
- Optional Tailscale access: reach every route from your phone or any other tailnet device as `<container>.gantry.internal`, no DNS server or extra containers to run
- Settings page: base domain, Tailscale options, live status

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

Off by default — a stock install behaves exactly as before and never touches Tailscale.

Turn it on under **Settings → Tailscale** and every route becomes reachable from any device on your tailnet, alongside the usual `*.localhost` names:

| Where you are | What you open |
|---------------|---------------|
| On the machine running Gantry | `http://<container>.localhost` (unchanged) |
| Any other tailnet device (phone, laptop, …) | `http://<container>.gantry.internal` |
| Gantry itself, from the tailnet | `http://gantry.internal` |

`gantry.internal` is the default; pick any name you like. `.internal` is reserved for private use, so it can never collide with a public domain.

### How it works

Tailscale's MagicDNS gives every device one name and has no wildcard records, so Gantry fills the gap itself:

1. **Caddy** matches every route on a second suffix (`<container>.gantry.internal`) in addition to `.localhost`. Caddy already listens on all interfaces, so tailnet traffic reaches it on port 80 like any other.
2. **A built-in DNS responder** (dependency-free, ~150 lines) binds UDP 53 on this machine's Tailscale IP and answers `*.gantry.internal` with that IP. Nothing else — names outside the zone are refused. The IP is auto-detected; you can pin it.
3. **Tailscale split DNS** sends only queries for that domain to Gantry. One-time setup in the Tailscale admin console, and the Settings page prints the exact steps with your values filled in:
   **DNS → Nameservers → Add nameserver → Custom** → nameserver = this machine's Tailscale IP → **Restrict to domain** = `gantry.internal`.

Links in the UI follow the address you opened Gantry on: open it as `gantry.localhost` and cards link to `*.localhost`; open it as `gantry.internal` from a phone and they link to `*.gantry.internal`. Both names are listed, so the other one is always a click away.

Traffic is plain HTTP inside Tailscale's encrypted tunnel; nothing is exposed outside the tailnet. If the machine running Gantry is asleep, the names simply don't resolve.

### Settings

`Settings` (left nav, **System**) holds the base domain (`localhost` by default) and everything Tailscale-related: enable, domain, IP override, the DNS responder toggle and port, plus live status of the responder (running / bind error / no Tailscale IP found). Runtime problems are shown there and on `/health`; they never block saving.

## Requirements

- Docker with socket access (`/var/run/docker.sock`)
- Port 80 free (Caddy)
- Ports 3001 and 2019 free (backend + Caddy Admin API)
- With Tailscale access on: UDP 53 free on the Tailscale interface (systemd-resolved binds only `127.0.0.53`, so this is normally the case) and Tailscale running on the host
