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
    });

    // Caddy's logger_names map is keyed by hostname and a bare '*' only matches
    // single-label hosts, so multi-label hosts (every *.localhost route) fell
    // through to the unnamed http.log.access logger and the file log's
    // `include` never matched — the access log stayed empty and the Proxy
    // Traffic analytics never populated. default_logger_name applies to every
    // host and must line up with the logging.include entry for that server.
    it('routes every host of server "main" to the logger the file log includes', () => {
      const config = buildConfig([]);
      const main = config.apps.http.servers.main;
      expect(main.logs).toEqual({ default_logger_name: 'main' });
      expect(config.logging.logs.access.include).toContain('http.log.access.main');
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
    // UI route also carries the bare tailscale domain (see 'apex domain' below).
    expect(routes[0].match[0].host).toEqual(['gantry.localhost', 'gantry.gantry.internal', 'gantry.internal']);
    expect(routes[1].match[0].host).toEqual(['a.localhost', 'a.gantry.internal']);
  });

  it('honors a non-default base domain', () => {
    const cfg = buildConfig([makeRoute({ hostname: 'a' })], { ...base, 'general.base_domain': 'lab.test' });
    expect(cfg.apps.http.servers.main.routes[1].match[0].host).toEqual(['a.lab.test']);
  });
});

describe('apex domain', () => {
  const base = { 'general.base_domain': 'localhost', 'tailscale.enabled': false, 'tailscale.domain': 'gantry.internal' };

  it('serves the Gantry UI on the bare tailscale domain when tailscale is on', () => {
    const cfg = buildConfig([], { ...base, 'tailscale.enabled': true });
    expect(cfg.apps.http.servers.main.routes[0].match[0].host)
      .toEqual(['gantry.localhost', 'gantry.gantry.internal', 'gantry.internal']);
  });

  it('does not add any apex host when tailscale is off (stock output unchanged)', () => {
    const cfg = buildConfig([], base);
    expect(cfg.apps.http.servers.main.routes[0].match[0].host).toEqual(['gantry.localhost']);
  });
});

describe('TLS (tls.enabled)', () => {
  const ts = {
    'general.base_domain': 'localhost', 'tailscale.enabled': true, 'tailscale.domain': 'lab.example.com',
    'tls.enabled': true, 'tls.acme_email': 'ops@example.com', 'tls.redirect_http': true,
  };

  it('stock settings: no :443 server, no tls app, automatic HTTPS disabled so Caddy never self-issues for *.localhost', () => {
    const cfg = buildConfig([]);
    expect(Object.keys(cfg.apps.http.servers)).toEqual(['main']);
    expect(cfg.apps.tls).toBeUndefined();
    expect(cfg.apps.http.servers.main.automatic_https).toEqual({ disable: true, disable_redirects: true });
  });

  it('tailscale on but tls off: still no :443 server', () => {
    const cfg = buildConfig([], { ...ts, 'tls.enabled': false });
    expect(Object.keys(cfg.apps.http.servers)).toEqual(['main']);
    expect(cfg.apps.tls).toBeUndefined();
  });

  it('tls on: adds a :443 server with the same routes and a TLS connection policy', () => {
    const cfg = buildConfig([makeRoute({ hostname: 'a', target_port: 1 })], ts);
    const { main, tls } = cfg.apps.http.servers;
    expect(main.listen).toEqual([':80']);
    expect(tls.listen).toEqual([':443']);
    expect(tls.tls_connection_policies).toEqual([{}]);
    expect(tls.automatic_https).toEqual({ disable: true, disable_redirects: true });
    // proxy routes identical on both servers
    const proxyRoutes = s => s.routes.filter(r => r.handle[0].handler === 'reverse_proxy');
    expect(proxyRoutes(tls)).toEqual(proxyRoutes(main));
    expect(proxyRoutes(tls)[1].match[0].host).toEqual(['a.localhost', 'a.lab.example.com']);
  });

  it('tls on: manages the wildcard + apex via ACME DNS-01 (cloudflare, token from env)', () => {
    const cfg = buildConfig([], ts);
    expect(cfg.apps.tls).toEqual({
      // `automate` is what makes Caddy obtain these at load; with automatic
      // HTTPS off, policy subjects alone would never trigger issuance.
      certificates: { automate: ['lab.example.com', '*.lab.example.com'] },
      automation: {
        policies: [{
          subjects: ['lab.example.com', '*.lab.example.com'],
          issuers: [{
            module: 'acme',
            email: 'ops@example.com',
            challenges: {
              dns: {
                provider: { name: 'cloudflare', api_token: '{env.CLOUDFLARE_API_TOKEN}' },
                resolvers: ['1.1.1.1', '8.8.8.8'],
              },
            },
          }],
        }],
      },
    });
  });

  it('tls on: the :443 server logs to its own named logger, included by the file log', () => {
    const cfg = buildConfig([], ts);
    expect(cfg.apps.http.servers.tls.logs).toEqual({ default_logger_name: 'tls' });
    expect(cfg.logging.logs.access.include).toEqual(['http.log.access.main', 'http.log.access.tls']);
  });

  it('tls on, no email: omits the email field rather than sending an empty string', () => {
    const cfg = buildConfig([], { ...ts, 'tls.acme_email': '' });
    expect(cfg.apps.tls.automation.policies[0].issuers[0]).not.toHaveProperty('email');
  });

  it('redirect on: first :80 route 308s the tailscale hosts to https, localhost untouched', () => {
    const cfg = buildConfig([makeRoute()], ts);
    const first = cfg.apps.http.servers.main.routes[0];
    expect(first.match).toEqual([{ host: ['lab.example.com', '*.lab.example.com'] }]);
    expect(first.handle).toEqual([{
      handler: 'static_response',
      status_code: 308,
      headers: { Location: ['https://{http.request.host}{http.request.uri}'] },
    }]);
    // the :443 server must NOT carry the redirect (loop)
    expect(cfg.apps.http.servers.tls.routes[0].handle[0].handler).toBe('reverse_proxy');
  });

  it('redirect off: no redirect route, plain http still served on the tailscale domain', () => {
    const cfg = buildConfig([makeRoute()], { ...ts, 'tls.redirect_http': false });
    expect(cfg.apps.http.servers.main.routes[0].handle[0].handler).toBe('reverse_proxy');
    expect(cfg.apps.http.servers.main.routes[0].match[0].host).toContain('gantry.lab.example.com');
  });
});
