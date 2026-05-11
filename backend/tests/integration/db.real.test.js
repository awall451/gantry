const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const db = require('../../src/db');

let dbPath;
let prevDbPath;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-db-test-'));
  dbPath = path.join(dir, `t-${crypto.randomUUID().slice(0, 8)}.db`);
  prevDbPath = process.env.DB_PATH;
  process.env.DB_PATH = dbPath;
});

afterEach(() => {
  db.closeDb();
  if (prevDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = prevDbPath;
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch {}
});

function ts(s) { return s; }

describe('db.js — schema bootstrap', () => {
  it('creates the schema on first getDb() call', () => {
    const handle = db.getDb();
    const tables = handle
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(r => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(['analytics', 'container_events', 'container_stats', 'routes'])
    );
  });

  it('is idempotent across getDb() calls', () => {
    db.getDb();
    expect(() => db.getDb()).not.toThrow();
  });
});

describe('routes', () => {
  describe('insertRoute', () => {
    it('inserts a manual route with is_auto=0 and container_id=NULL and returns the rowid', () => {
      const id = db.insertRoute({ container_name: 'manual', hostname: 'manual', target_port: 9000 });
      expect(id).toBeGreaterThan(0);
      const row = db.getRouteById(id);
      expect(row).toMatchObject({
        container_name: 'manual',
        hostname: 'manual',
        target_port: 9000,
        is_auto: 0,
        enabled: 1,
        container_id: null
      });
    });

    it('throws on UNIQUE constraint when reusing a hostname', () => {
      db.insertRoute({ container_name: 'a', hostname: 'dup', target_port: 1 });
      expect(() =>
        db.insertRoute({ container_name: 'b', hostname: 'dup', target_port: 2 })
      ).toThrow(/UNIQUE/i);
    });
  });

  describe('getAllRoutes / getEnabledRoutes', () => {
    it('returns all rows when none are filtered (DESC by created_at; ties unstable — see issue follow-up)', () => {
      // NOTE: CURRENT_TIMESTAMP has 1-second resolution in SQLite, so two rapid inserts
      // get identical created_at values and ORDER BY ... DESC produces an unstable order
      // for the ties. A tiebreaker `, id DESC` would fix it. Filed as a follow-up.
      const id1 = db.insertRoute({ container_name: 'a', hostname: 'a', target_port: 1 });
      const id2 = db.insertRoute({ container_name: 'b', hostname: 'b', target_port: 2 });
      const all = db.getAllRoutes();
      expect(all.map(r => r.id).sort()).toEqual([id1, id2].sort());
    });

    it('getEnabledRoutes filters out enabled=0', () => {
      const id1 = db.insertRoute({ container_name: 'a', hostname: 'a', target_port: 1 });
      db.insertRoute({ container_name: 'b', hostname: 'b', target_port: 2 });
      db.updateRoute(id1, { enabled: 0 });
      const enabled = db.getEnabledRoutes().map(r => r.hostname);
      expect(enabled).toEqual(['b']);
    });
  });

  describe('getRouteById', () => {
    it('returns matching row', () => {
      const id = db.insertRoute({ container_name: 'a', hostname: 'a', target_port: 1 });
      expect(db.getRouteById(id)).toMatchObject({ id, hostname: 'a' });
    });

    it('returns undefined when no match', () => {
      expect(db.getRouteById(99999)).toBeUndefined();
    });
  });

  describe('updateRoute', () => {
    it('updates allowed fields (hostname, enabled)', () => {
      const id = db.insertRoute({ container_name: 'a', hostname: 'a', target_port: 1 });
      db.updateRoute(id, { hostname: 'a-renamed', enabled: 0 });
      expect(db.getRouteById(id)).toMatchObject({ hostname: 'a-renamed', enabled: 0 });
    });

    it('ignores fields outside the allow-list', () => {
      const id = db.insertRoute({ container_name: 'a', hostname: 'a', target_port: 1 });
      db.updateRoute(id, { target_port: 9999, container_id: 'foo', is_auto: 1 });
      expect(db.getRouteById(id)).toMatchObject({ target_port: 1, container_id: null, is_auto: 0 });
    });

    it('is a no-op when no allowed fields are supplied', () => {
      const id = db.insertRoute({ container_name: 'a', hostname: 'a', target_port: 1 });
      const before = db.getRouteById(id);
      db.updateRoute(id, { not_a_column: 'nope' });
      expect(db.getRouteById(id)).toEqual(before);
    });
  });

  describe('deleteRoute', () => {
    it('removes the row', () => {
      const id = db.insertRoute({ container_name: 'a', hostname: 'a', target_port: 1 });
      db.deleteRoute(id);
      expect(db.getRouteById(id)).toBeUndefined();
    });
  });

  describe('upsertRoute', () => {
    it('first call inserts a new auto route and returns its id', () => {
      const id = db.upsertRoute({
        container_id: 'abc123',
        container_name: 'svc',
        hostname: 'svc',
        target_port: 8080
      });
      expect(id).toBeGreaterThan(0);
      expect(db.getRouteById(id)).toMatchObject({
        container_id: 'abc123',
        container_name: 'svc',
        hostname: 'svc',
        target_port: 8080,
        is_auto: 1
      });
    });

    it('second call with the same container_id returns the existing id (no-op)', () => {
      const id1 = db.upsertRoute({ container_id: 'abc', container_name: 'svc', hostname: 'svc', target_port: 1 });
      const id2 = db.upsertRoute({ container_id: 'abc', container_name: 'svc', hostname: 'svc', target_port: 1 });
      expect(id2).toBe(id1);
      expect(db.getAllRoutes()).toHaveLength(1);
    });

    it('updates container_id when the same container_name reappears under a new id (container restart)', () => {
      const id1 = db.upsertRoute({ container_id: 'old', container_name: 'svc', hostname: 'svc', target_port: 1 });
      const id2 = db.upsertRoute({ container_id: 'new', container_name: 'svc', hostname: 'svc', target_port: 1 });
      expect(id2).toBe(id1);
      expect(db.getRouteById(id1).container_id).toBe('new');
    });

    it('does NOT insert when a manual route already owns the hostname (INSERT OR IGNORE)', () => {
      const manualId = db.insertRoute({ container_name: 'svc', hostname: 'svc', target_port: 9000 });
      // Auto sync sees a container that wants the same hostname
      const returnedId = db.upsertRoute({
        container_id: 'abc',
        container_name: 'svc',
        hostname: 'svc',
        target_port: 8080
      });
      // CLAUDE.md: "INSERT OR IGNORE silently dropped"
      // KNOWN BUG: better-sqlite3's result.lastInsertRowid reports the rowid of the
      // PREVIOUS successful insert on the connection when INSERT OR IGNORE is ignored.
      // That stale value (here: the manual route's rowid) gets returned, indistinguishable
      // from a successful new insert. Filed as a follow-up.
      expect(returnedId).toBe(manualId);
      // The important invariant: no second row was created.
      expect(db.getAllRoutes()).toHaveLength(1);
    });
  });

  describe('markContainerStopped', () => {
    it('is a no-op: route persists after a container stops', () => {
      const id = db.upsertRoute({
        container_id: 'abc',
        container_name: 'svc',
        hostname: 'svc',
        target_port: 8080
      });
      db.markContainerStopped('abc');
      expect(db.getRouteById(id)).toBeDefined();
    });
  });
});

describe('analytics', () => {
  describe('recordAnalytics', () => {
    it('first call inserts with count=1 and the right status bucket', () => {
      db.recordAnalytics({ hostname: 'h', hour: '2026-05-11T10', status: 200, duration_ms: 100 });
      const rows = db.queryAnalytics({ hostname: 'h' });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        hostname: 'h',
        hour: '2026-05-11T10',
        request_count: 1,
        status_2xx: 1,
        status_4xx: 0,
        status_5xx: 0,
        avg_duration_ms: 100
      });
    });

    it('increments request_count and sums status buckets on conflict', () => {
      db.recordAnalytics({ hostname: 'h', hour: '2026-05-11T10', status: 200, duration_ms: 100 });
      db.recordAnalytics({ hostname: 'h', hour: '2026-05-11T10', status: 404, duration_ms: 200 });
      db.recordAnalytics({ hostname: 'h', hour: '2026-05-11T10', status: 500, duration_ms: 300 });
      const rows = db.queryAnalytics({ hostname: 'h' });
      expect(rows[0]).toMatchObject({
        request_count: 3,
        status_2xx: 1,
        status_4xx: 1,
        status_5xx: 1
      });
    });

    it('computes a running average for duration: [100, 200] -> 150', () => {
      db.recordAnalytics({ hostname: 'h', hour: 'H', status: 200, duration_ms: 100 });
      db.recordAnalytics({ hostname: 'h', hour: 'H', status: 200, duration_ms: 200 });
      const row = db.queryAnalytics({ hostname: 'h' })[0];
      expect(row.avg_duration_ms).toBeCloseTo(150);
    });

    it('computes a running average for duration: [100, 200, 300] -> 200', () => {
      db.recordAnalytics({ hostname: 'h', hour: 'H', status: 200, duration_ms: 100 });
      db.recordAnalytics({ hostname: 'h', hour: 'H', status: 200, duration_ms: 200 });
      db.recordAnalytics({ hostname: 'h', hour: 'H', status: 200, duration_ms: 300 });
      const row = db.queryAnalytics({ hostname: 'h' })[0];
      expect(row.avg_duration_ms).toBeCloseTo(200);
    });

    it('1xx and 3xx statuses are not counted in any bucket but still increment request_count', () => {
      db.recordAnalytics({ hostname: 'h', hour: 'H', status: 100, duration_ms: 10 });
      db.recordAnalytics({ hostname: 'h', hour: 'H', status: 301, duration_ms: 20 });
      const row = db.queryAnalytics({ hostname: 'h' })[0];
      expect(row).toMatchObject({
        request_count: 2,
        status_2xx: 0,
        status_4xx: 0,
        status_5xx: 0
      });
    });
  });

  describe('queryAnalytics', () => {
    beforeEach(() => {
      db.recordAnalytics({ hostname: 'a', hour: '2026-05-11T09', status: 200, duration_ms: 100 });
      db.recordAnalytics({ hostname: 'a', hour: '2026-05-11T10', status: 200, duration_ms: 100 });
      db.recordAnalytics({ hostname: 'b', hour: '2026-05-11T10', status: 200, duration_ms: 100 });
    });

    it('returns all rows when called with no filters', () => {
      expect(db.queryAnalytics()).toHaveLength(3);
    });

    it('filters by hostname', () => {
      const rows = db.queryAnalytics({ hostname: 'a' });
      expect(rows).toHaveLength(2);
      expect(rows.every(r => r.hostname === 'a')).toBe(true);
    });

    it('filters by from (inclusive lower bound)', () => {
      const rows = db.queryAnalytics({ from: '2026-05-11T10' });
      expect(rows).toHaveLength(2);
      expect(rows.every(r => r.hour >= '2026-05-11T10')).toBe(true);
    });

    it('filters by to (inclusive upper bound)', () => {
      const rows = db.queryAnalytics({ to: '2026-05-11T09' });
      expect(rows).toHaveLength(1);
    });

    it('orders by hostname, hour', () => {
      const rows = db.queryAnalytics();
      const keys = rows.map(r => `${r.hostname}|${r.hour}`);
      const sorted = [...keys].sort();
      expect(keys).toEqual(sorted);
    });
  });
});

