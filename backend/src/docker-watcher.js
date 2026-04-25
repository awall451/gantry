const { docker } = require('./docker-client');
const { upsertRoute, getAllRoutes, insertContainerEvent } = require('./db');
const { pushConfig } = require('./caddy-client');

const SYNC_ACTIONS = ['start', 'die', 'destroy'];
const TRACKED_ACTIONS = ['start', 'die', 'destroy', 'kill', 'oom', 'pause', 'unpause'];

let broadcast = () => {};

function setBroadcast(fn) {
  broadcast = fn;
}

function sanitizeName(name) {
  return name.replace(/^\//, '').replace(/_/g, '-').toLowerCase();
}

function pickPort(container) {
  const ports = container.Ports || [];
  // Prefer the lowest exposed TCP port
  const tcp = ports.filter(p => p.Type === 'tcp' && p.PublicPort).sort((a, b) => a.PublicPort - b.PublicPort);
  return tcp.length ? tcp[0].PublicPort : null;
}

async function syncContainers() {
  let containers;
  try {
    containers = await docker.listContainers();
  } catch (err) {
    console.error('[docker] cannot list containers:', err.message);
    return;
  }

  for (const c of containers) {
    const port = pickPort(c);
    if (!port) continue;
    const name = sanitizeName(c.Names[0]);
    upsertRoute({ container_id: c.Id, container_name: name, hostname: name, target_port: port });
  }

  await pushConfig();
  broadcast({ type: 'routes:updated', routes: getAllRoutes() });
}

async function getLiveContainers() {
  try {
    const containers = await docker.listContainers();
    return containers.map(c => ({
      id: c.Id,
      name: sanitizeName(c.Names[0]),
      image: c.Image,
      status: c.Status,
      port: pickPort(c),
      running: c.State === 'running',
    }));
  } catch {
    return [];
  }
}

function startWatcher() {
  console.log('[docker] syncing containers...');
  syncContainers();

  docker.getEvents({}, (err, stream) => {
    if (err) {
      console.error('[docker] event stream error:', err.message);
      setTimeout(startWatcher, 5000);
      return;
    }

    stream.on('data', chunk => {
      let event;
      try { event = JSON.parse(chunk.toString()); } catch { return; }
      if (event.Type !== 'container') return;

      const action = event.Action;
      if (!TRACKED_ACTIONS.includes(action)) return;

      const container_name = event.Actor?.Attributes?.name || '';
      const container_id = event.Actor?.Id || '';
      const occurred_at = new Date((event.time || Date.now() / 1000) * 1000).toISOString().slice(0, 19);
      const exit_code = action === 'die'
        ? parseInt(event.Actor?.Attributes?.exitCode ?? '-1', 10)
        : null;

      console.log(`[docker] event: ${action} ${container_name}`);

      insertContainerEvent({ container_id, container_name, action, exit_code, occurred_at });
      broadcast({ type: 'container:event', container_id, container_name, action, exit_code, occurred_at });

      if (SYNC_ACTIONS.includes(action)) syncContainers();
    });

    stream.on('error', err => {
      console.error('[docker] stream error:', err.message);
    });

    stream.on('end', () => {
      console.warn('[docker] event stream ended, reconnecting...');
      setTimeout(startWatcher, 3000);
    });
  });
}

async function isHealthy() {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

module.exports = { startWatcher, syncContainers, getLiveContainers, setBroadcast, isHealthy };
