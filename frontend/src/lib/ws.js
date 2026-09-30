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
    if (!stopped) reconnectTimer = setTimeout(connectWs, 3000);
  });

  socket.addEventListener('error', () => socket.close());
}

// Logout: close for good (no reconnect loop against a socket that now 401s).
export function disconnectWs() {
  stopped = true;
  clearTimeout(reconnectTimer);
  socket?.close();
}
