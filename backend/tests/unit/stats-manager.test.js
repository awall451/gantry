const { computeStats } = require('../../src/stats-manager');

function makeStats(overrides = {}) {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: 2000, percpu_usage: [500, 500, 500, 500] },
      system_cpu_usage: 20000,
      online_cpus: 4
    },
    precpu_stats: {
      cpu_usage: { total_usage: 1000 },
      system_cpu_usage: 10000
    },
    memory_stats: {
      usage: 200 * 1024 * 1024,        // 200 MiB
      limit: 1024 * 1024 * 1024,       // 1 GiB
      stats: { cache: 50 * 1024 * 1024 } // 50 MiB cache
    },
    networks: {
      eth0: { rx_bytes: 1000, tx_bytes: 2000 }
    },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: 'Read', value: 5000 },
        { op: 'Write', value: 7000 }
      ]
    },
    ...overrides
  };
}

describe('computeStats', () => {
  describe('shape', () => {
    it('returns an object with the expected keys', () => {
      const r = computeStats(makeStats());
      expect(Object.keys(r).sort()).toEqual([
        'blkReadBytes',
        'blkWriteBytes',
        'cpuPercent',
        'memLimitMB',
        'memPercent',
        'memUsageMB',
        'netRxBytes',
        'netTxBytes'
      ]);
    });

    it('does not mutate the input', () => {
      const input = makeStats();
      const snapshot = JSON.parse(JSON.stringify(input));
      computeStats(input);
      expect(input).toEqual(snapshot);
    });
  });

  describe('CPU', () => {
    it('computes cpuPercent = (cpuDelta / systemDelta) * numCpus * 100', () => {
      // delta: 1000, system delta: 10000, numCpus: 4 → (1000/10000)*4*100 = 40
      const r = computeStats(makeStats());
      expect(r.cpuPercent).toBeCloseTo(40);
    });

    it('uses online_cpus as numCpus when present', () => {
      const r = computeStats(makeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 100, percpu_usage: [25, 25, 25, 25, 25, 25, 25, 25] },
          system_cpu_usage: 1000,
          online_cpus: 2
        }
      }));
      // (100-1000) negative — but standard case: use shape, not result. Use a clean shape.
      const clean = computeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 200, percpu_usage: [] },
          system_cpu_usage: 1000,
          online_cpus: 2
        },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
        memory_stats: { usage: 0, limit: 1, stats: {} },
        networks: {},
        blkio_stats: {}
      });
      expect(clean.cpuPercent).toBeCloseTo((100 / 500) * 2 * 100); // 40
    });

    it('falls back to percpu_usage.length when online_cpus is missing', () => {
      const r = computeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 200, percpu_usage: [0, 0, 0] }, // length 3
          system_cpu_usage: 1000
        },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
        memory_stats: { usage: 0, limit: 1, stats: {} },
        networks: {},
        blkio_stats: {}
      });
      expect(r.cpuPercent).toBeCloseTo((100 / 500) * 3 * 100); // 60
    });

    it('falls back to numCpus = 1 when both online_cpus and percpu_usage are missing', () => {
      const r = computeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 200 },
          system_cpu_usage: 1000
        },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
        memory_stats: { usage: 0, limit: 1, stats: {} },
        networks: {},
        blkio_stats: {}
      });
      expect(r.cpuPercent).toBeCloseTo((100 / 500) * 1 * 100); // 20
    });

    it('returns 0 when systemDelta is 0 (avoids NaN/Infinity)', () => {
      const r = computeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 100, percpu_usage: [] },
          system_cpu_usage: 1000,
          online_cpus: 1
        },
        precpu_stats: { cpu_usage: { total_usage: 50 }, system_cpu_usage: 1000 },
        memory_stats: { usage: 0, limit: 1, stats: {} },
        networks: {},
        blkio_stats: {}
      });
      expect(r.cpuPercent).toBe(0);
    });

    it('clamps cpuPercent to a maximum of 100', () => {
      const r = computeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 1000, percpu_usage: [] },
          system_cpu_usage: 1100,
          online_cpus: 16
        },
        precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
        memory_stats: { usage: 0, limit: 1, stats: {} },
        networks: {},
        blkio_stats: {}
      });
      expect(r.cpuPercent).toBeLessThanOrEqual(100);
    });

    it('clamps cpuPercent to a minimum of 0 (handles negative deltas)', () => {
      const r = computeStats({
        cpu_stats: {
          cpu_usage: { total_usage: 100, percpu_usage: [] },
          system_cpu_usage: 1000,
          online_cpus: 1
        },
        precpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 500 },
        memory_stats: { usage: 0, limit: 1, stats: {} },
        networks: {},
        blkio_stats: {}
      });
      expect(r.cpuPercent).toBeGreaterThanOrEqual(0);
    });
  });

  // The 30 s recorder passes the previous raw sample so the CPU figure is the
  // average over the whole poll gap, not docker's 1 s pre/cur window. A 1 s
  // window every 30 s aliases against anything periodic (a 15 s healthcheck
  // burst read as a steady 20%).
  describe('CPU against a previous sample', () => {
    it('uses the deltas from prev instead of precpu_stats', () => {
      const prev = { cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 } };
      // delta 2000 / 20000 * 4 cpus * 100 = 40 vs 1000/10000 via precpu = 40 too,
      // so shift prev to make the two paths differ.
      const r = computeStats(makeStats(), { cpu_stats: { cpu_usage: { total_usage: 1500 }, system_cpu_usage: 10000 } });
      expect(r.cpuPercent).toBeCloseTo((500 / 10000) * 4 * 100);
      expect(computeStats(makeStats(), prev).cpuPercent).toBeCloseTo((2000 / 20000) * 4 * 100);
    });

    it('clamps to 0 when the container restarted and its counter reset', () => {
      const prev = { cpu_stats: { cpu_usage: { total_usage: 9000 }, system_cpu_usage: 10000 } };
      expect(computeStats(makeStats(), prev).cpuPercent).toBe(0);
    });

    it('ignores a prev sample that lacks cpu_stats', () => {
      expect(computeStats(makeStats(), {}).cpuPercent).toBeCloseTo(40);
    });
  });

  describe('memory', () => {
    it('subtracts cache from usage to compute memUsage', () => {
      // usage 200 MiB, cache 50 MiB → effective 150 MiB
      const r = computeStats(makeStats());
      expect(r.memUsageMB).toBeCloseTo(150);
    });

    it('reports memLimitMB in MiB', () => {
      const r = computeStats(makeStats());
      expect(r.memLimitMB).toBeCloseTo(1024);
    });

    it('treats missing memory_stats.stats as cache=0', () => {
      const r = computeStats(makeStats({
        memory_stats: { usage: 100 * 1024 * 1024, limit: 1024 * 1024 * 1024 }
      }));
      expect(r.memUsageMB).toBeCloseTo(100);
    });

    it('computes memPercent against the post-cache usage', () => {
      const r = computeStats(makeStats());
      expect(r.memPercent).toBeCloseTo((150 / 1024) * 100);
    });

    it('returns memPercent = 0 when memLimit is 0 (avoids Infinity)', () => {
      const r = computeStats(makeStats({
        memory_stats: { usage: 100, limit: 0, stats: {} }
      }));
      expect(r.memPercent).toBe(0);
    });
  });

  describe('network', () => {
    it('sums rx_bytes and tx_bytes across all interfaces', () => {
      const r = computeStats(makeStats({
        networks: {
          eth0: { rx_bytes: 100, tx_bytes: 200 },
          eth1: { rx_bytes: 50, tx_bytes: 25 }
        }
      }));
      expect(r.netRxBytes).toBe(150);
      expect(r.netTxBytes).toBe(225);
    });

    it('returns 0 when networks is missing', () => {
      const r = computeStats(makeStats({ networks: undefined }));
      expect(r.netRxBytes).toBe(0);
      expect(r.netTxBytes).toBe(0);
    });

    it('treats missing rx_bytes / tx_bytes per-interface as 0', () => {
      const r = computeStats(makeStats({
        networks: { eth0: {} }
      }));
      expect(r.netRxBytes).toBe(0);
      expect(r.netTxBytes).toBe(0);
    });
  });

  describe('block I/O', () => {
    it('sums Read values into blkReadBytes and Write values into blkWriteBytes', () => {
      const r = computeStats(makeStats({
        blkio_stats: {
          io_service_bytes_recursive: [
            { op: 'Read', value: 100 },
            { op: 'Write', value: 200 },
            { op: 'Read', value: 50 }
          ]
        }
      }));
      expect(r.blkReadBytes).toBe(150);
      expect(r.blkWriteBytes).toBe(200);
    });

    it('ignores op values other than Read and Write (Sync/Async/Total)', () => {
      const r = computeStats(makeStats({
        blkio_stats: {
          io_service_bytes_recursive: [
            { op: 'Sync', value: 999 },
            { op: 'Async', value: 999 },
            { op: 'Total', value: 999 },
            { op: 'Read', value: 5 }
          ]
        }
      }));
      expect(r.blkReadBytes).toBe(5);
      expect(r.blkWriteBytes).toBe(0);
    });

    it('returns 0 when blkio_stats is missing', () => {
      const r = computeStats(makeStats({ blkio_stats: undefined }));
      expect(r.blkReadBytes).toBe(0);
      expect(r.blkWriteBytes).toBe(0);
    });

    it('returns 0 when io_service_bytes_recursive is missing', () => {
      const r = computeStats(makeStats({ blkio_stats: {} }));
      expect(r.blkReadBytes).toBe(0);
      expect(r.blkWriteBytes).toBe(0);
    });
  });
});
