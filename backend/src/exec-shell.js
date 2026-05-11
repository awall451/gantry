const DEFAULT_SHELLS = ['/bin/bash', '/bin/sh', '/bin/ash'];

function drainAndEnd(stream) {
  return new Promise((resolve) => {
    if (!stream || typeof stream.on !== 'function') return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
    if (typeof stream.resume === 'function') stream.resume();
  });
}

async function pickShell(container, candidates = DEFAULT_SHELLS) {
  for (const shell of candidates) {
    try {
      const exec = await container.exec({
        Cmd: [shell, '-c', 'true'],
        AttachStdout: true,
        AttachStderr: true
      });
      const stream = await exec.start({ Detach: false });
      await drainAndEnd(stream);
      const info = await exec.inspect();
      if (info && info.ExitCode === 0) return shell;
    } catch {
      // try next candidate
    }
  }
  return null;
}

module.exports = { pickShell, DEFAULT_SHELLS };
