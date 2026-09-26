const Database = require('better-sqlite3');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/proxy.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id TEXT,
        container_name TEXT NOT NULL,
        hostname TEXT NOT NULL UNIQUE,
        target_port INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_auto INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS analytics (
        hostname TEXT NOT NULL,
        hour TEXT NOT NULL,
        request_count INTEGER DEFAULT 0,
        status_2xx INTEGER DEFAULT 0,
        status_4xx INTEGER DEFAULT 0,
        status_5xx INTEGER DEFAULT 0,
        avg_duration_ms REAL DEFAULT 0,
        PRIMARY KEY (hostname, hour)
      );

      CREATE TABLE IF NOT EXISTS container_stats (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id    TEXT NOT NULL,
        container_name  TEXT NOT NULL,
        recorded_at     TEXT NOT NULL,
        cpu_percent     REAL NOT NULL DEFAULT 0,
        mem_usage_mb    REAL NOT NULL DEFAULT 0,
        mem_limit_mb    REAL NOT NULL DEFAULT 0,
        mem_percent     REAL NOT NULL DEFAULT 0,
        net_rx_bytes    INTEGER NOT NULL DEFAULT 0,
        net_tx_bytes    INTEGER NOT NULL DEFAULT 0,
        blk_read_bytes  INTEGER NOT NULL DEFAULT 0,
        blk_write_bytes INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_cstats ON container_stats (container_id, recorded_at);

      CREATE TABLE IF NOT EXISTS container_events (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id   TEXT NOT NULL,
        container_name TEXT NOT NULL,
        action         TEXT NOT NULL,
        exit_code      INTEGER,
        occurred_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cevents ON container_events (container_id, occurred_at);

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }
  return db;
}

function getAllRoutes() {
  return getDb().prepare('SELECT * FROM routes ORDER BY created_at DESC').all();
}

function getEnabledRoutes() {
  return getDb().prepare('SELECT * FROM routes WHERE enabled = 1').all();
}

function upsertRoute({ container_id, container_name, hostname, target_port }) {
  const db = getDb();
  // Same container, nothing to do
  const byId = db.prepare('SELECT id FROM routes WHERE container_id = ?').get(container_id);
  if (byId) return byId.id;
  // Container restarted (new ID, same name) — update stale container_id so lookups still work
  const byName = db.prepare('SELECT id FROM routes WHERE container_name = ? AND is_auto = 1').get(container_name);
  if (byName) {
    db.prepare('UPDATE routes SET container_id = ? WHERE id = ?').run(container_id, byName.id);
    return byName.id;
  }
  // Genuinely new container
  const result = db.prepare(
    'INSERT OR IGNORE INTO routes (container_id, container_name, hostname, target_port) VALUES (?, ?, ?, ?)'
  ).run(container_id, container_name, hostname, target_port);
  return result.lastInsertRowid;
}

function updateRoute(id, fields) {
  const allowed = ['hostname', 'enabled'];
  const sets = Object.keys(fields)
    .filter(k => allowed.includes(k))
    .map(k => `${k} = ?`).join(', ');
  const vals = Object.keys(fields)
    .filter(k => allowed.includes(k))
    .map(k => fields[k]);
  if (!sets) return;
  getDb().prepare(`UPDATE routes SET ${sets} WHERE id = ?`).run(...vals, id);
}

function deleteRoute(id) {
  getDb().prepare('DELETE FROM routes WHERE id = ?').run(id);
}

function insertRoute({ container_name, hostname, target_port }) {
  const result = getDb().prepare(
    'INSERT INTO routes (container_id, container_name, hostname, target_port, is_auto) VALUES (NULL, ?, ?, ?, 0)'
  ).run(container_name, hostname, target_port);
  return result.lastInsertRowid;
}

function getRouteById(id) {
  return getDb().prepare('SELECT * FROM routes WHERE id = ?').get(id);
}

function markContainerStopped(container_id) {
  // Don't delete — keep route in DB so user sees it as offline
  // Caddy will simply 502 until container restarts
}

