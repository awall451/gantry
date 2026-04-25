<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api';

  let images = [];
  let loading = true;
  let confirming = {};
  let errors = {};

  async function load() {
    loading = true;
    try {
      images = await api.getImages();
    } catch (e) {
      console.error(e);
    }
    loading = false;
  }

  async function remove(img) {
    errors[img.id] = '';
    try {
      await api.removeImage(img.id);
      images = images.filter(i => i.id !== img.id);
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(msg).error; } catch {}
      errors[img.id] = msg;
    }
    confirming[img.id] = false;
  }

  onMount(load);
</script>

<div class="page-header">
  <h1>Images</h1>
  <button class="btn" on:click={load}>Refresh</button>
</div>

{#if loading}
  <p class="muted">Loading...</p>
{:else if images.length === 0}
  <p class="muted">No images found.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Repository:Tag</th>
        <th>ID</th>
        <th>Size</th>
        <th>Created</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each images as img (img.id)}
        <tr>
          <td>
            {#each img.repoTags as tag}
              <span class="tag" class:none={tag === '<none>:<none>'}>{tag}</span>
            {/each}
          </td>
          <td class="mono muted">{img.id}</td>
          <td class="muted">{img.sizeMB} MB</td>
          <td class="muted">{new Date(img.created * 1000).toLocaleDateString()}</td>
          <td>
            <div class="action-cell">
              {#if errors[img.id]}
                <span class="err-inline">{errors[img.id]}</span>
              {/if}
              {#if confirming[img.id]}
                <span class="confirm-txt">Remove?</span>
                <button class="icon-btn danger" on:click={() => remove(img)}>Yes</button>
                <button class="icon-btn" on:click={() => { confirming[img.id] = false; errors[img.id] = ''; }}>No</button>
              {:else}
                <button class="icon-btn danger" on:click={() => { confirming[img.id] = true; errors[img.id] = ''; }}>Remove</button>
              {/if}
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h1 { font-size: 1.4rem; font-weight: 700; }

  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; color: #64748b; font-weight: 500; font-size: 0.78rem;
       text-transform: uppercase; letter-spacing: 0.05em; padding: 0.6rem 1rem;
       border-bottom: 1px solid #2d3148; }
  td { padding: 0.65rem 1rem; border-bottom: 1px solid #1e2235; vertical-align: middle; }

  .tag {
    display: inline-block; background: #1e2235; color: #94a3b8;
    font-size: 0.78rem; font-family: monospace; padding: 0.15rem 0.4rem;
    border-radius: 4px; margin-right: 0.25rem;
  }
  .tag.none { color: #475569; }
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
</style>
