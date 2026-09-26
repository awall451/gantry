const { getEnabledRoutes } = require('./db');
const { DEFAULTS, loadSettings, resolveDomains } = require('./settings');

const CADDY_ADMIN = process.env.CADDY_ADMIN || 'http://localhost:2019';
const LOG_FILE = process.env.LOG_PATH || '/logs/access.log';
const BACKEND_PORT = process.env.PORT || 3001;

// Every route is matched on `<hostname>.<domain>` for each configured domain
// (just `localhost` by default; plus the Tailscale domain when that's on).
// Settings default to DEFAULTS so callers that predate settings still get
// today's exact output.
//
// TLS, when enabled, is for the Tailscale domain only: a second server on
// :443 with the same proxy routes, certificates managed by Caddy through the
// ACME DNS-01 challenge (wildcard + apex). Caddy's own automatic HTTPS is
// always disabled — left on, it would self-issue for `*.localhost` and start
// redirecting the laptop to https the moment a :443 listener exists.
function buildConfig(routes, settings = DEFAULTS) {
  const domains = resolveDomains(settings);
  const hosts = name => domains.map(d => `${name}.${d}`);
  const tsDomain = settings['tailscale.domain'];
  const tailnet = settings['tailscale.enabled'];
  const tls = tailnet && settings['tls.enabled'];

  // The bare Tailscale domain is what someone types on a phone, so it lands
  // on the Gantry UI too. Not done for the base domain: bare `localhost`
  // stays untouched to keep stock output identical.
  const uiHosts = hosts('gantry');
  if (tailnet) uiHosts.push(tsDomain);
  const proxyRoutes = [
    {
      match: [{ host: uiHosts }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${BACKEND_PORT}` }] }],
    },
    ...routes.map(r => ({
      match: [{ host: hosts(r.hostname) }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${r.target_port}` }] }],
    })),
  ];

  const tlsSubjects = [tsDomain, `*.${tsDomain}`];
  const redirect = tls && settings['tls.redirect_http']
    ? [{
        match: [{ host: tlsSubjects }],
        handle: [{
          handler: 'static_response',
          status_code: 308,
          headers: { Location: ['https://{http.request.host}{http.request.uri}'] },
        }],
      }]
    : [];

  const server = (listen, routes) => ({
    listen,
    automatic_https: { disable: true, disable_redirects: true },
    logs: { logger_names: { '*': 'access' } },
    routes,
  });

  const servers = { main: server([':80'], [...redirect, ...proxyRoutes]) };
  if (tls) servers.tls = { ...server([':443'], proxyRoutes), tls_connection_policies: [{}] };

  const config = {
    logging: {
      logs: {
        access: {
          writer: { output: 'file', filename: LOG_FILE },
          encoder: { format: 'json' },
          include: Object.keys(servers).map(n => `http.log.access.${n}`),
        },
      },
    },
    apps: { http: { servers } },
  };

  if (tls) {
    const issuer = {
      module: 'acme',
      ...(settings['tls.acme_email'] ? { email: settings['tls.acme_email'] } : {}),
      challenges: {
        dns: {
          // Token is substituted by Caddy at load from its own environment —
          // it never passes through this process or the settings table.
          provider: { name: 'cloudflare', api_token: '{env.CLOUDFLARE_API_TOKEN}' },
          // Public resolvers for the propagation check: on this host the
          // Tailscale domain is split-DNS'd to Gantry's own responder, which
          // knows nothing about _acme-challenge TXT records.
          resolvers: ['1.1.1.1', '8.8.8.8'],
        },
      },
    };
    config.apps.tls = {
      // `automate` is what makes Caddy obtain + renew these at load. Policy
      // `subjects` alone only route names to a policy; with automatic HTTPS
      // off nothing else would ever ask for the certificate.
      certificates: { automate: tlsSubjects },
      automation: { policies: [{ subjects: tlsSubjects, issuers: [issuer] }] },
    };
  }

  return config;
}

async function pushConfig() {
  const routes = getEnabledRoutes();
  const config = buildConfig(routes, loadSettings());

  try {
    const res = await fetch(`${CADDY_ADMIN}/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: CADDY_ADMIN },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[caddy] push failed:', res.status, text);
      return false;
    }
    console.log(`[caddy] pushed ${routes.length} route(s)`);
    return true;
  } catch (err) {
    console.error('[caddy] unreachable:', err.message);
    return false;
  }
}

async function isHealthy() {
  try {
    const res = await fetch(`${CADDY_ADMIN}/config/`, { headers: { Origin: CADDY_ADMIN }, signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { buildConfig, pushConfig, isHealthy };
