<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api';
  import { containerEventMessage } from '$lib/ws';

  let events = [];
  let loading = true;
  let rangeHours = 24;

  async function load() {
    loading = true;
    const from = new Date(Date.now() - rangeHours * 3_600_000).toISOString().slice(0, 19);
    events = await api.getAllContainerEvents({ from, limit: 500 });
    loading = false;
  }

  onMount(load);

  const unsub = containerEventMessage.subscribe(msg => {
    if (!msg) return;
    events = [
      {
        container_id: msg.container_id,
        container_name: msg.container_name,
        action: msg.action,
        exit_code: msg.exit_code ?? null,
        occurred_at: msg.occurred_at,
      },
      ...events,
    ].slice(0, 500);
  });
  onDestroy(unsub);

  const ACTION_COLOR = {
    start:   '#4ade80',
    unpause: '#4ade80',
    die:     '#f87171',
    destroy: '#f87171',
    kill:    '#f87171',
    oom:     '#f87171',
    pause:   '#fbbf24',
  };
</script>

<div class="page-header">
  <h1>Container Events</h1>
  <div class="filters">
    <select bind:value={rangeHours} on:change={load}>
      <option value={1}>Last 1h</option>
      <option value={6}>Last 6h</option>
      <option value={24}>Last 24h</option>
      <option value={168}>Last 7d</option>
    </select>
    <button class="btn" on:click={load}>Refresh</button>
  </div>
</div>

{#if loading}
  <p class="empty">Loading...</p>
{:else if events.length === 0}
  <p class="empty">No events in this time range.</p>
{:else}
  <div class="table-scroll">
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Container</th>
        <th>Event</th>
        <th>Exit Code</th>
      </tr>
    </thead>
    <tbody>
      {#each events as e (e.id ?? `${e.occurred_at}${e.container_id}${e.action}`)}
        <tr>
          <td class="mono muted"><span class="date">{e.occurred_at.slice(0, 10)}</span> <span class="time">{e.occurred_at.slice(11, 19)}</span></td>
          <td>
            {#if e.container_id}
              <a href="/containers/{e.container_id}" class="name-link">{e.container_name}</a>
            {:else}
              <span class="muted">{e.container_name}</span>
            {/if}
          </td>
          <td>
            <span class="badge" style="color: {ACTION_COLOR[e.action] || '#94a3b8'}">{e.action}</span>
          </td>
          <td class="mono muted">{e.exit_code != null ? e.exit_code : '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  </div>
{/if}

<style>
  .page-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1.5rem; gap: 1rem;
  }
  h1 { font-size: 1.4rem; font-weight: 700; }

  .filters { display: flex; align-items: center; gap: 0.75rem; }
  select {
    background: #1a1d27; border: 1px solid #2d3148; color: #e2e8f0;
    border-radius: 6px; padding: 0.4rem 0.6rem; font-size: 0.8rem; outline: none;
  }
  select:focus { border-color: #7c84ff; }

  .btn {
    background: #3d42a0; color: #e2e8f0; border: none; border-radius: 6px;
    padding: 0.45rem 0.9rem; font-size: 0.85rem; cursor: pointer;
  }
  .btn:hover { background: #4a4fbf; }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  thead th {
    text-align: left; padding: 0.5rem 0.75rem; font-size: 0.75rem;
    color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;
    border-bottom: 1px solid #2d3148;
  }
  tbody tr { border-bottom: 1px solid #1e2235; }
  tbody tr:hover { background: #1a1d27; }
  td { padding: 0.55rem 0.75rem; color: #e2e8f0; }

  .mono { font-family: monospace; font-size: 0.8rem; }
  .muted { color: #64748b; }

  .badge {
    font-size: 0.75rem; font-weight: 600;
    padding: 0.15rem 0.5rem; border-radius: 999px;
    background: rgba(255,255,255,0.05);
  }

  .name-link { color: #7c84ff; text-decoration: none; }
  .name-link:hover { text-decoration: underline; }

  .empty { color: #64748b; font-size: 0.9rem; margin-top: 2rem; }

  /* Small screens: the table scrolls sideways inside its own box instead of
     pushing the page wider; long cells may wrap; header row wraps. */
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .page-header { flex-wrap: wrap; gap: 0.75rem; }
  @media (max-width: 640px) {
    th, td { padding: 0.5rem; }
  }
  .filters { flex-wrap: wrap; }
  @media (max-width: 640px) {
    .mono { font-size: 0.72rem; white-space: nowrap; }
    .date { display: block; }
  }
</style>
