<script>
  import { onMount } from 'svelte';
  import { connectWs, disconnectWs, wsMessage } from '$lib/ws';
  import { loadSettings, applyServerPayload } from '$lib/settings';
  import { auth, checkAuth, logout, loginUrl } from '$lib/auth';
  import { goto } from '$app/navigation';
  import Footer from '$lib/components/Footer.svelte';
  import { page } from '$app/stores';

  // The app (sockets, settings, the chrome) starts only once the backend says
  // we may use it: immediately on a stock install, after login otherwise.
  let started = false;
  let hostShellOn = false; // nav link only when the feature is switched on
  function start() {
    if (started) return;
    started = true;
    connectWs();
    loadSettings();
    fetch('/api/host-shell/status').then(r => (r.ok ? r.json() : {})).then(s => { hostShellOn = !!s.enabled; }).catch(() => {});
  }

  onMount(async () => {
    try { await checkAuth(); }
    // Backend unreachable: behave as before (pages show their own errors).
    catch { auth.set({ checked: true, required: false, authed: true, misconfigured: false, username: null }); }
  });

  $: onLogin = path === '/login';
  $: if ($auth.checked && $auth.authed) start();
  let loggingOut = false; // logout reloads the page itself; skip the SPA redirect
  $: if ($auth.checked && !$auth.authed && !onLogin && !loggingOut) goto(loginUrl(path + $page.url.search), { replaceState: true });

  async function doLogout() {
    loggingOut = true;
    await logout();
    disconnectWs();
    started = false;
    location.assign('/login');
  }

  // Settings saved in another tab (or by the MCP) reach every page live.
  $: if ($wsMessage?.type === 'settings:updated') applyServerPayload({ values: $wsMessage.values });

  $: path = $page.url.pathname;

  let collapsed = false;   // desktop: icon rail
  let drawerOpen = false;  // phones: off-canvas drawer (see --bp-nav in <style>)

  // Any navigation closes the drawer.
  $: if (path) drawerOpen = false;

  function onKeydown(e) {
    if (e.key === 'Escape') drawerOpen = false;
  }

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
        { href: '/host',     label: 'Host terminal', icon: '›_', exact: true, hostShell: true },
      ],
    },
  ];

  // `path` is a parameter on purpose: Svelte 4 only re-evaluates a template
  // expression when a variable it references changes, so `isActive(link)`
  // reading `path` from the closure would freeze on the first page.
  function isActive(link, current) {
    return link.exact ? current === link.href : current.startsWith(link.href);
  }
</script>

<svelte:window on:keydown={onKeydown} />

