// Vue SAV local — tableau des tickets SAV + CRUD (2026-06-09)
//
// Colonnes : Date / Client / Ville / Type / Statut (+ actions).
// La Ville est DÉRIVÉE du client lié (table Clients a déjà Ville/CP) — pas un champ SAV.
// Champs additifs (cf. scripts/setup-sav-fields.js) :
//   - "Statut"   (singleSelect) — Nouveau | En cours | En attente pièce | Résolu | Annulé
//   - "Type SAV" (singleSelect) — Réglage | Pièce à remplacer | Reprise | Autre
// Code DÉFENSIF : si les champs additifs sont absents (script non exécuté), la vue
// fonctionne, le tableau s'affiche, et l'enregistrement du reste ne casse pas.

import { state } from '../core/state.js';
import { fetchSav, createSav, patchSav, deleteSav } from '../core/api.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';

const STATUTS = ['Nouveau', 'En cours', 'En attente pièce', 'Résolu', 'Annulé'];
const TYPES_SAV = ['Réglage', 'Pièce à remplacer', 'Reprise', 'Autre'];
const REALISE_PAR = ['Virginie', 'Solène', 'Sébastien', 'Marine'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, j] = String(d).slice(0, 10).split('-');
  if (!y || !m || !j) return esc(d);
  return `${j}/${m}/${y}`;
}

// id de record client (lien Airtable) → nom + ville depuis state.clients (chargé au boot).
function clientInfo(clientLink) {
  const id = Array.isArray(clientLink) ? clientLink[0] : null;
  if (!id) return { nom: '—', ville: '—' };
  const c = (state.clients || []).find(x => x.id === id);
  if (!c) return { nom: '—', ville: '—' };
  return { nom: c.Nom || '—', ville: c.Ville || '—' };
}

// Type affiché : "Type SAV" (singleSelect additif) en priorité, sinon "Type" texte historique.
function typeLabel(t) {
  return t['Type SAV'] || t['Type'] || '';
}

function modalShell(title, content) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${content}</div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  return { modal, close };
}

