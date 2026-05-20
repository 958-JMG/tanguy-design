// API client v3 (Sprint 1) — wrappers fetch vers /api/*

import { state } from './state.js';

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

export async function fetchClients() {
  const d = await api('/api/data/clients');
  state.clients = (d.records || []).map(r => ({ id: r.id, ...r.fields }));
  return state.clients;
}

export async function fetchClient(clientId) {
  const d = await api(`/api/clients/${clientId}`);
  state.client = d.client;
  state.projets = d.projets;
  return d;
}

export async function createProjetForClient(clientId, fields) {
  return api(`/api/clients/${clientId}/projets`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}
