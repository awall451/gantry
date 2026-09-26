<script>
  import { onMount, tick } from 'svelte';
  import { Line, Bar } from 'svelte-chartjs';
  import {
    Chart,
    CategoryScale, LinearScale, PointElement, LineElement,
    BarElement, Title, Tooltip, Legend, Filler,
  } from 'chart.js';
  import { api } from '$lib/api';

  Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

  // ── shared time range ────────────────────────────────────────────
  function toInputVal(d) {
    // datetime-local requires local time, not UTC
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  // datetime-local value has no tz suffix → parsed as local → .toISOString() converts to UTC for DB
  function toApiTs(v)   { return v ? new Date(v).toISOString().slice(0, 19) : v; }
  function toApiHour(v) { return v ? new Date(v).toISOString().slice(0, 13) : v; }
  // DB stores UTC strings — convert back to local for display
  function fmtUtcTs(ts) { return new Date(ts + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function fmtUtcHour(h) { return new Date(h + ':00:00Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  const PRESETS = [
    { value: '5m',   label: 'Last 5 min',  ms: 5 * 60_000 },
    { value: '15m',  label: 'Last 15 min', ms: 15 * 60_000 },
    { value: '30m',  label: 'Last 30 min', ms: 30 * 60_000 },
    { value: '1h',   label: 'Last 1 hr',   ms: 3_600_000 },
    { value: '6h',   label: 'Last 6 hrs',  ms: 6 * 3_600_000 },
    { value: '24h',  label: 'Last 24 hrs', ms: 24 * 3_600_000 },
    { value: '1w',   label: 'Last 1 week', ms: 7 * 24 * 3_600_000 },
    { value: 'date', label: 'Date range',  ms: null },
  ];

  let selectedPreset = '5m';
  let fromVal = toInputVal(new Date(Date.now() - 5 * 60_000));
  let toVal   = toInputVal(new Date());

  function getRange() {
    const p = PRESETS.find(p => p.value === selectedPreset);
    if (p?.ms) {
      const now = new Date();
      return { from: toInputVal(new Date(now - p.ms)), to: toInputVal(now) };
    }
    return { from: fromVal, to: toVal };
  }

  function onPresetChange() {
    if (selectedPreset !== 'date') applyRange();
  }

  // ── tabs ─────────────────────────────────────────────────────────
  let activeTab = 'resources';

  // ── proxy traffic ────────────────────────────────────────────────
  let proxyData = [];
  let proxyLoading = false;

  async function loadProxy() {
    proxyLoading = true;
    const { from, to } = getRange();
    proxyData = await api.getAnalytics({ from: toApiHour(from), to: toApiHour(to) });
    proxyLoading = false;
  }

  $: hourlyMap = proxyData.reduce((acc, r) => {
    acc[r.hour] = (acc[r.hour] || 0) + r.request_count;
    return acc;
  }, {});
  $: sortedHours = Object.keys(hourlyMap).sort();
  $: lineData = {
    labels: sortedHours.map(h => fmtUtcHour(h)),
    datasets: [{
      label: 'Requests',
      data: sortedHours.map(h => hourlyMap[h]),
      borderColor: '#7c84ff', backgroundColor: 'rgba(124,132,255,0.12)',
      fill: true, tension: 0.3, pointRadius: 2,
    }],
  };
  $: routeTotals = proxyData.reduce((acc, r) => {
    acc[r.hostname] = (acc[r.hostname] || 0) + r.request_count;
    return acc;
  }, {});
  $: topRoutes = Object.entries(routeTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  $: barData = {
    labels: topRoutes.map(([h]) => h),
    datasets: [{ label: 'Total requests', data: topRoutes.map(([, c]) => c), backgroundColor: '#3d42a0', borderRadius: 4 }],
  };
  $: totalRequests = proxyData.reduce((s, r) => s + r.request_count, 0);
  $: totalErrors   = proxyData.reduce((s, r) => s + r.status_5xx + r.status_4xx, 0);
  $: avgDuration   = proxyData.length
    ? (proxyData.reduce((s, r) => s + r.avg_duration_ms * r.request_count, 0) / Math.max(totalRequests, 1)).toFixed(1)
    : '—';

  // ── container resources ──────────────────────────────────────────
  let resData = [];
  let resLoading = false;

  const PALETTE = ['#7c84ff','#34d399','#f59e0b','#f87171','#a78bfa','#38bdf8','#fb923c','#4ade80','#e879f9','#94a3b8'];

  async function loadResources() {
    resLoading = true;
    const { from, to } = getRange();
    resData = await api.getAllContainerStats({ from: toApiTs(from), to: toApiTs(to) });
    resLoading = false;
  }

  // Group rows by container_name, build per-container time series
  $: byContainer = resData.reduce((acc, r) => {
    (acc[r.container_name] = acc[r.container_name] || []).push(r);
    return acc;
  }, {});

  $: containerNames = Object.keys(byContainer).sort();

  // All unique timestamps (x-axis labels) — downsample to max 120 ticks
  $: allTs = [...new Set(resData.map(r => r.recorded_at))].sort();
  $: labels = downsample(allTs, 120);

  function downsample(arr, max) {
    if (arr.length <= max) return arr;
    const step = Math.ceil(arr.length / max);
    return arr.filter((_, i) => i % step === 0);
  }

  function labelFmt(ts) { return fmtUtcTs(ts); }

  function makeDataset(name, field, idx, alpha = '0.12') {
    const rows = byContainer[name] || [];
    const rowMap = Object.fromEntries(rows.map(r => [r.recorded_at, r]));
    const color = PALETTE[idx % PALETTE.length];
    return {
      label: name,
      data: labels.map(ts => {
        const r = rowMap[ts];
        return r ? +r[field].toFixed(2) : null;
      }),
      borderColor: color,
      backgroundColor: color.replace(')', `, ${alpha})`).replace('rgb', 'rgba').replace('#', 'rgba(') + (color.startsWith('#') ? toRgba(color, alpha) : ''),
      fill: false, tension: 0.3, pointRadius: 0, spanGaps: true,
    };
  }

  // hex → rgba helper
  function toRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function makeDatasetClean(name, field, idx) {
    const rows = byContainer[name] || [];
    const rowMap = Object.fromEntries(rows.map(r => [r.recorded_at, r]));
    const color = PALETTE[idx % PALETTE.length];
    return {
      label: name,
      data: labels.map(ts => {
        const r = rowMap[ts];
        return r ? +r[field].toFixed(2) : null;
      }),
      borderColor: color,
      backgroundColor: toRgba(color, '0.08'),
      fill: false, tension: 0.3, pointRadius: 0, spanGaps: true,
    };
  }

  function makeNetDataset(name, idx) {
    const rows = (byContainer[name] || []).sort((a,b) => a.recorded_at.localeCompare(b.recorded_at));
    const deltaMap = {};
    for (let i = 1; i < rows.length; i++) {
      const delta = Math.max(0, (rows[i].net_rx_bytes + rows[i].net_tx_bytes) - (rows[i-1].net_rx_bytes + rows[i-1].net_tx_bytes));
      deltaMap[rows[i].recorded_at] = +(delta / 1024).toFixed(1); // KB
    }
    const color = PALETTE[idx % PALETTE.length];
    return {
      label: name,
      data: labels.map(ts => deltaMap[ts] ?? null),
      borderColor: color,
      backgroundColor: toRgba(color, '0.08'),
      fill: false, tension: 0.3, pointRadius: 0, spanGaps: true,
    };
  }

  $: cpuDatasets = containerNames.map((n, i) => makeDatasetClean(n, 'cpu_percent', i));
  $: memDatasets = containerNames.map((n, i) => makeDatasetClean(n, 'mem_usage_mb', i));
  $: netDatasets = containerNames.map((n, i) => makeNetDataset(n, i));

  $: cpuChartData = { labels: labels.map(labelFmt), datasets: cpuDatasets };
  $: memChartData = { labels: labels.map(labelFmt), datasets: memDatasets };
  $: netChartData = { labels: labels.map(labelFmt), datasets: netDatasets };

  // Summary stats
  $: resSummary = containerNames.map(name => {
    const rows = byContainer[name];
    const avgCpu = rows.reduce((s,r) => s + r.cpu_percent, 0) / rows.length;
    const peakMem = Math.max(...rows.map(r => r.mem_usage_mb));
    const lastRow = rows[rows.length - 1];
    return { name, avgCpu, peakMem, currentCpu: lastRow?.cpu_percent ?? 0, currentMem: lastRow?.mem_usage_mb ?? 0 };
  }).sort((a,b) => b.avgCpu - a.avgCpu);

  // ── shared chart options ─────────────────────────────────────────
  const baseOpts = (yLabel = '') => ({
    responsive: true,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { title: items => items[0].label } },
    },
    scales: {
      x: { ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' }, beginAtZero: true, title: { display: !!yLabel, text: yLabel, color: '#64748b', font: { size: 10 } } },
    },
  });

  const cpuOpts = { ...baseOpts('%'), scales: { ...baseOpts('%').scales, y: { ...baseOpts('%').scales.y, max: 100 } } };
  const memOpts = baseOpts('MB');
  const netOpts = baseOpts('KB/30s');

  const proxyOpts = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' }, beginAtZero: true },
    },
  };

  // ── init ─────────────────────────────────────────────────────────
  async function applyRange() {
    if (activeTab === 'resources') loadResources();
    else loadProxy();
  }

  onMount(() => loadResources());

  function switchTab(t) {
    activeTab = t;
    if (t === 'resources' && resData.length === 0) loadResources();
    if (t === 'proxy' && proxyData.length === 0) loadProxy();
  }
</script>

<div class="page-header">
  <h1>Analytics</h1>
  <div class="filters">
    <select bind:value={selectedPreset} on:change={onPresetChange} class="preset-select">
      {#each PRESETS as p}
        <option value={p.value}>{p.label}</option>
      {/each}
    </select>
    {#if selectedPreset === 'date'}
      <label>From <input type="datetime-local" bind:value={fromVal} /></label>
      <label>To   <input type="datetime-local" bind:value={toVal} /></label>
      <button class="btn" on:click={applyRange}>Apply</button>
    {/if}
  </div>
</div>

<div class="tabs">
  <button class="tab" class:active={activeTab === 'resources'} on:click={() => switchTab('resources')}>Container Resources</button>
  <button class="tab" class:active={activeTab === 'proxy'}     on:click={() => switchTab('proxy')}>Proxy Traffic</button>
</div>

<!-- ── RESOURCES TAB ─────────────────────────────────────────────── -->
{#if activeTab === 'resources'}
  {#if resLoading}
    <p class="empty">Loading...</p>
  {:else if resData.length === 0}
    <p class="empty">No resource data yet — stats are recorded every 30s once containers are running.</p>
  {:else}
    <!-- Summary cards -->
    <div class="stats-row">
      {#each resSummary.slice(0, 5) as s, i}
        <div class="stat" style="border-left: 3px solid {PALETTE[i % PALETTE.length]}">
          <span class="stat-name">{s.name}</span>
          <div class="stat-nums">
            <span><span class="stat-val">{s.currentCpu.toFixed(1)}%</span><span class="stat-label">CPU now</span></span>
            <span><span class="stat-val">{s.currentMem.toFixed(0)}</span><span class="stat-label">MB now</span></span>
            <span><span class="stat-val">{s.avgCpu.toFixed(1)}%</span><span class="stat-label">avg CPU</span></span>
            <span><span class="stat-val">{s.peakMem.toFixed(0)}</span><span class="stat-label">peak MB</span></span>
          </div>
        </div>
      {/each}
    </div>

    <div class="charts-col">
      <div class="chart-box wide">
        <h2>CPU Usage (%)</h2>
        <Line data={cpuChartData} options={cpuOpts} />
      </div>
      <div class="chart-box wide">
        <h2>Memory Usage (MB)</h2>
        <Line data={memChartData} options={memOpts} />
      </div>
      <div class="chart-box wide">
        <h2>Network I/O (KB per 30s interval)</h2>
        <Line data={netChartData} options={netOpts} />
      </div>
    </div>
  {/if}

<!-- ── PROXY TRAFFIC TAB ─────────────────────────────────────────── -->
{:else}
  <div class="stats-row">
    <div class="stat">
      <span class="stat-val big">{totalRequests.toLocaleString()}</span>
      <span class="stat-label">Total requests</span>
    </div>
    <div class="stat">
      <span class="stat-val big">{topRoutes.length}</span>
      <span class="stat-label">Active routes</span>
    </div>
    <div class="stat">
      <span class="stat-val big" class:warn={totalErrors > 0}>{totalErrors.toLocaleString()}</span>
      <span class="stat-label">Errors (4xx+5xx)</span>
    </div>
    <div class="stat">
      <span class="stat-val big">{avgDuration} ms</span>
      <span class="stat-label">Avg response time</span>
    </div>
  </div>

  {#if proxyLoading}
    <p class="empty">Loading...</p>
  {:else if proxyData.length === 0}
    <p class="empty">No proxy analytics yet. Make requests through your proxy routes.</p>
  {:else}
    <div class="charts">
      <div class="chart-box">
        <h2>Requests over time</h2>
        <Line data={lineData} options={proxyOpts} />
      </div>
      <div class="chart-box">
        <h2>Top routes</h2>
        <Bar data={barData} options={proxyOpts} />
      </div>
    </div>
  {/if}
{/if}

<style>
  .page-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: 1.25rem; flex-wrap: wrap; gap: 1rem;
  }
  h1 { font-size: 1.4rem; font-weight: 700; }

  .filters { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
  label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #94a3b8; }
  .preset-select {
    background: #1a1d27; border: 1px solid #2d3148; color: #e2e8f0;
    border-radius: 6px; padding: 0.4rem 0.6rem; font-size: 0.8rem;
    outline: none; cursor: pointer;
  }
  .preset-select:focus { border-color: #7c84ff; }

  input[type="datetime-local"] {
    background: #1a1d27; border: 1px solid #2d3148; color: #e2e8f0;
    border-radius: 6px; padding: 0.4rem 0.6rem; font-size: 0.8rem; outline: none;
  }
  input:focus { border-color: #7c84ff; }

  .btn {
    background: #3d42a0; color: #e2e8f0; border: none; border-radius: 6px;
    padding: 0.45rem 0.9rem; font-size: 0.85rem; cursor: pointer;
  }
  .btn:hover { background: #4a4fbf; }

  .tabs {
    display: flex; gap: 0; border-bottom: 1px solid #2d3148; margin-bottom: 1.5rem;
    overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    background: none; border: none; color: #64748b; cursor: pointer;
    padding: 0.6rem 1.2rem; font-size: 0.875rem; border-bottom: 2px solid transparent;
    transition: color 0.15s; margin-bottom: -1px; white-space: nowrap; flex-shrink: 0;
  }
  .tab:hover { color: #e2e8f0; }
  .tab.active { color: #7c84ff; border-bottom-color: #7c84ff; }

  .stats-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .stat {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 10px;
    padding: 0.85rem 1.1rem; display: flex; flex-direction: column; gap: 0.4rem;
    min-width: 160px; flex: 1; min-width: 0; flex-basis: 160px;
  }
  .stat-name { font-size: 0.78rem; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat-nums { display: flex; gap: 1rem; flex-wrap: wrap; }
  .stat-nums span { display: flex; flex-direction: column; gap: 0.1rem; }
  .stat-val { font-size: 1.25rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat-val.big { font-size: 1.8rem; }
  .stat-val.warn { color: #f87171; }
  .stat-label { font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }

  .charts-col { display: flex; flex-direction: column; gap: 1.5rem; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  @media (max-width: 768px) { .charts { grid-template-columns: 1fr; } }

  .chart-box {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 10px; padding: 1.25rem;
  }
  h2 { font-size: 0.85rem; color: #94a3b8; margin-bottom: 1rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }

  .empty { color: #64748b; font-size: 0.9rem; margin-top: 2rem; }

  @media (pointer: coarse) {
    .tab { min-height: 44px; }
    .btn, .preset-select, input[type="datetime-local"] { min-height: 40px; }
  }
  @media (max-width: 640px) {
    .tab { padding: 0.6rem 0.8rem; }
    .stat { flex-basis: calc(50% - 0.5rem); padding: 0.7rem 0.8rem; }
    .stat-nums { gap: 0.6rem 0.9rem; }
    .stat-val { font-size: 1.1rem; }
    .filters label { flex: 1 1 100%; }
    .filters input[type="datetime-local"] { flex: 1; min-width: 0; }
    .chart-box { padding: 0.75rem; }
  }
</style>
