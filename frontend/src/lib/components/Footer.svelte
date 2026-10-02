<script>
  import { about } from '../about.js';
</script>

<footer>
  <div class="left">
    <span>Gantry v{about.version}</span>
    <span class="sep">·</span>
    <span>{about.license}</span>
  </div>
  <div class="right">
    <a href={about.repo} target="_blank" rel="noopener">GitHub</a>
    <span class="sep">·</span>
    <a class="kofi" href={about.support} target="_blank" rel="noopener">Buy me a coffee ♥</a>
  </div>
</footer>

<style>
  footer {
    margin-top: 3rem; padding-top: 1rem;
    border-top: 1px solid #1f2335;
    display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
    gap: 0.5rem 1.5rem;
    color: #475569; font-size: 0.75rem; line-height: 1.4;
  }
  .left, .right { display: flex; align-items: center; gap: 0.5rem; white-space: nowrap; }
  .sep { color: #2d3148; }
  a { color: #64748b; text-decoration: none; }
  a:hover { color: #94a3b8; }
  .kofi { color: #7c84ff; opacity: 0.8; }
  .kofi:hover { opacity: 1; color: #7c84ff; }
  @media (pointer: coarse) { a { padding: 0.5rem 0; } }
</style>
