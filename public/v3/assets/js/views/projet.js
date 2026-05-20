// Vue Projet v3 (Sprint 1) — fiche basique avec édition Phase/Chantier/dates/budget
// Les détails riches (stepper, tâches, commandes, devis, journal) sont reportés à Sprint 2/3.

import { state } from '../core/state.js';
import { navigateTo, router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
}

async function patchProjet(projetId, fields) {
  const r = await fetch(`/api/data/projets/${projetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || r.status);
  }
  return r.json();
}

export function renderProjet(app, projetId) {
  const p = (state.projets || []).find(x => x.id === projetId);
  if (!p) {
    app.innerHTML = `<div class="card"><h2>Projet introuvable</h2><p class="muted">L'identifiant ${esc(projetId)} ne correspond à aucun projet en mémoire. Essaie de retourner aux clients et de rouvrir.</p></div>`;
    return;
  }

  const clientId = (p.Client || [])[0];
  const client = clientId ? state.clients.find(c => c.id === clientId) : null;
  const phase = p['Phase commerciale'] || p.Statut || '—';
  const chantier = p['Statut chantier'] || '';

  app.innerHTML = `
    <nav class="breadcrumb">
      <a href="#clients">Clients</a> &rsaquo;
      ${client ? `<a href="#clients/${encodeURIComponent(client.id)}">${esc(client.Nom)}</a> &rsaquo;` : ''}
      <strong>${esc(p.Référence || '(sans référence)')}</strong>
    </nav>

    <div class="client-header">
      <div class="client-header-left">
        <div class="client-header-icon">${icon('folder', 36)}</div>
        <div>
          <h1 class="page-title" style="margin:0">${esc(p.Référence || '(sans référence)')}</h1>
          <div class="muted" style="margin-top:4px">
            ${client ? `Client : <strong>${esc(client.Nom)}</strong>` : 'Pas de client lié'}
            ${p['Date découverte'] ? ` · Découvert ${esc(p['Date découverte'])}` : ''}
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" id="btn-edit-projet">${icon('edit', 16)} Éditer</button>
        ${chantier === 'Archivé'
          ? `<button class="btn btn-ghost" id="btn-unarchive">${icon('arrowLeft', 16)} Désarchiver</button>`
          : `<button class="btn btn-ghost" id="btn-archive">${icon('archive', 16)} Archiver</button>`}
      </div>
    </div>

    <div class="client-grid">
      <div class="card">
        <h2 class="card-title">État</h2>
        <div class="kv">${icon('compass', 16)} Phase commerciale : <strong>${esc(phase)}</strong></div>
        ${chantier ? `<div class="kv">${icon('hammer', 16)} Statut chantier : <strong>${esc(chantier)}</strong></div>` : ''}
        ${p['Date pose prévue']
          ? `<div class="kv">${icon('calendar', 16)} Pose prévue : <strong>${esc(p['Date pose prévue'])}${p['Date pose fin'] ? ' → ' + esc(p['Date pose fin']) : ''}</strong></div>`
          : ''}
      </div>
      <div class="card">
        <h2 class="card-title">Finances prévisionnelles</h2>
        <div class="kv">Budget HT : <strong>${euros(p['Budget HT'])}</strong></div>
        ${p['Marge prévisionnelle'] != null
          ? `<div class="kv">Marge prévi : <strong>${(p['Marge prévisionnelle'] > 1 ? p['Marge prévisionnelle'] : p['Marge prévisionnelle'] * 100).toFixed(1)} %</strong></div>`
          : ''}
      </div>
    </div>

    ${p.Description ? `
    <h2 class="section-title">Description</h2>
    <div class="card"><p style="white-space:pre-line">${esc(p.Description)}</p></div>
    ` : ''}

    ${p['Journal chantier'] ? `
    <h2 class="section-title">Journal chantier</h2>
    <div class="card"><pre class="journal" style="white-space:pre-wrap;font-family:'DM Mono',monospace;font-size:12px">${esc(p['Journal chantier'])}</pre></div>
    ` : ''}

    <h2 class="section-title">À venir Sprint 2/3</h2>
    <div class="card">
      <p class="muted muted-with-icon">${icon('construction', 14)}
        Détails riches de la fiche projet (stepper 12 étapes, tâches éditables,
        commandes fournisseurs, devis Tanguy/artisans, attachments 4 onglets, R1/R2 Plaud,
        drag-drop pose sur calendar) à venir dans les Sprints 2-3.
        En attendant, la <a href="/">version v2</a> reste disponible avec tout le détail.
      </p>
    </div>
  `;

  hydrateIcons(app);

  document.getElementById('btn-edit-projet')?.addEventListener('click', () => openModalEditProjet(p));
  document.getElementById('btn-archive')?.addEventListener('click', () => archiveProjet(p, 'Archivé'));
  document.getElementById('btn-unarchive')?.addEventListener('click', () => archiveProjet(p, ''));
}

