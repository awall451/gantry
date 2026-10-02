import { render, screen } from '@testing-library/svelte';
import Footer from '../../src/lib/components/Footer.svelte';
import pkg from '../../package.json';

describe('Footer', () => {
  it('left: version from package.json and the licence', () => {
    const { container } = render(Footer);
    const left = container.querySelector('.left');
    expect(left.textContent).toContain(`Gantry v${pkg.version}`);
    expect(left.textContent).toContain('MIT');
  });

  it('right: GitHub and the tip link, both opening in a new tab', () => {
    const { container } = render(Footer);
    const right = container.querySelector('.right');
    const repo = screen.getByRole('link', { name: 'GitHub' });
    const tip = screen.getByRole('link', { name: /buy me a coffee/i });
    expect(right.contains(repo) && right.contains(tip)).toBe(true);
    expect(repo.getAttribute('href')).toBe('https://github.com/awall451/gantry');
    expect(tip.getAttribute('href')).toBe('https://ko-fi.com/sigilworks');
    for (const a of [repo, tip]) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });
});
