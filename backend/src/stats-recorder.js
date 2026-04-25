const { docker } = require('./docker-client');
const { computeStats } = require('./stats-manager');
const { insertContainerStats, purgeOldContainerStats, purgeOldContainerEvents } = require('./db');

const POLL_INTERVAL_MS = 30_000;
const PURGE_INTERVAL_MS = 3_600_000;
const STATS_RETAIN_DAYS = 30;
const EVENTS_RETAIN_DAYS = 90;

let lastPurge = 0;

async function recordAllStats() {
  let containers;
  try {
    containers = await docker.listContainers();
  } catch {
    return;
  }

  const recorded_at = new Date().toISOString().slice(0, 19);

  for (const c of containers) {
    try {
      const raw = await docker.getContainer(c.Id).stats({ stream: false });
      const s = computeStats(raw);
      insertContainerStats({
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

  if (Date.now() - lastPurge > PURGE_INTERVAL_MS) {
    lastPurge = Date.now();
    const statsBefore = new Date(Date.now() - STATS_RETAIN_DAYS * 86_400_000).toISOString().slice(0, 19);
    const eventsBefore = new Date(Date.now() - EVENTS_RETAIN_DAYS * 86_400_000).toISOString().slice(0, 19);
    purgeOldContainerStats(statsBefore);
    purgeOldContainerEvents(eventsBefore);
  }
}

function startStatsRecorder() {
  console.log('[stats-recorder] starting (30s interval)');
  recordAllStats();
  setInterval(recordAllStats, POLL_INTERVAL_MS);
}

module.exports = { startStatsRecorder };
