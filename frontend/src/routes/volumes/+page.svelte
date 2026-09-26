<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api';

  let volumes = [];
  let loading = true;
  let confirming = {};
  let errors = {};

  async function load() {
    loading = true;
    try {
      volumes = await api.getVolumes();
    } catch (e) {
      console.error(e);
    }
    loading = false;
  }

  async function remove(name) {
    errors[name] = '';
    try {
      await api.removeVolume(name);
      volumes = volumes.filter(v => v.Name !== name);
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(msg).error; } catch {}
      errors[name] = msg;
    }
    confirming[name] = false;
  }

  function shortMount(path) {
    if (!path) return '—';
    const parts = path.split('/').filter(Boolean);
    return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : path;
  }

  onMount(load);
</script>

<div class="page-header">
  <h1>Volumes</h1>
  <button class="btn" on:click={load}>Refresh</button>
</div>

{#if loading}
  <p class="muted">Loading...</p>
{:else if volumes.length === 0}
  <p class="muted">No volumes found.</p>
{:else}
  <div class="table-scroll">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Driver</th>
        <th>Mountpoint</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each volumes as v (v.Name)}
        <tr>
          <td class="mono">{v.Name}</td>
          <td class="muted">{v.Driver}</td>
          <td class="mono muted" title={v.Mountpoint}>{shortMount(v.Mountpoint)}</td>
          <td>
            <div class="action-cell">
              {#if errors[v.Name]}
                <span class="err-inline">{errors[v.Name]}</span>
              {/if}
              {#if confirming[v.Name]}
                <span class="confirm-txt">Remove?</span>
                <button class="icon-btn danger" on:click={() => remove(v.Name)}>Yes</button>
                <button class="icon-btn" on:click={() => { confirming[v.Name] = false; errors[v.Name] = ''; }}>No</button>
              {:else}
                <button class="icon-btn danger" on:click={() => { confirming[v.Name] = true; errors[v.Name] = ''; }}>Remove</button>
              {/if}
            </div>
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

  .mono { font-family: monospace; font-size: 0.8rem; }
  .muted { color: #64748b; }

  .action-cell { display: flex; align-items: center; gap: 0.4rem; justify-content: flex-end; }
  .confirm-txt { font-size: 0.78rem; color: #94a3b8; }
  .err-inline { font-size: 0.75rem; color: #f87171; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }

  .icon-btn {
    background: none; border: 1px solid #2d3148; border-radius: 4px;
    color: #94a3b8; cursor: pointer; font-size: 0.78rem;
    padding: 0.25rem 0.6rem; transition: all 0.15s;
  }
  .icon-btn:hover { border-color: #4a4f7a; color: #e2e8f0; }
  .icon-btn.danger:hover { border-color: #f87171; color: #f87171; }

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
  /* Hashed volume names and mountpoints are long even on desktop. */
  td.mono { overflow-wrap: anywhere; }
  @media (max-width: 640px) {
    .err-inline { max-width: 140px; }
  }
</style>
