const { Router } = require('express');
const { docker } = require('../docker-client');

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { Volumes } = await docker.listVolumes();
    res.json(Volumes || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:name', async (req, res) => {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ volume: [req.params.name] }),
    });
    if (containers.length > 0) {
      const names = containers.map(c => c.Names[0].replace(/^\//, '')).join(', ');
      return res.status(409).json({ error: `Volume in use by: ${names}` });
    }
    await docker.getVolume(req.params.name).remove();
    res.status(204).end();
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
