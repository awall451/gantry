// Request gatekeeping, shared by Express and the WebSocket upgrade handler.
//
//  - Host allowlist (always on): blocks DNS rebinding, where a hostile page's
//    own name re-resolves to this machine and becomes "same origin" with the
//    API. Allowed: the Gantry UI names, anything under .localhost (browsers
//    pin it to loopback), IP literals (rebinding needs a hostname), and
//    GANTRY_ALLOWED_HOSTS.
//  - Origin check (always on) for state-changing requests and WebSocket
//    upgrades: a browser request from another origin (a random site, or a
//    proxied container app on a sibling subdomain) is refused.
//  - Login (opt-in): when GANTRY_PASSWORD_HASH is set, /api/* and /ws* need a
//    session cookie or `Authorization: Bearer $GANTRY_API_TOKEN`.
const crypto = require('crypto');
const { loadSettings, resolveDomains, onSettingsSaved } = require('../settings');
const { isValidHash } = require('./password');
const sessions = require('./sessions');

const COOKIE = 'gantry_session';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function config(env = process.env) {
  const hash = (env.GANTRY_PASSWORD_HASH || '').trim();
  const token = (env.GANTRY_API_TOKEN || '').trim();
  const ttlHours = Number(env.GANTRY_SESSION_TTL_HOURS) > 0 ? Number(env.GANTRY_SESSION_TTL_HOURS) : 168;
  return {
    passwordRequired: hash !== '',
    // A set-but-broken hash fails closed: login required, nothing verifies.
    misconfigured: hash !== '' && !isValidHash(hash),
    hash,
    username: (env.GANTRY_USERNAME || 'admin').trim(),
    apiToken: token.length >= 32 ? token : '',
    ttlMs: ttlHours * 3_600_000,
    extraHosts: (env.GANTRY_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
  };
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      // Untrusted input: a bad %-escape must read as "no cookie", not throw
      // (a throw in the upgrade handler would take the process down).
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function hostname(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function allowedHostnames(settings) {
  const names = new Set(['localhost']);
  for (const d of resolveDomains(settings)) names.add(`gantry.${d}`);
  if (settings['tailscale.enabled']) names.add(settings['tailscale.domain']);
  return names;
}

// The names only change when settings are saved, so they are computed once
// and dropped by onSettingsSaved, not re-read from SQLite on every request.
let cachedNames = null;
onSettingsSaved(() => { cachedNames = null; });
function currentNames() {
  if (!cachedNames) cachedNames = allowedHostnames(loadSettings());
  return cachedNames;
}
function resetHostCache() { cachedNames = null; }

function hostAllowed(hostHeader, { names = currentNames(), cfg = config() } = {}) {
  if (cfg.extraHosts.includes('*')) return true;
  const h = hostname(hostHeader);
  if (!h) return false;
  if (IPV4.test(h) || h.startsWith('[')) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (names.has(h)) return true;
  return cfg.extraHosts.some(x => (x.startsWith('*.') ? h.endsWith(x.slice(1)) : h === x));
}

// A browser always sends Origin on cross-origin POSTs and on WebSocket
// handshakes; non-browser clients (curl, the MCP server) send none.
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); }
  catch { return false; }
}

function bearerOk(req, cfg) {
  if (!cfg.apiToken) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(cfg.apiToken).digest();
  return crypto.timingSafeEqual(a, b);
}

function isAuthenticated(req, cfg = config()) {
  if (!cfg.passwordRequired) return true;
  if (bearerOk(req, cfg)) return true;
  return sessions.isValidSession(readCookie(req.headers.cookie, COOKIE), cfg.hash);
}

// ── Express ─────────────────────────────────────────────────────────────────

function hostGuard(req, res, next) {
  if (hostAllowed(req.headers.host)) return next();
  res.status(400).type('text/plain').send(
    `Host "${hostname(req.headers.host)}" is not a Gantry address. ` +
    'Open Gantry on one of its own names, or add this one to GANTRY_ALLOWED_HOSTS.\n');
}

function originGuard(req, res, next) {
  if (!UNSAFE.has(req.method) || originOk(req)) return next();
  res.status(403).json({ detail: 'cross-origin request refused' });
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ detail: 'not authenticated' });
}

// ── WebSocket upgrade ───────────────────────────────────────────────────────

// null when the upgrade may proceed, else the HTTP status to refuse with.
function refuseUpgrade(req) {
  if (!hostAllowed(req.headers.host)) return 400;
  if (!originOk(req)) return 403;
  if (!isAuthenticated(req)) return 401;
  return null;
}

module.exports = {
  COOKIE, config, readCookie, hostAllowed, originOk, isAuthenticated,
  hostGuard, originGuard, requireAuth, refuseUpgrade, resetHostCache,
};
