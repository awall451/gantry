import { get } from 'svelte/store';
import { auth, safeReturnTo, loginUrl, checkAuth, login, logout } from '../../src/lib/auth.js';

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fakeFetch = routes => vi.fn(async (url, opts = {}) => {
  const r = routes[`${opts.method || 'GET'} ${url}`];
  if (!r) throw new Error(`unexpected ${opts.method || 'GET'} ${url}`);
  return r;
});

describe('safeReturnTo / loginUrl', () => {
  it('keeps in-app paths, rejects everything that could leave the app or loop', () => {
    expect(safeReturnTo('/routes?x=1')).toBe('/routes?x=1');
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/login', '/login?return_to=/x', '', null, undefined]) {
      expect(safeReturnTo(bad), String(bad)).toBe('/');
    }
    expect(loginUrl('/containers/abc')).toBe('/login?return_to=%2Fcontainers%2Fabc');
    expect(loginUrl('/')).toBe('/login');
  });
});

describe('checkAuth', () => {
  it('no login configured: authed without calling /me', async () => {
    const f = fakeFetch({ 'GET /api/auth/config': res(200, { password_required: false, misconfigured: false }) });
    expect(await checkAuth(f)).toMatchObject({ checked: true, required: false, authed: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('login configured: authed follows /me', async () => {
    const cfg = res(200, { password_required: true, misconfigured: false });
    expect(await checkAuth(fakeFetch({ 'GET /api/auth/config': cfg, 'GET /api/auth/me': res(401, {}) })))
      .toMatchObject({ required: true, authed: false });
    expect(await checkAuth(fakeFetch({ 'GET /api/auth/config': cfg, 'GET /api/auth/me': res(200, { username: 'admin' }) })))
      .toMatchObject({ required: true, authed: true, username: 'admin' });
  });
});

describe('login / logout', () => {
  it('success flips the store; failure returns the server message', async () => {
    const ok = await login(' Admin ', 'pw', fakeFetch({ 'POST /api/auth/login': res(200, { ok: true }) }));
    expect(ok).toEqual({ ok: true });
    expect(get(auth)).toMatchObject({ authed: true, username: 'admin' });

    const bad = await login('admin', 'nope', fakeFetch({ 'POST /api/auth/login': res(429, { detail: 'too many failed attempts; try again in 60s' }) }));
    expect(bad).toEqual({ ok: false, status: 429, detail: 'too many failed attempts; try again in 60s' });

    await logout(fakeFetch({ 'POST /api/auth/logout': res(200, { ok: true }) }));
    expect(get(auth).authed).toBe(false);
  });

  it('sends JSON (the backend refuses anything else)', async () => {
    const f = fakeFetch({ 'POST /api/auth/login': res(200, {}) });
    await login('admin', 'pw', f);
    const [, opts] = f.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ username: 'admin', password: 'pw' });
  });
});
