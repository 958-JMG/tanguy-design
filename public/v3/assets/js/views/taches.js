// Tâches — vue globale « Toutes les tâches » (admin / Virginie).
// Deux vues : Liste (tableau) et Kanban (colonnes par statut, groupable par personne).
// Gestion : multi-assignation (champ additif « Assignées à », sans toucher « Assignée à »),
// changer le statut, supprimer (y compris les tâches auto-générées). ACL taches = '*'.

import { state } from '../core/state.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';
import { navigateTo } from '../core/router.js';
import { fetchProjets, fetchClients, patchTache, deleteTache } from '../core/api.js';

const ASSIGNES = ['Virginie', 'Solène', 'Sébastien', 'Marine'];
const STATUTS = ['À faire', 'En cours', 'Terminée'];
const PRIORITES = ['Haute', 'Moyenne', 'Basse'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

// Assignés d'une tâche : « Assignées à » (multi) en priorité, repli sur « Assignée à » (single).
function assigneesOf(t) {
  const multi = Array.isArray(t['Assignées à']) ? t['Assignées à'].filter(Boolean) : [];
  if (multi.length) return multi;
  return t['Assignée à'] ? [t['Assignée à']] : [];
}

// Map projetId → { ref, clientNom } pour afficher client · dossier.
function buildProjetMap() {
  const clientNom = new Map((state.clients || []).map(c => [c.id, c.Nom || '']));
  const m = new Map();
  for (const p of state.projets || []) {
    const cid = Array.isArray(p.Client) ? p.Client[0] : null;
    m.set(p.id, { ref: p.Référence || '', clientNom: cid ? (clientNom.get(cid) || '') : '' });
  }
  return m;
}

export async function renderTaches(app) {
  if (!state.isAdmin) {
    app.innerHTML = `<div class="card"><h2>Accès réservé</h2><p class="muted">La vue globale des tâches est réservée aux administrateurs.</p></div>`;
    return;
  }

  // État local de la vue
  const ui = { mode: 'liste', groupBy: 'statut' };           // mode: liste|kanban ; groupBy (kanban): statut|personne
  const filt = { assignee: 'Tous', statut: 'En cours', priorite: 'Toutes' };

  app.innerHTML = `<h1 class="page-title">Toutes les tâches</h1><div id="taches-body"><div class="loading">Chargement…</div></div>`;
  const body = document.getElementById('taches-body');

  try {
    if (!(state.clients || []).length) await fetchClients().catch(() => {});
    if (!(state.projets || []).length) await fetchProjets().catch(() => {});
  } catch { /* libellés best-effort */ }

  let taches = [];
  async function load() {
    const r = await fetch('/api/data/taches');
    if (!r.ok) throw new Error('chargement des tâches');
    const d = await r.json();
    taches = (d.records || []).map(t => ({ id: t.id, ...t.fields }));
  }

  // Filtre commun (liste + kanban). Le filtre statut ne s'applique qu'en vue liste.
  function filtered(forKanban) {
    return taches.filter(t => {
      const as = assigneesOf(t);
      if (filt.assignee === 'Non assignée' && as.length) return false;
      if (filt.assignee !== 'Tous' && filt.assignee !== 'Non assignée' && !as.includes(filt.assignee)) return false;
      if (filt.priorite !== 'Toutes' && t.Priorité !== filt.priorite) return false;
      if (!forKanban) {
        if (filt.statut === 'En cours' && t.Statut === 'Terminée') return false;
        if (filt.statut !== 'Tous' && filt.statut !== 'En cours' && t.Statut !== filt.statut) return false;
      }
      return true;
    });
  }

  const pmap = () => buildProjetMap();
  function teteOf(t, m) {
    const info = t.Projet && t.Projet[0] ? m.get(t.Projet[0]) : null;
    return info ? [info.clientNom, info.ref].filter(Boolean).join(' · ') : '';
  }

  function controlsHtml() {
    const sel = (name, opts, cur) =>
      `<select data-filter="${name}">${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    return `
      <div class="taches-filtres" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <div class="btn-group" style="display:flex;gap:4px">
          <button class="btn btn-sm ${ui.mode === 'liste' ? 'btn-primary' : 'btn-ghost'}" data-mode="liste">${icon('file', 14)} Liste</button>
          <button class="btn btn-sm ${ui.mode === 'kanban' ? 'btn-primary' : 'btn-ghost'}" data-mode="kanban">${icon('chart', 14)} Kanban</button>
        </div>
        <label style="margin:0">Personne ${sel('assignee', ['Tous', ...ASSIGNES, 'Non assignée'], filt.assignee)}</label>
        ${ui.mode === 'liste' ? `<label style="margin:0">Statut ${sel('statut', ['En cours', 'Tous', ...STATUTS], filt.statut)}</label>` : ''}
        <label style="margin:0">Priorité ${sel('priorite', ['Toutes', ...PRIORITES], filt.priorite)}</label>
        ${ui.mode === 'kanban' ? `<label style="margin:0">Grouper ${sel('groupBy', ['statut', 'personne'], ui.groupBy)}</label>` : ''}
      </div>`;
  }

  function draw() {
    body.innerHTML = controlsHtml() + (ui.mode === 'kanban' ? kanbanHtml() : listeHtml());
    hydrateIcons(body);
    bindControls();
    if (ui.mode === 'kanban') bindKanban(); else bindListe();
  }

  // ---- Vue liste (tableau) ----
  function listeHtml() {
    const m = pmap();
    const today = todayISO();
    const rows = filtered(false).sort((a, b) => String(a.Échéance || '9999').localeCompare(String(b.Échéance || '9999')));
    if (!rows.length) return `<div class="card"><p class="muted">Aucune tâche pour ces filtres.</p></div>`;
    return `
      <div style="overflow-x:auto">
      <table class="pipeline-table">
        <thead><tr><th></th><th>Tâche</th><th>Client · Dossier</th><th>Assigné·e·s</th><th>Priorité</th><th>Échéance</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${rows.map(t => {
            const tete = teteOf(t, m);
            const done = t.Statut === 'Terminée';
            const retard = t.Échéance && t.Échéance < today && !done;
            const as = assigneesOf(t);
            return `
          <tr data-id="${esc(t.id)}"${done ? ' style="opacity:.55"' : ''}>
            <td><button class="btn btn-ghost btn-sm" data-action="toggle" title="${done ? 'Rouvrir' : 'Terminer'}">${done ? icon('check', 14) : '<span class="tache-check-empty"></span>'}</button></td>
            <td><strong>${esc(t.Titre || '?')}</strong></td>
            <td>${tete ? `<button class="taches-link" data-action="open-projet" data-projet="${esc(t.Projet[0])}">${esc(tete)}</button>` : '<span class="muted">—</span>'}</td>
            <td>${as.length ? as.map(a => `<span class="badge">${esc(a)}</span>`).join(' ') : '<span class="muted">—</span>'}</td>
            <td>${t.Priorité ? `<span class="badge phase-${esc(t.Priorité).toLowerCase()}">${esc(t.Priorité)}</span>` : '—'}</td>
            <td${retard ? ' style="color:var(--accent);font-weight:600"' : ''}>${t.Échéance ? esc(t.Échéance) : '—'}</td>
            <td><span class="badge">${esc(t.Statut || '?')}</span></td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm" data-action="edit" title="Éditer / assigner">${icon('edit', 14)}</button>
              <button class="btn btn-ghost btn-sm" data-action="delete" title="Supprimer" style="color:var(--accent)">${icon('trash', 14)}</button>
            </td>
          </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
  }

  function bindListe() {
    body.querySelectorAll('tr[data-id]').forEach(row => {
      const id = row.dataset.id;
      const t = taches.find(x => x.id === id);
      if (!t) return;
      row.querySelector('[data-action="toggle"]').addEventListener('click', () =>
        patchAndRefresh(id, { Statut: t.Statut === 'Terminée' ? 'À faire' : 'Terminée' }));
      row.querySelector('[data-action="edit"]').addEventListener('click', () => openTacheEditor(t));
      row.querySelector('[data-action="open-projet"]')?.addEventListener('click', () => navigateTo('projet', { id: t.Projet[0] }));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => removeTache(t));
    });
  }

  // ---- Vue Kanban ----
  function carteHtml(t, m) {
    const tete = teteOf(t, m);
    const as = assigneesOf(t);
    const today = todayISO();
    const retard = t.Échéance && t.Échéance < today && t.Statut !== 'Terminée';
    return `
      <div class="kb-card" draggable="true" data-id="${esc(t.id)}">
        <div class="kb-card-title">${esc(t.Titre || '?')}</div>
        ${tete ? `<div class="kb-card-sub">${esc(tete)}</div>` : ''}
        <div class="kb-card-meta">
          ${as.length ? as.map(a => `<span class="badge">${esc(a)}</span>`).join(' ') : '<span class="muted">non assigné</span>'}
          ${t.Priorité ? `<span class="badge phase-${esc(t.Priorité).toLowerCase()}">${esc(t.Priorité)}</span>` : ''}
          ${t.Échéance ? `<span class="kb-ech${retard ? ' kb-retard' : ''}">${icon('calendar', 11)} ${esc(t.Échéance)}</span>` : ''}
        </div>
      </div>`;
  }

  function colonneHtml(statut, list, m, personne) {
    return `
      <section class="kb-col" data-statut="${esc(statut)}"${personne ? ` data-personne="${esc(personne)}"` : ''}>
        <header class="kb-col-head">${esc(statut)} <span class="kb-count">${list.length}</span></header>
        <div class="kb-col-body">
          ${list.map(t => carteHtml(t, m)).join('') || '<p class="muted" style="font-size:12px;padding:8px">—</p>'}
        </div>
      </section>`;
  }

  function kanbanHtml() {
    const m = pmap();
    const items = filtered(true);
    if (ui.groupBy === 'personne') {
      // Swimlanes : une ligne par personne (+ Non assignée), colonnes par statut. Lecture (pas de drag).
      const lignes = [...ASSIGNES, 'Non assignée'].map(personne => {
        const sub = items.filter(t => {
          const as = assigneesOf(t);
          return personne === 'Non assignée' ? as.length === 0 : as.includes(personne);
        });
        if (!sub.length && filt.assignee !== 'Tous') return '';
        return `
          <div class="kb-lane">
            <div class="kb-lane-head">${esc(personne)} <span class="kb-count">${sub.length}</span></div>
            <div class="kb-board">
              ${STATUTS.map(s => colonneHtml(s, sub.filter(t => (t.Statut || 'À faire') === s), m)).join('')}
            </div>
          </div>`;
      }).join('');
      return `<p class="muted" style="margin:-4px 0 12px">Glisser-déposer désactivé en vue groupée. Clic sur une carte pour éditer/assigner.</p>${lignes || '<div class="card"><p class="muted">Aucune tâche.</p></div>'}`;
    }
    // Groupé par statut : colonnes drag & drop.
    return `<p class="muted" style="margin:-4px 0 12px">Glisse une carte d'une colonne à l'autre pour changer son statut · clic pour éditer/assigner.</p>
      <div class="kb-board kb-board-main">
        ${STATUTS.map(s => colonneHtml(s, items.filter(t => (t.Statut || 'À faire') === s), m)).join('')}
      </div>`;
  }

  function bindKanban() {
    // Édition au clic
    body.querySelectorAll('.kb-card').forEach(card => {
      card.addEventListener('click', e => {
        if (card.classList.contains('dragging')) return;
        const t = taches.find(x => x.id === card.dataset.id);
        if (t) openTacheEditor(t);
      });
    });
    if (ui.groupBy === 'personne') return; // pas de drag en swimlanes

    let dragId = null;
    body.querySelectorAll('.kb-card').forEach(card => {
      card.addEventListener('dragstart', e => { dragId = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragId = null; body.querySelectorAll('.kb-col.drag-over').forEach(c => c.classList.remove('drag-over')); });
    });
    body.querySelectorAll('.kb-col').forEach(col => {
      col.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); col.classList.add('drag-over'); } });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('drag-over');
        const id = dragId; const newStatut = col.dataset.statut;
        if (!id) return;
        const t = taches.find(x => x.id === id);
        if (!t || t.Statut === newStatut) return;
        patchAndRefresh(id, { Statut: newStatut });
      });
    });
  }

  // ---- Actions partagées ----
  async function patchAndRefresh(id, fields) {
    const t = taches.find(x => x.id === id);
    try { await patchTache(id, fields); if (t) Object.assign(t, fields); draw(); }
    catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  }

  async function removeTache(t) {
    const ok = await confirmModal(`Supprimer la tâche « ${t.Titre || '?'} » ?`, { okLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try { await deleteTache(t.id); taches = taches.filter(x => x.id !== t.id); draw(); toast('Tâche supprimée', 'success'); }
    catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  }

  // Éditeur : multi-assignation (Assignées à) + statut + priorité + échéance. Ne touche PAS « Assignée à ».
  function openTacheEditor(t) {
    const current = new Set(assigneesOf(t));
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${esc(t.Titre || 'Tâche')}</h2>
        <fieldset style="border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:0 0 12px">
          <legend style="font-size:12px;padding:0 4px">Assigné·e·s</legend>
          <div style="display:flex;flex-wrap:wrap;gap:12px">
            ${ASSIGNES.map(a => `<label class="rdv-allday" style="margin:0"><input type="checkbox" name="assignee" value="${esc(a)}" ${current.has(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}
          </div>
        </fieldset>
        <label>Statut <select name="Statut">${STATUTS.map(s => `<option ${t.Statut === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Priorité <select name="Priorité"><option value="">—</option>${PRIORITES.map(p => `<option ${t.Priorité === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>Échéance <input type="date" name="Échéance" value="${esc(t.Échéance || '')}"></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-act="del" style="margin-right:auto;color:var(--accent)">${icon('trash', 14)} Supprimer</button>
          <button type="button" class="btn btn-ghost" data-act="cancel">Annuler</button>
          <button type="button" class="btn btn-primary" data-act="save">Enregistrer</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    hydrateIcons(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('[data-act="cancel"]').onclick = close;
    modal.querySelector('[data-act="del"]').onclick = () => { close(); removeTache(t); };
    modal.querySelector('[data-act="save"]').onclick = async () => {
      const assignees = [...modal.querySelectorAll('input[name="assignee"]:checked')].map(c => c.value);
      const fields = {
        'Assignées à': assignees,                 // multi-assign (champ additif) — « Assignée à » NON touché
        Statut: modal.querySelector('[name="Statut"]').value,
      };
      const prio = modal.querySelector('[name="Priorité"]').value;
      if (prio) fields.Priorité = prio;
      const ech = modal.querySelector('[name="Échéance"]').value;
      if (ech) fields.Échéance = ech;
      try { await patchTache(t.id, fields); Object.assign(t, fields); close(); draw(); toast('Tâche mise à jour', 'success'); }
      catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    };
  }

  function bindControls() {
    body.querySelectorAll('[data-filter]').forEach(s => s.addEventListener('change', () => {
      if (s.dataset.filter === 'groupBy') ui.groupBy = s.value; else filt[s.dataset.filter] = s.value;
      draw();
    }));
    body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { ui.mode = b.dataset.mode; draw(); }));
  }

  try { await load(); draw(); }
  catch (err) { body.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`; }
}
