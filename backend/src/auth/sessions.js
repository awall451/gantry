// Server-side login sessions. The cookie carries a random 256-bit token; the
// DB keeps only its SHA-256 (a high-entropy token needs no HMAC key).
const crypto = require('crypto');
const { getDb } = require('../db');

const sha256 = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// Fingerprint of the configured password hash; sessions only count while it matches.
const fingerprint = passwordHash => sha256(`gantry-session:${passwordHash}`).slice(0, 16);

function createSession(ttlMs, passwordHash, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  getDb().prepare('INSERT INTO sessions (token_hash, pw_fp, issued_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), fingerprint(passwordHash), new Date(now).toISOString(), new Date(now + ttlMs).toISOString());
  // Opportunistic cleanup: nothing else ever reads expired rows.
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(now).toISOString());
  return token;
}

function isValidSession(token, passwordHash, now = Date.now()) {
  if (!token || typeof token !== 'string' || token.length > 128) return false;
  const row = getDb().prepare('SELECT pw_fp, expires_at, revoked_at FROM sessions WHERE token_hash = ?').get(sha256(token));
  return !!row && !row.revoked_at && row.pw_fp === fingerprint(passwordHash)
    && new Date(row.expires_at).getTime() > now;
}

function revokeSession(token, now = Date.now()) {
  if (!token) return;
  getDb().prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(new Date(now).toISOString(), sha256(token));
}

module.exports = { createSession, isValidSession, revokeSession, sha256 };
