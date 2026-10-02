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
const { installAuth } = require('./auth/install');
const authGuard = require('./auth/guard');
const hostShell = require('./host-shell');
const { refuseHostUpgrade } = require('./api/host-shell');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.json());
installAuth(app);

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
app.use('/api/host-shell',       require('./api/host-shell'));

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

// Host terminal WebSocket (SSH to this machine; see host-shell.js)
const hostWss = new WebSocket.Server({ noServer: true });

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
      // Only {"type":"resize",...} is control; anything else, including a
      // typed "{" (previously swallowed here), is terminal input.
      if (str.startsWith('{"type"')) {
        try {
          const msg = JSON.parse(str);
          if (msg.type === 'resize') { exec.resize({ h: msg.rows, w: msg.cols }).catch(() => {}); return; }
        } catch {}
      }
      stream.write(data);
    });

    ws.on('close', () => stream.destroy());
  } catch (err) {
    ws.send(`Error: ${err.message}\r\n`);
    ws.close();
  }
});

// Route WebSocket upgrades by path
server.on('upgrade', (req, socket, head) => {
  // Nothing in a handshake may crash the process: refuse instead.
  try { routeUpgrade(req, socket, head); }
  catch (err) {
    console.error(`[ws] upgrade failed: ${err.message}`);
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  }
});

function routeUpgrade(req, socket, head) {
  const refused = authGuard.refuseUpgrade(req);
  if (refused) {
    const text = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden' }[refused];
    socket.end(`HTTP/1.1 ${refused} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    return;
  }
  if (/^\/ws\/host(\?|$)/.test(req.url)) {
    const no = refuseHostUpgrade(req);
    if (no) {
      console.warn(`[host-shell] refused upgrade (${no}) from ${req.socket.remoteAddress}`);
      socket.end(`HTTP/1.1 ${no} ${no === 404 ? 'Not Found' : 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    hostWss.handleUpgrade(req, socket, head, ws => hostWss.emit('connection', ws, req));
    return;
  }
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
}

hostWss.on('connection', async (ws, req) => {
  const cfg = hostShell.hostShellConfig();
  const q = new URL(req.url, 'http://x').searchParams;
  const size = { cols: Math.min(500, Number(q.get('cols')) || 80), rows: Math.min(200, Number(q.get('rows')) || 24) };
  const who = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const started = Date.now();
  let conn, stream, idle;
  const close = (why) => {
    clearTimeout(idle);
    if (ws.readyState === WebSocket.OPEN) { if (why) ws.send(`\r\n[${why}]\r\n`); ws.close(); }
    stream?.end(); conn?.end();
  };
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => { const m = cfg.idleMs / 60000; close(`closed after ${m} minute${m === 1 ? '' : 's'} without input`); }, cfg.idleMs); };

  // Listen for the browser leaving *before* the SSH handshake: a tab closed
  // mid-connect must not leave a shell running until the idle timer.
  let browserGone = false;
  ws.on('close', () => {
    browserGone = true;
    close();
    if (conn) console.log(`[host-shell] closed for ${who} after ${Math.round((Date.now() - started) / 1000)}s`);
  });

  try {
    ({ conn, stream } = await hostShell.openShell(cfg, size));
  } catch (err) {
    console.error(`[host-shell] ssh ${cfg.user}@${cfg.host}:${cfg.port} failed: ${err.message}`);
    return close(`could not open a shell: ${err.message}`);
  }
  if (browserGone) {
    stream.end(); conn.end();
    console.log(`[host-shell] ${who} left before the shell opened; closed it`);
    return;
  }
  console.log(`[host-shell] opened ${cfg.user}@${cfg.host} for ${who}`);
  touch();

  stream.on('data', d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });
  stream.stderr?.on('data', d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });
  stream.on('close', () => close('shell exited'));
  conn.on('close', () => close());

  ws.on('message', data => {
    touch();
    const str = data.toString();
    // Control frames are {"type":"resize",...}; anything else, including a
    // typed "{", is terminal input.
    if (str.startsWith('{"type"')) {
      try {
        const msg = JSON.parse(str);
        if (msg.type === 'resize') { stream.setWindow(Math.min(200, msg.rows | 0) || 24, Math.min(500, msg.cols | 0) || 80, 0, 0); return; }
      } catch {}
    }
    stream.write(data);
  });
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
  const auth = authGuard.config();
  if (auth.misconfigured) console.error('[auth] GANTRY_PASSWORD_HASH is malformed: login is required but nothing can succeed. Regenerate it with scripts/set-password.sh');
  else console.log(auth.passwordRequired ? `[auth] login required (user "${auth.username}")` : '[auth] no GANTRY_PASSWORD_HASH set: the UI and API are open to anyone who can reach them');
  if ((process.env.GANTRY_API_TOKEN || '').trim() && !auth.apiToken) console.error('[auth] GANTRY_API_TOKEN ignored: use at least 32 characters');
  const hs = hostShell.availability(hostShell.hostShellConfig(), auth);
  if (hs.enabled) console.log(hs.available ? `[host-shell] enabled for ${hostShell.hostShellConfig().user}` : `[host-shell] enabled but unavailable: ${hs.reason}`);
  startWatcher();
  startLogTail();
  startStatsRecorder();
  // Bring the DNS responder up (or leave it down) per saved settings. Caddy
  // config is pushed by the watcher's first sync, so apply() only has to
  // own the socket here; the extra pushConfig it does is harmless.
  tailscale.apply().catch(err => console.error('[tailscale] apply on boot failed:', err.message));
});
