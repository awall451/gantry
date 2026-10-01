<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { openTerminal } from '$lib/terminal';

  let status = null;      // GET /api/host-shell/status
  let password = '';
  let code = '';          // authenticator code, when status.totp_required
  let error = '';
  let busy = false;
  let connected = false;
  let termEl, session, pwInput;

  onMount(async () => {
    const res = await fetch('/api/host-shell/status');
    status = res.ok ? await res.json() : { enabled: false };
    await tick();
    pwInput?.focus();
  });

  onDestroy(() => session?.close());

  // Re-type the password for a one-time ticket, then open the socket with it.
  async function unlock() {
    if (busy) return;
    busy = true; error = '';
    const res = await fetch('/api/host-shell/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(status.totp_required ? { password, code } : { password }),
    });
    password = ''; code = '';
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      busy = false;
      error = res.status === 401
        ? (status.totp_required ? 'Wrong password or code.' : 'Wrong password.')
        : (body.detail || 'Could not open the terminal.');
      return;
    }
    connected = true;
    await tick();
    try {
      session = await openTerminal(termEl,
        ({ cols, rows }) => `/ws/host?ticket=${encodeURIComponent(body.ticket)}&cols=${cols}&rows=${rows}`,
        // Server ended it (exit, idle timeout): dispose this xterm so the next
        // unlock starts in an empty element instead of stacking below it.
        { onClose: handle => { handle.close(); session = null; connected = false; } });
    } catch (e) {
      connected = false;
      error = `Could not start the terminal: ${e?.message || e}`;
    } finally {
      busy = false;
    }
  }

  function disconnect() {
    session?.close();
    session = null;
    connected = false;
  }
</script>

<svelte:head><title>Host terminal · Gantry</title></svelte:head>

<div class="head">
  <h1>Host terminal</h1>
  {#if connected}<button class="btn ghost" on:click={disconnect}>Disconnect</button>{/if}
</div>

{#if !status}
  <p class="muted">Loading…</p>
{:else if !status.enabled}
  <section>
    <p>The host terminal is off. It opens a shell on the machine running Gantry, as your user, over SSH to its own sshd.</p>
    <p class="hint">Turn it on with <code>scripts/enable-host-shell.sh</code> (needs a login set with <code>scripts/set-password.sh</code>), then <code>docker compose up -d</code>.</p>
  </section>
{:else if !status.available}
  <section><p class="error">{status.reason}</p></section>
{:else}
  {#if !connected}
    <form class="unlock" on:submit|preventDefault={unlock}>
      <p>Opens a shell as <b>{status.user}</b> on this machine. Confirm your Gantry password{status.totp_required ? ' and the code from your authenticator app' : ''} to continue.</p>
      <label for="hpw">Password</label>
      <input id="hpw" type="password" bind:this={pwInput} bind:value={password} autocomplete="current-password" required />
      {#if status.totp_required}
        <label for="hcode">Authenticator code</label>
        <input id="hcode" class="code" bind:value={code} inputmode="numeric" autocomplete="one-time-code"
          pattern="[0-9 ]*" maxlength="7" placeholder="123456" required />
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn" type="submit" disabled={busy}>{busy ? 'Opening…' : 'Open terminal'}</button>
    </form>
  {/if}
  <div class="term-wrap" class:hidden={!connected} bind:this={termEl}></div>
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
  h1 { font-size: 1.4rem; font-weight: 700; }
  section, .unlock {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 10px;
    padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 0.6rem; max-width: 560px;
    color: #e2e8f0; font-size: 0.9rem; line-height: 1.5;
  }
  label { color: #94a3b8; font-size: 0.8rem; margin-top: 0.3rem; }
  input {
    background: #0f1117; border: 1px solid #2d3148; border-radius: 6px; color: #e2e8f0;
    padding: 0.55rem 0.7rem; font-size: 1rem; outline: none; max-width: 360px; min-height: 40px;
  }
  input:focus { border-color: #7c84ff; }
  input.code { max-width: 160px; letter-spacing: 0.2em; font-variant-numeric: tabular-nums; }
  .btn {
    align-self: flex-start; margin-top: 0.4rem; min-height: 40px; padding: 0 1rem;
    background: #4f46e5; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;
  }
  .btn.ghost { background: none; border: 1px solid #2d3148; color: #94a3b8; margin: 0; }
  .btn:disabled { opacity: 0.6; }
  .hint, .muted { color: #64748b; font-size: 0.82rem; }
  .error { color: #f87171; }
  code { font-size: 0.8rem; }
  .term-wrap { height: 70vh; background: #0f1117; border-radius: 8px; overflow: hidden; padding: 0.5rem; }
  .term-wrap.hidden { display: none; }
  @media (pointer: coarse) { .btn, input { min-height: 44px; } }
  @media (max-width: 640px) {
    section, .unlock { padding: 1rem; }
    .term-wrap { height: 60vh; height: 60dvh; }
  }
</style>