export async function renderSav(app) {
  app.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">SAV</h1>
      <button class="btn btn-primary" id="btn-new-sav">${icon('plus', 16)} Nouveau ticket</button>
    </div>
    <div class="filters-bar">
      <div class="filter-chips" id="sav-filters">
        <button class="chip is-active" data-filter="all">Tous</button>
        ${STATUTS.map(s => `<button class="chip" data-filter="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
    </div>
    <div id="sav-body"><div class="loading">Chargement…</div></div>
  `;
  hydrateIcons(app);

  const body = document.getElementById('sav-body');
  let tickets = [];
  let currentFilter = 'all';

  async function reload() {
    try {
      tickets = await fetchSav();
    } catch (err) {
      body.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`;
      return;
    }
    renderTable();
  }

  function renderTable() {
    const filtered = currentFilter === 'all'
      ? tickets
      : tickets.filter(t => (t['Statut'] || '') === currentFilter);

    // Tri : plus récent d'abord (par Date demande).
    filtered.sort((a, b) => String(b['Date demande'] || '').localeCompare(String(a['Date demande'] || '')));

    if (!filtered.length) {
      body.innerHTML = `<div class="card"><p class="muted">${
        tickets.length ? 'Aucun ticket pour ce statut.' : 'Aucun ticket SAV. Crée le premier via « Nouveau ticket ».'
      }</p></div>`;
      return;
    }

    body.innerHTML = `
      <div class="table-scroll">
        <table class="pipeline-table">
          <thead><tr><th>Date</th><th>Client</th><th>Ville</th><th>Type</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${filtered.map(t => {
              const ci = clientInfo(t['Client']);
              const type = typeLabel(t);
              return `
              <tr>
                <td>${fmtDate(t['Date demande'])}</td>
                <td><strong>${esc(ci.nom)}</strong></td>
                <td>${esc(ci.ville)}</td>
                <td>${type ? `<span class="badge">${esc(type)}</span>` : '<span class="muted">—</span>'}</td>
                <td>${t['Statut'] ? `<span class="badge">${esc(t['Statut'])}</span>` : '<span class="muted">—</span>'}</td>
                <td style="display:flex;gap:4px;justify-content:flex-end">
                  <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(t.id)}" title="Éditer">${icon('edit', 14)}</button>
                  <button class="btn btn-ghost btn-sm" data-action="del" data-id="${esc(t.id)}" data-label="${esc(ci.nom)}" style="color:var(--accent)" title="Supprimer">${icon('trash', 14)}</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    hydrateIcons(body);

    body.querySelectorAll('[data-action="edit"]').forEach(b => b.addEventListener('click', () => {
      const t = tickets.find(x => x.id === b.dataset.id);
      if (t) openModalSav(t, reload);
    }));
    body.querySelectorAll('[data-action="del"]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmModal(`Supprimer le ticket SAV de ${b.dataset.label} ? Cette action est irréversible.`, { okLabel: 'Supprimer', danger: true });
      if (!ok) return;
      try {
        await deleteSav(b.dataset.id);
        toast('Ticket SAV supprimé', 'success');
        reload();
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
  }

  app.querySelector('#btn-new-sav').addEventListener('click', () => openModalSav(null, reload));
  app.querySelectorAll('#sav-filters .chip').forEach(c => c.addEventListener('click', () => {
    currentFilter = c.dataset.filter;
    app.querySelectorAll('#sav-filters .chip').forEach(x => x.classList.toggle('is-active', x === c));
    renderTable();
  }));

  await reload();
}

// Modale create / edit d'un ticket SAV.
function openModalSav(ticket, onSaved) {
  const isNew = !ticket;
  const t = ticket || {};
  const selectedClient = Array.isArray(t['Client']) ? t['Client'][0] : '';
  const clients = (state.clients || []).slice().sort((a, b) => String(a.Nom || '').localeCompare(String(b.Nom || '')));
  const today = new Date().toISOString().slice(0, 10);

  const { modal, close } = modalShell(isNew ? 'Nouveau ticket SAV' : 'Éditer le ticket SAV', `
    <form id="form-sav">
      <label>Client
        <select name="Client" required>
          <option value="">— Sélectionner —</option>
          ${clients.map(c => `<option value="${esc(c.id)}" ${selectedClient === c.id ? 'selected' : ''}>${esc(c.Nom || '(sans nom)')}${c.Ville ? ` — ${esc(c.Ville)}` : ''}</option>`).join('')}
        </select>
      </label>
      <label>Date de la demande <input name="Date demande" type="date" value="${esc(t['Date demande'] || today)}"></label>
      <label>Type
        <select name="Type SAV">
          <option value="">—</option>
          ${TYPES_SAV.map(v => `<option ${typeLabel(t) === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </label>
      <label>Statut
        <select name="Statut">
          ${STATUTS.map(v => `<option ${(t['Statut'] || 'Nouveau') === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </label>
      <label>Réalisé par
        <select name="Réalisé par">
          <option value="">—</option>
          ${REALISE_PAR.map(v => `<option ${t['Réalisé par'] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </label>
      <label>Description / notes <textarea name="Référence" rows="3" placeholder="Décris la demande SAV…">${esc(t['Référence'] || '')}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="sav-cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Créer' : 'Enregistrer'}</button>
      </div>
    </form>
  `);
  modal.querySelector('#sav-cancel').onclick = close;

  modal.querySelector('#form-sav').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const clientId = fd.get('Client');
    if (!clientId) { toast('Sélectionne un client', 'error'); return; }

    const fields = {};
    fields['Client'] = [clientId];
    const dateDemande = fd.get('Date demande');
    if (dateDemande) fields['Date demande'] = dateDemande;
    const ref = (fd.get('Référence') || '').trim();
    if (ref) fields['Référence'] = ref;
    const statut = fd.get('Statut');
    if (statut) fields['Statut'] = statut;
    const typeSav = fd.get('Type SAV');
    if (typeSav) fields['Type SAV'] = typeSav;
    const realise = fd.get('Réalisé par');
    if (realise) fields['Réalisé par'] = realise;

    try {
      if (isNew) await createSav(fields);
      else await patchSav(ticket.id, fields);
      close();
      toast(isNew ? 'Ticket SAV créé' : 'Ticket SAV enregistré', 'success');
      onSaved && onSaved();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}
