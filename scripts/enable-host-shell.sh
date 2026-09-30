#!/usr/bin/env bash
# Enable (or disable) Gantry's host terminal: a shell on this machine, opened
# from the Gantry UI over SSH to this machine's own sshd.
#
#   scripts/enable-host-shell.sh            set up for the current user
#   scripts/enable-host-shell.sh --disable  remove the key and switch it off
#
# What it does:
#  - generates a dedicated ed25519 key in ./host-shell (mounted read-only into
#    the backend), never your own keys
#  - adds its public half to ~/.ssh/authorized_keys restricted to
#    from="127.0.0.1,::1" with port/agent/X11 forwarding off, so the key is
#    useless from any other machine
#  - pins this machine's SSH host key in ./host-shell/known_hosts
#  - test-connects, then sets GANTRY_HOST_SHELL=1 and the user in .env
# Run it as the user the shell should belong to (not root). A login must be
# configured too (scripts/set-password.sh) or Gantry refuses to open shells.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env
DIR=host-shell
KEY=$DIR/id_ed25519
TAG=gantry-host-shell
PORT=${GANTRY_HOST_SHELL_PORT:-22}
AK="$HOME/.ssh/authorized_keys"

set_var() {
  local key=$1 val=$2 tmp
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  tmp=$(mktemp)
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

remove_key_line() {
  [[ -f "$AK" ]] || return 0
  local tmp; tmp=$(mktemp)
  grep -v " ${TAG}\$" "$AK" > "$tmp" || true
  cat "$tmp" > "$AK"; rm -f "$tmp"
}

if [[ $EUID -eq 0 ]]; then
  echo "Run this as the user the shell should belong to, not root." >&2
  exit 1
fi

if [[ "${1:-}" == "--disable" ]]; then
  remove_key_line
  rm -f "$KEY" "$KEY.pub" "$DIR/known_hosts"
  set_var GANTRY_HOST_SHELL 0
  echo "Host terminal off: key removed from $AK and $DIR. Apply with: docker compose up -d"
  exit 0
fi

command -v ssh-keygen >/dev/null && command -v ssh-keyscan >/dev/null || { echo "Needs ssh-keygen and ssh-keyscan (openssh)." >&2; exit 1; }

mkdir -p "$DIR"; chmod 700 "$DIR"
if [[ ! -f "$KEY" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C "$TAG" -f "$KEY"
  echo "Generated $KEY"
fi
chmod 600 "$KEY"

mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
touch "$AK"; chmod 600 "$AK"
remove_key_line
printf 'from="127.0.0.1,::1",no-port-forwarding,no-agent-forwarding,no-X11-forwarding %s\n' "$(cat "$KEY.pub")" >> "$AK"
echo "Authorised the key in $AK (localhost only, no forwarding)"

ssh-keyscan -p "$PORT" -t ed25519,ecdsa,rsa 127.0.0.1 2>/dev/null > "$DIR/known_hosts"
[[ -s "$DIR/known_hosts" ]] || { echo "Could not read this machine's SSH host key on 127.0.0.1:$PORT. Is sshd running?" >&2; exit 1; }
echo "Pinned this machine's SSH host key"

if ssh -q -p "$PORT" -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes \
     -o UserKnownHostsFile="$DIR/known_hosts" -o StrictHostKeyChecking=yes \
     "$USER@127.0.0.1" true; then
  echo "Test connection OK"
else
  echo "Test connection failed. Check that sshd allows public-key login for $USER (PubkeyAuthentication yes, AllowUsers)." >&2
  exit 1
fi

set_var GANTRY_HOST_SHELL 1
set_var GANTRY_HOST_SHELL_USER "$USER"
[[ "$PORT" != 22 ]] && set_var GANTRY_HOST_SHELL_PORT "$PORT"
grep -q -E '^GANTRY_PASSWORD_HASH=.+' "$ENV_FILE" || echo "Note: no login is set yet. Run scripts/set-password.sh first, or Gantry will refuse to open shells."
echo
echo "Apply with: docker compose up -d"
