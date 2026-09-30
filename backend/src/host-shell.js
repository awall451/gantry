// Host terminal: a shell on the machine running Gantry, over SSH to its own
// sshd, as an ordinary user. Off unless GANTRY_HOST_SHELL=1, and refused
// unless a login is configured: the Docker socket already makes Gantry
// root-equivalent, but a one-click host shell must never exist on an install
// that anyone on the network can open.
//
// Guard rails, in order:
//  1. /ws/host goes through the normal upgrade guard (Host, Origin, session).
//  2. It additionally needs a one-time ticket from POST /api/host-shell/unlock,
//     which re-checks the password (shared throttle) and binds the ticket to
//     the caller's session cookie. Tickets live 60 s and are single use; the
//     MCP's Bearer token can never get one.
//  3. SSH uses a dedicated key that authorized_keys limits to
//     from="127.0.0.1,::1" with forwarding off, and the host key pinned at
//     setup (scripts/enable-host-shell.sh). A changed host key refuses.
//  4. Idle sessions close after GANTRY_HOST_SHELL_IDLE_MINUTES (30).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const TICKET_TTL_MS = 60_000;
const tickets = new Map(); // ticket -> { sessionHash, expires }

function hostShellConfig(env = process.env) {
  const dir = env.GANTRY_HOST_SHELL_DIR || path.join(__dirname, '../host-shell');
  return {
    enabled: /^(1|true|yes|on)$/i.test(String(env.GANTRY_HOST_SHELL || '').trim()),
    user: String(env.GANTRY_HOST_SHELL_USER || '').trim(),
    host: env.GANTRY_HOST_SHELL_HOST || '127.0.0.1',
    port: Number(env.GANTRY_HOST_SHELL_PORT) || 22,
    keyPath: path.join(dir, 'id_ed25519'),
    knownHostsPath: path.join(dir, 'known_hosts'),
    idleMs: (Number(env.GANTRY_HOST_SHELL_IDLE_MINUTES) > 0 ? Number(env.GANTRY_HOST_SHELL_IDLE_MINUTES) : 30) * 60_000,
  };
}

// What the UI may show. `reason` is a fix-it sentence when not available.
function availability(cfg, auth) {
  if (!cfg.enabled) return { enabled: false, available: false, reason: null };
  const no = reason => ({ enabled: true, available: false, reason });
  if (!auth.passwordRequired || auth.misconfigured) return no('The host terminal needs a login. Set one with scripts/set-password.sh, then docker compose up -d.');
  if (!cfg.user) return no('GANTRY_HOST_SHELL_USER is not set. Run scripts/enable-host-shell.sh.');
  if (!fs.existsSync(cfg.keyPath)) return no('No SSH key found. Run scripts/enable-host-shell.sh.');
  if (knownHostKeys(cfg.knownHostsPath).size === 0) return no('No pinned host key. Run scripts/enable-host-shell.sh.');
  return { enabled: true, available: true, reason: null, user: cfg.user };
}

// Base64 key blobs from an OpenSSH known_hosts file (any key type).
function knownHostKeys(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return new Set(); }
  const keys = new Set();
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 3 && !f[0].startsWith('#') && /^(ssh-|ecdsa-)/.test(f[1])) keys.add(f[2]);
  }
  return keys;
}

// ── tickets ─────────────────────────────────────────────────────────────────

const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');

function issueTicket(sessionToken, now = Date.now()) {
  for (const [t, v] of tickets) if (v.expires <= now) tickets.delete(t);
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { sessionHash: hashToken(sessionToken), expires: now + TICKET_TTL_MS });
  return ticket;
}

// Single use: a ticket is gone after the first attempt, valid or not.
function redeemTicket(ticket, sessionToken, now = Date.now()) {
  if (!ticket || !sessionToken) return false;
  const v = tickets.get(ticket);
  tickets.delete(ticket);
  return !!v && v.expires > now && v.sessionHash === hashToken(sessionToken);
}

function clearTickets() { tickets.clear(); }

// ── SSH ─────────────────────────────────────────────────────────────────────

// Resolves { conn, stream } for an interactive login shell, or rejects.
function openShell(cfg, { cols = 80, rows = 24 } = {}) {
  const pinned = knownHostKeys(cfg.knownHostsPath);
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        resolve({ conn, stream });
      });
    });
    conn.on('error', reject);
    conn.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.user,
      privateKey: fs.readFileSync(cfg.keyPath),
      hostVerifier: key => pinned.has(Buffer.from(key).toString('base64')),
      readyTimeout: 10_000,
      keepaliveInterval: 30_000,
    });
  });
}

module.exports = {
  hostShellConfig, availability, knownHostKeys,
  issueTicket, redeemTicket, clearTickets, openShell, TICKET_TTL_MS,
};
