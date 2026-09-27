const WebSocket = require('ws');
const { docker } = require('./docker-client');

const subscribers = new Map(); // containerId -> Set<WebSocket>
const intervals = new Map();   // containerId -> intervalId

// `prev` is an earlier raw sample of the same container. When given, CPU is
// the average over the whole gap between the two samples; without it, docker's
// own pre/cur window (~1 s) is used, which only means "right now".
function computeStats(s, prev) {
  const base = prev?.cpu_stats ? prev.cpu_stats : s.precpu_stats;
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - base.cpu_usage.total_usage;
  const systemDelta = s.cpu_stats.system_cpu_usage - base.system_cpu_usage;
  const numCpus = s.cpu_stats.online_cpus || s.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

  const memUsage = s.memory_stats.usage - (s.memory_stats.stats?.cache || 0);
  const memLimit = s.memory_stats.limit;
  const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

  let netRxBytes = 0, netTxBytes = 0;
  for (const iface of Object.values(s.networks || {})) {
    netRxBytes += iface.rx_bytes || 0;
    netTxBytes += iface.tx_bytes || 0;
  }

  let blkReadBytes = 0, blkWriteBytes = 0;
  for (const e of s.blkio_stats?.io_service_bytes_recursive || []) {
    if (e.op === 'Read')  blkReadBytes  += e.value;
    if (e.op === 'Write') blkWriteBytes += e.value;
  }

  return {
    cpuPercent: Math.min(100, Math.max(0, cpuPercent)),
    memUsageMB: memUsage / 1024 / 1024,
    memLimitMB: memLimit / 1024 / 1024,
    memPercent,
    netRxBytes,
    netTxBytes,
    blkReadBytes,
    blkWriteBytes,
  };
}

function startPolling(containerId) {
  const id = setInterval(async () => {
    const subs = subscribers.get(containerId);
    if (!subs || subs.size === 0) return stopPolling(containerId);
    try {
      const stats = await docker.getContainer(containerId).stats({ stream: false });
      const payload = computeStats(stats);
      const msg = JSON.stringify({ type: 'stats:update', id: containerId, ...payload });
      for (const ws of subs) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      }
    } catch {
      stopPolling(containerId);
      const errMsg = JSON.stringify({ type: 'stats:unavailable', id: containerId });
      const subs2 = subscribers.get(containerId);
      if (subs2) {
        for (const ws of subs2) {
          if (ws.readyState === WebSocket.OPEN) ws.send(errMsg);
        }
      }
    }
  }, 2000);
  intervals.set(containerId, id);
}

function stopPolling(containerId) {
  const id = intervals.get(containerId);
  if (id !== undefined) {
    clearInterval(id);
    intervals.delete(containerId);
  }
}

function subscribe(ws, containerId) {
  ws.statsSubscriptions = ws.statsSubscriptions || new Set();
  ws.statsSubscriptions.add(containerId);
  if (!subscribers.has(containerId)) {
    subscribers.set(containerId, new Set());
    startPolling(containerId);
  }
  subscribers.get(containerId).add(ws);
}

function unsubscribe(ws, containerId) {
  ws.statsSubscriptions?.delete(containerId);
  const subs = subscribers.get(containerId);
  if (!subs) return;
  subs.delete(ws);
  if (subs.size === 0) {
    subscribers.delete(containerId);
    stopPolling(containerId);
  }
}

function unsubscribeAll(ws) {
  for (const id of (ws.statsSubscriptions || [])) {
    unsubscribe(ws, id);
  }
}

function handleMessage(ws, msg) {
  if (msg.type === 'stats:subscribe' && msg.id) subscribe(ws, msg.id);
  if (msg.type === 'stats:unsubscribe' && msg.id) unsubscribe(ws, msg.id);
}

module.exports = { handleMessage, unsubscribeAll, computeStats };
