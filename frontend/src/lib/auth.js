// Login state for the SPA. The backend decides whether a login exists
// (GANTRY_PASSWORD_HASH); with none, `authed` is simply true and nothing
// changes for a stock install.
import { writable, get } from 'svelte/store';

export const auth = writable({ checked: false, required: false, authed: false, misconfigured: false, username: null });

// Only same-app paths: never a full URL, protocol-relative `//host`, or back to /login.
export function safeReturnTo(v) {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/';
  if (v === '/login' || v.startsWith('/login?') || v.startsWith('/login/')) return '/';
  return v;
}

export function loginUrl(returnTo) {
  const r = safeReturnTo(returnTo);
  return r === '/' ? '/login' : `/login?return_to=${encodeURIComponent(r)}`;
}

export async function checkAuth(f = fetch) {
  const cfg = await f('/api/auth/config').then(r => r.json());
  if (!cfg.password_required) {
    auth.set({ checked: true, required: false, authed: true, misconfigured: false, username: null });
    return get(auth);
  }
  const me = await f('/api/auth/me');
  const body = me.ok ? await me.json() : {};
  auth.set({ checked: true, required: true, authed: me.ok, misconfigured: !!cfg.misconfigured, username: body.username ?? null });
  return get(auth);
}

export async function login(username, password, f = fetch) {
  const res = await f('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) {
    auth.update(a => ({ ...a, checked: true, authed: true, username: username.trim().toLowerCase() }));
    return { ok: true };
  }
  let detail = 'Login failed.';
  try { detail = (await res.json()).detail || detail; } catch {}
  return { ok: false, status: res.status, detail };
}

export async function logout(f = fetch) {
  await f('/api/auth/logout', { method: 'POST' }).catch(() => {});
  auth.update(a => ({ ...a, authed: false }));
}
