import { loginUrl } from './auth';
import { writable } from 'svelte/store';

export const wsMessage = writable(null);
export const statsStore = writable({});
export const containerEventMessage = writable(null);

let socket;
let reconnectTimer;

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function wsSend(data) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

let stopped = false;

export function connectWs() {
  clearTimeout(reconnectTimer);
  stopped = false;
  socket = new WebSocket(getWsUrl());

  socket.addEventListener('message', e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'stats:update' || msg.type === 'stats:unavailable') {
        statsStore.update(s => ({ ...s, [msg.id]: msg }));
      } else if (msg.type === 'container:event') {
        containerEventMessage.set(msg);
      } else {
        wsMessage.set(msg);
      }
    } catch {}
  });

  socket.addEventListener('close', () => {
    if (!stopped) reconnectTimer = setTimeout(reconnectOrLogin, 3000);
  });

  socket.addEventListener('error', () => socket.close());
}

// A refused handshake looks like any other close. Before retrying, ask
// whether the session is still good: if it expired (or the password was
// changed), go to the login page instead of retrying every 3 s forever.
// Backend unreachable → keep retrying as before.
export async function reconnectOrLogin(f = fetch) {
  if (stopped) return;
  try {
    const res = await f('/api/auth/me');
    if (res.status === 401) {
      stopped = true;
      if (typeof location !== 'undefined') location.assign(loginUrl(location.pathname + location.search));
      return;
    }
  } catch {}
  if (!stopped) connectWs();
}

// Logout: close for good (no reconnect loop against a socket that now 401s).
export function disconnectWs() {
  stopped = true;
  clearTimeout(reconnectTimer);
  socket?.close();
}
