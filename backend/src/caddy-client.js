const { getEnabledRoutes } = require('./db');

const CADDY_ADMIN = process.env.CADDY_ADMIN || 'http://localhost:2019';
const LOG_FILE = process.env.LOG_PATH || '/logs/access.log';
const BACKEND_PORT = process.env.PORT || 3001;

function buildConfig(routes) {
  const caddyRoutes = [
    {
      match: [{ host: ['gantry.localhost'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${BACKEND_PORT}` }] }],
    },
    ...routes.map(r => ({
      match: [{ host: [`${r.hostname}.localhost`] }],
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
  const config = buildConfig(routes);

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
