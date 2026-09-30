const request = require('supertest');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeTestDbPath, cleanupTestDb } = require('../helpers/db');
const db = require('../../src/db');
const pw = require('../../src/auth/password');
const hs = require('../../src/host-shell');
const { installAuth } = require('../../src/auth/install');

const ENV = ['GANTRY_PASSWORD_HASH', 'GANTRY_API_TOKEN', 'GANTRY_HOST_SHELL', 'GANTRY_HOST_SHELL_USER', 'GANTRY_HOST_SHELL_DIR'];
const KEYBLOB = 'AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyBlobForTestsOnly0000000000000000';
let app, dbPath, dir, HASH;

beforeAll(async () => { HASH = await pw.hashPassword('hunter2hunter2'); });

beforeEach(() => {
  dbPath = makeTestDbPath();
  process.env.DB_PATH = dbPath;
  for (const k of ENV) delete process.env[k];
  pw.resetAttempts();
  hs.clearTickets();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantry-hs-'));
  fs.writeFileSync(path.join(dir, 'id_ed25519'), 'not a real key');
  fs.writeFileSync(path.join(dir, 'known_hosts'), `# pinned\n127.0.0.1 ssh-ed25519 ${KEYBLOB}\n`);
  app = express();
  app.use(express.json());
  installAuth(app);
  app.use('/api/host-shell', require('../../src/api/host-shell'));
});

