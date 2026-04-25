const { Router } = require('express');
const { docker } = require('../docker-client');

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const networks = await docker.listNetworks();
    res.json(networks.map(n => ({
      id: n.Id.slice(0, 12),
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
      subnet: n.IPAM?.Config?.[0]?.Subnet || '',
      containers: Object.values(n.Containers || {}).map(c => c.Name),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
