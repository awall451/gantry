// TOTP (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits) on Node's built-in
// crypto. Works offline: the authenticator app and this server each derive
// the code from the shared secret and the clock, so nothing leaves the
// tailnet. Used as the second factor for unlocking the host terminal.
//
// CLI (used by scripts/set-password.sh):
//   node src/auth/totp.js new                    print a fresh base32 secret
//   node src/auth/totp.js uri <secret> <account> print the otpauth:// URI
//   node src/auth/totp.js verify <secret> <code> exit 0 if the code is valid now
//   node src/auth/totp.js qr <text>              draw a QR code (needs qrcode-terminal)
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;
const DIGITS = 6;

const clean = s => String(s ?? '').toUpperCase().replace(/[\s=-]/g, '');

function base32Decode(input) {
  const s = clean(input);
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// At least 80 bits, per RFC 4226's minimum.
function isValidSecret(secret) {
  try { return base32Decode(secret).length >= 10; } catch { return false; }
}

function newSecret() { return base32Encode(crypto.randomBytes(20)); }

function codeAtStep(key, step, digits) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = h.readUInt32BE(off) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

function codeAt(secret, nowMs = Date.now(), { digits = DIGITS } = {}) {
  return codeAtStep(base32Decode(secret), Math.floor(nowMs / STEP_MS), digits);
}

// A verifier remembers the last step it accepted, so a code (or anything
// older) cannot be replayed. One per secret; in memory, so a restart within
// the ±30 s window could accept a just-used code once more.
function verifier() {
  let lastStep = -1;
  return {
    check(secret, code, nowMs = Date.now()) {
      const typed = String(code ?? '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(typed) || !isValidSecret(secret)) return false;
      const key = base32Decode(secret);
      const now = Math.floor(nowMs / STEP_MS);
      for (const step of [now - 1, now, now + 1]) {
        if (step <= lastStep) continue;
        const want = Buffer.from(codeAtStep(key, step, DIGITS));
        if (crypto.timingSafeEqual(want, Buffer.from(typed))) { lastStep = step; return true; }
      }
      return false;
    },
  };
}

function otpauthUri(secret, { account, issuer = 'Gantry' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${clean(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_MS / 1000}`;
}

module.exports = { newSecret, isValidSecret, codeAt, verifier, otpauthUri, base32Decode, base32Encode };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'new') console.log(newSecret());
  else if (cmd === 'uri' && a && b) console.log(otpauthUri(a, { account: b }));
  else if (cmd === 'verify' && a) process.exit(verifier().check(a, b) ? 0 : 1);
  else if (cmd === 'qr' && a) {
    let qr;
    try { qr = require('qrcode-terminal'); } catch { console.error('qrcode-terminal is not installed'); process.exit(3); }
    qr.generate(a, { small: true }, s => console.log(s));
  } else {
    console.error('usage: totp.js new | uri <secret> <account> | verify <secret> <code> | qr <text>');
    process.exit(2);
  }
}