afterEach(() => {
  db.closeDb();
  for (const k of ENV) delete process.env[k];
  delete process.env.DB_PATH;
  cleanupTestDb(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

const H = { Host: 'gantry.localhost' };
function enable() {
  Object.assign(process.env, {
    GANTRY_PASSWORD_HASH: HASH, GANTRY_HOST_SHELL: '1', GANTRY_HOST_SHELL_USER: 'alice', GANTRY_HOST_SHELL_DIR: dir,
  });
}
async function sessionCookie() {
  const res = await request(app).post('/api/auth/login').set(H).set('Content-Type', 'application/json')
    .send({ username: 'admin', password: 'hunter2hunter2' });
  return res.headers['set-cookie'][0].split(';')[0];
}
const unlock = (jar, password) => request(app).post('/api/host-shell/unlock').set(H).set('Cookie', jar || '')
  .set('Content-Type', 'application/json').send({ password });

describe('availability', () => {
  const auth = { passwordRequired: true, misconfigured: false };
  it('is off unless GANTRY_HOST_SHELL is truthy', () => {
    expect(hs.availability(hs.hostShellConfig({}), auth)).toEqual({ enabled: false, available: false, reason: null });
  });

  it('refuses without a login, even when enabled', () => {
    const cfg = hs.hostShellConfig({ GANTRY_HOST_SHELL: '1', GANTRY_HOST_SHELL_USER: 'u', GANTRY_HOST_SHELL_DIR: dir });
    for (const a of [{ passwordRequired: false }, { passwordRequired: true, misconfigured: true }]) {
      const r = hs.availability(cfg, a);
      expect(r.available).toBe(false);
      expect(r.reason).toMatch(/needs a login/);
    }
    expect(hs.availability(cfg, auth)).toMatchObject({ available: true, user: 'u' });
  });

  it('names the missing piece: user, key, pinned host key', () => {
    const base = { GANTRY_HOST_SHELL: 'true', GANTRY_HOST_SHELL_DIR: dir };
    expect(hs.availability(hs.hostShellConfig(base), auth).reason).toMatch(/GANTRY_HOST_SHELL_USER/);
    const cfg = hs.hostShellConfig({ ...base, GANTRY_HOST_SHELL_USER: 'u' });
    fs.writeFileSync(cfg.knownHostsPath, '# empty\n');
    expect(hs.availability(cfg, auth).reason).toMatch(/host key/);
    fs.rmSync(cfg.keyPath);
    expect(hs.availability(cfg, auth).reason).toMatch(/SSH key/);
  });
});

describe('knownHostKeys', () => {
  it('reads key blobs, skipping comments and junk', () => {
    const f = path.join(dir, 'kh');
    fs.writeFileSync(f, `# c\n\n127.0.0.1 ssh-ed25519 AAA1\n[127.0.0.1]:2222 ecdsa-sha2-nistp256 AAA2\ngarbage\n`);
    expect([...hs.knownHostKeys(f)]).toEqual(['AAA1', 'AAA2']);
    expect(hs.knownHostKeys(path.join(dir, 'missing')).size).toBe(0);
  });
});

describe('tickets', () => {
  it('are single use, bound to the session, and expire after 60 s', () => {
    const t = hs.issueTicket('session-a', 1000);
    expect(hs.redeemTicket(t, 'session-b', 1000)).toBe(false);
    expect(hs.redeemTicket(t, 'session-a', 1000)).toBe(false); // burnt by the wrong-session try
    const u = hs.issueTicket('session-a', 1000);
    expect(hs.redeemTicket(u, 'session-a', 1000)).toBe(true);
    expect(hs.redeemTicket(u, 'session-a', 1000)).toBe(false);
    const v = hs.issueTicket('session-a', 1000);
    expect(hs.redeemTicket(v, 'session-a', 1000 + hs.TICKET_TTL_MS)).toBe(false);
    expect(hs.redeemTicket(null, 'session-a')).toBe(false);
    expect(hs.redeemTicket(hs.issueTicket('x'), null)).toBe(false);
  });
});

describe('/api/host-shell', () => {
  it('status reports off by default, and unlock 404s', async () => {
    process.env.GANTRY_PASSWORD_HASH = HASH;
    const jar = await sessionCookie();
    expect((await request(app).get('/api/host-shell/status').set(H).set('Cookie', jar)).body.enabled).toBe(false);
    expect((await unlock(jar, 'hunter2hunter2')).status).toBe(404);
  });

  it('unlock needs the password again and returns a ticket bound to this session', async () => {
    enable();
    const jar = await sessionCookie();
    expect((await request(app).get('/api/host-shell/status').set(H).set('Cookie', jar)).body)
      .toMatchObject({ enabled: true, available: true, user: 'alice' });
    expect((await unlock(jar, 'wrong')).status).toBe(401);
    const ok = await unlock(jar, 'hunter2hunter2');
    expect(ok.status).toBe(200);
    expect(ok.body.ticket).toMatch(/^[0-9a-f]{48}$/);

    const { refuseHostUpgrade } = require('../../src/api/host-shell');
    const up = (ticket, cookie) => refuseHostUpgrade({ url: `/ws/host?ticket=${ticket}`, headers: { cookie } });
    expect(up(ok.body.ticket, 'gantry_session=someone-else')).toBe(403);
    const again = (await unlock(jar, 'hunter2hunter2')).body.ticket;
    expect(up(again, jar)).toBeNull();
    expect(up(again, jar)).toBe(403); // single use
  });

  it('the MCP Bearer token cannot unlock', async () => {
    enable();
    process.env.GANTRY_API_TOKEN = 't'.repeat(40);
    const res = await request(app).post('/api/host-shell/unlock').set(H)
      .set('Authorization', `Bearer ${'t'.repeat(40)}`).set('Content-Type', 'application/json').send({ password: 'hunter2hunter2' });
    expect(res.status).toBe(403);
  });

  it('shares the login throttle', async () => {
    enable();
    const jar = await sessionCookie();
    for (let i = 0; i < 5; i++) await unlock(jar, 'wrong');
    expect((await unlock(jar, 'hunter2hunter2')).status).toBe(429);
  });

  it('is unavailable (409) when enabled without a login, and requireAuth still applies', async () => {
    Object.assign(process.env, { GANTRY_HOST_SHELL: '1', GANTRY_HOST_SHELL_USER: 'u', GANTRY_HOST_SHELL_DIR: dir });
    const res = await unlock('', 'x');
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/needs a login/);
    const { refuseHostUpgrade } = require('../../src/api/host-shell');
    expect(refuseHostUpgrade({ url: '/ws/host?ticket=abc', headers: {} })).toBe(404);
  });
});
