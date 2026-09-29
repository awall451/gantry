# Gantry MCP

MCP server that exposes Gantry's deploy, route, and lifecycle operations to an MCP-aware client (Claude Code, etc.). Lets the agent clone a repo, bring up its containers, and verify the auto-discovered Gantry route in one tool call.

## Prereqs

- Node.js 18+
- Gantry stack running and reachable at `http://localhost:3001` (override with `GANTRY_API`)
- `git`, `docker`, `curl`, `ss`, `find` on `PATH`
- Docker socket access for the user running this MCP

## Install (recommended)

One-shot installer:

```bash
cd mcp
./setup.sh
```

What it does:

1. Verifies `node` 18+, `npm`, `claude`, `git`, `docker`, `curl`, `ss`, `find` on `PATH`
2. Probes the Docker daemon and Gantry backend
3. Runs `npm install` in `mcp/` (skips if `node_modules` already populated)
4. Creates `$GANTRY_SERVICES_DIR` (default `~/services`)
5. Removes stale `~/.claude/.mcp.json` if found (asks first)
6. Registers the MCP user-wide via `claude mcp add ... -s user`
7. Prints `claude mcp list` to verify

Then restart Claude Code.

## Configure

Two env vars, both optional. The installer reads them at install time and bakes them into the registration:

| Var | Default | Purpose |
|-----|---------|---------|
| `GANTRY_SERVICES_DIR` | `~/services` | Where `deploy_service` clones repos and where `update_service`/`remove_service`/`list_services` look |
| `GANTRY_API` | `http://localhost:3001` | Gantry backend base URL |

To override, prepend before `./setup.sh`:

```bash
GANTRY_SERVICES_DIR=/srv/apps ./setup.sh
```

To re-register later (e.g. after moving the repo): rerun `./setup.sh` — idempotent.

## Manual install (if you can't use the script)

```bash
cd mcp
npm install
claude mcp add gantry -s user \
  --env GANTRY_SERVICES_DIR=$HOME/services \
  -- node "$(pwd)/index.js"
```

> Claude Code does **not** read `~/.claude/.mcp.json`. The user-scoped store is `~/.claude.json` under the `mcpServers` key — `claude mcp add` writes there for you. For project-scoped registration, drop `.mcp.json` at the **repo root** (see `.mcp.json.example`).

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

## Future: slash-command prompts

Today the MCP exposes **tools only**. They fire when the agent decides to call them based on natural-language intent ("list all gantry routes" → agent calls `list_routes`). Tools do not appear as slash commands.

MCP also supports a second primitive — **prompts** — which *do* surface as `/mcp__gantry__<name>` in Claude Code's slash-command menu. Tools and prompts coexist on the same server; adding prompts does not change tool behavior. A prompt is a pure text template (no HTTP, no shell) that, when invoked, injects a rendered string into the chat — the agent then calls the underlying tool to do the real work.

Reasonable candidates to wrap as prompts:

| Prompt | Renders to | Args |
|--------|------------|------|
| `routes` | "List all Gantry proxy routes" | none |
| `services` | "List all services in `$GANTRY_SERVICES_DIR` with their container status" | none |
| `ports` | "Show all listening TCP ports on this host" | none |
| `status` | "Check status of `<host>.localhost` (and optionally `localhost:<port>`)" | `hostname`, optional `port` |

`deploy_service` / `update_service` / `remove_service` are poor prompt candidates — multi-arg, side-effectful, and the value of typing the command is small versus describing intent in chat.

Implementation sketch (when we get there):

```js
server.registerPrompt(
  "routes",
  { title: "List Gantry routes", description: "Show all proxy routes", argsSchema: {} },
  async () => ({
    messages: [{ role: "user", content: { type: "text", text: "List all Gantry proxy routes." } }],
  })
);
```

One commit per prompt batch, behind a follow-up PR. No backend or tool changes required.

---

Gantry is free and MIT. If it saves you time, [buy me a coffee](https://ko-fi.com/sigilworks).
