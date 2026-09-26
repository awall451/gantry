const { withTestDb } = require('../helpers/db');

// db.js caches its Database handle at module scope, and vi.resetModules() does
// not touch the CommonJS require cache — evict it by hand so every test opens
// the temp DB that withTestDb() just pointed DB_PATH at.
function freshDb() {
  delete require.cache[require.resolve('../../src/db')];
  return require('../../src/db');
}

describe('settings table', () => {
  it('getSetting returns the fallback when the key is unset', () => {
    withTestDb(() => {
      const db = freshDb();
      expect(db.getSetting('tailscale.enabled', 'fallback')).toBe('fallback');
    });
  });

  it('setSetting persists a value that getSetting reads back', () => {
    withTestDb(() => {
      const db = freshDb();
      db.setSetting('tailscale.domain', 'gantry.internal');
      expect(db.getSetting('tailscale.domain')).toBe('gantry.internal');
    });
  });

  it('setSetting overwrites an existing key', () => {
    withTestDb(() => {
      const db = freshDb();
      db.setSetting('k', 'one');
      db.setSetting('k', 'two');
      expect(db.getSetting('k')).toBe('two');
    });
  });

  it('getAllSettings returns every stored key as a flat object', () => {
    withTestDb(() => {
      const db = freshDb();
      db.setSetting('a', '1');
      db.setSetting('b', '2');
      expect(db.getAllSettings()).toEqual({ a: '1', b: '2' });
    });
  });
});
