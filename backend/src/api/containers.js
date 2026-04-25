const { Router } = require('express');
const { PassThrough } = require('stream');
const { docker } = require('../docker-client');
const { getLiveContainers, syncContainers } = require('../docker-watcher');

const router = Router();

router.get('/', async (req, res) => {
  const containers = await getLiveContainers();
  res.json(containers);
});

router.get('/:id/inspect', async (req, res) => {
  try {
    const info = await docker.getContainer(req.params.id).inspect();
    res.json(info);
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/:id/logs', async (req, res) => {
  const { tail = '200', timestamps = 'false' } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let logStream;
  try {
    logStream = await docker.getContainer(req.params.id).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: Number(tail),
      timestamps: timestamps === 'true',
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
    return;
  }

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(logStream, stdout, stderr);

  function sendLine(chunk) {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line) res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }
  }

  stdout.on('data', sendLine);
  stderr.on('data', sendLine);

  req.on('close', () => logStream.destroy());
  logStream.on('error', () => res.end());
});

async function lifecycleAction(action, req, res) {
  const container = docker.getContainer(req.params.id);
  try {
    await container[action]();
    await syncContainers();
    res.json({ ok: true });
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : err.statusCode === 304 ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
}

router.post('/:id/start',   (req, res) => lifecycleAction('start',   req, res));
router.post('/:id/stop',    (req, res) => lifecycleAction('stop',    req, res));
router.post('/:id/restart', (req, res) => lifecycleAction('restart', req, res));

module.exports = router;
