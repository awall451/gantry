const { Router } = require('express');
const { docker } = require('../docker-client');

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const images = await docker.listImages();
    res.json(images.map(img => ({
      id: img.Id.replace('sha256:', '').slice(0, 12),
      fullId: img.Id,
      repoTags: img.RepoTags || ['<none>:<none>'],
      sizeMB: (img.Size / 1024 / 1024).toFixed(1),
      created: img.Created,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ ancestor: [req.params.id] }),
    });
    if (containers.length > 0) {
      const names = containers.map(c => c.Names[0].replace(/^\//, '')).join(', ');
      return res.status(409).json({ error: `Image in use by: ${names}` });
    }
    await docker.getImage(req.params.id).remove();
    res.status(204).end();
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
