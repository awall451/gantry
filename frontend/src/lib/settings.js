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

// Every domain a route answers on. Same rule as the backend's
// resolveDomains(), kept in sync by hand — it's two lines.
function domainsFor(values) {
  const domains = [values['general.base_domain']];
  if (values['tailscale.enabled']) domains.push(values['tailscale.domain']);
  return domains;
}

// Which of the configured domains the UI itself was opened on. A `.localhost`
// link is dead on a phone and a `.gantry.internal` link is a detour on the
// laptop, so links follow the address bar rather than a setting: whichever
// domain the current page's host ends with wins, base domain otherwise.
export function currentDomain(values, currentHost = globalThis.location?.hostname ?? '') {
  const host = currentHost.toLowerCase();
  for (const d of domainsFor(values)) {
    if (host === d || host.endsWith(`.${d}`)) return d;
  }
  return values['general.base_domain'];
}

// Every FQDN a route answers on, the current network's first. The first entry
// is the one to link; the rest are shown as alternates.
export function hostsFor(hostname, values, currentHost) {
  const current = currentDomain(values, currentHost);
  const domains = domainsFor(values).sort((a, b) => (a === current ? -1 : b === current ? 1 : 0));
  return domains.map(d => `${hostname}.${d}`);
}

export function primaryUrl(hostname, values, currentHost) {
  return `http://${hostsFor(hostname, values, currentHost)[0]}`;
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
