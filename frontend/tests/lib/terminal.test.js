// lib/terminal.js with xterm and WebSocket faked: lifecycle only.
const writes = [];
let disposed = 0;
vi.mock('xterm', () => ({
  Terminal: class {
    constructor() { this.cols = 80; this.rows = 24; }
    loadAddon() {} open() {} focus() {}
    write(d) { if (this.gone) throw new Error('write after dispose'); writes.push(d); }
    dispose() { this.gone = true; disposed++; }
    onData() {} onResize() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('xterm/css/xterm.css', () => ({}));

let sockets;
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
  send() {}
  close() { this.readyState = 3; this.onclose?.(); }
}
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const { openTerminal } = await import('../../src/lib/terminal.js');

beforeEach(() => { sockets = []; writes.length = 0; disposed = 0; globalThis.WebSocket = FakeWS; });

describe('openTerminal', () => {
  it('builds the URL from the initial size', async () => {
    await openTerminal(document.createElement('div'), ({ cols, rows }) => `/ws/host?cols=${cols}&rows=${rows}`);
    expect(sockets[0].url).toMatch(/\/ws\/host\?cols=80&rows=24$/);
  });

  it('server close: writes [disconnected] once and hands onClose a handle that disposes', async () => {
    const onClose = vi.fn(h => h.close());
    await openTerminal(document.createElement('div'), '/ws/x', { onClose });
    sockets[0].onclose(); // server ended it
    sockets[0].onclose(); // duplicate event
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(writes.filter(w => String(w).includes('[disconnected]'))).toHaveLength(1);
    expect(disposed).toBe(1);
  });

  it('our own close(): no write to the disposed terminal, no onClose, idempotent', async () => {
    const onClose = vi.fn();
    const h = await openTerminal(document.createElement('div'), '/ws/x', { onClose });
    h.close();  // FakeWS fires onclose synchronously, after dispose
    h.close();
    expect(onClose).not.toHaveBeenCalled();
    expect(disposed).toBe(1);
    expect(writes).toHaveLength(0);
  });
});
