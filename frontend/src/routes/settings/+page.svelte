<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { settings, applyServerPayload, loadSettings } from '$lib/settings';
  import { auth } from '$lib/auth';

  // Local form state — edited freely, written back in one PUT per section.
  let form = null;
  let saving = '';
  let errors = {};
  let banner = '';

  $: if ($settings.loaded && !form) form = { ...$settings.values };
  $: status = $settings.status;
  $: detected = status?.tailscale?.detected;
  $: effectiveIp = status?.tailscale?.effectiveIp || '';
  $: dns = status?.dns;
  $: tlsS = status?.tls;
  $: scheme = $settings.values['tls.enabled'] ? 'https' : 'http';

  onMount(loadSettings);

  async function save(keys) {
    saving = keys.join(',');
    errors = {};
    banner = '';
    const patch = {};
    for (const k of keys) patch[k] = form[k];
    try {
      const res = await api.updateSettings(patch);
      applyServerPayload(res);
      form = { ...res.values };
      banner = 'Saved.';
    } catch (e) {
      try { errors = JSON.parse(e.message).errors || {}; }
      catch { errors = { _: e.message }; }
    }
    saving = '';
  }

  function num(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : v; }
</script>

<h1>Settings</h1>

{#if !form}
  <p class="empty">Loading…</p>
{:else}
  {#if banner}<p class="ok">{banner}</p>{/if}
  {#if errors._}<p class="error">{errors._}</p>{/if}

  <section class="login-status" class:warn={!$auth.required && $settings.values['tailscale.enabled']}>
    <header>
      <h2>Login</h2>
      {#if $auth.required}
        <p class="hint">On. Signed in as <b>{$auth.username}</b>. Change the password or add an API token for the MCP server with <code>scripts/set-password.sh</code>, then <code>docker compose up -d</code>. Changing it signs out every device.</p>
      {:else}
        <p class="hint">
          Off: anyone who can reach this page can control Docker on this machine{#if $settings.values['tailscale.enabled']}, and that includes every device on your tailnet{/if}.
          Turn it on with <code>scripts/set-password.sh</code>, then <code>docker compose up -d</code>.
        </p>
      {/if}
    </header>
  </section>

  <section>
    <header>
      <h2>General</h2>
      <p class="hint">How routes are named on this machine.</p>
    </header>

    <div class="field">
      <label for="base">Base domain</label>
      <input id="base" bind:value={form['general.base_domain']} spellcheck="false" />
      <span class="preview">http://&lt;container&gt;.{form['general.base_domain']}</span>
      {#if errors['general.base_domain']}<span class="field-error">{errors['general.base_domain']}</span>{/if}
      <span class="hint">
        <code>localhost</code> resolves to this machine in every modern browser with no DNS setup.
        Change it only if you run your own resolver for another suffix.
      </span>
    </div>

    <div class="actions">
      <button class="btn" disabled={saving === 'general.base_domain'} on:click={() => save(['general.base_domain'])}>Save</button>
    </div>
  </section>

  <section>
    <header>
      <h2>Tailscale</h2>
      <p class="hint">
        Reach every route from other devices on your tailnet. Off by default — Gantry works exactly as before.
      </p>
    </header>

    <div class="field row">
      <label class="switch">
        <input type="checkbox" bind:checked={form['tailscale.enabled']} />
        <span>Enable Tailscale access</span>
      </label>
      {#if errors['tailscale.enabled']}<span class="field-error">{errors['tailscale.enabled']}</span>{/if}
    </div>

    <div class="grid" class:dim={!form['tailscale.enabled']}>
      <div class="field">
        <label for="tsdomain">Tailscale domain</label>
        <input id="tsdomain" bind:value={form['tailscale.domain']} spellcheck="false" />
        <span class="preview">http://&lt;container&gt;.{form['tailscale.domain']}</span>
        {#if errors['tailscale.domain']}<span class="field-error">{errors['tailscale.domain']}</span>{/if}
        <span class="hint">Every route is also matched on this suffix. <code>.internal</code> is reserved for private use and never clashes with the public DNS.</span>
      </div>

      <div class="field">
        <label for="tsip">Tailscale IP of this host</label>
        <input id="tsip" bind:value={form['tailscale.ip']} placeholder={detected ? `${detected.ip} (auto)` : 'not detected'} spellcheck="false" />
        {#if errors['tailscale.ip']}<span class="field-error">{errors['tailscale.ip']}</span>{/if}
        <span class="hint">
          {#if detected}
            Detected <code>{detected.ip}</code> on <code>{detected.iface}</code>. Leave blank to keep auto-detecting.
          {:else}
            No Tailscale interface found on this host. Enter the IP by hand or start Tailscale.
          {/if}
        </span>
      </div>

      <div class="field row">
        <label class="switch">
          <input type="checkbox" bind:checked={form['tailscale.dns_enabled']} />
          <span>Answer DNS for the Tailscale domain</span>
        </label>
        <span class="hint">Gantry runs a tiny resolver that maps <code>*.{form['tailscale.domain']}</code> to the IP above. Turn off if you already run one.</span>
      </div>

      <div class="field narrow">
        <label for="dnsport">DNS port</label>
        <input id="dnsport" type="number" min="1" max="65535" value={form['tailscale.dns_port']}
          on:input={e => form['tailscale.dns_port'] = num(e.target.value)} />
        {#if errors['tailscale.dns_port']}<span class="field-error">{errors['tailscale.dns_port']}</span>{/if}
        <span class="hint">Tailscale split DNS only talks to port 53.</span>
      </div>
    </div>

    <div class="actions">
      <button class="btn" disabled={!!saving}
        on:click={() => save(['tailscale.enabled', 'tailscale.domain', 'tailscale.ip', 'tailscale.dns_enabled', 'tailscale.dns_port'])}>
        Save
      </button>
    </div>

    <div class="sub" class:dim={!form['tailscale.enabled']}>
      <header>
        <h2>HTTPS <span class="rec">recommended</span></h2>
        <p class="hint">
          A real certificate for <code>*.{form['tailscale.domain']}</code> from Let's Encrypt, obtained and renewed by Caddy in-process
          (no restarts). Needs a domain you own with DNS on Cloudflare, and a <code>CLOUDFLARE_API_TOKEN</code>
          (zone-scoped, DNS:Edit) in the <code>.env</code> next to <code>docker-compose.yml</code>.
          Off = plain http on the tailnet, which is still encrypted by Tailscale itself.
        </p>
      </header>

      <div class="field row">
        <label class="switch">
          <input type="checkbox" bind:checked={form['tls.enabled']} />
          <span>Enable HTTPS on the Tailscale domain</span>
        </label>
        {#if tlsS && !tlsS.tokenPresent}
          <span class="field-error">CLOUDFLARE_API_TOKEN is not set — Caddy cannot obtain a certificate until it is (then <code>docker compose up -d</code>).</span>
        {/if}
      </div>

      <div class="field">
        <label for="acme">ACME account email <span class="opt">optional</span></label>
        <input id="acme" type="email" bind:value={form['tls.acme_email']} placeholder="you@example.com" spellcheck="false" />
        {#if errors['tls.acme_email']}<span class="field-error">{errors['tls.acme_email']}</span>{/if}
        <span class="hint">Let's Encrypt uses it for expiry warnings only.</span>
      </div>

      <div class="field row">
        <label class="switch">
          <input type="checkbox" bind:checked={form['tls.redirect_http']} />
          <span>Redirect http → https on the Tailscale domain</span>
        </label>
        <span class="hint">Only that domain; <code>*.{form['general.base_domain']}</code> is never redirected. Some TLDs (<code>.dev</code>, <code>.app</code>) are HTTPS-only in browsers regardless.</span>
      </div>

      <div class="actions">
        <button class="btn" disabled={!!saving}
          on:click={() => save(['tls.enabled', 'tls.acme_email', 'tls.redirect_http'])}>
          Save
        </button>
      </div>

      {#if $settings.values['tailscale.enabled'] && $settings.values['tls.enabled']}
        <div class="status-box">
          <h3>Certificate</h3>
          <dl>
            <dt>Token</dt>
            <dd>{#if tlsS?.tokenPresent}<span class="tag on">set</span>{:else}<span class="tag err">missing</span>{/if}</dd>
            <dt>Served for <code>{$settings.values['tailscale.domain']}</code></dt>
            <dd>
              {#if tlsS?.cert?.error}
                <span class="tag err">none yet</span> <span class="hint">{tlsS.cert.error} — Caddy may still be requesting it; see <code>docker compose logs caddy</code>.</span>
              {:else if tlsS?.cert}
                <span class="tag on">ok</span> issued by <code>{tlsS.cert.issuer}</code>, expires {tlsS.cert.validTo.slice(0, 10)} ({tlsS.cert.daysLeft} days)
                {#if tlsS.cert.selfSigned}<span class="tag err">self-signed</span>{/if}
              {/if}
            </dd>
            {#if tlsS?.conflicts?.length}
              <dt>Port 443</dt>
              <dd><span class="tag err">conflict</span> <span class="hint">already bound on {tlsS.conflicts.join(', ')} by another process — tailnet HTTPS to that address will not reach Gantry. Free it (e.g. <code>tailscale serve reset</code>).</span></dd>
            {/if}
          </dl>
        </div>
      {/if}
    </div>

    {#if $settings.values['tailscale.enabled']}
      <div class="status-box">
        <h3>Status</h3>
        <dl>
          <dt>Routes</dt>
          <dd>matching <code>*.{$settings.values['tailscale.domain']}</code> on port 80 — this UI also answers on bare <code>http://{$settings.values['tailscale.domain']}</code></dd>
          <dt>DNS responder</dt>
          <dd>
            {#if !$settings.values['tailscale.dns_enabled']}
              <span class="tag off">off</span>
            {:else if dns?.running}
              <span class="tag on">running</span> on <code>{dns.bind}</code>
            {:else}
              <span class="tag err">not running</span>
              {#if dns?.error}<span class="field-error">{dns.error}</span>{/if}
            {/if}
          </dd>
        </dl>

        <h3>Tailscale admin console — one-time setup</h3>
        <ol>
          <li>Open <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener">login.tailscale.com/admin/dns</a>.</li>
          <li>Under <b>Nameservers</b> choose <b>Add nameserver → Custom</b>.</li>
          <li>Nameserver: <code>{effectiveIp || '<this host’s Tailscale IP>'}</code></li>
          <li>Turn on <b>Restrict to domain</b> and enter <code>{$settings.values['tailscale.domain']}</code>.</li>
          <li>Save. Other tailnet devices now open <code>{scheme}://&lt;container&gt;.{$settings.values['tailscale.domain']}</code> on this machine.</li>
        </ol>
        <p class="hint">Only queries for that domain reach Gantry; everything else keeps using your normal DNS. Traffic is plain HTTP inside the tailnet's encrypted tunnel.</p>
      </div>
    {/if}
  </section>
{/if}

<style>
  h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 1.5rem; }
  h2 { font-size: 1.05rem; font-weight: 600; }
  h3 { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin: 1rem 0 0.5rem; }

  section {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 10px;
    padding: 1.25rem 1.5rem; margin-bottom: 1.25rem;
    display: flex; flex-direction: column; gap: 1rem;
  }
  section > header { display: flex; flex-direction: column; gap: 0.25rem; }
  .login-status.warn { border-color: #92400e; }
  .login-status.warn .hint { color: #fbbf24; }

  .field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; }
  .field.narrow input { width: 120px; }
  .field.row { gap: 0.4rem; }
  label { color: #94a3b8; font-size: 0.8rem; }
  input:not([type=checkbox]) {
    background: #0f1117; border: 1px solid #2d3148; border-radius: 6px;
    color: #e2e8f0; padding: 0.45rem 0.6rem; font-size: 0.875rem; outline: none; max-width: 360px;
  }
  input:not([type=checkbox]):focus { border-color: #7c84ff; }
  input::placeholder { color: #475569; }

  .switch { display: flex; align-items: center; gap: 0.6rem; color: #e2e8f0; font-size: 0.9rem; cursor: pointer; }
  .switch input { width: 16px; height: 16px; accent-color: #7c84ff; }

  .grid { display: flex; flex-direction: column; gap: 1rem; transition: opacity 0.15s; }
  .grid.dim { opacity: 0.5; }

  .preview { color: #7c84ff; font-size: 0.8rem; font-family: ui-monospace, monospace; }
  .hint { color: #64748b; font-size: 0.78rem; line-height: 1.4; }
  code { font-family: ui-monospace, monospace; background: #0f1117; padding: 0.05rem 0.35rem; border-radius: 4px; color: #c4b5fd; font-size: 0.78rem; overflow-wrap: anywhere; }

  .actions { display: flex; justify-content: flex-end; }
  .btn {
    background: #3d42a0; color: #e2e8f0; border: none; border-radius: 6px;
    padding: 0.5rem 1rem; font-size: 0.85rem; cursor: pointer; font-weight: 500;
  }
  .btn:hover { background: #4a4fbf; }
  .btn:disabled { opacity: 0.5; cursor: default; }

  .status-box { border-top: 1px solid #2d3148; padding-top: 0.5rem; }
  .sub { border-top: 1px solid #2d3148; padding-top: 1rem; display: flex; flex-direction: column; gap: 1rem; transition: opacity 0.15s; }
  .sub.dim { opacity: 0.5; }
  .rec { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #4ade80; background: #14532d; padding: 0.15rem 0.45rem; border-radius: 999px; margin-left: 0.5rem; vertical-align: middle; }
  .opt { color: #475569; font-weight: 400; margin-left: 0.3rem; }
  dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.4rem 1rem; font-size: 0.85rem; }
  dt, dd { min-width: 0; overflow-wrap: anywhere; }
  dt { color: #64748b; }
  ol { padding-left: 1.25rem; font-size: 0.85rem; line-height: 1.7; color: #cbd5e1; }
  ol a { color: #7c84ff; text-decoration: underline; }

  .tag { font-size: 0.7rem; font-weight: 600; padding: 0.15rem 0.45rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
  .tag.on { background: #14532d; color: #4ade80; }
  .tag.off { background: #2d3148; color: #94a3b8; }
  .tag.err { background: #4c1d1d; color: #f87171; }

  .ok { color: #4ade80; font-size: 0.85rem; margin-bottom: 0.75rem; }
  .error, .field-error { color: #f87171; font-size: 0.8rem; }
  .empty { color: #64748b; font-size: 0.9rem; }

  @media (max-width: 640px) {
    section { padding: 1rem; }
    dl { grid-template-columns: 1fr; gap: 0.15rem 0; }
    dt { margin-top: 0.5rem; }
    dt:first-child { margin-top: 0; }
    input:not([type=checkbox]) { max-width: none; width: 100%; }
    .field.narrow input { width: 120px; }
    .btn { min-height: 44px; }
  }
</style>
