<script>
  import { about } from '../about.js';
</script>

<section aria-labelledby="about-heading">
  <header>
    <h2 id="about-heading">About</h2>
    <p class="hint">Gantry v{about.version} · {about.license} · <a href={about.repo} target="_blank" rel="noopener">GitHub</a></p>
  </header>
  <p class="support">
    Gantry is free. If it saves you time,
    <a class="kofi" href={about.support} target="_blank" rel="noopener">buy me a coffee</a> ♥
  </p>
  <p class="hint">Part of every tip goes to carbon removal through Stripe Climate.</p>
</section>

<style>
  section {
    background: #1a1d27; border: 1px solid #2d3148; border-radius: 10px;
    padding: 1.25rem 1.5rem; margin-bottom: 1.25rem;
    display: flex; flex-direction: column; gap: 0.6rem;
  }
  header { display: flex; flex-direction: column; gap: 0.25rem; }
  h2 { font-size: 1.05rem; font-weight: 600; }
  .hint { color: #64748b; font-size: 0.78rem; line-height: 1.4; }
  .hint a { color: #94a3b8; }
  .support { color: #e2e8f0; font-size: 0.9rem; }
  .kofi { color: #7c84ff; text-decoration: none; border-bottom: 1px solid #3f4670; }
  .kofi:hover { border-bottom-color: #7c84ff; }
  @media (pointer: coarse) { .kofi { display: inline-block; padding: 0.4rem 0; } }
  @media (max-width: 640px) { section { padding: 1rem; } }
</style>
