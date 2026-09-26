// Tiny authoritative DNS responder for ONE zone: `*.<domain>` → one IPv4.
//
// Why hand-rolled: the only job is "answer A queries for names under the
// Tailscale domain with this host's Tailscale IP" so Tailscale split DNS can
// point at Gantry directly — no dnsmasq, no extra container, no dependency.
// It answers nothing else: names outside the zone get REFUSED, non-A types
// under the zone get an empty NOERROR (so resolvers fall straight back to A
// instead of waiting on an AAAA that will never come).
//
// UDP only. Every answer is one 16-byte record, so truncation never happens
// and TCP fallback is never triggered.

const dgram = require('dgram');
const os = require('os');

const TYPE_A = 1;
const CLASS_IN = 1;
const RCODE_NOERROR = 0;
const RCODE_REFUSED = 5;

function encodeName(name) {
  const parts = [];
  for (const label of name.split('.').filter(Boolean)) {
    const b = Buffer.from(label, 'ascii');
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

// Parse the first question. Returns { name, qtype, qclass, end } or null.
// No compression pointers are expected in a question section.
function parseQuestion(buf) {
  let off = 12;
  const labels = [];
  while (off < buf.length) {
    const len = buf[off++];
    if (len === 0) break;
    if (len & 0xc0) return null; // compression in a question: not supported
    if (off + len > buf.length) return null;
    labels.push(buf.toString('ascii', off, off + len));
    off += len;
  }
  if (off + 4 > buf.length) return null;
  return {
    name: labels.join('.').toLowerCase(),
    qtype: buf.readUInt16BE(off),
    qclass: buf.readUInt16BE(off + 2),
    end: off + 4,
  };
}

function inZone(name, domain) {
  return name === domain || name.endsWith(`.${domain}`);
}

// Build the response to one query packet. Returns null when the packet is
// not a query we should answer at all (malformed, already a response).
function buildResponse(buf, { domain, ip, ttl = 60 }) {
  if (buf.length < 12) return null;
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return null; // QR set: it's a response, not a query
  if (buf.readUInt16BE(4) < 1) return null;
  const q = parseQuestion(buf);
  if (!q) return null;

  const zone = domain.toLowerCase();
  const matches = inZone(q.name, zone);
  const answer = matches && q.qtype === TYPE_A && q.qclass === CLASS_IN;

  const header = Buffer.alloc(12);
  header.writeUInt16BE(buf.readUInt16BE(0), 0);
  // QR=1, opcode copied, AA=1 when in our zone, RD copied, RA=0
  let rflags = 0x8000 | (flags & 0x7800) | (flags & 0x0100);
  if (matches) rflags |= 0x0400;
  rflags |= matches ? RCODE_NOERROR : RCODE_REFUSED;
  header.writeUInt16BE(rflags, 2);
  header.writeUInt16BE(1, 4);                 // QDCOUNT: echo the question
  header.writeUInt16BE(answer ? 1 : 0, 6);    // ANCOUNT

  const question = buf.subarray(12, q.end);
  if (!answer) return Buffer.concat([header, question]);

  const rr = Buffer.alloc(16);
  rr.writeUInt16BE(0xc00c, 0);   // name: pointer to offset 12 (the question)
  rr.writeUInt16BE(TYPE_A, 2);
  rr.writeUInt16BE(CLASS_IN, 4);
  rr.writeUInt32BE(ttl, 6);
  rr.writeUInt16BE(4, 10);
  const octets = ip.split('.').map(Number);
  for (let i = 0; i < 4; i++) rr[12 + i] = octets[i];
  return Buffer.concat([header, question, rr]);
}

// Tailscale hands out IPv4s from the CGNAT block 100.64.0.0/10.
function isCgnat(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

// Find this host's Tailscale IPv4 from os.networkInterfaces() (injectable
// for tests). Named interface first (Linux `tailscale0`), then any CGNAT
// address (macOS `utun*`, Windows). null when Tailscale isn't up.
function pickTailscaleIp(ifaces = os.networkInterfaces()) {
  const v4 = a => a.family === 'IPv4' || a.family === 4;
  for (const [iface, addrs] of Object.entries(ifaces)) {
    if (!iface.startsWith('tailscale')) continue;
    const a = (addrs || []).find(v4);
    if (a) return { ip: a.address, iface };
  }
  for (const [iface, addrs] of Object.entries(ifaces)) {
    const a = (addrs || []).find(x => v4(x) && isCgnat(x.address));
    if (a) return { ip: a.address, iface };
  }
  return null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
// One socket at a time. state is what the Settings page shows.

let socket = null;
let state = { running: false, bind: null, error: null };

function getState() {
  return { ...state };
}

function stop() {
  return new Promise(resolve => {
    if (!socket) { state = { running: false, bind: null, error: null }; return resolve(); }
    const s = socket;
    socket = null;
    s.close(() => {
      state = { running: false, bind: null, error: null };
      resolve();
    });
  });
}

// (Re)start on `${ip}:${port}` for `domain`. Resolves once bound or failed;
// failure is recorded in state (EACCES/EADDRINUSE/EADDRNOTAVAIL are the
// expected ones) rather than thrown — the HTTP API still has to answer.
async function start({ domain, ip, port }) {
  await stop();
  const bind = `${ip}:${port}`;
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    s.on('error', err => {
      console.error(`[dns] ${bind}: ${err.message}`);
      state = { running: false, bind, error: err.message };
      try { s.close(); } catch {}
      if (socket === s) socket = null;
      resolve(state);
    });
    s.on('message', (msg, rinfo) => {
      const res = buildResponse(msg, { domain, ip });
      if (res) s.send(res, rinfo.port, rinfo.address);
    });
    s.bind(port, ip, () => {
      socket = s;
      state = { running: true, bind, error: null };
      console.log(`[dns] answering *.${domain} → ${ip} on ${bind}`);
      resolve(state);
    });
  });
}

module.exports = { buildResponse, encodeName, parseQuestion, pickTailscaleIp, start, stop, getState };