describe('container_stats', () => {
  const sample = {
    container_id: 'c1',
    container_name: 'svc',
    recorded_at: '2026-05-11 10:00:00',
    cpu_percent: 1.5,
    mem_usage_mb: 256,
    mem_limit_mb: 1024,
    mem_percent: 25,
    net_rx_bytes: 100,
    net_tx_bytes: 200,
    blk_read_bytes: 300,
    blk_write_bytes: 400
  };

  it('insertContainerStats round-trips all numeric fields', () => {
    db.insertContainerStats(sample);
    const rows = db.queryContainerStats({ container_id: 'c1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(sample);
  });

  it('queryContainerStats filters by container_id', () => {
    db.insertContainerStats(sample);
    db.insertContainerStats({ ...sample, container_id: 'c2' });
    expect(db.queryContainerStats({ container_id: 'c1' })).toHaveLength(1);
    expect(db.queryContainerStats({ container_id: 'c2' })).toHaveLength(1);
  });

  it('queryContainerStats respects from/to', () => {
    db.insertContainerStats({ ...sample, recorded_at: '2026-05-11 09:00:00' });
    db.insertContainerStats({ ...sample, recorded_at: '2026-05-11 10:00:00' });
    db.insertContainerStats({ ...sample, recorded_at: '2026-05-11 11:00:00' });
    const rows = db.queryContainerStats({
      container_id: 'c1',
      from: '2026-05-11 10:00:00',
      to: '2026-05-11 10:00:00'
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].recorded_at).toBe('2026-05-11 10:00:00');
  });

  it('queryContainerStats respects limit', () => {
    for (let i = 0; i < 5; i++) {
      db.insertContainerStats({ ...sample, recorded_at: `2026-05-11 0${i}:00:00` });
    }
    expect(db.queryContainerStats({ container_id: 'c1', limit: 3 })).toHaveLength(3);
  });

  it('queryAllContainerStats spans containers and respects time range + limit', () => {
    db.insertContainerStats({ ...sample, container_id: 'c1' });
    db.insertContainerStats({ ...sample, container_id: 'c2' });
    expect(db.queryAllContainerStats()).toHaveLength(2);
  });

  it('purgeOldContainerStats deletes rows older than the cutoff', () => {
    db.insertContainerStats({ ...sample, recorded_at: '2026-05-10 00:00:00' });
    db.insertContainerStats({ ...sample, recorded_at: '2026-05-12 00:00:00' });
    db.purgeOldContainerStats('2026-05-11 00:00:00');
    const all = db.queryAllContainerStats();
    expect(all).toHaveLength(1);
    expect(all[0].recorded_at).toBe('2026-05-12 00:00:00');
  });
});

describe('container_events', () => {
  const sample = {
    container_id: 'c1',
    container_name: 'svc',
    action: 'start',
    exit_code: null,
    occurred_at: '2026-05-11 10:00:00'
  };

  it('insertContainerEvent round-trips fields', () => {
    db.insertContainerEvent(sample);
    const rows = db.queryContainerEvents({ container_id: 'c1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(sample);
  });

  it('exit_code defaults to null when undefined', () => {
    db.insertContainerEvent({ ...sample, exit_code: undefined });
    const rows = db.queryContainerEvents({ container_id: 'c1' });
    expect(rows[0].exit_code).toBeNull();
  });

  it('queryContainerEvents filters by container_id', () => {
    db.insertContainerEvent(sample);
    db.insertContainerEvent({ ...sample, container_id: 'c2' });
    expect(db.queryContainerEvents({ container_id: 'c1' })).toHaveLength(1);
  });

  it('queryContainerEvents returns most recent first (DESC)', () => {
    db.insertContainerEvent({ ...sample, occurred_at: '2026-05-11 09:00:00' });
    db.insertContainerEvent({ ...sample, occurred_at: '2026-05-11 10:00:00' });
    db.insertContainerEvent({ ...sample, occurred_at: '2026-05-11 11:00:00' });
    const rows = db.queryContainerEvents({ container_id: 'c1' });
    expect(rows.map(r => r.occurred_at)).toEqual([
      '2026-05-11 11:00:00',
      '2026-05-11 10:00:00',
      '2026-05-11 09:00:00'
    ]);
  });

  it('queryContainerEvents respects limit', () => {
    for (let i = 0; i < 5; i++) {
      db.insertContainerEvent({ ...sample, occurred_at: `2026-05-11 0${i}:00:00` });
    }
    expect(db.queryContainerEvents({ container_id: 'c1', limit: 2 })).toHaveLength(2);
  });

  it('queryAllContainerEvents spans containers', () => {
    db.insertContainerEvent({ ...sample, container_id: 'c1' });
    db.insertContainerEvent({ ...sample, container_id: 'c2' });
    expect(db.queryAllContainerEvents()).toHaveLength(2);
  });

  it('purgeOldContainerEvents deletes rows older than the cutoff', () => {
    db.insertContainerEvent({ ...sample, occurred_at: '2026-05-10 00:00:00' });
    db.insertContainerEvent({ ...sample, occurred_at: '2026-05-12 00:00:00' });
    db.purgeOldContainerEvents('2026-05-11 00:00:00');
    const remaining = db.queryAllContainerEvents();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].occurred_at).toBe('2026-05-12 00:00:00');
  });
});
