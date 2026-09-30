const request = require('supertest');
const express = require('express');
const { makeTestDbPath, cleanupTestDb } = require('../helpers/db');
const db = require('../../src/db');
const pw = require('../../src/auth/password');
const guard = require('../../src/auth/guard');
const { installAuth } = require('../../src/auth/install');

const ENV = ['GANTRY_PASSWORD_HASH', 'GANTRY_USERNAME', 'GANTRY_API_TOKEN', 'GANTRY_ALLOWED_HOSTS', 'GANTRY_SESSION_TTL_HOURS'];
const TOKEN = 'a'.repeat(40);
let app, dbPath, HASH;

beforeAll(async () => { HASH = await pw.hashPassword('hunter2hunter2'); });

beforeEach(() => {
  dbPath = makeTestDbPath();
  process.env.DB_PATH = dbPath;
  for (const k of ENV) delete process.env[k];
  pw.resetAttempts();
  app = express();
  app.use(express.json());
  installAuth(app);
  app.get('/api/ping', (_req, res) => res.json({ pong: true }));
  app.post('/api/containers/x/stop', (_req, res) => res.json({ stopped: true }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
});

afterEach(() => {
  db.closeDb();
  delete process.env.DB_PATH;
  for (const k of ENV) delete process.env[k];
  cleanupTestDb(dbPath);
});

const H = { Host: 'gantry.localhost' };
const login = (body, agent = request(app)) =>
  agent.post('/api/auth/login').set(H).set('Content-Type', 'application/json').send(body);

describe('no password configured (stock install)', () => {
  it('API stays open and reports no login', async () => {
    expect((await request(app).get('/api/ping').set(H)).status).toBe(200);
    const cfg = await request(app).get('/api/auth/config').set(H);
    expect(cfg.body).toEqual({ password_required: false, misconfigured: false });
    expect((await request(app).get('/api/auth/me').set(H)).status).toBe(200);
    expect((await login({ username: 'admin', password: 'x' })).status).toBe(404);
  });
});

describe('with GANTRY_PASSWORD_HASH', () => {
  beforeEach(() => { process.env.GANTRY_PASSWORD_HASH = HASH; });

  it('guards /api but not /api/auth or /health', async () => {
    expect((await request(app).get('/api/ping').set(H)).status).toBe(401);
    expect((await request(app).get('/api/auth/config').set(H)).body.password_required).toBe(true);
    expect((await request(app).get('/api/auth/me').set(H)).status).toBe(401);
    expect((await request(app).get('/health').set(H)).status).toBe(200);
  });

  it('login sets an HttpOnly SameSite=Strict session cookie that opens the API', async () => {
    const res = await login({ username: 'Admin ', password: 'hunter2hunter2' });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^gantry_session=[0-9a-f]{64};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure'); // plain http here
    const jar = cookie.split(';')[0];
    expect((await request(app).get('/api/ping').set(H).set('Cookie', jar)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(H).set('Cookie', jar)).body.username).toBe('admin');
  });

  it('marks the cookie Secure when Caddy says the request came over https', async () => {
    const res = await login({ username: 'admin', password: 'hunter2hunter2' }).set('X-Forwarded-Proto', 'https');
    expect(res.headers['set-cookie'][0]).toContain('Secure');
  });

  it('rejects a wrong password or username with one message', async () => {
    const a = await login({ username: 'admin', password: 'wrong-password' });
    const b = await login({ username: 'root', password: 'hunter2hunter2' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.detail).toBe(b.body.detail);
    expect(a.headers['set-cookie']).toBeUndefined();
  });

  it('throttles after 5 failures with 429 + Retry-After, even for the right password', async () => {
    for (let i = 0; i < 5; i++) await login({ username: 'admin', password: 'nope' });
    const res = await login({ username: 'admin', password: 'hunter2hunter2' });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('only accepts JSON bodies', async () => {
    const res = await request(app).post('/api/auth/login').set(H)
      .type('form').send('username=admin&password=hunter2hunter2');
    expect(res.status).toBe(415);
  });

  it('logout revokes the session server-side', async () => {
    const jar = (await login({ username: 'admin', password: 'hunter2hunter2' })).headers['set-cookie'][0].split(';')[0];
    await request(app).post('/api/auth/logout').set(H).set('Cookie', jar);
    expect((await request(app).get('/api/ping').set(H).set('Cookie', jar)).status).toBe(401);
  });

  it('changing the password logs out every existing session', async () => {
    const jar = (await login({ username: 'admin', password: 'hunter2hunter2' })).headers['set-cookie'][0].split(';')[0];
    process.env.GANTRY_PASSWORD_HASH = await pw.hashPassword('a-new-password');
    expect((await request(app).get('/api/ping').set(H).set('Cookie', jar)).status).toBe(401);
  });

  it('expired sessions are refused', async () => {
    process.env.GANTRY_SESSION_TTL_HOURS = '0.0000001';
    const jar = (await login({ username: 'admin', password: 'hunter2hunter2' })).headers['set-cookie'][0].split(';')[0];
    await new Promise(r => setTimeout(r, 5));
    expect((await request(app).get('/api/ping').set(H).set('Cookie', jar)).status).toBe(401);
  });

  it('accepts Authorization: Bearer $GANTRY_API_TOKEN (the MCP server), ignores short tokens', async () => {
    process.env.GANTRY_API_TOKEN = TOKEN;
    expect((await request(app).get('/api/ping').set(H).set('Authorization', `Bearer ${TOKEN}`)).status).toBe(200);
    expect((await request(app).get('/api/ping').set(H).set('Authorization', 'Bearer nope')).status).toBe(401);
    process.env.GANTRY_API_TOKEN = 'short';
    expect((await request(app).get('/api/ping').set(H).set('Authorization', 'Bearer short')).status).toBe(401);
  });

  it('a malformed hash fails closed and says so', async () => {
    process.env.GANTRY_PASSWORD_HASH = 'scrypt$32768$8$1$oops';
    expect((await request(app).get('/api/auth/config').set(H)).body).toEqual({ password_required: true, misconfigured: true });
    expect((await login({ username: 'admin', password: 'anything' })).status).toBe(401);
    expect((await request(app).get('/api/ping').set(H)).status).toBe(401);
  });
});

describe('Host allowlist (DNS rebinding)', () => {
  it('allows Gantry names, *.localhost, IP literals; refuses others', async () => {
    for (const host of ['gantry.localhost', 'localhost:3001', '127.0.0.1:3001', '100.64.1.2', '[::1]:3001', 'anything.localhost']) {
      expect((await request(app).get('/api/ping').set('Host', host)).status, host).toBe(200);
    }
    const res = await request(app).get('/api/ping').set('Host', 'evil.example.com');
    expect(res.status).toBe(400);
    expect(res.text).toContain('GANTRY_ALLOWED_HOSTS');
  });

  it('GANTRY_ALLOWED_HOSTS adds exact names and *.suffix patterns; * disables the check', async () => {
    process.env.GANTRY_ALLOWED_HOSTS = 'box.lan, *.ts.net';
    expect((await request(app).get('/api/ping').set('Host', 'box.lan')).status).toBe(200);
    expect((await request(app).get('/api/ping').set('Host', 'laptop.tail0.ts.net')).status).toBe(200);
    expect((await request(app).get('/api/ping').set('Host', 'other.lan')).status).toBe(400);
    process.env.GANTRY_ALLOWED_HOSTS = '*';
    expect((await request(app).get('/api/ping').set('Host', 'other.lan')).status).toBe(200);
  });

  it('follows settings: the Tailscale domain and gantry.<domain> once enabled', async () => {
    db.setSetting('tailscale.enabled', 'true');
    db.setSetting('tailscale.domain', 'lab.example.com');
    for (const host of ['lab.example.com', 'gantry.lab.example.com']) {
      expect((await request(app).get('/api/ping').set('Host', host)).status, host).toBe(200);
    }
    expect((await request(app).get('/api/ping').set('Host', 'jellyfin.lab.example.com')).status).toBe(400);
  });
});

describe('Origin check (cross-site requests)', () => {
  it('refuses state-changing requests from another origin, even with no password', async () => {
    const res = await request(app).post('/api/containers/x/stop').set(H).set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    const sibling = await request(app).post('/api/containers/x/stop').set(H).set('Origin', 'http://jellyfin.localhost');
    expect(sibling.status).toBe(403);
  });

  it('allows same-origin browser requests, origin-less clients, and cross-origin GETs', async () => {
    expect((await request(app).post('/api/containers/x/stop').set(H).set('Origin', 'http://gantry.localhost')).status).toBe(200);
    expect((await request(app).post('/api/containers/x/stop').set(H)).status).toBe(200);
    expect((await request(app).get('/api/ping').set(H).set('Origin', 'https://evil.example.com')).status).toBe(200);
  });
});

describe('refuseUpgrade (WebSocket handshakes)', () => {
  const req = (headers) => ({ headers: { host: 'gantry.localhost', ...headers } });

  it('open without a password, but still checks Host and Origin', () => {
    expect(guard.refuseUpgrade(req({ origin: 'http://gantry.localhost' }))).toBeNull();
    expect(guard.refuseUpgrade(req({ host: 'evil.example.com' }))).toBe(400);
    expect(guard.refuseUpgrade(req({ origin: 'https://evil.example.com' }))).toBe(403);
  });

  it('needs a session once a password is set', async () => {
    process.env.GANTRY_PASSWORD_HASH = HASH;
    expect(guard.refuseUpgrade(req({ origin: 'http://gantry.localhost' }))).toBe(401);
    const jar = (await login({ username: 'admin', password: 'hunter2hunter2' })).headers['set-cookie'][0].split(';')[0];
    expect(guard.refuseUpgrade(req({ origin: 'http://gantry.localhost', cookie: `x=1; ${jar}` }))).toBeNull();
  });
});
