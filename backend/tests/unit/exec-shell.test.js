const { Readable } = require('stream');

const { pickShell, DEFAULT_SHELLS } = require('../../src/exec-shell');

function mockContainer(probes) {
  // probes[i] describes what happens on the i-th exec call:
  //   { exitCode: N }    → exec.create + start succeed, inspect returns ExitCode N
  //   'throwCreate'      → container.exec(...) throws
  //   'throwStart'       → exec.start(...) throws
  //   'throwInspect'     → exec.inspect(...) throws
  let i = 0;
  const calls = [];
  const container = {
    exec: vi.fn(async (opts) => {
      const probe = probes[i++];
      calls.push(opts);
      if (probe === 'throwCreate') throw new Error('exec create failed');
      return {
        start: vi.fn(async () => {
          if (probe === 'throwStart') throw new Error('exec start failed');
          return Readable.from([]);
        }),
        inspect: vi.fn(async () => {
          if (probe === 'throwInspect') throw new Error('inspect failed');
          return { ExitCode: probe.exitCode };
        })
      };
    })
  };
  return { container, calls };
}

describe('pickShell', () => {
  it('returns the first candidate when its probe exits 0', async () => {
    const { container } = mockContainer([{ exitCode: 0 }]);
    expect(await pickShell(container)).toBe('/bin/bash');
  });

  it('falls back to /bin/sh when bash probe exits non-zero', async () => {
    const { container } = mockContainer([{ exitCode: 127 }, { exitCode: 0 }]);
    expect(await pickShell(container)).toBe('/bin/sh');
  });

  it('falls back further when both bash and sh fail (busybox-only or restricted image)', async () => {
    const { container } = mockContainer([
      { exitCode: 127 },
      { exitCode: 127 },
      { exitCode: 0 }
    ]);
    expect(await pickShell(container)).toBe('/bin/ash');
  });

  it('returns null when no candidate succeeds', async () => {
    const { container } = mockContainer([
      { exitCode: 127 },
      { exitCode: 127 },
      { exitCode: 127 }
    ]);
    expect(await pickShell(container)).toBeNull();
  });

  it('skips a candidate when container.exec throws', async () => {
    const { container } = mockContainer(['throwCreate', { exitCode: 0 }]);
    expect(await pickShell(container)).toBe('/bin/sh');
  });

  it('skips a candidate when exec.start throws', async () => {
    const { container } = mockContainer(['throwStart', { exitCode: 0 }]);
    expect(await pickShell(container)).toBe('/bin/sh');
  });

  it('skips a candidate when exec.inspect throws', async () => {
    const { container } = mockContainer(['throwInspect', { exitCode: 0 }]);
    expect(await pickShell(container)).toBe('/bin/sh');
  });

  it('uses caller-supplied candidates instead of defaults', async () => {
    const { container } = mockContainer([{ exitCode: 0 }]);
    expect(await pickShell(container, ['/usr/local/bin/fish'])).toBe('/usr/local/bin/fish');
  });

  it('probes with Cmd [shell, "-c", "true"]', async () => {
    const { container, calls } = mockContainer([{ exitCode: 0 }]);
    await pickShell(container, ['/bin/dash']);
    expect(calls[0]).toMatchObject({ Cmd: ['/bin/dash', '-c', 'true'] });
  });

  it('attaches stdout/stderr so the exec stream drains and ExitCode is available on inspect', async () => {
    const { container, calls } = mockContainer([{ exitCode: 0 }]);
    await pickShell(container, ['/bin/bash']);
    expect(calls[0].AttachStdout).toBe(true);
    expect(calls[0].AttachStderr).toBe(true);
  });

  it('stops probing as soon as one succeeds (no extra exec calls)', async () => {
    const { container } = mockContainer([{ exitCode: 0 }, { exitCode: 0 }]);
    await pickShell(container, ['/bin/bash', '/bin/sh']);
    expect(container.exec).toHaveBeenCalledTimes(1);
  });

  it('exports DEFAULT_SHELLS in priority order: bash, sh, ash', () => {
    expect(DEFAULT_SHELLS).toEqual(['/bin/bash', '/bin/sh', '/bin/ash']);
  });
});
