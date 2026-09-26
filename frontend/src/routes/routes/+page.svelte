<script>
  import { onMount, onDestroy } from 'svelte';
  import { wsMessage } from '$lib/ws';
  import { api } from '$lib/api';
  import { settings, hostsFor, urlFor } from '$lib/settings';

  let routes = [];
  let editingId = null;
  let editingValue = '';
  let error = '';

  async function load() {
    routes = await api.getRoutes();
  }

  onMount(load);

  const unsub = wsMessage.subscribe(msg => {
    if (msg?.type === 'routes:updated') routes = msg.routes;
  });
  onDestroy(unsub);

  function startEdit(r) {
    editingId = r.id;
    editingValue = r.hostname;
  }

  function cancelEdit() {
    editingId = null;
    editingValue = '';
  }

  async function saveEdit(r) {
    const hostname = editingValue.trim();
    if (!hostname) return;
    try {
      await api.updateRoute(r.id, { hostname });
      routes = routes.map(x => x.id === r.id ? { ...x, hostname } : x);
      cancelEdit();
    } catch (e) {
      error = e.message;
    }
  }

  async function toggleEnabled(r) {
    await api.updateRoute(r.id, { enabled: !r.enabled });
    routes = routes.map(x => x.id === r.id ? { ...x, enabled: r.enabled ? 0 : 1 } : x);
  }

  async function deleteRoute(id) {
    if (!confirm('Remove this route?')) return;
    await api.deleteRoute(id);
    routes = routes.filter(x => x.id !== id);
  }
</script>

<h1>Routes</h1>
{#if error}<p class="error">{error}</p>{/if}

<table>
  <thead>
    <tr>
      <th>Hostname</th>
      <th>Container</th>
      <th>Port</th>
      <th>Type</th>
      <th>Enabled</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    {#each routes as r (r.id)}
      <tr class:disabled={!r.enabled}>
        <td class="hostname-cell">
          {#if editingId === r.id}
            <input
              class="inline-edit"
              bind:value={editingValue}
              on:keydown={e => { if (e.key === 'Enter') saveEdit(r); else if (e.key === 'Escape') cancelEdit(); }}
            />
          {:else}
            {#each hostsFor(r.hostname, $settings.values) as h, i}
              <a class="hostname" class:secondary={i > 0} href={urlFor(h, $settings.values)} target="_blank" rel="noopener">{h}</a>
            {/each}
          {/if}
        </td>
        <td class="muted">{r.container_name}</td>
        <td class="muted">:{r.target_port}</td>
        <td>
          <span class="type-badge" class:auto={r.is_auto} class:manual={!r.is_auto}>
            {r.is_auto ? 'auto' : 'manual'}
          </span>
        </td>
        <td>
          <button class="toggle" class:on={r.enabled} on:click={() => toggleEnabled(r)}>
            {r.enabled ? 'on' : 'off'}
          </button>
        </td>
        <td>
          <div class="actions-cell">
            {#if editingId === r.id}
              <button class="icon-btn" on:click={() => saveEdit(r)} title="Save">✓</button>
              <button class="icon-btn muted" on:click={cancelEdit} title="Cancel">✕</button>
            {:else}
              <button class="icon-btn muted" on:click={() => startEdit(r)} title="Edit">✎</button>
              <button class="icon-btn danger" on:click={() => deleteRoute(r.id)} title="Delete">✕</button>
            {/if}
          </div>
        </td>
      </tr>
    {/each}
  </tbody>
</table>

{#if routes.length === 0}
  <p class="empty">No routes yet. Start a Docker container or add a manual route from the dashboard.</p>
{/if}

<style>
  h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 1.5rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; color: #64748b; font-weight: 500; padding: 0.5rem 0.75rem; border-bottom: 1px solid #2d3148; }
  td { padding: 0.75rem; border-bottom: 1px solid #1e2235; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr.disabled { opacity: 0.45; }

  .actions-cell { display: flex; align-items: center; gap: 0.25rem; justify-content: flex-end; }
  .hostname { font-weight: 500; color: #7c84ff; display: block; }
  .hostname.secondary { color: #64748b; font-weight: 400; font-size: 0.8rem; }
  .hostname:hover { text-decoration: underline; }

  .inline-edit {
    background: #0f1117; border: 1px solid #7c84ff; border-radius: 4px;
    color: #e2e8f0; padding: 0.25rem 0.5rem; font-size: 0.875rem; outline: none; width: 180px;
  }

  .muted { color: #64748b; }

  .icon-btn {
    background: none; border: none; cursor: pointer; color: #94a3b8;
    font-size: 0.9rem; padding: 0.1rem 0.3rem; border-radius: 4px; line-height: 1;
    transition: color 0.15s;
  }
  .icon-btn:hover { color: #e2e8f0; }
  .icon-btn.danger:hover { color: #f87171; }

  .type-badge {
    font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.4rem;
    border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .type-badge.auto { background: #172554; color: #93c5fd; }
  .type-badge.manual { background: #2d1b4e; color: #c4b5fd; }

  .toggle {
    font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.6rem;
    border-radius: 999px; border: none; cursor: pointer;
    background: #2d3148; color: #64748b; transition: all 0.15s;
  }
  .toggle.on { background: #14532d; color: #4ade80; }

  .empty { color: #64748b; font-size: 0.9rem; margin-top: 2rem; }
  .error { color: #f87171; font-size: 0.85rem; margin-bottom: 1rem; }
</style>
