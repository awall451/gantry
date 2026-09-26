// Read-only checks behind the HTTPS block on the Settings page. None of
// these change anything; they answer "is it actually working?" for the
// three things that can silently go wrong: no token, no certificate yet,
// and someone else already holding :443 on the Tailscale IP.

const tls = require('tls');
const fs = require('fs');

// Connect to Caddy locally with SNI for the Tailscale domain and read back
// whatever certificate it serves. Resolves to a summary or { error }.
function probeCert({ domain, host = '127.0.0.1', port = 443, timeoutMs = 2500 }) {
  return new Promise(resolve => {
    const socket = tls.connect({ host, port, servername: domain, rejectUnauthorized: false }, () => {
      const c = socket.getPeerCertificate();
      socket.destroy();
      if (!c || !c.subject) return resolve({ error: 'no certificate served' });
      const validTo = new Date(c.valid_to);
      const subject = c.subject.CN || '';
      const issuer = c.issuer.CN || c.issuer.O || '';
      resolve({
        subject,
        issuer,
        validTo: validTo.toISOString(),
        daysLeft: Math.floor((validTo - Date.now()) / 86_400_000),
        selfSigned: subject === issuer,
      });
    });
    socket.setTimeout(timeoutMs, () => { socket.destroy(); resolve({ error: 'timeout' }); });
    socket.on('error', err => resolve({ error: err.message }));
  });
}

// /proc/net/tcp lines: "sl local_address rem_address st ..." with
// local_address as little-endian hex IPv4 + hex port. st 0A = LISTEN.
function parseProcTcp(text, port) {
  const out = [];
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[3] !== '0A') continue;
    const [hexIp, hexPort] = cols[1].split(':');
    if (parseInt(hexPort, 16) !== port) continue;
    const ip = [6, 4, 2, 0].map(i => parseInt(hexIp.slice(i, i + 2), 16)).join('.');
    out.push(ip);
  }
  return out;
}

// Who is listening on :443, host-wide (the backend runs on the host network).
// Caddy binds 0.0.0.0; anything bound to a specific address wins for that
// address (e.g. `tailscale serve` on the Tailscale IP) and would swallow
// the tailnet's HTTPS traffic without any bind error.
function listenersOn(port) {
  try {
    return parseProcTcp(fs.readFileSync('/proc/net/tcp', 'utf8'), port);
  } catch {
    return [];
  }
}

function tokenPresent(env = process.env) {
  return Boolean((env.CLOUDFLARE_API_TOKEN || '').trim());
}

module.exports = { probeCert, parseProcTcp, listenersOn, tokenPresent };
