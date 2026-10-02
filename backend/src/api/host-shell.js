// /api/host-shell — mounted behind requireAuth. `unlock` needs the Linux
// username, the password again, and the authenticator code when
// GANTRY_TOTP_SECRET is set; it returns a one-time ticket for /ws/host.
const { Router } = require('express');
const crypto = require('crypto');
const pw = require('../auth/password');
const sessions = require('../auth/sessions');
const { COOKIE, config: authConfig, readCookie } = require('../auth/guard');
const hs = require('../host-shell');
const totp = require('../auth/totp');

const router = Router();

// Constant-time string equality (hash first so lengths always match).
const sameText = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

// One replay-guarding verifier per secret (a new secret starts fresh).
let verifierFor = { secret: null, v: null };
function totpVerifier(secret) {
  if (verifierFor.secret !== secret) verifierFor = { secret, v: totp.verifier() };
  return verifierFor.v;
}

router.get('/status', (_req, res) => {
  res.json(hs.availability(hs.hostShellConfig(), authConfig()));
});

router.post('/unlock', async (req, res) => {
  const auth = authConfig();
  const status = hs.availability(hs.hostShellConfig(), auth);
  if (!status.enabled) return res.status(404).json({ detail: 'host terminal is off' });
  if (!status.available) return res.status(409).json({ detail: status.reason });
  if (!req.is('application/json')) return res.status(415).json({ detail: 'expected application/json' });

  // A browser session only: the MCP's Bearer token never opens a host shell.
  const token = readCookie(req.headers.cookie, COOKIE);
  if (!sessions.isValidSession(token, auth.hash)) return res.status(403).json({ detail: 'log in from a browser to open the host terminal' });

  const wait = pw.lockedFor();
  if (wait) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ detail: `too many failed attempts; try again in ${wait}s`, retry_after: wait });
  }
  const cfg = hs.hostShellConfig();
  // Three things to know: the Linux username (never shown by the UI), the
  // Gantry password, and, with GANTRY_TOTP_SECRET, an authenticator code.
  // The password is always checked (scrypt, constant cost) and the username
  // compare is constant-time. The code is only checked when both are right,
  // so a wrong guess cannot use up the current code. One message covers every
  // failure, so a guess never learns which part was wrong.
  const pwOk = await pw.verifyPassword(String(req.body?.password ?? ''), auth.hash);
  const userOk = sameText(String(req.body?.username ?? '').trim(), cfg.user);
  const codeOk = !cfg.totpSecret || (pwOk && userOk && totpVerifier(cfg.totpSecret).check(cfg.totpSecret, req.body?.code));
  if (!(pwOk && userOk && codeOk)) {
    pw.recordFailure();
    const which = !userOk ? 'username' : !pwOk ? 'password' : 'code';
    console.warn(`[host-shell] failed unlock (${which}) from ${req.ip}`);
    return res.status(401).json({ detail: cfg.totpSecret ? 'wrong username, password or code' : 'wrong username or password' });
  }
  pw.resetAttempts();
  res.json({ ticket: hs.issueTicket(token) });
});

// Extra check for /ws/host, after the normal upgrade guard has passed.
// null = go ahead, else the HTTP status to refuse with.
function refuseHostUpgrade(req) {
  if (!hs.availability(hs.hostShellConfig(), authConfig()).available) return 404;
  const ticket = new URL(req.url, 'http://x').searchParams.get('ticket');
  return hs.redeemTicket(ticket, readCookie(req.headers.cookie, COOKIE)) ? null : 403;
}

module.exports = router;
module.exports.refuseHostUpgrade = refuseHostUpgrade;
