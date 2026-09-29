import { render, screen } from '@testing-library/svelte';
import About from '../../src/lib/components/About.svelte';
import { about } from '../../src/lib/about.js';
import pkg from '../../package.json';

describe('About block', () => {
  it('shows the version from package.json and the licence', () => {
    render(About);
    expect(screen.getByText(new RegExp(`Gantry v${pkg.version.replace(/\./g, '\\.')}`))).toBeTruthy();
    expect(about.version).toBe(pkg.version);
  });

  it('links to the repo and the tip page, opening in a new tab', () => {
    render(About);
    const repo = screen.getByRole('link', { name: 'GitHub' });
    const tip = screen.getByRole('link', { name: /buy me a coffee/i });
    expect(repo.getAttribute('href')).toBe('https://github.com/awall451/gantry');
    expect(tip.getAttribute('href')).toBe('https://ko-fi.com/sigilworks');
    for (const a of [repo, tip]) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
});
