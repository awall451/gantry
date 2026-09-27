vi.mock('../../src/db', () => ({ recordAnalytics: vi.fn() }));
vi.mock('tail', () => ({ Tail: vi.fn() }));

const { parseAccessLine } = require('../../src/log-tail');

const now = new Date('2026-09-27T23:10:00Z');
const entry = (over = {}) => JSON.stringify({
  request: { host: 'app.localhost', uri: '/', headers: {} },
  status: 200,
  duration: 0.0125,
  resp_headers: { 'Content-Type': ['text/html'] },
  ...over,
});

describe('parseAccessLine', () => {
  it('turns a Caddy access entry into an analytics row bucketed by hour', () => {
    expect(parseAccessLine(entry(), now)).toEqual({
      hostname: 'app.localhost', hour: '2026-09-27T23', status: 200, duration_ms: 12.5,
    });
  });

  it('strips the port from the host', () => {
    expect(parseAccessLine(entry({ request: { host: 'app.localhost:8080', headers: {} } }), now).hostname)
      .toBe('app.localhost');
  });

  it('ignores lines that are not JSON or lack host/status', () => {
    expect(parseAccessLine('not json', now)).toBeNull();
    expect(parseAccessLine(JSON.stringify({ status: 200 }), now)).toBeNull();
    expect(parseAccessLine(JSON.stringify({ request: { host: 'a' } }), now)).toBeNull();
  });

  // A WebSocket upgrade or an SSE stream is logged once when it closes, with
  // a duration equal to how long the tab was open — minutes or hours. One of
  // them drags the hourly average from ~20 ms to seconds, so they are not
  // requests for analytics purposes.
  it('drops WebSocket upgrades (101 / Upgrade header)', () => {
    expect(parseAccessLine(entry({ status: 101, duration: 466 }), now)).toBeNull();
    expect(parseAccessLine(entry({
      status: 200, duration: 30,
      request: { host: 'app.localhost', headers: { Upgrade: ['websocket'] } },
    }), now)).toBeNull();
  });

  it('drops server-sent event streams', () => {
    expect(parseAccessLine(entry({
      duration: 120, resp_headers: { 'Content-Type': ['text/event-stream'] },
    }), now)).toBeNull();
  });
});
