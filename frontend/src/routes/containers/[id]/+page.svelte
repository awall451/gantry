<script>
  import { onMount, onDestroy, afterUpdate, tick } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import { wsSend, statsStore } from '$lib/ws';
  import { openTerminal as openTerminalIn } from '$lib/terminal';
  import {
    Chart, LineController, LineElement, PointElement, LinearScale,
    CategoryScale, Filler, Tooltip
  } from 'chart.js';

  import { registerSideTooltip, hideTooltipOnTouchEnd, tooltipStyle, crosshair } from '$lib/chart-tooltip';
  Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);
  registerSideTooltip(Tooltip);

  const TABS = ['overview', 'history', 'logs', 'inspect', 'terminal'];
  let activeTab = 'overview';
  let id = $page.params.id;
  let container = null;
  let inspect = null;
  let error = null;

  // Logs
  let logLines = [];
  let logEl;
  let autoScroll = true;
  let es;

  // Stats
  const MAX_STATS = 60;
  let statsLabels = [];
  let statsCpuData = [];
  let statsChart;
  let statsChartEl;

  $: stats = $statsStore[id];
  // The canvas only exists once the first stats frame has arrived, which is
  // after onMount; create the chart whenever the element gets bound.
  $: if (statsChartEl && !statsChart) initStatsChart();
  $: if (stats && stats.type !== 'stats:unavailable') updateStatsChart(stats);

  // History tab
  let historyRange = '6h';
  let historyData = [];
  let historyLoading = false;
  let cpuHistChartEl, memHistChartEl, netHistChartEl;
  let cpuHistChart, memHistChart, netHistChart;

  // Terminal
  let termEl;
  let termSession = null;

  // Env var visibility
  let showEnvValues = false;

  async function loadContainer() {
    try {
      const containers = await api.getContainers();
      container = containers.find(c => c.id === id) || null;
    } catch (e) {
      error = e.message;
    }
  }

  async function loadInspect() {
    try {
      inspect = await api.getContainerInspect(id);
    } catch (e) {
      inspect = null;
    }
  }

  function connectLogs() {
    es?.close();
    logLines = [];
    es = new EventSource(`/api/containers/${id}/logs?tail=200&timestamps=true`);
    es.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      if (data.line !== undefined) {
        logLines = [...logLines.slice(-999), data.line];
        if (autoScroll) {
          await tick();
          if (logEl) logEl.scrollTop = logEl.scrollHeight;
        }
      }
    };
  }

  function disconnectLogs() {
    es?.close();
    es = null;
  }

  function updateStatsChart(s) {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    statsLabels = [...statsLabels.slice(-(MAX_STATS - 1)), now];
    statsCpuData = [...statsCpuData.slice(-(MAX_STATS - 1)), s.cpuPercent.toFixed(2)];
    if (statsChart) {
      statsChart.data.labels = statsLabels;
      statsChart.data.datasets[0].data = statsCpuData;
      statsChart.update({ animation: false });
    }
  }

  function initStatsChart() {
    if (!statsChartEl || statsChart) return;
    statsChart = new Chart(statsChartEl, {
      plugins: [hideTooltipOnTouchEnd, crosshair],
      type: 'line',
      data: {
        labels: statsLabels,
        datasets: [{
          data: statsCpuData,
          borderColor: '#7c84ff',
          backgroundColor: 'rgba(124,132,255,0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,   // .chart-wrap sets the height
        plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, position: 'side', events: ['mousemove', 'mouseout', 'touchstart', 'touchmove'] } },
        scales: {
          x: { ticks: { color: '#64748b', maxTicksLimit: 6 }, grid: { color: '#1e2235' } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' }, beginAtZero: true, max: 100 },
        },
      },
    });
  }

  async function openTerminal() {
    if (!termEl) return;
    closeTerminal();
    try {
      termSession = await openTerminalIn(termEl, `/ws/exec/${id}`);
    } catch {
      termEl.textContent = 'xterm not installed. Run: npm install xterm @xterm/addon-fit in frontend/';
    }
  }

  function closeTerminal() {
    termSession?.close();
    termSession = null;
  }

  function fmtBytes(b) {
    if (b == null) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  }

  async function loadHistory() {
    historyLoading = true;
    const hours = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 }[historyRange];
    const to   = new Date().toISOString().slice(0, 19);
    const from = new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 19); // already UTC, DB stores UTC
    historyData = await api.getContainerStats(id, { from, to });
    historyLoading = false;
    await tick();
    renderHistoryCharts();
  }

  function renderHistoryCharts() {
    if (!cpuHistChartEl || !memHistChartEl || !netHistChartEl) return;

    const labels = historyData.map(r => new Date(r.recorded_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const cpuData = historyData.map(r => +r.cpu_percent.toFixed(2));
    const memData = historyData.map(r => +r.mem_usage_mb.toFixed(1));
    const netData = historyData.map((r, i) => {
      if (i === 0) return 0;
      const prev = historyData[i - 1];
      return Math.max(0, (r.net_rx_bytes + r.net_tx_bytes) - (prev.net_rx_bytes + prev.net_tx_bytes));
    });

    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,   // .chart-wrap sets the height
      plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, position: 'side', events: ['mousemove', 'mouseout', 'touchstart', 'touchmove'] } },
      scales: {
        x: { ticks: { color: '#64748b', maxTicksLimit: 8 }, grid: { color: '#1e2235' } },
        y: { ticks: { color: '#64748b' }, grid: { color: '#1e2235' }, beginAtZero: true },
      },
    };

    cpuHistChart?.destroy();
    memHistChart?.destroy();
    netHistChart?.destroy();

    cpuHistChart = new Chart(cpuHistChartEl, {
      plugins: [hideTooltipOnTouchEnd, crosshair],
      type: 'line',
      data: { labels, datasets: [{ data: cpuData, borderColor: '#7c84ff', backgroundColor: 'rgba(124,132,255,0.12)', fill: true, tension: 0.3, pointRadius: 0 }] },
      options: { ...baseOpts, scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, max: 100 } } },
    });
    memHistChart = new Chart(memHistChartEl, {
      plugins: [hideTooltipOnTouchEnd, crosshair],
      type: 'line',
      data: { labels, datasets: [{ data: memData, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)', fill: true, tension: 0.3, pointRadius: 0 }] },
      options: baseOpts,
    });
    netHistChart = new Chart(netHistChartEl, {
      plugins: [hideTooltipOnTouchEnd, crosshair],
      type: 'line',
      data: { labels, datasets: [{ data: netData, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)', fill: true, tension: 0.3, pointRadius: 0 }] },
      options: baseOpts,
    });
  }

  async function switchTab(tab) {
    if (tab === activeTab) return;
    if (activeTab === 'logs') disconnectLogs();
    if (activeTab === 'terminal') closeTerminal();
    if (activeTab === 'overview') { statsChart?.destroy(); statsChart = null; }   // canvas is about to go away
    activeTab = tab;
    await tick();
    if (tab === 'logs') connectLogs();
    if (tab === 'terminal') openTerminal();
    if (tab === 'overview') initStatsChart();
    if (tab === 'history') loadHistory();
  }

  async function containerAction(act) {
    try {
      await api.containerAction(id, act);
      await loadContainer();
    } catch (e) {
      alert(e.message);
    }
  }

  onMount(async () => {
    await Promise.all([loadContainer(), loadInspect()]);
    wsSend({ type: 'stats:subscribe', id });
    await tick();
    initStatsChart();
  });

  onDestroy(() => {
    wsSend({ type: 'stats:unsubscribe', id });
    disconnectLogs();
    closeTerminal();
    statsChart?.destroy();
    cpuHistChart?.destroy();
    memHistChart?.destroy();
    netHistChart?.destroy();
  });

  function parseEnv(env = []) {
    return env.map(e => {
      const i = e.indexOf('=');
      return { key: e.slice(0, i), val: e.slice(i + 1) };
    });
  }
</script>

<div class="back"><a href="/containers">← Containers</a></div>

{#if error}
  <p class="err">{error}</p>
{:else if container}
  <div class="page-header">
    <div>
      <h1>{container.name}</h1>
      <span class="image-label">{container.image}</span>
    </div>
    <div class="ctrl">
      <span class="badge" class:running={container.running} class:stopped={!container.running}>
        {container.running ? 'running' : 'stopped'}
      </span>
      {#if !container.running}
        <button class="btn green" on:click={() => containerAction('start')}>Start</button>
      {:else}
        <button class="btn" on:click={() => containerAction('restart')}>Restart</button>
        <button class="btn red" on:click={() => containerAction('stop')}>Stop</button>
      {/if}
    </div>
  </div>

  <div class="tabs">
    {#each TABS as t}
      <button class="tab" class:active={activeTab === t} on:click={() => switchTab(t)}>
        {t.charAt(0).toUpperCase() + t.slice(1)}
      </button>
    {/each}
  </div>

  {#if activeTab === 'overview'}
    <div class="section">
      <h2>Stats</h2>
      {#if stats && stats.type !== 'stats:unavailable'}
        <div class="stat-row">
          <div class="stat-card">
            <span class="stat-val">{stats.cpuPercent.toFixed(1)}%</span>
            <span class="stat-lbl">CPU</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">{stats.memUsageMB.toFixed(0)} MB</span>
            <span class="stat-lbl">Memory / {stats.memLimitMB.toFixed(0)} MB ({stats.memPercent.toFixed(1)}%)</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">{fmtBytes(stats.netRxBytes)} / {fmtBytes(stats.netTxBytes)}</span>
            <span class="stat-lbl">Net RX / TX</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">{fmtBytes(stats.blkReadBytes)} / {fmtBytes(stats.blkWriteBytes)}</span>
            <span class="stat-lbl">Block Read / Write</span>
          </div>
        </div>
        <div class="chart-wrap">
          <canvas bind:this={statsChartEl}></canvas>
        </div>
      {:else}
        <p class="muted">Stats unavailable (container not running or no stats yet)</p>
      {/if}
    </div>

    {#if inspect}
      <div class="section">
        <h2>Details</h2>
        <div class="kv-grid">
          <span class="k">ID</span><span class="v mono">{inspect.Id.slice(0, 12)}</span>
          <span class="k">Created</span><span class="v">{new Date(inspect.Created).toLocaleString()}</span>
          <span class="k">Restart policy</span><span class="v">{inspect.HostConfig?.RestartPolicy?.Name || '—'}</span>
          <span class="k">Status</span><span class="v">{inspect.State?.Status}</span>
          {#if inspect.State?.StartedAt}
            <span class="k">Started</span><span class="v">{new Date(inspect.State.StartedAt).toLocaleString()}</span>
          {/if}
        </div>
      </div>

      {#if Object.keys(inspect.NetworkSettings?.Ports || {}).length}
        <div class="section">
          <h2>Ports</h2>
          <div class="kv-grid">
            {#each Object.entries(inspect.NetworkSettings.Ports) as [port, bindings]}
              <span class="k mono">{port}</span>
              <span class="v mono">{bindings ? bindings.map(b => `${b.HostIp}:${b.HostPort}`).join(', ') : 'not bound'}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if (inspect.Mounts || []).length}
        <div class="section">
          <h2>Mounts</h2>
          <div class="kv-grid">
            {#each inspect.Mounts as m}
              <span class="k mono">{m.Type}</span>
              <span class="v mono">{m.Source} → {m.Destination}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if (inspect.Config?.Env || []).length}
        <div class="section">
          <h2>
            Environment
            <button class="toggle-btn" on:click={() => showEnvValues = !showEnvValues}>
              {showEnvValues ? 'Hide values' : 'Show values'}
            </button>
          </h2>
          <div class="kv-grid">
            {#each parseEnv(inspect.Config.Env) as { key, val }}
              <span class="k mono">{key}</span>
              <span class="v mono">{showEnvValues ? val : '••••••'}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if Object.keys(inspect.Config?.Labels || {}).length}
        <div class="section">
          <h2>Labels</h2>
          <div class="kv-grid">
            {#each Object.entries(inspect.Config.Labels) as [k, v]}
              <span class="k mono">{k}</span>
              <span class="v mono">{v || '—'}</span>
            {/each}
          </div>
        </div>
      {/if}
    {/if}

  {:else if activeTab === 'history'}
    <div class="section">
      <div class="history-controls">
        <label>Range
          <select bind:value={historyRange} on:change={loadHistory}>
            <option value="1h">Last 1h</option>
            <option value="6h">Last 6h</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
          </select>
        </label>
        <button class="btn sm" on:click={loadHistory}>Refresh</button>
      </div>
      {#if historyLoading}
        <p class="muted">Loading...</p>
      {:else if historyData.length === 0}
        <p class="muted">No historical data yet — stats are sampled every 30s.</p>
      {:else}
        <h2>CPU %</h2>
        <div class="chart-wrap"><canvas bind:this={cpuHistChartEl}></canvas></div>
        <h2>Memory (MB)</h2>
        <div class="chart-wrap"><canvas bind:this={memHistChartEl}></canvas></div>
        <h2>Network I/O (bytes per 30s)</h2>
        <div class="chart-wrap"><canvas bind:this={netHistChartEl}></canvas></div>
      {/if}
    </div>

  {:else if activeTab === 'logs'}
    <div class="log-controls">
      <label>
        <input type="checkbox" bind:checked={autoScroll} />
        Auto-scroll
      </label>
      <button class="btn sm" on:click={connectLogs}>Reconnect</button>
    </div>
    <pre class="log-box" bind:this={logEl}
      on:scroll={() => { autoScroll = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 10; }}
    >{logLines.join('\n')}</pre>

  {:else if activeTab === 'inspect'}
    <pre class="inspect-box">{JSON.stringify(inspect, null, 2)}</pre>

  {:else if activeTab === 'terminal'}
    <div class="term-wrap" bind:this={termEl}></div>
  {/if}

{:else}
  <p class="muted">Loading...</p>
{/if}

<style>
  .back { margin-bottom: 1.25rem; }
  .back a { color: #64748b; font-size: 0.875rem; }
  .back a:hover { color: #e2e8f0; }

  .page-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: 1.5rem; gap: 1rem; flex-wrap: wrap;
  }
  .page-header > div:first-child { min-width: 0; }
  h1 { font-size: 1.4rem; font-weight: 700; overflow-wrap: anywhere; }
  .image-label { font-size: 0.8rem; color: #64748b; overflow-wrap: anywhere; }

  .ctrl { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; }

  .badge {
    font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.5rem;
    border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .badge.running { background: #14532d; color: #4ade80; }
  .badge.stopped { background: #3b1515; color: #f87171; }

  .btn {
    background: #3d42a0; color: #e2e8f0; border: none; border-radius: 6px;
    padding: 0.45rem 0.9rem; font-size: 0.85rem; cursor: pointer; font-weight: 500;
    transition: background 0.15s;
  }
  .btn:hover { background: #4a4fbf; }
  .btn.green { background: #14532d; color: #4ade80; }
  .btn.green:hover { background: #166534; }
  .btn.red { background: #3b1515; color: #f87171; }
  .btn.red:hover { background: #4b1c1c; }
  .btn.sm { padding: 0.3rem 0.6rem; font-size: 0.78rem; }

  /* The tab strip scrolls sideways when it does not fit (phones). */
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

  .section { margin-bottom: 1.5rem; }
  h2 {
    font-size: 0.85rem; font-weight: 600; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 0.06em;
    margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.75rem;
  }

  .stat-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
  .stat-card {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 8px;
    padding: 0.75rem 1.25rem; display: flex; flex-direction: column; gap: 0.2rem;
  }
  .stat-val { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat-lbl { font-size: 0.75rem; color: #64748b; }

  .chart-wrap {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 8px; padding: 1rem;
    position: relative; height: 260px;
  }
  .chart-wrap canvas { touch-action: pan-y; }   /* horizontal drag scrubs, vertical scrolls */

  .kv-grid {
    display: grid; grid-template-columns: minmax(140px, max-content) 1fr;
    gap: 0.3rem 1.5rem; font-size: 0.82rem;
  }
  .k { color: #64748b; }
  .v { color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: monospace; font-size: 0.8rem; }

  .toggle-btn {
    background: none; border: 1px solid #2d3148; border-radius: 4px;
    color: #64748b; cursor: pointer; font-size: 0.72rem; padding: 0.1rem 0.4rem;
    transition: all 0.15s;
  }
  .toggle-btn:hover { color: #e2e8f0; border-color: #4a4f7a; }

  .log-controls {
    display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem; font-size: 0.82rem; color: #94a3b8;
  }
  .log-controls label { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; }

  .log-box {
    background: #0a0c12; border: 1px solid #2d3148; border-radius: 8px;
    padding: 1rem; font-size: 0.78rem; font-family: monospace;
    overflow-y: auto; max-height: 60vh; white-space: pre-wrap; word-break: break-all;
    color: #c8d3e0; line-height: 1.5;
  }

  .inspect-box {
    background: #0a0c12; border: 1px solid #2d3148; border-radius: 8px;
    padding: 1rem; font-size: 0.78rem; font-family: monospace;
    overflow: auto; max-height: 70vh; color: #c8d3e0; line-height: 1.5;
  }

  .term-wrap { height: 60vh; background: #0f1117; border-radius: 8px; overflow: hidden; padding: 0.5rem; }

  .history-controls, .log-controls { flex-wrap: wrap; }
  .history-controls {
    display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem; font-size: 0.82rem; color: #94a3b8;
  }
  .history-controls label { display: flex; align-items: center; gap: 0.4rem; }
  .history-controls select {
    background: #1a1d27; border: 1px solid #2d3148; color: #e2e8f0;
    border-radius: 6px; padding: 0.3rem 0.5rem; font-size: 0.8rem; outline: none;
  }

  .muted { color: #64748b; }
  .err { color: #f87171; }

  @media (pointer: coarse) {
    .tab { min-height: 44px; }
    .btn { min-height: 40px; }
  }
  @media (max-width: 640px) {
    .tab { padding: 0.6rem 0.8rem; }
    .chart-wrap { height: 220px; padding: 0.5rem; }
    .term-wrap { height: 50vh; }
  }
</style>
