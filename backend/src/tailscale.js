// Turns the saved settings into running state: Caddy host matchers and the
// DNS responder. This is the one place that decides what "Tailscale enabled"
// means at runtime, so the API, startup, and the Settings page all agree.
//
// dns-server is referenced through the module object (dns.start, not a
// destructured start) on purpose: it lets tests stub the socket without
// mocking the module graph.

const caddy = require('./caddy-client');
const dns = require('./dns-server');
const tlsStatus = require('./tls-status');
const { loadSettings } = require('./settings');

// Auto-detect unless the user pinned an IP.
function effectiveIp(settings) {
  if (settings['tailscale.ip']) return settings['tailscale.ip'];
  return dns.pickTailscaleIp()?.ip || '';
}

// Last apply's outcome for things that aren't the socket's own state.
let lastDnsError = null;

async function apply(settings = loadSettings()) {
  await caddy.pushConfig();

  const wantDns = settings['tailscale.enabled'] && settings['tailscale.dns_enabled'];
  if (!wantDns) {
    lastDnsError = null;
    await dns.stop();
    return status(settings);
  }

  const ip = effectiveIp(settings);
  if (!ip) {
    lastDnsError = 'no Tailscale IP: set one explicitly or check that Tailscale is up on this host';
    await dns.stop();
    return status(settings);
  }

  lastDnsError = null;
  await dns.start({ domain: settings['tailscale.domain'], ip, port: settings['tailscale.dns_port'] });
  return status(settings);
}

async function status(settings = loadSettings()) {
  const dnsState = dns.getState();
  const tlsOn = settings['tailscale.enabled'] && settings['tls.enabled'];
  // Anything bound to a specific address on :443 beats Caddy's 0.0.0.0 bind
  // for that address, silently. Surface it so the user can free the port.
  const conflicts = tlsStatus.listenersOn(443).filter(ip => ip !== '0.0.0.0');
  return {
    tailscale: {
      detected: dns.pickTailscaleIp(),
      effectiveIp: effectiveIp(settings),
    },
    dns: lastDnsError ? { ...dnsState, error: lastDnsError } : dnsState,
    tls: {
      tokenPresent: tlsStatus.tokenPresent(),
      conflicts,
      cert: tlsOn ? await tlsStatus.probeCert({ domain: settings['tailscale.domain'] }) : null,
    },
  };
}

module.exports = { apply, status, effectiveIp };
