const { Router } = require('express');
const { getAllRoutes, updateRoute, deleteRoute, insertRoute, getRouteById } = require('../db');
const { pushConfig } = require('../caddy-client');

const router = Router();

router.get('/', (req, res) => {
  res.json(getAllRoutes());
});

router.post('/', (req, res) => {
  const { container_name, hostname, target_port } = req.body;
  if (!container_name || !hostname || !target_port) {
    return res.status(400).json({ error: 'container_name, hostname, target_port required' });
  }
  try {
    const id = insertRoute({ container_name, hostname, target_port: Number(target_port) });
    pushConfig().then(() => req.broadcast({ type: 'routes:updated', routes: getAllRoutes() }));
    res.status(201).json(getRouteById(id));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { hostname, enabled } = req.body;
  const fields = {};
  if (hostname !== undefined) fields.hostname = hostname;
  if (enabled !== undefined) fields.enabled = enabled ? 1 : 0;
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'nothing to update' });

  updateRoute(req.params.id, fields);
  pushConfig().then(() => req.broadcast({ type: 'routes:updated', routes: getAllRoutes() }));
  res.json(getRouteById(req.params.id));
});

router.delete('/:id', (req, res) => {
  deleteRoute(req.params.id);
  pushConfig().then(() => req.broadcast({ type: 'routes:updated', routes: getAllRoutes() }));
  res.status(204).end();
});

module.exports = router;
