const { Router } = require('express');
const { queryAnalytics } = require('../db');

const router = Router();

router.get('/', (req, res) => {
  const { from, to, hostname } = req.query;
  res.json(queryAnalytics({ from, to, hostname }));
});

module.exports = router;
