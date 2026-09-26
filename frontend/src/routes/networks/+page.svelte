<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api';

  let networks = [];
  let loading = true;

  async function load() {
    loading = true;
    try {
      networks = await api.getNetworks();
    } catch (e) {
      console.error(e);
    }
    loading = false;
  }

  onMount(load);
</script>

<div class="page-header">
  <h1>Networks</h1>
  <button class="btn" on:click={load}>Refresh</button>
</div>

{#if loading}
  <p class="muted">Loading...</p>
{:else if networks.length === 0}
  <p class="muted">No networks found.</p>
{:else}
  <div class="table-scroll">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Driver</th>
        <th>Subnet</th>
        <th>Containers</th>
      </tr>
    </thead>
    <tbody>
      {#each networks as n (n.id)}
        <tr>
          <td class="name">{n.name}</td>
          <td class="muted">{n.driver}</td>
          <td class="mono muted">{n.subnet || '—'}</td>
          <td>
            {#if n.containers.length === 0}
              <span class="muted">—</span>
            {:else}
              {#each n.containers as c}
                <span class="chip">{c}</span>
              {/each}
            {/if}
          </td>
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
  td { padding: 0.65rem 1rem; border-bottom: 1px solid #1e2235; vertical-align: middle; }

  .name { font-weight: 500; }
  .mono { font-family: monospace; font-size: 0.8rem; }
  .muted { color: #64748b; }

  .chip {
    display: inline-block; background: #1e2235; color: #94a3b8;
    font-size: 0.75rem; padding: 0.15rem 0.4rem; border-radius: 4px; margin-right: 0.25rem;
  }

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
    .name { overflow-wrap: break-word; }
    .mono { white-space: nowrap; font-size: 0.75rem; }
  }
</style>
