import { writable } from 'svelte/store';
import { api } from './api.js';

// Mirror of backend settings.js DEFAULTS. Pages render against these until
// the first /api/settings response arrives, so a stock install never flashes
// a wrong hostname.
export const DEFAULT_VALUES = Object.freeze({
  'general.base_domain': 'localhost',
  'tailscale.enabled': false,
  'tailscale.domain': 'gantry.internal',
  'tailscale.ip': '',
  'tailscale.dns_enabled': true,
  'tailscale.dns_port': 53,
});

export const settings = writable({ values: { ...DEFAULT_VALUES }, status: null, loaded: false });

// Every FQDN a route answers on, base domain first. Same rule as the
// backend's resolveDomains(), kept in sync by hand — it's two lines.
export function hostsFor(hostname, values) {
  const hosts = [`${hostname}.${values['general.base_domain']}`];
  if (values['tailscale.enabled']) hosts.push(`${hostname}.${values['tailscale.domain']}`);
  return hosts;
}

export function primaryUrl(hostname, values) {
  return `http://${hostsFor(hostname, values)[0]}`;
}

export function applyServerPayload({ values, status }) {
  settings.update(s => ({
    values: { ...DEFAULT_VALUES, ...values },
    status: status === undefined ? s.status : status,
    loaded: true,
  }));
}

export async function loadSettings() {
  try {
    applyServerPayload(await api.getSettings());
  } catch {
    // Backend unreachable: keep defaults, the WS reconnect will retry pages.
  }
}
