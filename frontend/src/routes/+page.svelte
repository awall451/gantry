<script>
  import { onMount, onDestroy } from 'svelte';
  import { wsMessage } from '$lib/ws';
  import { api } from '$lib/api';
  import ContainerCard from '$lib/components/ContainerCard.svelte';
  import { settings } from '$lib/settings';

  let containers = [];
  let routes = [];
  let showAddModal = false;
  let addForm = { container_name: '', hostname: '', target_port: '' };
  let addError = '';

  async function load() {
    [containers, routes] = await Promise.all([api.getContainers(), api.getRoutes()]);
  }

  onMount(load);

  const unsub = wsMessage.subscribe(msg => {
    if (!msg) return;
    if (msg.type === 'routes:updated') { routes = msg.routes; }
    if (msg.type === 'container:started' || msg.type === 'container:stopped' || msg.type === 'container:restarted') load();
  });
  onDestroy(unsub);

  function routeForContainer(c) {
    return routes.find(r => r.container_id === c.id)
        || routes.find(r => r.container_name === c.name);
  }

  $: routed   = containers.filter(c => c.port);
  $: unrouted = containers.filter(c => !c.port);

  async function submitAdd() {
    addError = '';
    try {
      await api.createRoute({ ...addForm, target_port: Number(addForm.target_port) });
      showAddModal = false;
      addForm = { container_name: '', hostname: '', target_port: '' };
      routes = await api.getRoutes();
    } catch (e) {
      addError = e.message;
    }
  }
</script>

<div class="page-header">
  <h1>Dashboard</h1>
  <button class="btn" on:click={() => showAddModal = true}>+ Add manual route</button>
</div>

{#if containers.length === 0}
  <p class="empty">No running containers detected.</p>
{:else}
  {#if routed.length > 0}
    <div class="section-header">
      <span class="section-title">Routed</span>
      <span class="section-count">{routed.length}</span>
    </div>
    <div class="list">
      {#each routed as c (c.id)}
        <ContainerCard container={c} route={routeForContainer(c)} />
      {/each}
    </div>
  {/if}

  {#if unrouted.length > 0}
    <div class="section-header" class:mt={routed.length > 0}>
      <span class="section-title">No exposed port</span>
      <span class="section-count">{unrouted.length}</span>
    </div>
    <div class="list">
      {#each unrouted as c (c.id)}
        <ContainerCard container={c} route={routeForContainer(c)} />
      {/each}
    </div>
  {/if}
{/if}

{#if showAddModal}
  <div class="overlay" on:click|self={() => showAddModal = false} role="dialog" aria-modal="true">
    <div class="modal">
      <h2>Add manual route</h2>
      <form on:submit|preventDefault={submitAdd}>
        <label>Name<input bind:value={addForm.container_name} placeholder="my-service" required /></label>
        <label>Hostname<input bind:value={addForm.hostname} placeholder="my-service" required />
          <small>.{$settings.values['general.base_domain']}</small></label>
        <label>Port<input type="number" bind:value={addForm.target_port} placeholder="3000" required /></label>
        {#if addError}<p class="error">{addError}</p>{/if}
        <div class="modal-actions">
          <button type="button" class="btn secondary" on:click={() => showAddModal = false}>Cancel</button>
          <button type="submit" class="btn">Add</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h1 { font-size: 1.4rem; font-weight: 700; }

  .list { display: flex; flex-direction: column; gap: 0.4rem; }

  .section-header {
    display: flex; align-items: center; gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .section-header.mt { margin-top: 1.75rem; }
  .section-title {
    font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: #475569;
  }
  .section-count {
    font-size: 0.7rem; background: #1e2235; color: #64748b;
    padding: 0.1rem 0.4rem; border-radius: 999px;
  }

  .empty { color: #64748b; font-size: 0.9rem; margin-top: 2rem; }

  .btn {
    background: #3d42a0; color: #e2e8f0; border: none; border-radius: 6px;
    padding: 0.5rem 1rem; font-size: 0.85rem; cursor: pointer; font-weight: 500;
    transition: background 0.15s;
  }
  .btn:hover { background: #4a4fbf; }
  .btn.secondary { background: #2d3148; }
  .btn.secondary:hover { background: #3a3f5c; }

  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 100;
  }
  .modal {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 12px;
    padding: 1.5rem; width: 360px; display: flex; flex-direction: column; gap: 1rem;
  }
  .modal h2 { font-size: 1.1rem; }
  .modal form { display: flex; flex-direction: column; gap: 0.75rem; }
  label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.82rem; color: #94a3b8; }
  label small { color: #64748b; }
  input {
    background: #0f1117; border: 1px solid #2d3148; border-radius: 6px;
    color: #e2e8f0; padding: 0.5rem 0.75rem; font-size: 0.9rem; outline: none;
  }
  input:focus { border-color: #7c84ff; }
  .modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 0.25rem; }
  .error { color: #f87171; font-size: 0.8rem; }
</style>
