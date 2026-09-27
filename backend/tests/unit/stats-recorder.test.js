// Side effects are stubbed on the real module objects (CJS hands every
// require() the same object), same approach as api-settings.test.js.
const docker = require('../../src/docker-client');
const db = require('../../src/db');
const { recordAllStats, _resetForTests } = require('../../src/stats-recorder');

const raw = (total_usage, system_cpu_usage) => ({
  cpu_stats: { cpu_usage: { total_usage }, system_cpu_usage, online_cpus: 1 },
  precpu_stats: { cpu_usage: { total_usage: total_usage - 800 }, system_cpu_usage: system_cpu_usage - 1000 },
  memory_stats: { usage: 0, limit: 1 },
  networks: {}, blkio_stats: {},
});

describe('recordAllStats', () => {
  let statsCalls, inserted;
  beforeEach(() => {
    _resetForTests();
    statsCalls = [];
    inserted = [];
    const samples = [raw(10_000, 100_000), raw(10_300, 130_000)]; // 300 busy over 30 000 → 1%
    let i = 0;
    docker.docker.listContainers = vi.fn(async () => [{ Id: 'abc', Names: ['/app'] }]);
    docker.docker.getContainer = vi.fn(() => ({
      stats: vi.fn(async opts => { statsCalls.push(opts); return samples[i++]; }),
    }));
    db.insertContainerStats = vi.fn(row => inserted.push(row));
    db.purgeOldContainerStats = vi.fn();
    db.purgeOldContainerEvents = vi.fn();
  });

  it("first poll has no previous sample, so it uses docker's own 1 s window", async () => {
    await recordAllStats();
    expect(statsCalls[0]).toEqual({ stream: false });
    expect(inserted[0].cpu_percent).toBeCloseTo(80); // 800 / 1000 * 100
  });

  it('second poll averages over the gap since the previous sample and skips the 1 s pre-sample', async () => {
    await recordAllStats();
    await recordAllStats();
    expect(statsCalls[1]).toEqual({ stream: false, 'one-shot': true });
    expect(inserted[1].cpu_percent).toBeCloseTo(1); // 300 / 30 000 * 100, not 80
  });
});
