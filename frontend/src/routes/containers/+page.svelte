<script>
  import { onMount, onDestroy } from 'svelte';
  import { wsMessage } from '$lib/ws';
  import { api } from '$lib/api';

  let containers = [];
  let loading = true;

  async function load() {
    containers = await api.getContainers();
    loading = false;
  }

  onMount(load);

  const unsub = wsMessage.subscribe(msg => {
    if (!msg) return;
    if (msg.type === 'container:started' || msg.type === 'container:stopped' || msg.type === 'container:restarted') load();
  });
  onDestroy(unsub);

  function fmt(status) {
    return status || '—';
  }
</script>

<div class="page-header">
  <h1>Containers</h1>
  <button class="btn" on:click={load}>Refresh</button>
</div>

{#if loading}
  <p class="muted">Loading...</p>
{:else if containers.length === 0}
  <p class="muted">No running containers.</p>
{:else}
  <div class="table-scroll">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Image</th>
        <th>Status</th>
        <th>Port</th>
      </tr>
    </thead>
    <tbody>
      {#each containers as c (c.id)}
        <tr class:offline={!c.running}>
          <td><a href="/containers/{c.id}" class="name-link">{c.name}</a></td>
          <td class="muted">{c.image}</td>
          <td>
            <span class="badge" class:running={c.running} class:stopped={!c.running}>
              {c.running ? 'running' : 'stopped'}
            </span>
          </td>
          <td class="muted">{c.port ? `:${c.port}` : '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  </div>
{/if}

<style>
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h1 { font-size: 1.4rem; font-weight: 700; }

  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; color: #64748b; font-weight: 500; font-size: 0.78rem;
       text-transform: uppercase; letter-spacing: 0.05em; padding: 0.6rem 1rem;
       border-bottom: 1px solid #2d3148; }
  td { padding: 0.75rem 1rem; border-bottom: 1px solid #1e2235; }
  tr.offline td { opacity: 0.5; }

  .name-link { color: #7c84ff; font-weight: 500; }
  .name-link:hover { text-decoration: underline; }
  .muted { color: #64748b; }

  .badge {
    font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.5rem;
    border-radius: 999px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .badge.running { background: #14532d; color: #4ade80; }
  .badge.stopped { background: #3b1515; color: #f87171; }

  .btn {
    background: #3d42a0; color: #e2e8f0; border: none; border-radius: 6px;
    padding: 0.5rem 1rem; font-size: 0.85rem; cursor: pointer; font-weight: 500;
    transition: background 0.15s;
  }
  .btn:hover { background: #4a4fbf; }

  /* Small screens: the table scrolls sideways inside its own box instead of
     pushing the page wider; long cells may wrap; header row wraps. */
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .page-header { flex-wrap: wrap; gap: 0.75rem; }
  @media (max-width: 640px) {
    th, td { padding: 0.5rem; }
  }
  @media (max-width: 640px) {
    td:nth-child(2) { overflow-wrap: anywhere; }   /* image */
  }
</style>
