// Vue Clients v3 — liste + fiche détaillée (cœur du pivot client-centric, Sprint 1)

import { state } from '../core/state.js';
import { fetchClient, fetchClients, createProjetForClient, patchClient } from '../core/api.js';
import { navigateTo, router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';

const TYPE_ICONS = {
  'Particulier':   'user',
  'Professionnel': 'building',
  'Architecte':    'landmark',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

// === Liste clients ===
export function renderClientsList(app) {
  const clients = state.clients || [];

  app.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Clients (${clients.length})</h1>
      <button class="btn btn-primary" onclick="window.alert('Création client : à venir Sprint 1.5')">${icon('plus', 16)} Nouveau client</button>
    </div>

    <div class="filters-bar">
      <div class="search-input-wrap">
        <span class="search-input-icon">${icon('search', 16)}</span>
        <input type="search" id="search-clients" placeholder="Rechercher nom, email, téléphone…" class="search-input">
      </div>
      <div class="filter-chips">
        <button class="chip is-active" data-filter="all">Tous</button>
        <button class="chip" data-filter="Particulier">Particuliers</button>
        <button class="chip" data-filter="Professionnel">Pros</button>
        <button class="chip" data-filter="Architecte">Architectes</button>
      </div>
    </div>

    <div id="clients-list" class="clients-list"></div>
  `;

  let currentFilter = 'all';
  let currentSearch = '';

  function renderList() {
    const q = currentSearch.trim().toLowerCase();
    const filtered = clients.filter(c => {
      if (currentFilter !== 'all' && c.Type !== currentFilter) return false;
      if (!q) return true;
      const blob = [c.Nom, c.Email, c.Téléphone, c.Contact].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });

    const list = document.getElementById('clients-list');
    if (!filtered.length) {
      list.innerHTML = '<div class="card"><p class="muted">Aucun client correspondant.</p></div>';
      return;
    }
    list.innerHTML = filtered.map(c => `
      <button class="client-card" onclick="window.navigateTo('clients', { id: '${c.id}' })">
        <div class="client-icon">${icon(TYPE_ICONS[c.Type] || 'user', 24)}</div>
        <div class="client-info">
          <div class="client-name">${esc(c.Nom || '—')}</div>
          <div class="client-meta">
            <span class="client-type">${esc(c.Type || 'Particulier')}</span>
            ${c.Téléphone ? `<span class="client-meta-item">${icon('phone', 12)} ${esc(c.Téléphone)}</span>` : ''}
            ${c.Email ? `<span class="client-meta-item">${icon('mail', 12)} ${esc(c.Email)}</span>` : ''}
          </div>
        </div>
        <div class="client-projets">${(c.Projets || []).length} projet${(c.Projets || []).length > 1 ? 's' : ''}</div>
      </button>
    `).join('');
  }
  renderList();

  document.getElementById('search-clients').addEventListener('input', e => {
    currentSearch = e.target.value;
    renderList();
  });
  document.querySelectorAll('.chip').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      currentFilter = b.dataset.filter;
      renderList();
    });
  });
}

// === Fiche client détaillée ===
export async function renderClientDetail(app, clientId) {
  try {
    const data = await fetchClient(clientId);
    const c = data.client.fields;
    const projets = data.projets || [];

    app.innerHTML = `
      <nav class="breadcrumb">
        <a href="#clients">Clients</a> &rsaquo; <strong>${esc(c.Nom)}</strong>
      </nav>

      <div class="client-header">
        <div class="client-header-left">
          <div class="client-header-icon">${icon(TYPE_ICONS[c.Type] || 'user', 36)}</div>
          <div>
            <h1 class="page-title" style="margin:0">${esc(c.Nom)}</h1>
            <div class="muted" style="margin-top:4px">
              ${esc(c.Type || 'Particulier')}${c['Architecte référent'] ? ' · via architecte' : ''}
              ${c.Source ? ` · Source : ${esc(c.Source)}` : ''}
            </div>
          </div>
        </div>
        <button class="btn btn-ghost" id="btn-edit-client">${icon('edit', 16)} Éditer</button>
      </div>

      <div class="client-grid">
        <div class="card">
          <h2 class="card-title">Contact</h2>
          ${c.Téléphone ? `<div class="kv">${icon('phone', 16)} ${esc(c.Téléphone)}</div>` : ''}
          ${c.Email ? `<div class="kv">${icon('mail', 16)} <a href="mailto:${esc(c.Email)}">${esc(c.Email)}</a></div>` : ''}
          ${c.Adresse ? `<div class="kv">${icon('mapPin', 16)} <span style="white-space:pre-line">${esc(c.Adresse)}</span></div>` : ''}
        </div>
        ${c.Notes ? `
        <div class="card">
          <h2 class="card-title">Notes</h2>
          <p style="white-space:pre-line">${esc(c.Notes)}</p>
        </div>` : ''}
      </div>

      <div class="section-header">
        <h2 class="section-title">Projets (${projets.length})</h2>
        <button class="btn btn-primary" id="btn-new-projet">${icon('plus', 16)} Nouveau projet</button>
      </div>

      <div id="projets-list" class="projets-list">
        ${projets.length === 0
          ? '<div class="card"><p class="muted">Aucun projet pour ce client. Cliquez sur « Nouveau projet » pour démarrer.</p></div>'
          : projets
              .filter(p => (p.fields['Statut chantier'] || '') !== 'Archivé') // filtre archivés par défaut
              .map(p => {
                const pf = p.fields;
                const phase = pf['Phase commerciale'] || pf['Statut'] || '—';
                const chantier = pf['Statut chantier'] || '';
                return `
                <button class="projet-card" onclick="window.navigateTo('projet', { id: '${p.id}' })">
                  <div class="projet-ref">${icon('folder', 16)} ${esc(pf['Référence'] || '(sans référence)')}</div>
                  <div class="projet-meta">
                    <span class="badge phase-${esc(phase).toLowerCase().replace(/[^a-z]+/g,'-')}">${esc(phase)}</span>
                    ${chantier ? `<span class="badge chantier">${esc(chantier)}</span>` : ''}
                    ${pf['Budget HT'] ? `<span>${pf['Budget HT'].toLocaleString('fr-FR')} €</span>` : ''}
                    ${pf['Date pose prévue'] ? `<span class="meta-with-icon">${icon('calendar', 12)} Pose ${esc(pf['Date pose prévue'])}</span>` : ''}
                  </div>
                </button>
                `;
              }).join('')
        }
        ${projets.filter(p => (p.fields['Statut chantier'] || '') === 'Archivé').length > 0
          ? `<details class="archived-toggle"><summary class="muted">Voir ${projets.filter(p => (p.fields['Statut chantier'] || '') === 'Archivé').length} projet(s) archivé(s)</summary>
              <div class="projets-list" style="margin-top:8px">
              ${projets.filter(p => (p.fields['Statut chantier'] || '') === 'Archivé').map(p => {
                const pf = p.fields;
                return `<button class="projet-card archived" onclick="window.navigateTo('projet', { id: '${p.id}' })">
                  <div class="projet-ref">${icon('archive', 16)} ${esc(pf['Référence'] || '(sans référence)')}</div>
                  <div class="projet-meta"><span class="badge chantier">Archivé</span></div>
                </button>`;
              }).join('')}
              </div>
            </details>`
          : ''}
      </div>
    `;

    document.getElementById('btn-new-projet').addEventListener('click', () => openModalNouveauProjet(clientId));
    document.getElementById('btn-edit-client').addEventListener('click', () => openModalEditClient(data.client));
    hydrateIcons(app);
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Erreur</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

// === Modale "Nouveau projet" rattaché client (Sprint 1) ===
function openModalNouveauProjet(clientId) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">Nouveau projet</h2>
      <p class="muted">Rattaché au client courant.</p>
      <form id="form-new-projet">
        <label>Référence projet (auto si vide)
          <input name="Référence" placeholder="ex : Cuisine principale">
        </label>
        <label>Phase commerciale
          <select name="Phase commerciale">
            <option>Découverte</option>
            <option>Dessin</option>
            <option>Présentation devis</option>
            <option>En attente décision</option>
          </select>
        </label>
        <label>Budget HT estimé (€)
          <input name="Budget HT" type="number" step="0.01" placeholder="ex : 18000">
        </label>
        <label>Date pose souhaitée
          <input name="Date pose prévue" type="date">
        </label>
        <label>Description
          <textarea name="Description" rows="3" placeholder="Bref descriptif du projet…"></textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="modal-cancel">Annuler</button>
          <button type="submit" class="btn btn-primary">Créer projet</button>
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

  document.getElementById('form-new-projet').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) {
      if (v) fields[k] = k === 'Budget HT' ? Number(v) : v;
    }
    try {
      const r = await createProjetForClient(clientId, fields);
      modal.remove();
      toast('Projet créé', 'success');
      navigateTo('clients', { id: clientId });
    } catch (err) {
      toast('Erreur création : ' + err.message, 'error', 5000);
    }
  });
}

// === Modale "Éditer client" (Sprint 1 suite) ===
function openModalEditClient(clientRecord) {
  const c = clientRecord.fields;
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-edit">
      <h2 id="modal-title-edit">Éditer ${esc(c.Nom)}</h2>
      <form id="form-edit-client">
        <label>Nom
          <input name="Nom" value="${esc(c.Nom || '')}" required>
        </label>
        <label>Type
          <select name="Type">
            <option ${c.Type === 'Particulier' ? 'selected' : ''}>Particulier</option>
            <option ${c.Type === 'Professionnel' ? 'selected' : ''}>Professionnel</option>
            <option ${c.Type === 'Architecte' ? 'selected' : ''}>Architecte</option>
          </select>
        </label>
        <label>Contact
          <input name="Contact" value="${esc(c.Contact || '')}">
        </label>
        <label>Téléphone
          <input name="Téléphone" value="${esc(c.Téléphone || '')}">
        </label>
        <label>Email
          <input name="Email" type="email" value="${esc(c.Email || '')}">
        </label>
        <label>Adresse
          <textarea name="Adresse" rows="2">${esc(c.Adresse || '')}</textarea>
        </label>
        <label>Source
          <input name="Source" value="${esc(c.Source || '')}" placeholder="ex : Bouche à oreille, Site web…">
        </label>
        <label>Notes
          <textarea name="Notes" rows="3">${esc(c.Notes || '')}</textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="modal-cancel-edit">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('modal-cancel-edit').onclick = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escClose); }
  });

  document.getElementById('form-edit-client').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) {
      fields[k] = v || ''; // garder les chaînes vides pour effacer un champ
    }
    try {
      await patchClient(clientRecord.id, fields);
      await fetchClients();
      modal.remove();
      toast('Client enregistré', 'success');
      router();
    } catch (err) {
      toast('Erreur enregistrement : ' + err.message, 'error', 5000);
    }
  });
}
