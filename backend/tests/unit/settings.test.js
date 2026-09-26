// Real SQLite in a temp file. vi.mock() cannot intercept the Node-native
// require() that src files use, so mocking db.js here would silently hit the
// real database (it did, once — and wrote a setting into data/proxy.db).
const { makeTestDbPath, cleanupTestDb } = require('../helpers/db');

let db, settings, dbPath;
beforeEach(() => {
  dbPath = makeTestDbPath();
  process.env.DB_PATH = dbPath;
  delete require.cache[require.resolve('../../src/db')];
  delete require.cache[require.resolve('../../src/settings')];
  db = require('../../src/db');
  settings = require('../../src/settings');
});
afterEach(() => {
  delete process.env.DB_PATH;
  cleanupTestDb(dbPath);
});

const DEFAULTS_EXPECTED = {
  'general.base_domain': 'localhost',
  'tailscale.enabled': false,
  'tailscale.domain': 'gantry.internal',
  'tailscale.ip': '',
  'tailscale.dns_enabled': true,
  'tailscale.dns_port': 53,
};

describe('DEFAULTS', () => {
  it('describe a stock install: localhost only, tailscale off', () => {
    expect(settings.DEFAULTS).toEqual(DEFAULTS_EXPECTED);
  });
});

describe('loadSettings', () => {
  it('returns DEFAULTS when nothing is stored', () => {
    expect(settings.loadSettings()).toEqual(DEFAULTS_EXPECTED);
  });

  it('coerces stored strings back to the typed shape of the default', () => {
    db.setSetting('tailscale.enabled', 'true');
    db.setSetting('tailscale.dns_port', '5353');
    db.setSetting('tailscale.domain', 'lab.internal');
    const s = settings.loadSettings();
    expect(s['tailscale.enabled']).toBe(true);
    expect(s['tailscale.dns_port']).toBe(5353);
    expect(s['tailscale.domain']).toBe('lab.internal');
  });

  it('ignores stored keys that are not in the schema', () => {
    db.setSetting('bogus', 'x');
    expect(settings.loadSettings()).not.toHaveProperty('bogus');
  });
});

describe('validate', () => {
  it('accepts a partial patch of valid values', () => {
    expect(settings.validate({ 'tailscale.enabled': true, 'tailscale.domain': 'gantry.internal' })).toEqual({ ok: true, errors: {} });
  });

  it('rejects unknown keys', () => {
    const r = settings.validate({ nope: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.nope).toMatch(/unknown/i);
  });

  it('rejects a domain with a scheme, spaces, or a trailing dot', () => {
    for (const bad of ['http://x', 'a b', 'x.', '.x', 'UPPER', '']) {
      const r = settings.validate({ 'tailscale.domain': bad });
      expect(r.ok, bad).toBe(false);
      expect(r.errors['tailscale.domain']).toBeTruthy();
    }
  });

  it('rejects a base domain that would collide with the tailscale domain', () => {
    const r = settings.validate({ 'general.base_domain': 'same', 'tailscale.domain': 'same' });
    expect(r.ok).toBe(false);
  });

  it('accepts an empty tailscale ip (auto-detect) and a dotted-quad, rejects junk', () => {
    expect(settings.validate({ 'tailscale.ip': '' }).ok).toBe(true);
    expect(settings.validate({ 'tailscale.ip': '100.69.122.15' }).ok).toBe(true);
    expect(settings.validate({ 'tailscale.ip': '999.1.1.1' }).ok).toBe(false);
    expect(settings.validate({ 'tailscale.ip': 'garuda' }).ok).toBe(false);
  });

  it('requires dns_port to be an integer 1..65535', () => {
    expect(settings.validate({ 'tailscale.dns_port': 53 }).ok).toBe(true);
    expect(settings.validate({ 'tailscale.dns_port': 0 }).ok).toBe(false);
    expect(settings.validate({ 'tailscale.dns_port': 70000 }).ok).toBe(false);
    expect(settings.validate({ 'tailscale.dns_port': '53' }).ok).toBe(false);
  });

  it('requires booleans to be actual booleans', () => {
    expect(settings.validate({ 'tailscale.enabled': 'true' }).ok).toBe(false);
  });
});

describe('saveSettings', () => {
  it('writes only the patched keys and returns the merged result', () => {
    const merged = settings.saveSettings({ 'tailscale.enabled': true });
    // Only the patched key lands in the table — defaults are never materialized.
    expect(db.getAllSettings()).toEqual({ 'tailscale.enabled': 'true' });
    expect(merged['tailscale.enabled']).toBe(true);
    expect(merged['general.base_domain']).toBe('localhost');
  });
});

describe('resolveDomains', () => {
  it('is just the base domain when tailscale is off', () => {
    expect(settings.resolveDomains(settings.DEFAULTS)).toEqual(['localhost']);
  });

  it('appends the tailscale domain when tailscale is on', () => {
    expect(settings.resolveDomains({ ...settings.DEFAULTS, 'tailscale.enabled': true })).toEqual(['localhost', 'gantry.internal']);
  });
});
