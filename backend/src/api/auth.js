// /api/auth — public by design (the guard exempts it): the login page needs it.
const { Router } = require('express');
const crypto = require('crypto');
const pw = require('../auth/password');
const sessions = require('../auth/sessions');
const { COOKIE, config, readCookie, isAuthenticated } = require('../auth/guard');

const router = Router();
const BAD = 'invalid username or password';

function cookieFlags(req, maxAgeS) {
  // Secure only over https (Caddy's :443 sets X-Forwarded-Proto; see
  // `trust proxy` in index.js): *.localhost is plain http and must still work.
  return ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeS}`, ...(req.secure ? ['Secure'] : [])].join('; ');
}

router.get('/config', (_req, res) => {
  const cfg = config();
  res.json({ password_required: cfg.passwordRequired, misconfigured: cfg.misconfigured });
});

router.get('/me', (req, res) => {
  const cfg = config();
  if (!isAuthenticated(req, cfg)) return res.status(401).json({ detail: 'not authenticated' });
  res.json({ username: cfg.passwordRequired ? cfg.username : null, password_required: cfg.passwordRequired });
});

router.post('/login', async (req, res) => {
  const cfg = config();
  if (!cfg.passwordRequired) return res.status(404).json({ detail: 'login is not enabled' });
  // JSON only: an HTML form on another site cannot send this content type
  // without a CORS preflight, so it cannot even attempt a guess.
  if (!req.is('application/json')) return res.status(415).json({ detail: 'expected application/json' });

  const wait = pw.lockedFor();
  if (wait) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ detail: `too many failed attempts; try again in ${wait}s`, retry_after: wait });
  }

  const { username = '', password = '' } = req.body || {};
  // Always run scrypt, even for a wrong username, so timing reveals nothing.
  const pwOk = await pw.verifyPassword(String(password), cfg.hash);
  const a = crypto.createHash('sha256').update(String(username).trim().toLowerCase()).digest();
  const b = crypto.createHash('sha256').update(cfg.username.toLowerCase()).digest();
  const userOk = crypto.timingSafeEqual(a, b);

  if (!(pwOk && userOk)) {
    pw.recordFailure();
    console.warn(`[auth] failed login from ${req.ip}`);
    return res.status(401).json({ detail: BAD });
  }
  pw.resetAttempts();
  const token = sessions.createSession(cfg.ttlMs, cfg.hash);
  console.log(`[auth] login ok from ${req.ip}`);
  res.set('Set-Cookie', `${COOKIE}=${token}; ${cookieFlags(req, Math.floor(cfg.ttlMs / 1000))}`);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  sessions.revokeSession(readCookie(req.headers.cookie, COOKIE));
  res.set('Set-Cookie', `${COOKIE}=; ${cookieFlags(req, 0)}`);
  res.json({ ok: true });
});

module.exports = router;
