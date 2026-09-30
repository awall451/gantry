#!/usr/bin/env bash
# Set, change or remove Gantry's login, and optionally mint an API token for
# the MCP server. Writes .env next to docker-compose.yml; the password itself
# never touches disk, argv or the shell history (it is piped to the hasher).
#
#   scripts/set-password.sh              prompt for username + password
#   scripts/set-password.sh --api-token  also generate GANTRY_API_TOKEN
#   scripts/set-password.sh --disable    remove the login (open UI, as before)
#
# Then apply with:  docker compose up -d
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env

set_var() { # set_var KEY VALUE — replace or append KEY=VALUE in .env
  local key=$1 val=$2 tmp
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  tmp=$(mktemp)
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

current() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

if [[ "${1:-}" == "--disable" ]]; then
  set_var GANTRY_PASSWORD_HASH ''
  echo "Login removed from $ENV_FILE. Apply with: docker compose up -d"
  exit 0
fi

user_default=$(current GANTRY_USERNAME); user_default=${user_default:-admin}
read -r -p "Username [$user_default]: " user
user=${user:-$user_default}

read -r -s -p "Password (8+ characters): " pw1; echo
read -r -s -p "Repeat: " pw2; echo
[[ "$pw1" == "$pw2" ]] || { echo "Passwords do not match." >&2; exit 1; }
(( ${#pw1} >= 8 )) || { echo "Use at least 8 characters." >&2; exit 1; }

hash=$(printf '%s\n' "$pw1" | docker run --rm -i \
  -v "$PWD/backend/src/auth/password.js:/password.js:ro" node:20-alpine \
  node /password.js --stdin)
unset pw1 pw2

set_var GANTRY_USERNAME "$user"
set_var GANTRY_PASSWORD_HASH "$hash"
echo "Login set for \"$user\" in $ENV_FILE. Existing sessions are logged out."

if [[ "${1:-}" == "--api-token" ]]; then
  token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  set_var GANTRY_API_TOKEN "$token"
  echo
  echo "GANTRY_API_TOKEN written. Re-register the MCP server so it sends it:"
  echo "  (cd mcp && ./setup.sh)"
fi

echo
echo "Apply with: docker compose up -d"
