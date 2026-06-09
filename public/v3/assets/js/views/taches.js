// Tâches — vue globale « Toutes les tâches » (admin / Virginie).
// Lecture + gestion légère : changer l'assignée, le statut, supprimer (y compris les
// tâches auto-générées non pertinentes). Les routes /api/data/taches sont ouvertes (ACL '*').

import { state } from '../core/state.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';
import { navigateTo } from '../core/router.js';
import { fetchProjets, fetchClients, patchTache, deleteTache } from '../core/api.js';

const ASSIGNES = ['Virginie', 'Solène', 'Sébastien', 'Marine'];
const STATUTS = ['À faire', 'En cours', 'Terminée'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

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

  // Filtres (état local du composant)
  const filt = { assignee: 'Tous', statut: 'En cours', priorite: 'Toutes' };

  app.innerHTML = `<h1 class="page-title">Toutes les tâches</h1><div id="taches-body"><div class="loading">Chargement…</div></div>`;
  const body = document.getElementById('taches-body');

  // Charge clients + projets (pour les libellés) si nécessaire, puis les tâches.
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

  function draw() {
    const pmap = buildProjetMap();
    const today = todayISO();

    const filtered = taches.filter(t => {
      if (filt.assignee === 'Non assignée' && t['Assignée à']) return false;
      if (filt.assignee !== 'Tous' && filt.assignee !== 'Non assignée' && t['Assignée à'] !== filt.assignee) return false;
      if (filt.statut === 'En cours' && t.Statut === 'Terminée') return false;
      if (filt.statut !== 'Tous' && filt.statut !== 'En cours' && t.Statut !== filt.statut) return false;
      if (filt.priorite !== 'Toutes' && t.Priorité !== filt.priorite) return false;
      return true;
    }).sort((a, b) => String(a.Échéance || '9999').localeCompare(String(b.Échéance || '9999')));

    const sel = (name, opts, cur) =>
      `<select data-filter="${name}">${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>`;

    body.innerHTML = `
      <div class="taches-filtres" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <label style="margin:0">Assignée ${sel('assignee', ['Tous', ...ASSIGNES, 'Non assignée'], filt.assignee)}</label>
        <label style="margin:0">Statut ${sel('statut', ['En cours', 'Tous', ...STATUTS], filt.statut)}</label>
        <label style="margin:0">Priorité ${sel('priorite', ['Toutes', 'Haute', 'Moyenne', 'Basse'], filt.priorite)}</label>
        <span class="muted" style="margin-left:auto">${filtered.length} tâche${filtered.length > 1 ? 's' : ''}</span>
      </div>
      ${filtered.length ? `
      <div style="overflow-x:auto">
      <table class="pipeline-table">
        <thead><tr><th></th><th>Tâche</th><th>Client · Dossier</th><th>Assignée</th><th>Priorité</th><th>Échéance</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${filtered.map(t => {
            const info = t.Projet && t.Projet[0] ? pmap.get(t.Projet[0]) : null;
            const tete = info ? [info.clientNom, info.ref].filter(Boolean).join(' · ') : '';
            const done = t.Statut === 'Terminée';
            const retard = t.Échéance && t.Échéance < today && !done;
            return `
          <tr data-id="${esc(t.id)}"${done ? ' style="opacity:.55"' : ''}>
            <td><button class="btn btn-ghost btn-sm" data-action="toggle" title="${done ? 'Rouvrir' : 'Terminer'}">${done ? icon('check', 14) : '<span class="tache-check-empty"></span>'}</button></td>
            <td><strong>${esc(t.Titre || '?')}</strong></td>
            <td>${info && (info.ref || info.clientNom) ? `<button class="taches-link" data-action="open-projet" data-projet="${esc(t.Projet[0])}">${esc(tete)}</button>` : '<span class="muted">—</span>'}</td>
            <td>
              <select data-action="assignee">
                <option value="">—</option>
                ${ASSIGNES.map(a => `<option ${t['Assignée à'] === a ? 'selected' : ''}>${a}</option>`).join('')}
              </select>
            </td>
            <td>${t.Priorité ? `<span class="badge phase-${esc(t.Priorité).toLowerCase()}">${esc(t.Priorité)}</span>` : '—'}</td>
            <td${retard ? ' style="color:var(--accent);font-weight:600"' : ''}>${t.Échéance ? esc(t.Échéance) : '—'}</td>
            <td>
              <select data-action="statut">
                ${STATUTS.map(s => `<option ${t.Statut === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </td>
            <td><button class="btn btn-ghost btn-sm" data-action="delete" title="Supprimer" style="color:var(--accent)">${icon('trash', 14)}</button></td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>` : `<div class="card"><p class="muted">Aucune tâche pour ces filtres.</p></div>`}
    `;
    hydrateIcons(body);

    body.querySelectorAll('[data-filter]').forEach(s => s.addEventListener('change', () => {
      filt[s.dataset.filter] = s.value; draw();
    }));

    body.querySelectorAll('tr[data-id]').forEach(row => {
      const id = row.dataset.id;
      const t = taches.find(x => x.id === id);
      if (!t) return;
      const upd = async (fields, label) => {
        try { await patchTache(id, fields); Object.assign(t, fields); draw(); }
        catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
      };
      row.querySelector('[data-action="toggle"]').addEventListener('click', () =>
        upd({ Statut: t.Statut === 'Terminée' ? 'À faire' : 'Terminée' }));
      row.querySelector('[data-action="assignee"]').addEventListener('change', e =>
        upd({ 'Assignée à': e.target.value || null }));
      row.querySelector('[data-action="statut"]').addEventListener('change', e =>
        upd({ Statut: e.target.value }));
      row.querySelector('[data-action="open-projet"]')?.addEventListener('click', () =>
        navigateTo('projet', { id: t.Projet[0] }));
      row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        const ok = await confirmModal(`Supprimer la tâche « ${t.Titre || '?'} » ?`, { okLabel: 'Supprimer', danger: true });
        if (!ok) return;
        try { await deleteTache(id); taches = taches.filter(x => x.id !== id); draw(); toast('Tâche supprimée', 'success'); }
        catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
      });
    });
  }

  try { await load(); draw(); }
  catch (err) { body.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`; }
}
