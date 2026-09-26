<script>
  import { onMount } from 'svelte';
  import { connectWs, wsMessage } from '$lib/ws';
  import { loadSettings, applyServerPayload } from '$lib/settings';
  import { page } from '$app/stores';

  onMount(() => {
    connectWs();
    loadSettings();
  });

  // Settings saved in another tab (or by the MCP) reach every page live.
  $: if ($wsMessage?.type === 'settings:updated') applyServerPayload({ values: $wsMessage.values });

  $: path = $page.url.pathname;

  let collapsed = false;

  const NAV = [
    {
      label: 'Proxy',
      links: [
        { href: '/',          label: 'Dashboard', icon: '⊞', exact: true },
        { href: '/routes',    label: 'Routes',    icon: '⇄', exact: true },
        { href: '/analytics', label: 'Analytics', icon: '↗', exact: true },
      ],
    },
    {
      label: 'Docker',
      links: [
        { href: '/containers', label: 'Containers', icon: '▣', exact: false },
        { href: '/events',     label: 'Events',     icon: '◎', exact: true },
        { href: '/images',     label: 'Images',     icon: '◫', exact: true },
        { href: '/volumes',    label: 'Volumes',    icon: '⬡', exact: true },
        { href: '/networks',   label: 'Networks',   icon: '⬡', exact: true },
      ],
    },
    {
      label: 'System',
      links: [
        { href: '/settings', label: 'Settings', icon: '⚙', exact: true },
      ],
    },
  ];

  function isActive(link) {
    return link.exact ? path === link.href : path.startsWith(link.href);
  }
</script>

<div class="app" class:collapsed>
  <aside>
    <div class="sidebar-header">
      {#if !collapsed}
        <span class="brand">Gantry</span>
      {/if}
      <button class="toggle-btn" on:click={() => collapsed = !collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
        {collapsed ? '›' : '‹'}
      </button>
    </div>

    <nav>
      {#each NAV as group}
        <div class="nav-group">
          {#if !collapsed}
            <span class="group-label">{group.label}</span>
          {/if}
          {#each group.links as link}
            <a
              href={link.href}
              class:active={isActive(link)}
              title={collapsed ? link.label : ''}
            >
              <span class="icon">{link.icon}</span>
              {#if !collapsed}<span class="link-label">{link.label}</span>{/if}
            </a>
          {/each}
        </div>
      {/each}
    </nav>
  </aside>

  <main>
    <slot />
  </main>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; overflow-x: hidden; }
  :global(a) { color: inherit; text-decoration: none; }

  .app {
    display: flex; min-height: 100vh;
    --sidebar-w: 200px;
    --sidebar-w-collapsed: 52px;
  }

  aside {
    width: var(--sidebar-w);
    flex-shrink: 0;
    background: #1a1d27;
    border-right: 1px solid #2d3148;
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0; left: 0; bottom: 0;
    z-index: 20;
    transition: width 0.2s ease;
    overflow: hidden;
  }

  .collapsed aside { width: var(--sidebar-w-collapsed); }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.75rem;
    height: 56px;
    border-bottom: 1px solid #2d3148;
    flex-shrink: 0;
  }

  .collapsed .sidebar-header { justify-content: center; }

  .brand {
    font-weight: 700; font-size: 1rem; color: #7c84ff;
    letter-spacing: -0.02em; white-space: nowrap;
  }

  .toggle-btn {
    background: none; border: 1px solid #2d3148; border-radius: 4px;
    color: #64748b; cursor: pointer; font-size: 1rem;
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0;
  }
  .toggle-btn:hover { color: #e2e8f0; border-color: #4a4f7a; }

  nav { flex: 1; padding: 0.75rem 0; overflow-y: auto; overflow-x: hidden; }

  .nav-group { margin-bottom: 1rem; }

  .group-label {
    font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: #475569;
    padding: 0 1rem 0.35rem;
    display: block; white-space: nowrap;
  }

  nav a {
    display: flex; align-items: center; gap: 0.65rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem; color: #94a3b8;
    border-left: 2px solid transparent;
    transition: color 0.15s, background 0.15s;
    white-space: nowrap;
  }
  nav a:hover { color: #e2e8f0; background: #1e2235; }
  nav a.active { color: #7c84ff; border-left-color: #7c84ff; background: #1e2235; }

  .collapsed nav a { padding: 0.5rem; justify-content: center; }
  .collapsed nav a.active { border-left-color: #7c84ff; }

  .icon { font-size: 1rem; flex-shrink: 0; line-height: 1; }
  .link-label { overflow: hidden; }

  main {
    flex: 1;
    margin-left: var(--sidebar-w);
    padding: 2rem;
    max-width: 1200px;
    width: 100%;
    transition: margin-left 0.2s ease;
    min-width: 0;
  }

  .collapsed main { margin-left: var(--sidebar-w-collapsed); }
</style>
