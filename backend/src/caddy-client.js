const { getEnabledRoutes } = require('./db');
const { DEFAULTS, loadSettings, resolveDomains } = require('./settings');

const CADDY_ADMIN = process.env.CADDY_ADMIN || 'http://localhost:2019';
const LOG_FILE = process.env.LOG_PATH || '/logs/access.log';
const BACKEND_PORT = process.env.PORT || 3001;

// Every route is matched on `<hostname>.<domain>` for each configured domain
// (just `localhost` by default; plus the Tailscale domain when that's on).
// Settings default to DEFAULTS so callers that predate settings still get
// today's exact output.
function buildConfig(routes, settings = DEFAULTS) {
  const domains = resolveDomains(settings);
  const hosts = name => domains.map(d => `${name}.${d}`);
  const caddyRoutes = [
    {
      match: [{ host: hosts('gantry') }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${BACKEND_PORT}` }] }],
    },
    ...routes.map(r => ({
      match: [{ host: hosts(r.hostname) }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${r.target_port}` }] }],
    })),
  ];

  return {
    logging: {
      logs: {
        access: {
          writer: { output: 'file', filename: LOG_FILE },
          encoder: { format: 'json' },
          include: ['http.log.access.main'],
        },
      },
    },
    apps: {
      http: {
        servers: {
          main: {
            listen: [':80'],
            logs: { logger_names: { '*': 'access' } },
            routes: caddyRoutes,
          },
        },
      },
    },
  };
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
