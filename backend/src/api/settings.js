const { Router } = require('express');
const { loadSettings, validate, saveSettings } = require('../settings');
const tailscale = require('../tailscale');

const router = Router();

function payload(values, status) {
  return { values, status };
}

router.get('/', async (_req, res) => {
  const values = loadSettings();
  res.json(payload(values, await tailscale.status(values)));
});

// Partial update. Validates the whole patch first so a bad field never
// leaves half a patch behind, then re-applies Caddy + DNS from the merged
// result. Runtime failures (DNS bind) are reported in status, not as an
// HTTP error — the setting itself did save.
router.put('/', async (req, res) => {
  const patch = req.body;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return res.status(400).json({ error: 'body must be an object of settings' });
  }
  const merged = { ...loadSettings(), ...patch };
  const { ok, errors } = validate({ ...patch, ...crossFields(merged, patch) });
  if (!ok) return res.status(400).json({ errors });

  const values = saveSettings(patch);
  const status = await tailscale.apply(values);
  req.broadcast({ type: 'settings:updated', values });
  res.json(payload(values, status));
});

// The base/tailscale domain collision check needs both sides even when the
// patch only carries one — feed validate() the merged pair.
function crossFields(merged, patch) {
  if ('general.base_domain' in patch || 'tailscale.domain' in patch) {
    return { 'general.base_domain': merged['general.base_domain'], 'tailscale.domain': merged['tailscale.domain'] };
  }
  return {};
}

module.exports = router;
