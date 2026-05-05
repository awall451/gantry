# Gantry MCP

MCP server that exposes Gantry's deploy, route, and lifecycle operations to an MCP-aware client (Claude Code, etc.). Lets the agent clone a repo, bring up its containers, and verify the auto-discovered Gantry route in one tool call.

## Prereqs

- Node.js 18+
- Gantry stack running and reachable at `http://localhost:3001` (override with `GANTRY_API`)
- `git`, `docker`, `curl`, `ss`, `find` on `PATH`
- Docker socket access for the user running this MCP

## Install

```bash
cd mcp
npm install
```

## Configure

Two env vars, both optional:

| Var | Default | Purpose |
|-----|---------|---------|
| `GANTRY_SERVICES_DIR` | `~/services` | Where `deploy_service` clones repos and where `update_service`/`remove_service`/`list_services` look |
| `GANTRY_API` | `http://localhost:3001` | Gantry backend base URL |

The services dir is auto-created on startup.

### Register with Claude Code

Copy `mcp/.mcp.json.example` to either:

- `~/.claude/.mcp.json` (user-wide), or
- `<project>/.mcp.json` (per-project, checked in)

Edit the absolute path and `GANTRY_SERVICES_DIR` to taste. Restart Claude Code.

## Tools

| Tool | What it does |
|------|--------------|
| `list_routes` | GET `/api/routes` — all auto + manual proxy routes |
| `add_route_alias` | Add a manual hostname alias for a container |
| `remove_route` | Delete a route by ID |
| `get_service_status` | Probe `<host>.localhost` via the proxy and (optional) a direct port |
| `list_ports_in_use` | List listening TCP ports on the host (parsed from `ss -ltn`) |
| `deploy_service` | Clone repo into `$GANTRY_SERVICES_DIR/<name>`, `docker compose up`, verify Gantry pickup, optional alias |
| `update_service` | `git pull` + `docker compose up --build -d` (or `--no-cache`) for an existing service |
| `remove_service` | `docker compose down` + (optional) delete its Gantry routes |
| `list_services` | List subdirs of `$GANTRY_SERVICES_DIR` containing a compose file, with `docker compose ps` output |

## Security notes

- All shell calls use `execFileSync` with argv arrays — no string interpolation, no shell. Repo URLs, hostnames, dir names, and aliases pass through input regex validation before any subprocess call.
- Service-dir traversal is blocked: `name` must match `[A-Za-z0-9._-]+` and the resolved path must be inside `$GANTRY_SERVICES_DIR`.
- Destructive tools (`remove_service`, `remove_route`) are gated by Claude Code's per-tool approval prompt — the MCP itself does not add a second confirmation layer.
- The MCP runs as your user, on the host, with your Docker socket access. It is not sandboxed.

## Limits

- Compose project name matching uses `==`, `name-`, or `name_` prefix. Exotic Compose project names that don't match this pattern won't be auto-detected by `deploy_service`/`remove_service` route lookups.
- `deploy_service` waits a fixed 3s for Docker events to flow into Gantry's watcher before checking routes. Slow hosts may need a manual `list_routes` follow-up.
- Gantry only auto-discovers routes for containers with a published port. Composed services on internal networks won't appear in `list_routes`.
