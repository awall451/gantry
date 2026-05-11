const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

function makeTestDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-test-'));
  return path.join(dir, `test-${crypto.randomUUID().slice(0, 8)}.db`);
}

function withTestDb(callback) {
  const dbPath = makeTestDbPath();
  const prev = process.env.DB_PATH;
  process.env.DB_PATH = dbPath;
  try {
    return callback(dbPath);
  } finally {
    if (prev === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = prev;
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  }
}

function cleanupTestDb(dbPath) {
  if (!dbPath) return;
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch {}
}

module.exports = { makeTestDbPath, withTestDb, cleanupTestDb };
