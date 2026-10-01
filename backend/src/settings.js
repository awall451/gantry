const { getAllSettings, setSetting } = require('./db');

// Every setting Gantry knows about, with the value a stock install runs on.
// The default's JS type is also the setting's type: loadSettings() coerces the
// TEXT the DB hands back into this shape, and validate() rejects patches that
// don't match it. Add a key here and it exists everywhere — no migration.
//
// Stock defaults must reproduce today's behavior exactly: *.localhost only,
// nothing Tailscale-shaped running. Tailscale is opt-in.
const DEFAULTS = Object.freeze({
  // Suffix Caddy appends to every route hostname. `localhost` resolves to
  // 127.0.0.1 in every modern browser with no DNS involvement.
  'general.base_domain': 'localhost',

  // When on, every route is ALSO matched on `<hostname>.<tailscale.domain>`
  // and (if dns_enabled) Gantry answers DNS for that domain itself, so other
  // tailnet devices can reach the same routes through Tailscale split DNS.
  'tailscale.enabled': false,
  'tailscale.domain': 'gantry.internal',
  // Tailscale IPv4 of this host. Empty = auto-detect the CGNAT interface.
  'tailscale.ip': '',
  'tailscale.dns_enabled': true,
  'tailscale.dns_port': 53,

  // HTTPS for the Tailscale domain: a Let's Encrypt wildcard obtained by
  // Caddy over the DNS-01 challenge (Cloudflare; token via env
  // CLOUDFLARE_API_TOKEN, never stored here). The base domain is never TLS.
  'tls.enabled': false,
  'tls.acme_email': '',
  // 308 http→https on the Tailscale domain only. Plain http keeps being
  // served when this is off.
  'tls.redirect_http': true,
});

// Lowercase DNS name: labels of [a-z0-9-], no leading/trailing hyphen, at
// least one label, no trailing dot. Deliberately stricter than the RFC —
// these are names a human types into the Tailscale admin console.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function coerce(key, raw) {
  const def = DEFAULTS[key];
  if (typeof def === 'boolean') return raw === 'true' || raw === '1';
  if (typeof def === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  }
  return raw;
}

function loadSettings() {
  const stored = getAllSettings();
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    out[key] = key in stored ? coerce(key, stored[key]) : DEFAULTS[key];
  }
  return out;
}

function validate(patch) {
  const errors = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) { errors[key] = 'unknown setting'; continue; }
    const def = DEFAULTS[key];
    if (typeof def === 'boolean') {
      if (typeof value !== 'boolean') errors[key] = 'must be true or false';
      continue;
    }
    if (typeof def === 'number') {
      if (!Number.isInteger(value) || value < 1 || value > 65535) errors[key] = 'must be an integer between 1 and 65535';
      continue;
    }
    if (typeof value !== 'string') { errors[key] = 'must be a string'; continue; }
    if (key === 'tls.acme_email') {
      if (value !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[key] = 'must be an email address, or blank';
      continue;
    }
    if (key === 'tailscale.ip') {
      if (value !== '' && !IPV4_RE.test(value)) errors[key] = 'must be an IPv4 address, or blank to auto-detect';
      continue;
    }
    if (!DOMAIN_RE.test(value)) errors[key] = 'must be a lowercase DNS name like gantry.internal';
  }

  // Two suffixes that are the same string would make every route match twice
  // and, worse, make the Tailscale DNS responder claim `*.localhost`.
  const base = 'general.base_domain' in patch ? patch['general.base_domain'] : null;
  const ts = 'tailscale.domain' in patch ? patch['tailscale.domain'] : null;
  if (base !== null && ts !== null && base === ts) {
    errors['tailscale.domain'] = 'must differ from the base domain';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

const savedListeners = [];
// Callers that cache something derived from settings (the Host allowlist)
// register here to be told when to drop it.
function onSettingsSaved(fn) { savedListeners.push(fn); }

function saveSettings(patch) {
  for (const [key, value] of Object.entries(patch)) setSetting(key, value);
  for (const fn of savedListeners) fn();
  return loadSettings();
}

// The suffixes every route hostname is matched on, in priority order.
function resolveDomains(settings) {
  const domains = [settings['general.base_domain']];
  if (settings['tailscale.enabled']) domains.push(settings['tailscale.domain']);
  return domains;
}

module.exports = { DEFAULTS, loadSettings, validate, saveSettings, resolveDomains, onSettingsSaved };
