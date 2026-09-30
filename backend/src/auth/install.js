// Mount order matters and is shared by index.js and the tests:
// Host allowlist → Origin check → public /api/auth → everything else under
// /api needs a login (when one is configured). Static files stay public; the
// SPA shell holds no data and must load to show the login page.
const { hostGuard, originGuard, requireAuth } = require('./guard');

function installAuth(app) {
  app.set('trust proxy', 'loopback'); // Caddy runs on this host; trust its X-Forwarded-Proto
  app.use(hostGuard);
  app.use(originGuard);
  app.use('/api/auth', require('../api/auth'));
  app.use('/api', requireAuth);
}

module.exports = { installAuth };
