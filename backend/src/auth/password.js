// Login password: scrypt hashing (Node's built-in crypto, no dependency) and a
// small failed-login throttle. Mirrors hide-a-key's local mode.
//
// Hash format is self-describing so the cost can be raised later without
// invalidating existing hashes, and uses `:` rather than `$` so a hash pasted
// into .env is never mangled by docker compose's `$` interpolation:
//
//     scrypt:<N>:<r>:<p>:<salt b64>:<key b64>
//
// Generate one with scripts/set-password.sh, or
//     printf '%s\n' 'the password' | node src/auth/password.js --stdin
//
// The throttle is process-global, not per client: there is one account, and
// behind Caddy every client arrives from 127.0.0.1 anyway.
const crypto = require('crypto');

const N = 2 ** 15, R = 8, P = 1;
const KEY_LEN = 32;
const MAXMEM = 64 * 1024 * 1024;
const MIN_LENGTH = 8;

const MAX_FAILURES = 5;
const WINDOW_MS = 300_000;
let failures = [];

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(password), salt, KEY_LEN, { N: n, r, p, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key))));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64')}:${key.toString('base64')}`;
}

// Throws unless `encoded` is a well-formed, strong-enough scrypt hash.
function parseHash(encoded) {
  const parts = String(encoded ?? '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') throw new Error('expected scrypt:<N>:<r>:<p>:<salt>:<key>');
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (!Number.isInteger(n) || n < 2 ** 14 || (n & (n - 1)) || !(r >= 1) || !(p >= 1)) {
    throw new Error('scrypt parameters too weak or invalid');
  }
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!b64.test(parts[4]) || !b64.test(parts[5])) throw new Error('salt/key are not base64');
  const salt = Buffer.from(parts[4], 'base64');
  const key = Buffer.from(parts[5], 'base64');
  if (salt.length < 16 || key.length !== KEY_LEN) throw new Error('bad salt or key length');
  return { n, r, p, salt, key };
}

function isValidHash(encoded) {
  try { parseHash(encoded); return true; } catch { return false; }
}

async function verifyPassword(password, encoded) {
  let h;
  try { h = parseHash(encoded); } catch { return false; }
  const key = await scrypt(password, h.salt, h.n, h.r, h.p);
  return crypto.timingSafeEqual(key, h.key);
}

// ── throttle ────────────────────────────────────────────────────────────────

function prune(now) {
  failures = failures.filter(t => now - t < WINDOW_MS);
}

// Seconds until another attempt is allowed; 0 when not locked.
function lockedFor(now = Date.now()) {
  prune(now);
  if (failures.length < MAX_FAILURES) return 0;
  return Math.max(1, Math.floor((WINDOW_MS - (now - failures[0])) / 1000) + 1);
}

function recordFailure(now = Date.now()) { failures.push(now); }
function resetAttempts() { failures = []; }

module.exports = {
  hashPassword, verifyPassword, parseHash, isValidHash,
  lockedFor, recordFailure, resetAttempts, MIN_LENGTH,
};

// CLI: read one line from stdin, print its hash.
if (require.main === module) {
  if (!process.argv.includes('--stdin')) {
    console.error("usage: printf '%s\\n' 'password' | node src/auth/password.js --stdin");
    process.exit(2);
  }
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', async () => {
    const pw = buf.split(/\r?\n/)[0];
    if (pw.length < MIN_LENGTH) { console.error(`use at least ${MIN_LENGTH} characters`); process.exit(1); }
    console.log(await hashPassword(pw));
  });
}
