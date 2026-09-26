import { get } from 'svelte/store';
import { settings, DEFAULT_VALUES, hostsFor, primaryUrl, applyServerPayload } from '../../src/lib/settings';

const stock = { ...DEFAULT_VALUES };

describe('hostsFor', () => {
  it('is just <name>.localhost on a stock install', () => {
    expect(hostsFor('fleabook', stock)).toEqual(['fleabook.localhost']);
  });

  it('adds the tailscale FQDN when tailscale is enabled', () => {
    expect(hostsFor('fleabook', { ...stock, 'tailscale.enabled': true }))
      .toEqual(['fleabook.localhost', 'fleabook.gantry.internal']);
  });

  it('follows a custom base domain', () => {
    expect(hostsFor('x', { ...stock, 'general.base_domain': 'lab.test' })).toEqual(['x.lab.test']);
  });
});

describe('primaryUrl', () => {
  it('is http on the base domain', () => {
    expect(primaryUrl('fleabook', stock)).toBe('http://fleabook.localhost');
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
