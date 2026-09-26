async function json(res) {
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Containers
  getContainers:        ()           => fetch('/api/containers').then(json),
  getContainerInspect:  (id)         => fetch(`/api/containers/${id}/inspect`).then(json),
  containerAction:      (id, action) => fetch(`/api/containers/${id}/${action}`, { method: 'POST' }).then(json),

  // Routes
  getRoutes:    ()        => fetch('/api/routes').then(json),
  createRoute:  body      => fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  updateRoute:  (id, body) => fetch(`/api/routes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  deleteRoute:  id        => fetch(`/api/routes/${id}`, { method: 'DELETE' }).then(json),

  // Analytics
  getAnalytics: params => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    return fetch(`/api/analytics?${q}`).then(json);
  },

  // Images
  getImages:    ()   => fetch('/api/images').then(json),
  removeImage:  (id) => fetch(`/api/images/${id}`, { method: 'DELETE' }).then(json),

  // Volumes
  getVolumes:   ()     => fetch('/api/volumes').then(json),
  removeVolume: (name) => fetch(`/api/volumes/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(json),

  // Networks
  getNetworks:  () => fetch('/api/networks').then(json),

  // Settings
  getSettings:    ()    => fetch('/api/settings').then(json),
  updateSettings: patch => fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(json),

  // Docker analytics
  getAllContainerStats: (params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    return fetch(`/api/docker-analytics/stats?${q}`).then(json);
  },
  getContainerStats: (id, params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    return fetch(`/api/docker-analytics/stats/${id}?${q}`).then(json);
  },
  getContainerEvents: (id, params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    return fetch(`/api/docker-analytics/events/${id}?${q}`).then(json);
  },
  getAllContainerEvents: (params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    return fetch(`/api/docker-analytics/events?${q}`).then(json);
  },
};
