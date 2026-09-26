const { buildResponse, encodeName, pickTailscaleIp } = require('../../src/dns-server');

// Minimal DNS query builder: header + one question.
function query(name, qtype = 1, id = 0x1234) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // RD
  header.writeUInt16BE(1, 4);      // QDCOUNT
  const q = Buffer.concat([encodeName(name), Buffer.from([0, qtype, 0, 1])]);
  return Buffer.concat([header, q]);
}

const opts = { domain: 'gantry.internal', ip: '100.69.122.15', ttl: 60 };

describe('encodeName', () => {
  it('encodes labels with length prefixes and a root terminator', () => {
    expect(encodeName('a.bc')).toEqual(Buffer.from([1, 0x61, 2, 0x62, 0x63, 0]));
  });
});

describe('buildResponse', () => {
  it('answers an A query under the domain with the tailscale ip', () => {
    const res = buildResponse(query('fleabook.gantry.internal'), opts);
    expect(res.readUInt16BE(0)).toBe(0x1234);           // id echoed
    expect(res.readUInt16BE(2) & 0x8000).toBe(0x8000);  // QR = response
    expect(res.readUInt16BE(2) & 0x0400).toBe(0x0400);  // AA = authoritative
    expect(res.readUInt16BE(2) & 0x000f).toBe(0);       // RCODE NOERROR
    expect(res.readUInt16BE(6)).toBe(1);                // ANCOUNT
    // answer = pointer to name @12, type A, class IN, ttl, rdlength 4, ip
    const q = query('fleabook.gantry.internal');
    const ans = res.subarray(q.length);
    expect(ans.subarray(0, 2)).toEqual(Buffer.from([0xc0, 0x0c]));
    expect(ans.readUInt16BE(2)).toBe(1);
    expect(ans.readUInt16BE(4)).toBe(1);
    expect(ans.readUInt32BE(6)).toBe(60);
    expect(ans.readUInt16BE(10)).toBe(4);
    expect([...ans.subarray(12, 16)]).toEqual([100, 69, 122, 15]);
  });

  it('answers the apex domain itself', () => {
    const res = buildResponse(query('gantry.internal'), opts);
    expect(res.readUInt16BE(6)).toBe(1);
  });

  it('matches case-insensitively', () => {
    const res = buildResponse(query('FleaBook.Gantry.INTERNAL'), opts);
    expect(res.readUInt16BE(6)).toBe(1);
  });

  it('returns NOERROR with no answer for AAAA under the domain (so clients fall back to A)', () => {
    const res = buildResponse(query('fleabook.gantry.internal', 28), opts);
    expect(res.readUInt16BE(2) & 0x000f).toBe(0);
    expect(res.readUInt16BE(6)).toBe(0);
  });

  it('returns REFUSED for names outside the domain', () => {
    const res = buildResponse(query('example.com'), opts);
    expect(res.readUInt16BE(2) & 0x000f).toBe(5);
    expect(res.readUInt16BE(6)).toBe(0);
  });

  it('does not treat a suffix-overlapping name as in-domain', () => {
    const res = buildResponse(query('notgantry.internal'), opts);
    expect(res.readUInt16BE(2) & 0x000f).toBe(5);
  });

  it('returns null for a packet too short to be a query', () => {
    expect(buildResponse(Buffer.from([1, 2, 3]), opts)).toBeNull();
  });

  it('returns null for a packet that is already a response', () => {
    const q = query('a.gantry.internal');
    q.writeUInt16BE(0x8100, 2);
    expect(buildResponse(q, opts)).toBeNull();
  });
});

describe('pickTailscaleIp', () => {
  it('prefers an interface named tailscale*', () => {
    const ifaces = {
      eth0: [{ family: 'IPv4', address: '10.1.10.5', internal: false }],
      tailscale0: [{ family: 'IPv4', address: '100.69.122.15', internal: false }],
    };
    expect(pickTailscaleIp(ifaces)).toEqual({ ip: '100.69.122.15', iface: 'tailscale0' });
  });

  it('falls back to any CGNAT 100.64/10 address (e.g. utun on macOS)', () => {
    const ifaces = {
      utun4: [{ family: 'IPv4', address: '100.100.1.2', internal: false }],
      eth0: [{ family: 'IPv4', address: '100.200.1.2', internal: false }], // outside 100.64/10
    };
    expect(pickTailscaleIp(ifaces)).toEqual({ ip: '100.100.1.2', iface: 'utun4' });
  });

  it('returns null when nothing looks like tailscale', () => {
    expect(pickTailscaleIp({ eth0: [{ family: 'IPv4', address: '10.0.0.1', internal: false }] })).toBeNull();
  });

  it('handles the numeric family form node 18.0-18.3 emitted', () => {
    expect(pickTailscaleIp({ tailscale0: [{ family: 4, address: '100.1.1.1', internal: false }] })).toEqual({ ip: '100.1.1.1', iface: 'tailscale0' });
  });
});

describe('start/stop (real UDP socket on loopback)', () => {
  const dgram = require('dgram');
  const dns = require('../../src/dns-server');

  afterEach(() => dns.stop());

  function ask(port, name) {
    return new Promise((resolve, reject) => {
      const c = dgram.createSocket('udp4');
      const t = setTimeout(() => { c.close(); reject(new Error('timeout')); }, 2000);
      c.on('message', msg => { clearTimeout(t); c.close(); resolve(msg); });
      c.send(query(name), port, '127.0.0.1');
    });
  }

  it('binds, answers a query, reports running, and stops cleanly', async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const state = await dns.start({ domain: 'gantry.internal', ip: '127.0.0.1', port });
    expect(state).toEqual({ running: true, bind: `127.0.0.1:${port}`, error: null });

    const res = await ask(port, 'x.gantry.internal');
    expect(res.readUInt16BE(6)).toBe(1);
    expect([...res.subarray(res.length - 4)]).toEqual([127, 0, 0, 1]);

    await dns.stop();
    expect(dns.getState()).toEqual({ running: false, bind: null, error: null });
  });

  it('records a bind failure in state instead of throwing', async () => {
    const state = await dns.start({ domain: 'gantry.internal', ip: '192.0.2.1', port: 20053 }); // TEST-NET, never local
    expect(state.running).toBe(false);
    expect(state.error).toMatch(/EADDRNOTAVAIL/);
  });

  it('restart replaces the previous socket', async () => {
    const p1 = 20000 + Math.floor(Math.random() * 20000);
    const p2 = p1 + 1;
    await dns.start({ domain: 'a.internal', ip: '127.0.0.1', port: p1 });
    await dns.start({ domain: 'a.internal', ip: '127.0.0.1', port: p2 });
    expect(dns.getState().bind).toBe(`127.0.0.1:${p2}`);
    await expect(ask(p1, 'x.a.internal')).rejects.toThrow('timeout');
  });
});