{#if onLogin}
<slot />
{:else if $auth.checked && $auth.authed}
<div class="app" class:collapsed class:drawer-open={drawerOpen}>
  <header class="topbar">
    <button class="menu-btn" aria-label="Open menu" aria-expanded={drawerOpen}
      on:click={() => drawerOpen = !drawerOpen}>☰</button>
    <a class="brand" href="/">Gantry</a>
  </header>

  {#if drawerOpen}
    <div class="backdrop" on:click={() => drawerOpen = false} role="presentation"></div>
  {/if}

  <aside>
    <div class="sidebar-header">
      <span class="brand">Gantry</span>
      <button class="toggle-btn" on:click={() => collapsed = !collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
        {collapsed ? '›' : '‹'}
      </button>
      <button class="close-btn" aria-label="Close menu" on:click={() => drawerOpen = false}>×</button>
    </div>

    <nav>
      {#each NAV as group}
        <div class="nav-group">
          <span class="group-label">{group.label}</span>
          {#each group.links.filter(l => !l.hostShell || hostShellOn) as link}
            <a
              href={link.href}
              class:active={isActive(link, path)}
              title={collapsed ? link.label : ''}
            >
              <span class="icon">{link.icon}</span>
              <span class="link-label">{link.label}</span>
            </a>
          {/each}
        </div>
      {/each}
      {#if $auth.required}
        <button class="nav-btn" on:click={doLogout} title={collapsed ? 'Log out' : ''}>
          <span class="icon">⎋</span>
          <span class="link-label">Log out{#if $auth.username} ({$auth.username}){/if}</span>
        </button>
      {/if}
    </nav>
  </aside>

  <main>
    <div class="page"><slot /></div>
    <Footer />
  </main>
</div>
{/if}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; overflow-x: hidden; }
  :global(a) { color: inherit; text-decoration: none; }

  /*
   * Breakpoints (keep in sync with CLAUDE.md § CSS conventions):
   *   <= 900px  nav becomes an off-canvas drawer behind a top bar
   *   <= 640px  content stacks (rows wrap, tables scroll/cardify, modals go full-width)
   * Svelte can't put a custom property in a media query, so the numbers are
   * repeated literally in each component.
   */
  .app {
    display: flex; min-height: 100vh;
    --sidebar-w: 200px;
    --sidebar-w-collapsed: 52px;
    --topbar-h: 52px;
  }

  /* Top bar + drawer chrome: desktop never sees these. */
  .topbar { display: none; }
  .backdrop { display: none; }
  .close-btn { display: none; }

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
  .collapsed .brand, .collapsed .group-label, .collapsed .link-label { display: none; }

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
  nav a:hover, .nav-btn:hover { color: #e2e8f0; background: #1e2235; }
  .nav-btn {
    display: flex; align-items: center; gap: 0.65rem; width: 100%;
    padding: 0.5rem 1rem; background: none; border: none; border-left: 2px solid transparent;
    font: inherit; font-size: 0.875rem; color: #64748b; cursor: pointer; text-align: left;
    white-space: nowrap; transition: color 0.15s, background 0.15s;
  }
  .collapsed .nav-btn { padding: 0.5rem; justify-content: center; }
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
    /* Column so the footer sits at the very bottom: after the content on long
       pages, at the viewport bottom on short ones. */
    display: flex; flex-direction: column;
  }
  .page { flex: 1; }

  .collapsed main { margin-left: var(--sidebar-w-collapsed); }

  @media (max-width: 900px) {
    .topbar {
      display: flex; align-items: center; gap: 0.5rem;
      position: fixed; top: 0; left: 0; right: 0; height: var(--topbar-h);
      padding: 0 0.5rem;
      background: #1a1d27; border-bottom: 1px solid #2d3148;
      z-index: 30;
    }
    .menu-btn {
      background: none; border: none; color: #94a3b8; cursor: pointer;
      font-size: 1.25rem; line-height: 1;
      width: 44px; height: 44px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
    }
    .menu-btn:hover, .menu-btn:active { color: #e2e8f0; background: #1e2235; }

    .backdrop {
      display: block; position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.55); z-index: 40;
    }

    /* The sidebar becomes a drawer: full nav width, never the icon rail. */
    aside, .collapsed aside {
      width: min(280px, 85vw);
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      z-index: 50;
      box-shadow: none;
    }
    .drawer-open aside, .drawer-open.collapsed aside {
      transform: translateX(0);
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.6);
    }
    .toggle-btn { display: none; }
    .close-btn {
      display: flex; align-items: center; justify-content: center;
      background: none; border: 1px solid #2d3148; border-radius: 6px;
      color: #94a3b8; cursor: pointer; font-size: 1.25rem; line-height: 1;
      width: 40px; height: 40px;
    }
    .collapsed .sidebar-header { justify-content: space-between; }
    .collapsed .brand { display: inline; }
    .collapsed .group-label { display: block; }
    .collapsed .link-label { display: inline; }
    .collapsed nav a { padding: 0.5rem 1rem; justify-content: flex-start; }
    nav a, .nav-btn { min-height: 44px; font-size: 0.95rem; }
    .collapsed .nav-btn { padding: 0.5rem 1rem; justify-content: flex-start; }

    main, .collapsed main {
      margin-left: 0;
      padding: calc(var(--topbar-h) + 1rem) 1rem 1.5rem;
      max-width: none;
    }
  }
</style>
