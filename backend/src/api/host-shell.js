// /api/host-shell — mounted behind requireAuth. `unlock` re-checks the
// password and returns a one-time ticket for /ws/host.
const { Router } = require('express');
const pw = require('../auth/password');
const sessions = require('../auth/sessions');
const { COOKIE, config: authConfig, readCookie } = require('../auth/guard');
const hs = require('../host-shell');

const router = Router();

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
  if (!(await pw.verifyPassword(String(req.body?.password ?? ''), auth.hash))) {
    pw.recordFailure();
    console.warn(`[host-shell] wrong password on unlock from ${req.ip}`);
    return res.status(401).json({ detail: 'wrong password' });
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
