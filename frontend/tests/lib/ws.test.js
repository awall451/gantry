let sockets = [];
globalThis.WebSocket = class {
  constructor(url) { this.url = url; sockets.push(this); }
  addEventListener() {} close() {}
};
const { reconnectOrLogin } = await import('../../src/lib/ws.js');

describe('reconnectOrLogin', () => {
  beforeEach(() => { sockets = []; });

  it('session gone (401): sends the user to /login with return_to, no reconnect', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/routes', search: '?x=1', assign, protocol: 'http:', host: 'gantry.localhost' });
    await reconnectOrLogin(async () => ({ status: 401 }));
    expect(assign).toHaveBeenCalledWith('/login?return_to=%2Froutes%3Fx%3D1');
    expect(sockets).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe('reconnectOrLogin (session fine or backend down)', async () => {
  it('reconnects when /me is OK or unreachable', async () => {
    vi.resetModules();
    const ws = await import('../../src/lib/ws.js');
    vi.stubGlobal('location', { pathname: '/', search: '', assign: vi.fn(), protocol: 'http:', host: 'gantry.localhost' });
    await ws.reconnectOrLogin(async () => ({ status: 200 }));
    await ws.reconnectOrLogin(async () => { throw new Error('ECONNREFUSED'); });
    expect(sockets).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});
