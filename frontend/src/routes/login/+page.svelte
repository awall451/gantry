<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth, login, safeReturnTo } from '$lib/auth';

  let username = '';
  let password = '';
  let error = '';
  let busy = false;
  let userInput;

  $: target = safeReturnTo($page.url.searchParams.get('return_to'));

  // Nothing to do here without a login, or when already signed in.
  $: if ($auth.checked && $auth.authed) goto(target, { replaceState: true });

  onMount(() => userInput?.focus());

  async function submit() {
    if (busy) return;
    busy = true; error = '';
    const r = await login(username, password);
    busy = false;
    if (r.ok) { password = ''; goto(target, { replaceState: true }); return; }
    error = r.status === 401 ? 'Wrong username or password.' : r.detail;
    password = '';
  }
</script>

<svelte:head><title>Log in · Gantry</title></svelte:head>

<div class="wrap">
  <form class="card" on:submit|preventDefault={submit}>
    <h1>Gantry</h1>
    {#if $auth.misconfigured}
      <p class="error" role="alert">
        The server's <code>GANTRY_PASSWORD_HASH</code> is malformed, so no login can succeed.
        Regenerate it with <code>scripts/set-password.sh</code>, then <code>docker compose up -d</code>.
      </p>
    {/if}
    <label for="user">Username</label>
    <input id="user" bind:this={userInput} bind:value={username} autocomplete="username"
      autocapitalize="none" spellcheck="false" required />
    <label for="pass">Password</label>
    <input id="pass" type="password" bind:value={password} autocomplete="current-password" required />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Log in'}</button>
  </form>
</div>

<style>
  .wrap {
    min-height: 100vh; min-height: 100dvh;
    display: flex; align-items: center; justify-content: center;
    padding: 1rem; background: #0f1117;
  }
  .card {
    width: min(360px, 100%);
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 10px;
    padding: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem;
  }
  h1 { font-size: 1.3rem; font-weight: 700; color: #7c84ff; margin-bottom: 0.75rem; }
  label { color: #94a3b8; font-size: 0.8rem; margin-top: 0.4rem; }
  input {
    background: #0f1117; border: 1px solid #2d3148; border-radius: 6px;
    color: #e2e8f0; padding: 0.6rem 0.7rem; font-size: 1rem; outline: none; min-height: 44px;
  }
  input:focus { border-color: #7c84ff; }
  .btn {
    margin-top: 1rem; min-height: 44px;
    background: #4f46e5; color: #fff; border: none; border-radius: 6px;
    font-size: 0.95rem; font-weight: 600; cursor: pointer;
  }
  .btn:disabled { opacity: 0.6; cursor: default; }
  .error { color: #f87171; font-size: 0.85rem; line-height: 1.4; }
  code { font-size: 0.8rem; }
</style>
