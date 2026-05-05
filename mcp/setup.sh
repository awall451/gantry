#!/usr/bin/env bash
# Gantry MCP installer — idempotent.
# Installs npm deps, registers the MCP user-wide with Claude Code, prints next steps.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
INDEX_JS="$SCRIPT_DIR/index.js"
SERVICES_DIR="${GANTRY_SERVICES_DIR:-$HOME/services}"
GANTRY_API="${GANTRY_API:-http://localhost:3001}"
SERVER_NAME="gantry"
STALE_FILES=(
  "$HOME/.claude/.mcp.json"
  "$SCRIPT_DIR/.mcp.json"
)

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

bold "Gantry MCP setup"
info "Repo:           $SCRIPT_DIR"
info "Services dir:   $SERVICES_DIR"
info "Gantry API:     $GANTRY_API"
echo

# ─── Preflight ──────────────────────────────────────────────────────────
bold "Preflight"

if ! command -v node >/dev/null 2>&1; then
  err "node not found on PATH. Install Node.js 18+."
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "node $NODE_MAJOR found, need 18+."
  exit 1
fi
ok "node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm not found on PATH."
  exit 1
fi
ok "npm $(npm -v)"

if ! command -v claude >/dev/null 2>&1; then
  err "claude CLI not found on PATH. Install Claude Code first."
  exit 1
fi
ok "claude $(claude --version 2>&1 | head -1)"

for bin in git docker curl ss find; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    warn "$bin not found — some MCP tools will fail until installed."
  else
    ok "$bin"
  fi
done

if ! docker info >/dev/null 2>&1; then
  warn "docker daemon not reachable. MCP will fail to deploy/update services until fixed."
else
  ok "docker daemon reachable"
fi

if ! curl -sSf -o /dev/null --max-time 3 "$GANTRY_API/api/routes" 2>/dev/null; then
  warn "Gantry backend at $GANTRY_API not reachable. MCP will fail route tools until Gantry is up."
else
  ok "Gantry backend reachable"
fi
echo

# ─── Install deps ───────────────────────────────────────────────────────
bold "Install npm deps"
cd "$SCRIPT_DIR"
if [ -d node_modules/@modelcontextprotocol ]; then
  ok "deps already installed (skip)"
else
  npm install
  ok "deps installed"
fi
echo

# ─── Services dir ───────────────────────────────────────────────────────
bold "Services dir"
mkdir -p "$SERVICES_DIR"
ok "ensured: $SERVICES_DIR"
echo

# ─── Cleanup stale config ───────────────────────────────────────────────
for stale in "${STALE_FILES[@]}"; do
  if [ -f "$stale" ]; then
    bold "Stale config detected"
    warn "$stale — Claude Code does NOT read this path."
    read -r -p "  Delete it? [y/N] " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      rm -- "$stale"
      ok "deleted"
    else
      info "left in place"
    fi
    echo
  fi
done

# ─── Register MCP ───────────────────────────────────────────────────────
bold "Register MCP server (user scope)"
if claude mcp list 2>/dev/null | grep -q "^${SERVER_NAME}\b"; then
  warn "'$SERVER_NAME' already registered — re-registering."
  claude mcp remove "$SERVER_NAME" -s user >/dev/null 2>&1 || true
fi

claude mcp add "$SERVER_NAME" \
  -s user \
  --env "GANTRY_SERVICES_DIR=$SERVICES_DIR" \
  --env "GANTRY_API=$GANTRY_API" \
  -- node "$INDEX_JS"
ok "registered"
echo

# ─── Verify ─────────────────────────────────────────────────────────────
bold "Verify"
claude mcp list | sed 's/^/  /'
echo

bold "Done."
info "Restart Claude Code, then ask the agent: 'list all gantry routes'."