async function archiveProjet(p, newChantier) {
  const label = newChantier === 'Archivé' ? 'archiver' : 'désarchiver';
  if (!confirm(`Voulez-vous ${label} le projet « ${p.Référence || p.id} » ?`)) return;
  try {
    const fields = newChantier
      ? { 'Statut chantier': newChantier }
      : { 'Statut chantier': 'Pré-pose' }; // valeur par défaut sortie d'archive
    await patchProjet(p.id, fields);
    // Mettre à jour state local
    p['Statut chantier'] = fields['Statut chantier'];
    router();
  } catch (e) {
    alert(`Erreur ${label} : ${e.message}`);
  }
}

function openModalEditProjet(p) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Éditer projet</h2>
      <form id="form-edit-projet">
        <label>Référence
          <input name="Référence" value="${esc(p.Référence || '')}" required>
        </label>
        <label>Phase commerciale
          <select name="Phase commerciale">
            <option ${p['Phase commerciale'] === 'Découverte' ? 'selected' : ''}>Découverte</option>
            <option ${p['Phase commerciale'] === 'Dessin' ? 'selected' : ''}>Dessin</option>
            <option ${p['Phase commerciale'] === 'Présentation devis' ? 'selected' : ''}>Présentation devis</option>
            <option ${p['Phase commerciale'] === 'En attente décision' ? 'selected' : ''}>En attente décision</option>
            <option ${p['Phase commerciale'] === 'Signé' ? 'selected' : ''}>Signé</option>
          </select>
        </label>
        <label>Statut chantier (uniquement si Signé)
          <select name="Statut chantier">
            <option value="">—</option>
            <option ${p['Statut chantier'] === 'Pré-pose' ? 'selected' : ''}>Pré-pose</option>
            <option ${p['Statut chantier'] === 'Pose en cours' ? 'selected' : ''}>Pose en cours</option>
            <option ${p['Statut chantier'] === 'Terminé' ? 'selected' : ''}>Terminé</option>
            <option ${p['Statut chantier'] === 'SAV' ? 'selected' : ''}>SAV</option>
            <option ${p['Statut chantier'] === 'Archivé' ? 'selected' : ''}>Archivé</option>
          </select>
        </label>
        <label>Budget HT (€)
          <input name="Budget HT" type="number" step="0.01" value="${p['Budget HT'] || ''}">
        </label>
        <label>Date pose prévue
          <input name="Date pose prévue" type="date" value="${p['Date pose prévue'] || ''}">
        </label>
        <label>Date pose fin
          <input name="Date pose fin" type="date" value="${p['Date pose fin'] || ''}">
        </label>
        <label>Description
          <textarea name="Description" rows="3">${esc(p.Description || '')}</textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="modal-cancel">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('modal-cancel').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escClose); }
  });

  document.getElementById('form-edit-projet').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) {
      if (v === '' && k !== 'Statut chantier') continue;
      fields[k] = k === 'Budget HT' ? Number(v) : v;
    }
    try {
      await patchProjet(p.id, fields);
      // Mettre à jour state local
      Object.assign(p, fields);
      modal.remove();
      router();
    } catch (err) {
      alert('Erreur enregistrement : ' + err.message);
    }
  });
}