function recordAnalytics({ hostname, hour, status, duration_ms }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO analytics (hostname, hour, request_count, status_2xx, status_4xx, status_5xx, avg_duration_ms)
    VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(hostname, hour) DO UPDATE SET
      request_count = request_count + 1,
      status_2xx = status_2xx + excluded.status_2xx,
      status_4xx = status_4xx + excluded.status_4xx,
      status_5xx = status_5xx + excluded.status_5xx,
      avg_duration_ms = (avg_duration_ms * request_count + excluded.avg_duration_ms) / (request_count + 1)
  `).run(
    hostname, hour,
    status >= 200 && status < 300 ? 1 : 0,
    status >= 400 && status < 500 ? 1 : 0,
    status >= 500 ? 1 : 0,
    duration_ms
  );
}

function queryAnalytics({ from, to, hostname } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM analytics WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND hour >= ?'; params.push(from); }
  if (to)   { sql += ' AND hour <= ?'; params.push(to); }
  if (hostname) { sql += ' AND hostname = ?'; params.push(hostname); }
  sql += ' ORDER BY hostname, hour';
  return db.prepare(sql).all(...params);
}

function insertContainerStats({ container_id, container_name, recorded_at,
  cpu_percent, mem_usage_mb, mem_limit_mb, mem_percent,
  net_rx_bytes, net_tx_bytes, blk_read_bytes, blk_write_bytes }) {
  getDb().prepare(`
    INSERT INTO container_stats
      (container_id, container_name, recorded_at, cpu_percent, mem_usage_mb,
       mem_limit_mb, mem_percent, net_rx_bytes, net_tx_bytes, blk_read_bytes, blk_write_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(container_id, container_name, recorded_at, cpu_percent, mem_usage_mb,
         mem_limit_mb, mem_percent, net_rx_bytes, net_tx_bytes, blk_read_bytes, blk_write_bytes);
}

function queryContainerStats({ container_id, from, to, limit = 500 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM container_stats WHERE container_id = ?';
  const params = [container_id];
  if (from) { sql += ' AND recorded_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND recorded_at <= ?'; params.push(to); }
  sql += ' ORDER BY recorded_at ASC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function insertContainerEvent({ container_id, container_name, action, exit_code, occurred_at }) {
  getDb().prepare(`
    INSERT INTO container_events (container_id, container_name, action, exit_code, occurred_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(container_id, container_name, action, exit_code ?? null, occurred_at);
}

function queryContainerEvents({ container_id, from, to, limit = 200 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM container_events WHERE container_id = ?';
  const params = [container_id];
  if (from) { sql += ' AND occurred_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND occurred_at <= ?'; params.push(to); }
  sql += ' ORDER BY occurred_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function queryAllContainerEvents({ from, to, limit = 500 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM container_events WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND occurred_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND occurred_at <= ?'; params.push(to); }
  sql += ' ORDER BY occurred_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function queryAllContainerStats({ from, to, limit = 2000 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM container_stats WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND recorded_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND recorded_at <= ?'; params.push(to); }
  sql += ' ORDER BY recorded_at ASC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

function purgeOldContainerStats(beforeDate) {
  getDb().prepare('DELETE FROM container_stats WHERE recorded_at < ?').run(beforeDate);
}

function purgeOldContainerEvents(beforeDate) {
  getDb().prepare('DELETE FROM container_events WHERE occurred_at < ?').run(beforeDate);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function getSetting(key, fallback) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function getAllSettings() {
  const out = {};
  for (const row of getDb().prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

module.exports = {
  getDb,
  closeDb,
  getSetting,
  setSetting,
  getAllSettings,
  getAllRoutes,
  getEnabledRoutes,
  upsertRoute,
  updateRoute,
  deleteRoute,
  insertRoute,
  getRouteById,
  markContainerStopped,
  recordAnalytics,
  queryAnalytics,
  insertContainerStats,
  queryContainerStats,
  insertContainerEvent,
  queryContainerEvents,
  queryAllContainerEvents,
  queryAllContainerStats,
  purgeOldContainerStats,
  purgeOldContainerEvents,
};
