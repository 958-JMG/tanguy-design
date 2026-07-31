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

export async function patchDevisArtisan(id, fields) {
  return api(`/api/data/devis-artisans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

// Supprime un devis artisan (admin). Sert à réimporter une version modifiée :
// on supprime l'ancien, on réimporte le nouveau PDF.
export async function deleteDevisArtisan(id) {
  return api(`/api/data/devis-artisans/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

// === Rendez-vous (CRUD via /api/data/rendez-vous) ===
export async function fetchRendezVous() {
  const d = await api('/api/data/rendez-vous');
  return d.records || [];
}
export async function createRendezVous(fields) {
  return api('/api/data/rendez-vous', { method: 'POST', body: JSON.stringify({ fields }) });
}
export async function patchRendezVous(id, fields) {
  return api(`/api/data/rendez-vous/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
}
export async function deleteRendezVous(id) {
  return api(`/api/data/rendez-vous/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// === SAV (CRUD via /api/data/sav) — onglet SAV local ===
export async function fetchSav() {
  const d = await api('/api/data/sav');
  return (d.records || []).map(r => ({ id: r.id, ...r.fields }));
}

// P-F (2026-06-24) — toutes les commandes (pour afficher les réceptions/livraisons dans l'agenda).
export async function fetchCommandes() {
  const d = await api('/api/data/commandes');
  return (d.records || []).map(r => ({ id: r.id, ...r.fields }));
}
export async function createSav(fields) {
  return api('/api/data/sav', { method: 'POST', body: JSON.stringify({ fields }) });
}
export async function patchSav(id, fields) {
  return api(`/api/data/sav/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
}
export async function deleteSav(id) {
  return api(`/api/data/sav/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function appendJournalEntry(projetId, text) {
  // Server attend `text`, l'auteur est dérivé de req.session.user côté back.
  return api(`/api/projets/${projetId}/journal`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// Sprint v3.8 — Suppression d'une entrée journal (identifiée par son contenu exact).
export async function deleteJournalEntry(projetId, entry) {
  return api(`/api/projets/${projetId}/journal`, {
    method: 'DELETE',
    body: JSON.stringify({ entry }),
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

// ============================================================================
// Sprint v3.2 — Wrappers feature parity v1 (artisans, devis Tanguy, devis artisan, Plaud)
// ============================================================================

// Liste des artisans (utilisée par les modales d'affectation).
export async function fetchArtisans() {
  const d = await api('/api/data/artisans');
  return (d.records || []).map(r => ({ id: r.id, ...r.fields }));
}

// Affecter un (ou plusieurs) artisans à un projet — PATCH avec union des IDs existants.
export async function setProjetArtisans(projetId, artisanIds) {
  return patchProjet(projetId, { 'Artisans': artisanIds });
}

// Upload + parse PDF devis client Winner (Principal ou Additif).
// Le backend gère le parsing Claude + création devis + zones + lignes + échéances.
// withKeepAlive côté serveur pour éviter le 524 Cloudflare (parse Claude 60-120s).
//
// IMPORTANT : withKeepAlive renvoie TOUJOURS HTTP 200 (même en erreur), car les
// premiers bytes sont déjà flushés. Le payload contient {error: "..."} en cas
// d'échec. On doit donc tester `j.error` EN PLUS de `r.ok`.
export async function importDevisClient({ file, projetId = null, clientId = null, type = 'Principal', signal = null }) {
  const fd = new FormData();
  fd.append('pdf', file);
  if (projetId) fd.append('projetId', projetId);
  if (clientId) fd.append('clientId', clientId);
  fd.append('type', type);
  const r = await fetch('/api/devis/import', { method: 'POST', credentials: 'same-origin', body: fd, signal });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.statusText);
  }
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

// Devis express (P-H3) — upload + parse d'un devis FOURNISSEUR. Ne crée rien :
// retourne le parsing enrichi (coefficient de marge + éco-part + prix client suggéré).
// (withKeepAlive → check j.error en plus de r.ok, cf. importDevisClient.)
export async function parseDevisFournisseur({ file, signal = null }) {
  const fd = new FormData();
  fd.append('pdf', file);
  const r = await fetch('/api/devis-fournisseur/parse', { method: 'POST', credentials: 'same-origin', body: fd, signal });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.statusText);
  }
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

// Signature d'un devis Tanguy → backend crée les commandes fournisseurs avec rétro-planning
// (date envoi = date pose - 105 jours), génère 4 tâches (acompte, BC, notif artisans, planning J+60),
// passe le devis à Signé + projet à Commandes.
export async function signDevisTanguy(devisId) {
  return api(`/api/devis/${devisId}/sign`, { method: 'POST', body: JSON.stringify({}) });
}

// Upload + parse PDF devis artisan → calcul auto rétro-commission 5% côté backend,
// crée le record dans devis-artisans, attache le PDF, ajoute auto l'artisan au projet.
// (withKeepAlive → check j.error en plus de r.ok, cf. importDevisClient.)
export async function importDevisArtisan({ file, projetId, artisanId = null }) {
  const fd = new FormData();
  fd.append('pdf', file);
  if (projetId) fd.append('projetId', projetId);
  if (artisanId) fd.append('artisanId', artisanId);
  const r = await fetch('/api/artisan-devis/import', { method: 'POST', credentials: 'same-origin', body: fd });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.statusText);
  }
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

// Sprint v3.6 — Marque une échéance comme Encaissé (paiement reçu).
// Action manuelle déclenchée après que la facture a été envoyée et que le client a payé.
export async function marquerEncaisse(echeanceId, mode = null) {
  const fields = {
    'Statut': 'Encaissé',
    'Date règlement': new Date().toISOString().slice(0, 10),
  };
  if (mode) fields['Mode règlement'] = mode; // Virement / Chèque / Espèces / CB (#7)
  return api(`/api/data/echeances-devis/${encodeURIComponent(echeanceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

// P-D (2026-06-24) — édition du montant d'une échéance (acompte modifiable + recalcul).
export async function patchEcheance(echeanceId, fields) {
  return api(`/api/data/echeances-devis/${encodeURIComponent(echeanceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

// Crée un artisan (POST ouvert à tous via ACL, Lot B #3). Renvoie { ok, record }.
export async function createArtisan(fields) {
  return api('/api/data/artisans', { method: 'POST', body: JSON.stringify({ fields }) });
}

// Sprint v3.5 — Crée une tâche de facturation pour Virginie liée à une échéance.
// Quand Virginie marque la tâche "Terminée", l'échéance passe à "Encaissé" auto
// (hook backend dans PATCH /api/data/taches/:id).
export async function genererTacheFacturation(projetId, echeanceId) {
  return api(`/api/projets/${encodeURIComponent(projetId)}/echeances/${encodeURIComponent(echeanceId)}/facturer`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ============================================================================
// Sprint v5.1 — Aide utilisateur (contenu éditable par les admins)
// ============================================================================

export async function fetchAide() {
  const d = await api('/api/data/aide');
  return (d.records || []).map(r => ({ id: r.id, ...r.fields }));
}

export async function createAide(fields) {
  return api('/api/data/aide', { method: 'POST', body: JSON.stringify({ fields }) });
}

export async function patchAide(id, fields) {
  return api(`/api/data/aide/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
}

export async function deleteAide(id) {
  return api(`/api/data/aide/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Sprint v3.3 — détail complet d'un devis (header + zones + lignes + échéances).
// Endpoint backend : GET /api/devis/:id/detail (déjà existant).
export async function fetchDevisDetail(devisId) {
  return api(`/api/devis/${devisId}/detail`);
}

// Pousse un devis Tanguy en BROUILLON dans Pennylane (jamais envoyé auto).
// opts : { pennylane_customer_id?, create_customer?, force? }.
// Réponses possibles : { ok:true, quoteId, openUrl, ... } | { ok:true, already:true }
//   | { ok:false, needsCustomerConfirmation:true, candidates:[...] }.
export async function pushDevisToPennylane(devisId, opts = {}) {
  return api(`/api/devis/${devisId}/pennylane`, { method: 'POST', body: JSON.stringify(opts) });
}
// URL de téléchargement du PDF officiel du devis Pennylane.
export function pennylanePdfUrl(devisId) {
  return `/api/devis/${devisId}/pennylane/pdf`;
}

// Génère les factures BROUILLON d'échéance (acompte/livraison/solde) dans Pennylane.
// Même gestion de confirmation client que pushDevisToPennylane.
export async function pushEcheancesFactures(devisId, opts = {}) {
  return api(`/api/devis/${devisId}/echeances-factures`, { method: 'POST', body: JSON.stringify(opts) });
}
// URL de téléchargement du PDF d'une facture d'échéance.
export function echeancePdfUrl(echeanceId) {
  return `/api/echeances/${echeanceId}/pennylane/pdf`;
}

// PATCH champs header devis (Numéro, Type, Statut, Date, Notes…).
export async function patchDevis(devisId, fields) {
  return api(`/api/data/devis/${devisId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  });
}

// Parse Plaud R1/R2 → création réunion + tâches auto depuis prochaines_actions[].
// niveau: 'R1' (découverte) ou 'R2' (chantier). type_reunion: 'Découverte', 'Présentation devis',
// 'Suivi chantier', 'SAV'.
// (withKeepAlive → check j.error explicitement, cf. importDevisClient.)
export async function parsePlaud({ transcript, projetId = null, clientId = null, type_reunion = 'Découverte', niveau = null }) {
  const r = await fetch('/api/plaud/parse', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, projetId, clientId, type_reunion, niveau }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.statusText);
  }
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
