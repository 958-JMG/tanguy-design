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

function eurosFmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

// Paquet 2 (2026-08) — chantiers passés en « Statut chantier : SAV » sur leur fiche
// projet. Jusqu'ici, ce statut ne remontait NULLE PART dans l'onglet SAV (qui ne
// lit que la table de tickets). On les surface ici, avec leur retenue client
// (reste à encaisser). Lu depuis state.projets (chargé au boot). Les champs
// « Retenue* » n'existent qu'après la migration du paquet 1 → défensif : absents,
// la colonne retenue affiche « — » sans casser.
function chantiersEnSav() {
  return (state.projets || []).filter(p => (p['Statut chantier'] || '') === 'SAV');
}

function renderChantiersSavSection() {
  const list = chantiersEnSav();
  if (!list.length) {
    return `<div class="card" style="margin-top:12px"><p class="muted">Aucun chantier en statut SAV. Passe un projet en « Statut chantier : SAV » depuis sa fiche pour le suivre ici.</p></div>`;
  }
  const totalReste = list.reduce((s, p) => s + (p['Retenue statut'] === 'En cours' ? (Number(p['Retenue montant']) || 0) : 0), 0);
  const rows = list.map(p => {
    const ci = clientInfo(p['Client']);
    const ref = p['Référence'] || '(sans référence)';
    const rMontant = Number(p['Retenue montant']) || 0;
    const rStatut = p['Retenue statut'] || '';
    const reste = rStatut === 'En cours' ? rMontant : 0;
    const retenueCell = reste > 0
      ? `<span class="badge" style="background:var(--red-lo,#fde8e8);color:var(--red,#c0392b)">${eurosFmt(reste)} à encaisser</span>`
      : (rMontant > 0 ? `<span class="muted">${eurosFmt(rMontant)} · ${esc(rStatut || '—')}</span>` : '<span class="muted">—</span>');
    return `
      <tr>
        <td><strong>${esc(ci.nom)}</strong></td>
        <td>${esc(ref)}</td>
        <td>${esc(ci.ville)}</td>
        <td>${retenueCell}</td>
        <td style="display:flex;gap:4px;justify-content:flex-end">
          <a class="btn btn-ghost btn-sm" href="#projet/${encodeURIComponent(p.id)}" title="Ouvrir la fiche projet">${icon('folder', 14)} Fiche</a>
          <button class="btn btn-ghost btn-sm" data-action="ticket-from-chantier" data-client="${esc((p['Client'] || [])[0] || '')}" title="Créer un ticket SAV pour ce client">${icon('plus', 14)} Ticket</button>
        </td>
      </tr>`;
  }).join('');
  return `
    <section aria-label="Chantiers en SAV" style="margin-top:12px">
      <div class="section-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h2 class="section-title" style="margin:0">Chantiers en SAV <span class="count">(${list.length})</span></h2>
        ${totalReste > 0 ? `<span class="muted">Reste à encaisser (retenues) : <strong>${eurosFmt(totalReste)}</strong></span>` : ''}
      </div>
      <div class="table-scroll">
        <table class="pipeline-table">
          <thead><tr><th>Client</th><th>Chantier</th><th>Ville</th><th>Retenue</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
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
    ${renderChantiersSavSection()}
    <div class="section-header" style="margin-top:20px"><h2 class="section-title" style="margin:0">Tickets SAV</h2></div>
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
  // Paquet 2 — « Ticket » depuis un chantier en SAV : ouvre la modale préremplie client.
  app.querySelectorAll('[data-action="ticket-from-chantier"]').forEach(b => b.addEventListener('click', () => {
    openModalSav(null, reload, { clientId: b.dataset.client || '' });
  }));
  app.querySelectorAll('#sav-filters .chip').forEach(c => c.addEventListener('click', () => {
    currentFilter = c.dataset.filter;
    app.querySelectorAll('#sav-filters .chip').forEach(x => x.classList.toggle('is-active', x === c));
    renderTable();
  }));

  await reload();
}

// Modale create / edit d'un ticket SAV.
function openModalSav(ticket, onSaved, prefill = {}) {
  const isNew = !ticket;
  const t = ticket || {};
  const selectedClient = (Array.isArray(t['Client']) ? t['Client'][0] : '') || prefill.clientId || '';
  const clients = (state.clients || []).slice().sort((a, b) => String(a.Nom || '').localeCompare(String(b.Nom || '')));
  const initialClientName = clients.find(c => c.id === selectedClient)?.Nom || '';
  const today = new Date().toISOString().slice(0, 10);

  const { modal, close } = modalShell(isNew ? 'Nouveau ticket SAV' : 'Éditer le ticket SAV', `
    <form id="form-sav">
      <label>Client
        <input name="__clientName" list="sav-client-list" autocomplete="off" required
               value="${esc(initialClientName)}" placeholder="Rechercher un client…">
        <datalist id="sav-client-list">
          ${clients.map(c => `<option value="${esc(c.Nom || '')}">${esc(c.Ville || '')}</option>`).join('')}
        </datalist>
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
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row"><input name="Commandé" type="checkbox" ${t['Commandé'] ? 'checked' : ''} style="width:auto"> Pièce commandée</label>
      <label>Date de réception prévue (marchandises) <input name="Date réception" type="date" value="${esc(t['Date réception'] || '')}"></label>
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
    // Résolution du nom saisi → id (match exact sur le Nom, insensible à la casse) — même
    // pattern que l'agenda (core/rdv.js). Garde la trace : le ticket reste LIÉ au record client.
    const clientName = String(fd.get('__clientName') || '').trim();
    const clientMatch = clients.find(c => (c.Nom || '').toLowerCase() === clientName.toLowerCase());
    if (!clientMatch) { toast('Client introuvable — choisis un nom dans la liste', 'error'); return; }

    const fields = {};
    fields['Client'] = [clientMatch.id];
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
    // P-F — pièce commandée + date de réception des marchandises (alimente l'agenda).
    fields['Commandé'] = !!fd.get('Commandé');
    fields['Date réception'] = fd.get('Date réception') || null;

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
