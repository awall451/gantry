const { makeTestDbPath, cleanupTestDb } = require('../helpers/db');
const db = require('../../src/db');

// db.js keeps one Database handle at module scope. closeDb() drops it, so
// the next getDb() opens whatever DB_PATH points at now — a fresh temp file
// per test. Never mock db.js: vi.mock() cannot intercept the Node-native
// require() inside src/, and the fallback DB_PATH is the real data/proxy.db.
let dbPath;
beforeEach(() => {
  dbPath = makeTestDbPath();
  process.env.DB_PATH = dbPath;
});
afterEach(() => {
  db.closeDb();
  delete process.env.DB_PATH;
  cleanupTestDb(dbPath);
});

describe('settings table', () => {
  it('getSetting returns the fallback when the key is unset', () => {
    expect(db.getSetting('tailscale.enabled', 'fallback')).toBe('fallback');
  });

  it('setSetting persists a value that getSetting reads back', () => {
    db.setSetting('tailscale.domain', 'gantry.internal');
    expect(db.getSetting('tailscale.domain')).toBe('gantry.internal');
  });

  it('setSetting overwrites an existing key', () => {
    db.setSetting('k', 'one');
    db.setSetting('k', 'two');
    expect(db.getSetting('k')).toBe('two');
  });

  it('getAllSettings returns every stored key as a flat object', () => {
    db.setSetting('a', '1');
    db.setSetting('b', '2');
    expect(db.getAllSettings()).toEqual({ a: '1', b: '2' });
  });
});
