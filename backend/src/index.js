const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { startWatcher, setBroadcast, isHealthy: dockerHealthy } = require('./docker-watcher');
const { isHealthy: caddyHealthy } = require('./caddy-client');
const { startLogTail } = require('./log-tail');
const { handleMessage: statsHandleMessage, unsubscribeAll } = require('./stats-manager');
const { startStatsRecorder } = require('./stats-recorder');
const { docker } = require('./docker-client');
const { pickShell } = require('./exec-shell');
const tailscale = require('./tailscale');
const { PassThrough } = require('stream');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, '../public')));
app.use((req, _res, next) => { req.broadcast = broadcast; next(); });

app.use('/api/containers', require('./api/containers'));
app.use('/api/routes',     require('./api/routes'));
app.use('/api/analytics',  require('./api/analytics'));
app.use('/api/images',           require('./api/images'));
app.use('/api/volumes',          require('./api/volumes'));
app.use('/api/networks',         require('./api/networks'));
app.use('/api/docker-analytics', require('./api/docker-analytics'));
app.use('/api/settings',         require('./api/settings'));

app.get('/health', async (_req, res) => {
  res.json({
    status: 'ok',
    caddy: await caddyHealthy(),
    docker: await dockerHealthy(),
    dns: (await tailscale.status()).dns,
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const server = http.createServer(app);

// Main broadcast WebSocket (noServer — we handle upgrades manually for /ws/exec/:id routing)
const wss = new WebSocket.Server({ noServer: true });

// Exec terminal WebSocket
const execWss = new WebSocket.Server({ noServer: true });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    try {
      statsHandleMessage(ws, JSON.parse(data));
    } catch {}
  });
  ws.on('close', () => unsubscribeAll(ws));
});

execWss.on('connection', async (ws, _req, containerId) => {
  try {
    const container = docker.getContainer(containerId);
    const shell = await pickShell(container);
    if (!shell) {
      ws.send('No shell available in this container.\r\n');
      ws.close();
      return;
    }

    const exec = await container.exec({
      Cmd: [shell],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = await exec.start({ hijack: true, stdin: true });

    stream.on('data', chunk => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
    });
    stream.on('error', () => ws.close());
    stream.on('end', () => ws.close());

    ws.on('message', data => {
      const str = data.toString();
      if (str.startsWith('{')) {
        try {
          const msg = JSON.parse(str);
          if (msg.type === 'resize') exec.resize({ h: msg.rows, w: msg.cols }).catch(() => {});
        } catch {}
      } else {
        stream.write(data);
      }
    });

    ws.on('close', () => stream.destroy());
  } catch (err) {
    ws.send(`Error: ${err.message}\r\n`);
    ws.close();
  }
});

// Route WebSocket upgrades by path
server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/exec\/([a-zA-Z0-9]+)/);
  if (match) {
    execWss.handleUpgrade(req, socket, head, ws => {
      execWss.emit('connection', ws, req, match[1]);
    });
  } else {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  }
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

setBroadcast(broadcast);

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  startWatcher();
  startLogTail();
  startStatsRecorder();
  // Bring the DNS responder up (or leave it down) per saved settings. Caddy
  // config is pushed by the watcher's first sync, so apply() only has to
  // own the socket here; the extra pushConfig it does is harmless.
  tailscale.apply().catch(err => console.error('[tailscale] apply on boot failed:', err.message));
});
