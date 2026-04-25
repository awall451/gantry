const { Tail } = require('tail');
const { recordAnalytics } = require('./db');

const LOG_PATH = process.env.LOG_PATH || '/logs/access.log';

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
    let entry;
    try { entry = JSON.parse(line); } catch { return; }

    const host = entry.request?.host;
    const status = entry.status;
    const duration_ms = (entry.duration || 0) * 1000;
    if (!host || !status) return;

    // Strip port from host if present
    const hostname = host.split(':')[0];
    const now = new Date();
    const hour = now.toISOString().slice(0, 13); // "2026-04-23T15"

    recordAnalytics({ hostname, hour, status, duration_ms });
  });

  tail.on('error', err => console.error('[logtail] error:', err.message));
}

module.exports = { startLogTail };
