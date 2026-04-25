const { Router } = require('express');
const { queryContainerStats, queryAllContainerStats, queryContainerEvents, queryAllContainerEvents } = require('../db');

const router = Router();

router.get('/stats', (req, res) => {
  const { from, to, limit } = req.query;
  res.json(queryAllContainerStats({
    from,
    to,
    limit: limit ? parseInt(limit, 10) : 2000,
  }));
});

router.get('/stats/:containerId', (req, res) => {
  const { from, to, limit } = req.query;
  res.json(queryContainerStats({
    container_id: req.params.containerId,
    from,
    to,
    limit: limit ? parseInt(limit, 10) : 500,
  }));
});

router.get('/events/:containerId', (req, res) => {
  const { from, to, limit } = req.query;
  res.json(queryContainerEvents({
    container_id: req.params.containerId,
    from,
    to,
    limit: limit ? parseInt(limit, 10) : 200,
  }));
});

router.get('/events', (req, res) => {
  const { from, to, limit } = req.query;
  res.json(queryAllContainerEvents({
    from,
    to,
    limit: limit ? parseInt(limit, 10) : 500,
  }));
});

module.exports = router;
