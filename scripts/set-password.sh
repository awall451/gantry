#!/usr/bin/env bash
# Set, change or remove Gantry's login; optionally protect the host terminal
# with an authenticator app (TOTP) and mint an API token for the MCP server.
# Writes .env next to docker-compose.yml. Secrets never touch argv or the
# shell history: the password is piped to the hasher.
#
#   scripts/set-password.sh                 username + password, then asks
#                                           about the host terminal and MFA
#   scripts/set-password.sh --api-token     also generate GANTRY_API_TOKEN
#   scripts/set-password.sh --totp          (re)do only the authenticator setup
#   scripts/set-password.sh --disable-totp  remove the authenticator requirement
#   scripts/set-password.sh --disable       remove the login (open UI, as before)
#
# Then apply with:  docker compose up -d
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env
AUTH_DIR="$PWD/backend/src/auth"

set_var() { # set_var KEY VALUE — replace or append KEY=VALUE in .env
  local key=$1 val=$2 tmp
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  tmp=$(mktemp)
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

current() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# Run one of backend/src/auth/*.js (no npm dependencies) in a throwaway node.
# Only auth_node_stdin forwards stdin (the password); the others get
# /dev/null so docker cannot swallow input meant for later prompts.
auth_node() { local f=$1; shift; docker run --rm -v "$AUTH_DIR:/auth:ro" node:20-alpine node "/auth/$f" "$@" </dev/null; }
auth_node_stdin() { local f=$1; shift; docker run --rm -i -v "$AUTH_DIR:/auth:ro" node:20-alpine node "/auth/$f" "$@"; }

ask_yes() { # ask_yes "Question" default(y|n)
  local q=$1 def=$2 ans hint='[y/N]'
  [[ $def == y ]] && hint='[Y/n]'
  read -r -p "$q $hint " ans || ans=''
  ans=${ans:-$def}
  [[ $ans =~ ^[Yy] ]]
}

setup_totp() {
  local user=$1 secret uri code ok=0 try
  secret=$(auth_node totp.js new)
  uri=$(auth_node totp.js uri "$secret" "${user}@$(hostname)")
  echo
  echo "Scan this with your authenticator app (Aegis, Google Authenticator, 1Password, ...):"
  echo
  if command -v qrencode >/dev/null; then
    qrencode -t ansiutf8 "$uri"
  elif ! docker compose run --rm --no-deps -T backend node src/auth/totp.js qr "$uri" </dev/null 2>/dev/null; then
    echo "  (No QR renderer here: install qrencode, or type the key below into the app.)"
  fi
  echo "Can't scan? Add it by hand: account \"Gantry\", time-based, key:"
  echo "  $(printf '%s' "$secret" | sed 's/..../& /g')"
  echo
  for try in 1 2 3; do
    read -r -p "Type the 6-digit code the app shows now: " code || code=''
    if auth_node totp.js verify "$secret" "$code"; then ok=1; break; fi
    echo "That code does not match. Check the phone's clock is set automatically, then try the next code."
  done
  unset code
  if (( ! ok )); then
    echo "Authenticator not saved (no matching code). Run scripts/set-password.sh --totp to try again." >&2
    return 1
  fi
  set_var GANTRY_TOTP_SECRET "$secret"
  unset secret uri
  echo "Authenticator saved: opening the host terminal now needs your password and a code."
}

host_shell_hint() {
  [[ "$(current GANTRY_HOST_SHELL)" == 1 ]] || echo "Next: run scripts/enable-host-shell.sh to switch the host terminal on."
}

case "${1:-}" in
  --disable)
    set_var GANTRY_PASSWORD_HASH ''
    echo "Login removed from $ENV_FILE. Apply with: docker compose up -d"
    exit 0 ;;
  --disable-totp)
    set_var GANTRY_TOTP_SECRET ''
    echo "Authenticator requirement removed. Apply with: docker compose up -d"
    exit 0 ;;
  --totp)
    user=$(current GANTRY_USERNAME); user=${user:-admin}
    setup_totp "$user"
    host_shell_hint
    echo; echo "Apply with: docker compose up -d"
    exit 0 ;;
esac

user_default=$(current GANTRY_USERNAME); user_default=${user_default:-admin}
read -r -p "Username [$user_default]: " user || user=''
user=${user:-$user_default}

read -r -s -p "Password (8+ characters): " pw1; echo
read -r -s -p "Repeat: " pw2; echo
[[ "$pw1" == "$pw2" ]] || { echo "Passwords do not match." >&2; exit 1; }
(( ${#pw1} >= 8 )) || { echo "Use at least 8 characters." >&2; exit 1; }

hash=$(printf '%s\n' "$pw1" | auth_node_stdin password.js --stdin)
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
if ask_yes "Will you use the host terminal (a shell on this machine, from the browser)?" n; then
  if [[ -n "$(current GANTRY_TOTP_SECRET)" ]] && ! ask_yes "An authenticator is already set up. Replace it?" n; then
    echo "Keeping the existing authenticator."
  elif ask_yes "Protect it with an authenticator app code (recommended)?" y; then
    setup_totp "$user" || true
  fi
  host_shell_hint
fi

echo
echo "Apply with: docker compose up -d"
