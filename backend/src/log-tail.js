const { Tail } = require('tail');
const { recordAnalytics } = require('./db');

const LOG_PATH = process.env.LOG_PATH || '/logs/access.log';

// One Caddy access-log line → analytics row, or null if it should not count.
// Long-lived connections (WebSocket upgrades, SSE streams) are logged once when
// they close with a duration of minutes or hours; a single one would swamp the
// hourly average, so they are skipped entirely.
function parseAccessLine(line, now) {
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }

  const host = entry.request?.host;
  const status = entry.status;
  if (!host || !status) return null;

  const upgrade = entry.request.headers?.Upgrade;
  if (status === 101 || (upgrade && upgrade.length)) return null;
  const ctype = entry.resp_headers?.['Content-Type']?.[0] || '';
  if (ctype.startsWith('text/event-stream')) return null;

  return {
    hostname: host.split(':')[0],            // strip port if present
    hour: now.toISOString().slice(0, 13),    // "2026-04-23T15"
    status,
    duration_ms: (entry.duration || 0) * 1000,
  };
}

function startLogTail() {
  const fs = require('fs');
  if (!fs.existsSync(LOG_PATH)) {
    // Retry until Caddy creates the file
    setTimeout(startLogTail, 5000);
    return;
  }

  console.log('[logtail] watching', LOG_PATH);
  const tail = new Tail(LOG_PATH, { follow: true, fromBeginning: false });

  tail.on('line', line => {
    const row = parseAccessLine(line, new Date());
    if (row) recordAnalytics(row);
  });

  tail.on('error', err => console.error('[logtail] error:', err.message));
}

module.exports = { startLogTail, parseAccessLine };
