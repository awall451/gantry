vi.mock('../../src/db', () => ({
  getEnabledRoutes: vi.fn(() => [])
}));

const { buildConfig } = require('../../src/caddy-client');

const BACKEND_PORT = process.env.PORT || 3001;
const LOG_FILE = process.env.LOG_PATH || '/logs/access.log';

function makeRoute(overrides = {}) {
  return {
    id: 1,
    container_id: 'abc123',
    container_name: 'myapp',
    hostname: 'myapp',
    target_port: 8080,
    enabled: 1,
    is_auto: 1,
    created_at: '2026-01-01',
    ...overrides
  };
}

describe('buildConfig', () => {
  it('is a function exported from caddy-client', () => {
    expect(typeof buildConfig).toBe('function');
  });

  describe('top-level shape', () => {
    it('returns an object with logging and apps keys', () => {
      const config = buildConfig([]);
      expect(config).toHaveProperty('logging');
      expect(config).toHaveProperty('apps');
    });

    it('configures access log writer with json encoder', () => {
      const config = buildConfig([]);
      expect(config.logging.logs.access).toEqual({
        writer: { output: 'file', filename: LOG_FILE },
        encoder: { format: 'json' },
        include: ['http.log.access.main']
      });
    });

    it('configures http server "main" listening on :80', () => {
      const config = buildConfig([]);
      const main = config.apps.http.servers.main;
      expect(main.listen).toEqual([':80']);
      expect(main.logs).toEqual({ logger_names: { '*': 'access' } });
    });
  });

  describe('routes array', () => {
    it('always contains the gantry.localhost route', () => {
      const routes = buildConfig([]).apps.http.servers.main.routes;
      expect(routes).toHaveLength(1);
      expect(routes[0]).toEqual({
        match: [{ host: ['gantry.localhost'] }],
        handle: [
          { handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${BACKEND_PORT}` }] }
        ]
      });
    });

    it('places gantry.localhost as the first route even when other routes exist', () => {
      const routes = buildConfig([makeRoute()]).apps.http.servers.main.routes;
      expect(routes[0].match[0].host).toEqual(['gantry.localhost']);
    });

    it('appends one Caddy route per input route after gantry', () => {
      const input = [makeRoute({ hostname: 'a', target_port: 1000 })];
      const routes = buildConfig(input).apps.http.servers.main.routes;
      expect(routes).toHaveLength(2);
      expect(routes[1]).toEqual({
        match: [{ host: ['a.localhost'] }],
        handle: [
          { handler: 'reverse_proxy', upstreams: [{ dial: 'localhost:1000' }] }
        ]
      });
    });

    it('preserves insertion order of input routes', () => {
      const input = [
        makeRoute({ hostname: 'alpha', target_port: 1 }),
        makeRoute({ hostname: 'bravo', target_port: 2 }),
        makeRoute({ hostname: 'charlie', target_port: 3 })
      ];
      const routes = buildConfig(input).apps.http.servers.main.routes;
      expect(routes.slice(1).map(r => r.match[0].host[0])).toEqual([
        'alpha.localhost',
        'bravo.localhost',
        'charlie.localhost'
      ]);
    });

    it('appends .localhost suffix to the route hostname', () => {
      const routes = buildConfig([makeRoute({ hostname: 'pingpong' })]).apps.http.servers.main.routes;
      expect(routes[1].match[0].host[0]).toBe('pingpong.localhost');
    });

    it('uses the route target_port verbatim in the upstream dial string', () => {
      const routes = buildConfig([makeRoute({ target_port: 5555 })]).apps.http.servers.main.routes;
      expect(routes[1].handle[0].upstreams[0].dial).toBe('localhost:5555');
    });

    it('does NOT filter by enabled flag (filtering is the DB layer\'s responsibility)', () => {
      const input = [makeRoute({ enabled: 0 })];
      const routes = buildConfig(input).apps.http.servers.main.routes;
      expect(routes).toHaveLength(2);
    });
  });

  describe('documented edge cases (current behavior)', () => {
    it('produces "localhost:null" when target_port is null (documents current behavior; consider fixing in a follow-up)', () => {
      const routes = buildConfig([makeRoute({ target_port: null })]).apps.http.servers.main.routes;
      expect(routes[1].handle[0].upstreams[0].dial).toBe('localhost:null');
    });

    it('produces "localhost:undefined" when target_port is undefined', () => {
      const routes = buildConfig([makeRoute({ target_port: undefined })]).apps.http.servers.main.routes;
      expect(routes[1].handle[0].upstreams[0].dial).toBe('localhost:undefined');
    });

    it('does NOT dedupe duplicate hostnames (Caddy would reject; consider validating earlier)', () => {
      const input = [
        makeRoute({ hostname: 'dup', target_port: 1 }),
        makeRoute({ hostname: 'dup', target_port: 2 })
      ];
      const routes = buildConfig(input).apps.http.servers.main.routes;
      expect(routes).toHaveLength(3);
      expect(routes[1].match[0].host[0]).toBe('dup.localhost');
      expect(routes[2].match[0].host[0]).toBe('dup.localhost');
    });
  });
});

describe('buildConfig with settings (domains)', () => {
  const base = { 'general.base_domain': 'localhost', 'tailscale.enabled': false, 'tailscale.domain': 'gantry.internal' };

  it('with tailscale off, output is byte-identical to the settings-less call', () => {
    const routes = [makeRoute({ hostname: 'a', target_port: 1 })];
    expect(buildConfig(routes, base)).toEqual(buildConfig(routes));
  });

  it('with tailscale on, every route matches both suffixes, base first', () => {
    const cfg = buildConfig([makeRoute({ hostname: 'a', target_port: 1 })], { ...base, 'tailscale.enabled': true });
    const routes = cfg.apps.http.servers.main.routes;
    expect(routes[0].match[0].host).toEqual(['gantry.localhost', 'gantry.gantry.internal']);
    expect(routes[1].match[0].host).toEqual(['a.localhost', 'a.gantry.internal']);
  });

  it('honors a non-default base domain', () => {
    const cfg = buildConfig([makeRoute({ hostname: 'a' })], { ...base, 'general.base_domain': 'lab.test' });
    expect(cfg.apps.http.servers.main.routes[1].match[0].host).toEqual(['a.lab.test']);
  });
});
