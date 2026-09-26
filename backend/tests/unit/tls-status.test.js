const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { probeCert, parseProcTcp, tokenPresent } = require('../../src/tls-status');

const FIX = p => fs.readFileSync(path.join(__dirname, '../fixtures', p));

describe('probeCert', () => {
  let server, port;
  beforeAll(() => new Promise(resolve => {
    server = tls.createServer({ key: FIX('selfsigned.key'), cert: FIX('selfsigned.pem') });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  }));
  afterAll(() => new Promise(r => server.close(r)));

  it('reports subject, issuer, expiry and days left for the served certificate', async () => {
    const r = await probeCert({ domain: 'a.lab.example.com', host: '127.0.0.1', port });
    expect(r.error).toBeUndefined();
    expect(r.subject).toBe('lab.example.com');
    expect(r.issuer).toBe('lab.example.com'); // self-signed
    expect(r.daysLeft).toBeGreaterThan(3000);
    expect(r.validTo).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(r.selfSigned).toBe(true);
  });

  it('returns an error (not a throw) when nothing listens', async () => {
    const r = await probeCert({ domain: 'a.lab.example.com', host: '127.0.0.1', port: 1 });
    expect(r.error).toMatch(/ECONNREFUSED/);
  });
});

describe('parseProcTcp', () => {
  // /proc/net/tcp: "sl local_address rem_address st ..." — addresses are
  // little-endian hex IP:hex port, st 0A = LISTEN.
  const sample = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0F7A4564:01BB 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12346 1 0000000000000000 100 0 0 10 0
   2: 0100007F:01BB 0100007F:C350 01 00000000:00000000 00:00000000 00000000     0        0 12347 1 0000000000000000 100 0 0 10 0
`;

  it('lists LISTEN sockets on the given port with decoded IPv4 addresses', () => {
    expect(parseProcTcp(sample, 443)).toEqual(['100.69.122.15']);
    expect(parseProcTcp(sample, 80)).toEqual(['0.0.0.0']);
  });

  it('ignores established (non-LISTEN) sockets', () => {
    expect(parseProcTcp(sample, 443)).not.toContain('127.0.0.1');
  });
});

describe('tokenPresent', () => {
  it('is true only for a non-blank CLOUDFLARE_API_TOKEN', () => {
    expect(tokenPresent({ CLOUDFLARE_API_TOKEN: 'x' })).toBe(true);
    expect(tokenPresent({ CLOUDFLARE_API_TOKEN: '  ' })).toBe(false);
    expect(tokenPresent({})).toBe(false);
  });
});
