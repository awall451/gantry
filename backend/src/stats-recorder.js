const { docker } = require('./docker-client');
const { computeStats } = require('./stats-manager');
const db = require('./db');

const POLL_INTERVAL_MS = 30_000;
const PURGE_INTERVAL_MS = 3_600_000;
const STATS_RETAIN_DAYS = 30;
const EVENTS_RETAIN_DAYS = 90;

let lastPurge = 0;

// Last raw sample per container, so each row's CPU is the average over the
// 30 s since the previous poll rather than docker's 1 s pre/cur window. A 1 s
// window sampled every 30 s aliases against anything periodic — a 15 s
// healthcheck burst showed as a steady 20% — and the extra second docker
// spends collecting that window was paid once per container per poll.
const lastSample = new Map(); // containerId -> raw stats

async function recordAllStats() {
  let containers;
  try {
    containers = await docker.listContainers();
  } catch {
    return;
  }

  const recorded_at = new Date().toISOString().slice(0, 19);
  const seen = new Set();

  for (const c of containers) {
    seen.add(c.Id);
    try {
      const prev = lastSample.get(c.Id);
      const raw = await docker.getContainer(c.Id)
        .stats(prev ? { stream: false, 'one-shot': true } : { stream: false });
      const s = computeStats(raw, prev);
      lastSample.set(c.Id, raw);
      db.insertContainerStats({
        container_id: c.Id,
        container_name: c.Names[0].replace(/^\//, ''),
        recorded_at,
        cpu_percent: s.cpuPercent,
        mem_usage_mb: s.memUsageMB,
        mem_limit_mb: s.memLimitMB,
        mem_percent: s.memPercent,
        net_rx_bytes: s.netRxBytes,
        net_tx_bytes: s.netTxBytes,
        blk_read_bytes: s.blkReadBytes,
        blk_write_bytes: s.blkWriteBytes,
      });
    } catch {
      // container died mid-poll — skip
    }
  }

  for (const id of lastSample.keys()) if (!seen.has(id)) lastSample.delete(id);

  if (Date.now() - lastPurge > PURGE_INTERVAL_MS) {
    lastPurge = Date.now();
    const statsBefore = new Date(Date.now() - STATS_RETAIN_DAYS * 86_400_000).toISOString().slice(0, 19);
    const eventsBefore = new Date(Date.now() - EVENTS_RETAIN_DAYS * 86_400_000).toISOString().slice(0, 19);
    db.purgeOldContainerStats(statsBefore);
    db.purgeOldContainerEvents(eventsBefore);
  }
}

function startStatsRecorder() {
  console.log('[stats-recorder] starting (30s interval)');
  recordAllStats();
  setInterval(recordAllStats, POLL_INTERVAL_MS);
}

module.exports = { startStatsRecorder, recordAllStats, _resetForTests: () => lastSample.clear() };
