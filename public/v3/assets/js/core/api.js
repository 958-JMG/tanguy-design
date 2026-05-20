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

export async function fetchProjets() {
  const d = await api('/api/data/projets');
  state.projets = (d.records || []).map(r => ({ id: r.id, ...r.fields }));
  return state.projets;
}

export async function fetchClient(clientId) {
  const d = await api(`/api/clients/${clientId}`);
  state.client = d.client;
  state.clientProjets = d.projets;
  return d;
}

export async function patchClient(clientId, fields) {
  return api(`/api/data/clients/${clientId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

export async function createClient(fields) {
  return api(`/api/data/clients`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

export async function createProjetForClient(clientId, fields) {
  return api(`/api/clients/${clientId}/projets`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

export async function fetchProjetDetail(projetId) {
  return api(`/api/projets/${projetId}`);
}

export async function patchProjet(projetId, fields) {
  return api(`/api/data/projets/${projetId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

export async function patchTache(tacheId, fields) {
  return api(`/api/data/taches/${tacheId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

export async function createTache(fields) {
  return api(`/api/data/taches`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });
}

export async function deleteTache(tacheId) {
  return api(`/api/data/taches/${tacheId}`, { method: 'DELETE' });
}

export async function appendJournalEntry(projetId, text) {
  // Server attend `text`, l'auteur est dérivé de req.session.user côté back.
  return api(`/api/projets/${projetId}/journal`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function uploadAttachment(projetId, field, file) {
  const fd = new FormData();
  fd.append('field', field);
  fd.append('file', file);
  const r = await fetch(`/api/projets/${projetId}/attachments`, {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.statusText);
  }
  return r.json();
}

export async function deleteAttachment(projetId, field, attachmentId) {
  return api(`/api/projets/${projetId}/attachments`, {
    method: 'DELETE',
    body: JSON.stringify({ field, attachmentId }),
  });
}
