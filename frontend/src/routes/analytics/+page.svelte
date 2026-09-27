<script>
  import { onMount, tick } from 'svelte';
  import { Line, Bar } from 'svelte-chartjs';
  import {
    Chart,
    CategoryScale, LinearScale, PointElement, LineElement,
    BarElement, Title, Tooltip, Legend, Filler,
  } from 'chart.js';
  import { replaceState } from '$app/navigation';
  import { api } from '$lib/api';
  import { registerSideTooltip, hideTooltipOnTouchEnd, hexToRgba } from '$lib/chart-tooltip';

  Chart.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);
  registerSideTooltip(Tooltip);

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

  // 12 distinct hues; series past the palette repeat it with a dashed stroke.
  const PALETTE = ['#7c84ff','#34d399','#f59e0b','#f87171','#a78bfa','#38bdf8','#fb923c','#4ade80','#e879f9','#facc15','#2dd4bf','#f472b6'];

  async function loadResources() {
    resLoading = true;
    const { from, to } = getRange();
    resData = await api.getAllContainerStats({ from: toApiTs(from), to: toApiTs(to) });
    resLoading = false;
    await tick();   // let resSummary derive from the new resData first
    if (!selectionInit) { selectTop(3); selectionInit = true; }
  }

  // Group rows by container_name, build per-container time series
  $: byContainer = resData.reduce((acc, r) => {
    (acc[r.container_name] = acc[r.container_name] || []).push(r);
    return acc;
  }, {});

  $: containerNames = Object.keys(byContainer).sort();
  // Colour is tied to the alphabetical index so it is stable across ranges.
  $: colorIdx = Object.fromEntries(containerNames.map((n, i) => [n, i]));
  const colorOf = (name) => PALETTE[(colorIdx[name] ?? 0) % PALETTE.length];
  const dashedOf = (name) => (colorIdx[name] ?? 0) >= PALETTE.length;

  // ── selection: which containers are highlighted (shared by all three charts)
  // Persisted in ?s=a,b so a phone bookmark keeps it.
  let selected = new Set();
  let selectionInit = false;
  onMount(() => {
    const s = new URLSearchParams(location.search).get('s');
    if (s) { selected = new Set(s.split(',').filter(Boolean)); selectionInit = true; }
  });
  function syncUrl() {
    try {
      const u = new URL(location.href);
      if (selected.size) u.searchParams.set('s', [...selected].join(',')); else u.searchParams.delete('s');
      replaceState(u, history.state ?? {});
    } catch {}
  }
  function toggleSeries(name) {
    const n = new Set(selected);
    n.has(name) ? n.delete(name) : n.add(name);
    selected = n; syncUrl();
  }
  function selectTop(n) { selected = new Set(resSummary.slice(0, n).map(s => s.name)); syncUrl(); }
  function selectAll()  { selected = new Set(containerNames); syncUrl(); }
  function clearSel()   { selected = new Set(); syncUrl(); }

  // All unique timestamps (x-axis labels) — downsample to max 120 ticks
  $: allTs = [...new Set(resData.map(r => r.recorded_at))].sort();
  $: labels = downsample(allTs, 120);

  function downsample(arr, max) {
    if (arr.length <= max) return arr;
    const step = Math.ceil(arr.length / max);
    return arr.filter((_, i) => i % step === 0);
  }

  function labelFmt(ts) { return fmtUtcTs(ts); }

  // Selected series: full colour, thick, drawn on top. Others: thin and dim
  // (or normal when nothing is selected).
  function styled(name, data) {
    const color = colorOf(name);
    const sel = selected.has(name);
    const any = selected.size > 0;
    return {
      label: name,
      data,
      borderColor: any && !sel ? hexToRgba(color, '0.18') : color,
      backgroundColor: hexToRgba(color, '0.08'),
      borderWidth: sel ? 2.5 : 1.25,
      borderDash: dashedOf(name) ? [5, 3] : [],
      order: sel ? 0 : 1,
      fill: false, tension: 0.3, pointRadius: 0, spanGaps: true,
    };
  }

  function makeDataset(name, field) {
    const rows = byContainer[name] || [];
    const rowMap = Object.fromEntries(rows.map(r => [r.recorded_at, r]));
    return styled(name, labels.map(ts => { const r = rowMap[ts]; return r ? +r[field].toFixed(2) : null; }));
  }

  function makeNetDataset(name) {
    const rows = (byContainer[name] || []).sort((a,b) => a.recorded_at.localeCompare(b.recorded_at));
    const deltaMap = {};
    for (let i = 1; i < rows.length; i++) {
      const delta = Math.max(0, (rows[i].net_rx_bytes + rows[i].net_tx_bytes) - (rows[i-1].net_rx_bytes + rows[i-1].net_tx_bytes));
      deltaMap[rows[i].recorded_at] = +(delta / 1024).toFixed(1); // KB
    }
    return styled(name, labels.map(ts => deltaMap[ts] ?? null));
  }

  // A series that is 0/empty across the whole window is noise; drop it from
  // that chart and say how many were dropped.
  const live = (ds) => ds.data.some(v => v) || selected.has(ds.label);
  $: cpuAll = containerNames.map(n => makeDataset(n, 'cpu_percent', selected));
  $: memAll = containerNames.map(n => makeDataset(n, 'mem_usage_mb', selected));
  $: netAll = containerNames.map(n => makeNetDataset(n, selected));
  $: cpuDatasets = cpuAll.filter(live);
  $: memDatasets = memAll.filter(live);
  $: netDatasets = netAll.filter(live);
  $: idle = { cpu: cpuAll.length - cpuDatasets.length, mem: memAll.length - memDatasets.length, net: netAll.length - netDatasets.length };

  $: cpuChartData = { labels: labels.map(labelFmt), datasets: cpuDatasets };
  $: memChartData = { labels: labels.map(labelFmt), datasets: memDatasets };
  $: netChartData = { labels: labels.map(labelFmt), datasets: netDatasets };

  // Summary stats (also the legend order: busiest first)
  $: resSummary = containerNames.map(name => {
    const rows = byContainer[name];
    const avgCpu = rows.reduce((s,r) => s + r.cpu_percent, 0) / rows.length;
    const peakMem = Math.max(...rows.map(r => r.mem_usage_mb));
    const lastRow = rows[rows.length - 1];
    return { name, avgCpu, peakMem, currentCpu: lastRow?.cpu_percent ?? 0, currentMem: lastRow?.mem_usage_mb ?? 0 };
  }).sort((a,b) => b.avgCpu - a.avgCpu);

  // ── shared chart options ─────────────────────────────────────────
  // Tooltip: only the selected series, sorted by value, anchored beside the
  // cursor rather than under it. Click near a line toggles that series.
  const baseOpts = (yLabel, sel) => ({
    responsive: true,
    maintainAspectRatio: false,   // .chart-body sets the height
    animation: false,
    interaction: { mode: 'index', intersect: false },
    onClick: (evt, _els, chart) => {
      const hits = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false, axis: 'xy' }, true);
      if (hits.length) toggleSeries(chart.data.datasets[hits[0].datasetIndex].label);
    },
    plugins: {
      legend: { display: false },   // HTML legend below the stat cards
      tooltip: {
        enabled: sel.size > 0,
        position: 'side',
        // No 'click': on touch, the click after touchend would re-open the
        // tooltip that hideTooltipOnTouchEnd just closed. Hover/long-press only.
        events: ['mousemove', 'mouseout', 'touchstart', 'touchmove'],
        filter: (item) => sel.has(item.dataset.label) && item.parsed.y != null,
        itemSort: (a, b) => b.parsed.y - a.parsed.y,
        callbacks: { title: items => items[0]?.label ?? '' },
      },
    },
    scales: {
      x: { ticks: { color: '#64748b', maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#1e2235' } },
      y: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' }, beginAtZero: true, title: { display: !!yLabel, text: yLabel, color: '#64748b', font: { size: 10 } } },
    },
  });

  $: cpuOpts = (() => { const o = baseOpts('%', selected); o.scales.y.max = 100; return o; })();
  $: memOpts = baseOpts('MB', selected);
  $: netOpts = baseOpts('KB/30s', selected);
  const resPlugins = [hideTooltipOnTouchEnd];

  const proxyOpts = {
    responsive: true,
    maintainAspectRatio: false,   // .chart-body sets the height
    plugins: { legend: { display: false }, tooltip: { position: 'side', events: ['mousemove', 'mouseout', 'touchstart', 'touchmove'] } },
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
        <button type="button" class="stat" class:selected={selected.has(s.name)} style="border-left: 3px solid {colorOf(s.name)}"
          on:click={() => toggleSeries(s.name)} title="Toggle {s.name} on the charts">
          <span class="stat-name">{s.name}</span>
          <div class="stat-nums">
            <span><span class="stat-val">{s.currentCpu.toFixed(1)}%</span><span class="stat-label">CPU now</span></span>
            <span><span class="stat-val">{s.currentMem.toFixed(0)}</span><span class="stat-label">MB now</span></span>
            <span><span class="stat-val">{s.avgCpu.toFixed(1)}%</span><span class="stat-label">avg CPU</span></span>
            <span><span class="stat-val">{s.peakMem.toFixed(0)}</span><span class="stat-label">peak MB</span></span>
          </div>
        </button>
      {/each}
    </div>

    <!-- Shared legend: tap a chip (or a line, or a card) to compare containers -->
    <div class="legend">
      <div class="legend-tools">
        <button class="mini" on:click={() => selectTop(3)}>Top 3</button>
        <button class="mini" on:click={() => selectTop(5)}>Top 5</button>
        <button class="mini" on:click={selectAll}>All</button>
        <button class="mini" on:click={clearSel} disabled={selected.size === 0}>Clear</button>
        <span class="legend-hint">{selected.size} of {containerNames.length} highlighted — tap to compare</span>
      </div>
      <div class="chips">
        {#each resSummary as s (s.name)}
          <button type="button" class="chip" class:selected={selected.has(s.name)} style="--c: {colorOf(s.name)}"
            on:click={() => toggleSeries(s.name)}>
            <span class="sw" class:dashed={dashedOf(s.name)}></span>{s.name}
          </button>
        {/each}
      </div>
    </div>

    <div class="charts-col">
      <div class="chart-box wide">
        <h2>CPU Usage (%){#if idle.cpu} <span class="idle">{idle.cpu} idle hidden</span>{/if}</h2>
        <div class="chart-body">
          <Line data={cpuChartData} options={cpuOpts} plugins={resPlugins} />
        </div>
      </div>
      <div class="chart-box wide">
        <h2>Memory Usage (MB){#if idle.mem} <span class="idle">{idle.mem} idle hidden</span>{/if}</h2>
        <div class="chart-body">
          <Line data={memChartData} options={memOpts} plugins={resPlugins} />
        </div>
      </div>
      <div class="chart-box wide">
        <h2>Network I/O (KB per 30s interval){#if idle.net} <span class="idle">{idle.net} idle hidden</span>{/if}</h2>
        <div class="chart-body">
          <Line data={netChartData} options={netOpts} plugins={resPlugins} />
        </div>
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
        <div class="chart-body">
          <Line data={lineData} options={proxyOpts} />
        </div>
      </div>
      <div class="chart-box">
        <h2>Top routes</h2>
        <div class="chart-body">
          <Bar data={barData} options={proxyOpts} />
        </div>
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
    flex: 1; min-width: 0; flex-basis: 160px;
    color: inherit; font: inherit; text-align: left; cursor: pointer;
    transition: border-color 0.15s, opacity 0.15s;
  }
  .stat:hover { border-color: #4a4f7a; }
  .stat.selected { border-color: #7c84ff; box-shadow: 0 0 0 1px #7c84ff inset; }

  .legend { margin-bottom: 1.25rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .legend-tools { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .mini {
    background: #1e2235; color: #94a3b8; border: 1px solid #2d3148; border-radius: 6px;
    padding: 0.3rem 0.6rem; font-size: 0.75rem; cursor: pointer; min-height: 32px;
  }
  .mini:hover { color: #e2e8f0; border-color: #4a4f7a; }
  .mini:disabled { opacity: 0.4; cursor: default; }
  .legend-hint { font-size: 0.75rem; color: #64748b; margin-left: 0.25rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.4rem;
    background: #1a1d27; color: #94a3b8; border: 1px solid #2d3148; border-radius: 999px;
    padding: 0.3rem 0.7rem 0.3rem 0.5rem; font-size: 0.75rem; cursor: pointer; min-height: 32px;
    max-width: 100%; transition: all 0.15s;
  }
  .chip:hover { color: #e2e8f0; border-color: #4a4f7a; }
  .chip.selected { color: #e2e8f0; border-color: var(--c); background: color-mix(in srgb, var(--c) 18%, #1a1d27); }
  .chip .sw { width: 12px; height: 12px; border-radius: 3px; background: var(--c); opacity: 0.45; flex-shrink: 0; }
  .chip.selected .sw { opacity: 1; }
  .chip .sw.dashed { background: repeating-linear-gradient(90deg, var(--c) 0 3px, transparent 3px 5px); }
  .idle { font-size: 0.7rem; color: #475569; text-transform: none; letter-spacing: 0; font-weight: 400; margin-left: 0.5rem; }
  .stat-name { font-size: 0.78rem; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
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
  .chart-body { position: relative; height: 340px; }

  .empty { color: #64748b; font-size: 0.9rem; margin-top: 2rem; }

  @media (pointer: coarse) {
    .tab { min-height: 44px; }
    .chip, .mini { min-height: 40px; }
    .mini { min-width: 44px; }
    .btn, .preset-select, input[type="datetime-local"] { min-height: 40px; }
  }
  @media (max-width: 640px) {
    .tab { padding: 0.6rem 0.8rem; }
    .stat { flex-basis: calc(50% - 0.5rem); padding: 0.7rem 0.8rem; }
    .legend-hint { flex-basis: 100%; }
    .stat-nums { gap: 0.6rem 0.9rem; }
    .stat-val { font-size: 1.1rem; }
    .filters label { flex: 1 1 100%; }
    .filters input[type="datetime-local"] { flex: 1; min-width: 0; }
    .chart-box { padding: 0.75rem; }
    .chart-body { height: 260px; }
  }
</style>
