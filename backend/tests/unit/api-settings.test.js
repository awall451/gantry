const request = require('supertest');
const express = require('express');
const { makeTestDbPath, cleanupTestDb } = require('../helpers/db');

let app, dbPath, dns, tlsStatus, pushCalls;

beforeEach(() => {
  dbPath = makeTestDbPath();
  process.env.DB_PATH = dbPath;
  for (const m of ['db', 'settings', 'dns-server', 'caddy-client', 'tls-status', 'tailscale', 'api/settings']) {
    delete require.cache[require.resolve(`../../src/${m}`)];
  }
  // Stub the side effects at their real module objects (CJS: same object
  // every require) — the API must call pushConfig + dns start/stop, but the
  // test must not touch Caddy or bind :53.
  const caddy = require('../../src/caddy-client');
  pushCalls = 0;
  caddy.pushConfig = async () => { pushCalls++; return true; };
  dns = require('../../src/dns-server');
  dns.start = vi.fn(async ({ ip, port }) => ({ running: true, bind: `${ip}:${port}`, error: null }));
  dns.stop = vi.fn(async () => {});
  dns.getState = vi.fn(() => ({ running: false, bind: null, error: null }));
  dns.pickTailscaleIp = () => ({ ip: '100.1.2.3', iface: 'tailscale0' });
  tlsStatus = require('../../src/tls-status');
  tlsStatus.probeCert = vi.fn(async () => ({ error: 'ECONNREFUSED' }));
  tlsStatus.listenersOn = () => ['0.0.0.0', '100.1.2.3'];
  tlsStatus.tokenPresent = () => false;

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.broadcast = () => {}; next(); });
  app.use('/api/settings', require('../../src/api/settings'));
});

afterEach(() => {
  delete process.env.DB_PATH;
  cleanupTestDb(dbPath);
});

describe('GET /api/settings', () => {
  it('returns defaults plus runtime status on a fresh install', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.values['general.base_domain']).toBe('localhost');
    expect(res.body.values['tailscale.enabled']).toBe(false);
    expect(res.body.status.tailscale.detected).toEqual({ ip: '100.1.2.3', iface: 'tailscale0' });
    expect(res.body.status.tailscale.effectiveIp).toBe('100.1.2.3');
    expect(res.body.status.dns).toEqual({ running: false, bind: null, error: null });
  });

  it('reports token presence and :443 conflicts even with tls off; no cert probe until tls is on', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.body.status.tls).toEqual({ tokenPresent: false, conflicts: ['100.1.2.3'], cert: null });
    expect(tlsStatus.probeCert).not.toHaveBeenCalled();
  });
});

describe('PUT /api/settings (tls)', () => {
  it('probes the served certificate for the tailscale domain once tls is on', async () => {
    tlsStatus.probeCert = vi.fn(async () => ({ subject: 'gantry.internal', issuer: 'R11', daysLeft: 80, selfSigned: false }));
    const res = await request(app).put('/api/settings').send({ 'tailscale.enabled': true, 'tls.enabled': true });
    expect(res.status).toBe(200);
    expect(tlsStatus.probeCert).toHaveBeenCalledWith({ domain: 'gantry.internal' });
    expect(res.body.status.tls.cert.issuer).toBe('R11');
  });
});

describe('PUT /api/settings', () => {
  it('rejects an invalid patch with 400 and per-field errors, persisting nothing', async () => {
    const res = await request(app).put('/api/settings').send({ 'tailscale.domain': 'Bad Domain' });
    expect(res.status).toBe(400);
    expect(res.body.errors['tailscale.domain']).toBeTruthy();
    const after = await request(app).get('/api/settings');
    expect(after.body.values['tailscale.domain']).toBe('gantry.internal');
    expect(pushCalls).toBe(0);
  });

  it('rejects a non-object body', async () => {
    const res = await request(app).put('/api/settings').send([1]);
    expect(res.status).toBe(400);
  });

  it('persists a valid patch, re-pushes Caddy, and starts DNS when tailscale is enabled', async () => {
    const res = await request(app).put('/api/settings').send({ 'tailscale.enabled': true });
    expect(res.status).toBe(200);
    expect(res.body.values['tailscale.enabled']).toBe(true);
    expect(pushCalls).toBe(1);
    expect(dns.start).toHaveBeenCalledWith({ domain: 'gantry.internal', ip: '100.1.2.3', port: 53 });
  });

  it('uses an explicit tailscale.ip over the detected one', async () => {
    await request(app).put('/api/settings').send({ 'tailscale.enabled': true, 'tailscale.ip': '100.9.9.9' });
    expect(dns.start).toHaveBeenCalledWith(expect.objectContaining({ ip: '100.9.9.9' }));
  });

  it('stops DNS when tailscale is disabled or dns_enabled is off', async () => {
    await request(app).put('/api/settings').send({ 'tailscale.enabled': true });
    await request(app).put('/api/settings').send({ 'tailscale.dns_enabled': false });
    expect(dns.stop).toHaveBeenCalled();
    expect(dns.start).toHaveBeenCalledTimes(1);
  });

  it('reports a DNS failure in status without failing the request', async () => {
    // The real start() records its outcome where getState() reads it; the
    // stub has to keep that contract or status() can't see the failure.
    const failed = { running: false, bind: '100.1.2.3:53', error: 'bind EACCES' };
    dns.start = vi.fn(async () => failed);
    dns.getState = vi.fn(() => failed);
    const res = await request(app).put('/api/settings').send({ 'tailscale.enabled': true });
    expect(res.status).toBe(200);
    expect(res.body.status.dns.error).toBe('bind EACCES');
  });

  it('with tailscale enabled but no ip detectable, reports the problem and does not start DNS', async () => {
    dns.pickTailscaleIp = () => null;
    const res = await request(app).put('/api/settings').send({ 'tailscale.enabled': true });
    expect(res.status).toBe(200);
    expect(res.body.status.tailscale.effectiveIp).toBe('');
    expect(res.body.status.dns.error).toMatch(/no tailscale ip/i);
    expect(dns.start).not.toHaveBeenCalled();
  });
});
