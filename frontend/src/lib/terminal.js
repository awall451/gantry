// xterm.js ↔ WebSocket glue shared by the container Terminal tab and the host
// terminal. Protocol: binary/text frames are terminal I/O; a JSON
// {"type":"resize",cols,rows} frame is the only control message.
let xterm; // lazily imported once

async function loadXterm() {
  if (!xterm) {
    const [x, fit] = await Promise.all([import('xterm'), import('@xterm/addon-fit')]);
    await import('xterm/css/xterm.css');
    xterm = { Terminal: x.Terminal, FitAddon: fit.FitAddon };
  }
  return xterm;
}

export function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

// Opens a terminal in `el` wired to the socket at `path` (a function of the
// initial size, so the server can start the pty at the right size).
// Returns { close } ; `onClose` fires once when the socket ends.
export async function openTerminal(el, path, { onClose } = {}) {
  const { Terminal, FitAddon } = await loadXterm();
  const term = new Terminal({ cursorBlink: true, theme: { background: '#0f1117', foreground: '#e2e8f0' } });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(el);
  fitAddon.fit();

  const ws = new WebSocket(wsUrl(typeof path === 'function' ? path({ cols: term.cols, rows: term.rows }) : path));
  ws.binaryType = 'arraybuffer';
  const sendSize = () => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };
  ws.onopen = () => { sendSize(); term.focus(); };
  ws.onmessage = e => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
  let closed = false;
  ws.onclose = () => {
    term.write('\r\n[disconnected]\r\n');
    if (!closed) { closed = true; onClose?.(); }
  };

  term.onData(d => { if (ws.readyState === 1) ws.send(d); });
  term.onResize(sendSize);
  const ro = new ResizeObserver(() => fitAddon.fit());
  ro.observe(el);

  return {
    close() {
      closed = true;
      ro.disconnect();
      ws.close();
      term.dispose();
    },
  };
}
