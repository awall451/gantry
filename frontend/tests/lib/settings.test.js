import { get } from 'svelte/store';
import { settings, DEFAULT_VALUES, hostsFor, primaryUrl, urlFor, applyServerPayload } from '../../src/lib/settings';

const stock = { ...DEFAULT_VALUES };

describe('hostsFor', () => {
  it('is just <name>.localhost on a stock install', () => {
    expect(hostsFor('myapp', stock)).toEqual(['myapp.localhost']);
  });

  it('adds the tailscale FQDN when tailscale is enabled', () => {
    expect(hostsFor('myapp', { ...stock, 'tailscale.enabled': true }))
      .toEqual(['myapp.localhost', 'myapp.gantry.internal']);
  });

  it('follows a custom base domain', () => {
    expect(hostsFor('x', { ...stock, 'general.base_domain': 'lab.test' })).toEqual(['x.lab.test']);
  });
});

describe('primaryUrl', () => {
  it('is http on the base domain', () => {
    expect(primaryUrl('myapp', stock)).toBe('http://myapp.localhost');
  });
});

describe('settings store', () => {
  it('starts with defaults so pages render before the fetch lands', () => {
    expect(get(settings).values).toEqual(DEFAULT_VALUES);
  });

  it('applyServerPayload replaces values and status', () => {
    applyServerPayload({ values: { ...stock, 'tailscale.enabled': true }, status: { dns: { running: true } } });
    const s = get(settings);
    expect(s.values['tailscale.enabled']).toBe(true);
    expect(s.status.dns.running).toBe(true);
  });

  it('applyServerPayload without status keeps the previous status (WS broadcasts carry values only)', () => {
    applyServerPayload({ values: stock, status: { dns: { running: true } } });
    applyServerPayload({ values: { ...stock, 'tailscale.domain': 'z.internal' } });
    const s = get(settings);
    expect(s.values['tailscale.domain']).toBe('z.internal');
    expect(s.status.dns.running).toBe(true);
  });
});

describe('primaryUrl follows the domain the UI was opened on', () => {
  const ts = { ...stock, 'tailscale.enabled': true };

  it('opened on gantry.localhost → localhost links', () => {
    expect(primaryUrl('myapp', ts, 'gantry.localhost')).toBe('http://myapp.localhost');
  });

  it('opened on gantry.gantry.internal → tailscale links', () => {
    expect(primaryUrl('myapp', ts, 'gantry.gantry.internal')).toBe('http://myapp.gantry.internal');
  });

  it('opened on the bare tailscale domain → tailscale links', () => {
    expect(primaryUrl('myapp', ts, 'gantry.internal')).toBe('http://myapp.gantry.internal');
  });

  it('opened on localhost:5173 (vite dev) → base domain', () => {
    expect(primaryUrl('myapp', ts, 'localhost')).toBe('http://myapp.localhost');
  });

  it('tailscale off → always the base domain, whatever the current host', () => {
    expect(primaryUrl('myapp', stock, 'gantry.internal')).toBe('http://myapp.localhost');
  });

  it('hostsFor puts the current network first so the primary link is hosts[0]', () => {
    expect(hostsFor('x', ts, 'gantry.internal')).toEqual(['x.gantry.internal', 'x.localhost']);
    expect(hostsFor('x', ts, 'gantry.localhost')).toEqual(['x.localhost', 'x.gantry.internal']);
  });
});

describe('urlFor / primaryUrl with HTTPS on', () => {
  const tlsOn = { ...stock, 'tailscale.enabled': true, 'tailscale.domain': 'lab.example.com', 'tls.enabled': true };

  it('tailscale-domain hosts get https, base-domain hosts stay http', () => {
    expect(urlFor('x.lab.example.com', tlsOn)).toBe('https://x.lab.example.com');
    expect(urlFor('x.localhost', tlsOn)).toBe('http://x.localhost');
  });

  it('primaryUrl opened from the tailnet is https', () => {
    expect(primaryUrl('x', tlsOn, 'lab.example.com')).toBe('https://x.lab.example.com');
    expect(primaryUrl('x', tlsOn, 'gantry.localhost')).toBe('http://x.localhost');
  });

  it('tls off → http everywhere', () => {
    expect(urlFor('x.lab.example.com', { ...tlsOn, 'tls.enabled': false })).toBe('http://x.lab.example.com');
  });
});
