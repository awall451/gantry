<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api';
  import { wsSend, statsStore } from '$lib/ws';
  import { settings, hostsFor, primaryUrl, urlFor } from '$lib/settings';

  export let container;
  export let route;

  let loading = false;
  let expanded = false;
  let localRunning = container.running;

  $: localRunning = container.running;
  $: hostname = route ? route.hostname : container.name;
  $: url = primaryUrl(hostname, $settings.values);
  $: stats = $statsStore[container.id];

  async function action(act) {
    if (loading) return;
    loading = true;
    try {
      await api.containerAction(container.id, act);
      localRunning = act === 'start';
    } catch {}
    loading = false;
  }

  onMount(() => {
    if (container.running) wsSend({ type: 'stats:subscribe', id: container.id });
  });

  onDestroy(() => {
    wsSend({ type: 'stats:unsubscribe', id: container.id });
  });
</script>

<div class="row-wrap" class:offline={!localRunning} class:expanded>
  <div class="row" on:click={() => expanded = !expanded} role="button" tabindex="0"
    on:keydown={e => e.key === 'Enter' && (expanded = !expanded)}>

    <span class="chevron">{expanded ? '▾' : '▸'}</span>

    <span class="status-dot" class:running={localRunning} class:stopped={!localRunning}></span>

    <span class="name">{container.name}</span>

    <span class="image muted">{container.image}</span>

    {#if container.port}
      <span class="port muted">:{container.port}</span>
    {:else}
      <span class="port muted no-port">no port</span>
    {/if}

    {#if container.port}
      <a class="url" href={url} target="_blank" rel="noopener"
        on:click|stopPropagation>{url}</a>
    {:else}
      <span class="url"></span>
    {/if}

    <span class="stats-inline">
      {#if stats && stats.type !== 'stats:unavailable'}
        <span class="stat">CPU {stats.cpuPercent.toFixed(1)}%</span>
        <span class="stat">MEM {stats.memUsageMB.toFixed(0)} MB</span>
      {:else if localRunning}
        <span class="stat muted">—</span>
      {/if}
    </span>

    <div class="actions" on:click|stopPropagation role="none">
      {#if !localRunning}
        <button class="icon-btn start" title="Start" disabled={loading} on:click={() => action('start')}>▶</button>
      {:else}
        <button class="icon-btn" title="Restart" disabled={loading} on:click={() => action('restart')}>↺</button>
        <button class="icon-btn stop" title="Stop" disabled={loading} on:click={() => action('stop')}>■</button>
      {/if}
    </div>
  </div>

  {#if expanded}
    <div class="detail">
      <div class="detail-grid">
        <span class="dk">Status</span>
        <span class="dv">
          <span class="badge" class:running={localRunning} class:stopped={!localRunning}>
            {localRunning ? 'running' : 'stopped'}
          </span>
        </span>

        {#if route}
          <span class="dk">Route</span>
          <span class="dv">
            {#each hostsFor(route.hostname, $settings.values) as h, i}{#if i}<span class="muted"> · </span>{/if}<a class="route-link" class:alt={i > 0} href={urlFor(h, $settings.values)} target="_blank" rel="noopener">{h}</a>{/each}
            {#if !route.enabled}<span class="tag warn">disabled</span>{/if}
            <span class="tag {route.is_auto ? 'auto' : 'manual'}">{route.is_auto ? 'auto' : 'manual'}</span>
          </span>

          <span class="dk">Port</span>
          <span class="dv">:{route.target_port}</span>
        {:else}
          <span class="dk">Route</span>
          <span class="dv muted">none</span>
        {/if}

        <span class="dk">Image</span>
        <span class="dv mono">{container.image}</span>

        {#if stats && stats.type !== 'stats:unavailable'}
          <span class="dk">CPU</span>
          <span class="dv">{stats.cpuPercent.toFixed(2)}%</span>
          <span class="dk">Memory</span>
          <span class="dv">{stats.memUsageMB.toFixed(1)} MB / {stats.memLimitMB.toFixed(0)} MB ({stats.memPercent.toFixed(1)}%)</span>
        {/if}
      </div>

      <div class="detail-actions">
        <a class="detail-link" href="/containers/{container.id}">View details →</a>
      </div>
    </div>
  {/if}
</div>

<style>
  .row-wrap {
    background: #1a1d27;
    border: 1px solid #2d3148;
    border-radius: 8px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .row-wrap:hover { border-color: #3d4270; }
  .row-wrap.offline { opacity: 0.6; }
  .row-wrap.expanded { border-color: #4a4f7a; }

  .row {
    display: grid;
    grid-template-columns: 20px 10px 180px 1fr 60px 200px 120px 80px;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    cursor: pointer;
    user-select: none;
    min-width: 0;
  }

  .chevron { font-size: 0.7rem; color: #475569; }

  .status-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  .status-dot.running { background: #4ade80; box-shadow: 0 0 6px #4ade8088; }
  .status-dot.stopped { background: #f87171; }

  .name { font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .image { font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .port { font-size: 0.78rem; font-family: monospace; }
  .no-port { color: #475569; font-family: inherit; }

  .url { font-size: 0.8rem; color: #7c84ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .url:hover { text-decoration: underline; }

  .stats-inline {
    display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.73rem;
    font-variant-numeric: tabular-nums;
  }
  .stat { color: #64748b; }

  .actions { display: flex; gap: 0.25rem; justify-content: flex-end; }
  .icon-btn {
    background: none; border: 1px solid #2d3148; border-radius: 4px;
    color: #94a3b8; cursor: pointer; font-size: 0.72rem;
    padding: 0.2rem 0.45rem; line-height: 1; transition: all 0.15s;
  }
  .icon-btn:hover { border-color: #4a4f7a; color: #e2e8f0; }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .icon-btn.start:hover { border-color: #4ade80; color: #4ade80; }
  .icon-btn.stop:hover { border-color: #f87171; color: #f87171; }

  .muted { color: #64748b; }

  /* Expanded detail panel */
  .detail {
    border-top: 1px solid #2d3148;
    padding: 1rem 1.25rem;
    background: #141720;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1.5rem;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.3rem 1rem;
    font-size: 0.82rem;
  }
  .dk { color: #64748b; }
  .dv { color: #e2e8f0; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .mono { font-family: monospace; font-size: 0.78rem; }

  .badge {
    font-size: 0.68rem; font-weight: 600; padding: 0.15rem 0.45rem;
    border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .badge.running { background: #14532d; color: #4ade80; }
  .badge.stopped { background: #3b1515; color: #f87171; }

  .tag {
    font-size: 0.68rem; font-weight: 600; padding: 0.15rem 0.4rem;
    border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .tag.auto { background: #172554; color: #93c5fd; }
  .tag.manual { background: #2d1b4e; color: #c4b5fd; }
  .tag.warn { background: #3b2a00; color: #fbbf24; }

  .detail-actions { flex-shrink: 0; }
  .detail-link { font-size: 0.82rem; color: #7c84ff; white-space: nowrap; }
  .detail-link:hover { text-decoration: underline; }
  .route-link { color: #7c84ff; }
  .route-link.alt { color: #64748b; }
  .route-link:hover { text-decoration: underline; }
</style>
