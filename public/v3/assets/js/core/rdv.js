// RDV (rendez-vous) — module partagé : modale create/edit + rendu de liste.
// Utilisé par les vues projet, client et calendrier. CRUD via /api/data/rendez-vous.

import { icon, hydrateIcons } from './lucide.js';
import { toast, confirmModal } from './ui.js';
import { createRendezVous, patchRendezVous, deleteRendezVous } from './api.js';

export const RDV_TYPES = ['Découverte', 'Métré', 'Présentation devis', 'Suivi chantier', 'Réception/Pose', 'SAV', 'Autre'];
const STATUTS = ['Planifié', 'Confirmé', 'Réalisé', 'Annulé'];
const ASSIGNES = ['Virginie', 'Solène', 'Sébastien', 'Marine'];

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

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

// ISO (Airtable dateTime) → valeur input datetime-local (heure locale).
function toLocalInput(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  } catch { return ''; }
}

// Formatage lisible FR d'une date/heure ISO.
export function formatRdvDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return String(iso); }
}

// Modale création / édition d'un RDV.
// opts : { rdv?, projetId?, clientId?, contextLabel?, onSaved? }
export function openModalRdv({ rdv = null, projetId = null, clientId = null, contextLabel = '', onSaved = null } = {}) {
  const f = rdv?.fields || {};
  const isNew = !rdv;
  const { modal, close } = modalShell(isNew ? 'Nouveau rendez-vous' : 'Éditer le rendez-vous', `
    <form id="form-rdv">
      ${contextLabel ? `<p class="muted" style="margin-top:0">${esc(contextLabel)}</p>` : ''}
      <label>Objet <input name="Objet" value="${esc(f.Objet || '')}" required placeholder="Ex : Métré cuisine — ou un RDV imprévu…"></label>
      <label>Date et heure <input name="Date et heure" type="datetime-local" value="${toLocalInput(f['Date et heure'])}" required></label>
      <label>Type
        <select name="Type">
          ${RDV_TYPES.map(v => `<option ${f.Type === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Statut
        <select name="Statut">
          ${STATUTS.map(v => `<option ${(f.Statut || 'Planifié') === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Lieu <input name="Lieu" value="${esc(f.Lieu || '')}" placeholder="Adresse chantier, agence, visio…"></label>
      <label>Assigné à
        <select name="Assigné à">
          <option value="">—</option>
          ${ASSIGNES.map(v => `<option ${f['Assigné à'] === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Notes <textarea name="Notes" rows="2">${esc(f.Notes || '')}</textarea></label>
      <div class="modal-actions">
        ${!isNew ? `<button type="button" class="btn btn-ghost" id="rdv-del" style="margin-right:auto">${icon('trash', 14)} Supprimer</button>` : ''}
        <button type="button" class="btn btn-ghost" id="rdv-cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Créer' : 'Enregistrer'}</button>
      </div>
    </form>
  `);
  hydrateIcons(modal);
  modal.querySelector('#rdv-cancel').onclick = close;
  modal.querySelector('#rdv-del')?.addEventListener('click', async () => {
    const ok = await confirmModal('Supprimer ce rendez-vous ?', { okLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try { await deleteRendezVous(rdv.id); close(); toast('Rendez-vous supprimé', 'success'); onSaved && onSaved(); }
    catch (e) { toast('Erreur : ' + e.message, 'error', 5000); }
  });
  modal.querySelector('#form-rdv').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) { if (v !== '') fields[k] = v; }
    if (fields['Date et heure']) fields['Date et heure'] = new Date(fields['Date et heure']).toISOString();
    if (isNew) {
      if (projetId) fields.Projet = [projetId];
      if (clientId) fields.Client = [clientId];
    }
    try {
      if (isNew) await createRendezVous(fields); else await patchRendezVous(rdv.id, fields);
      close();
      toast(isNew ? 'Rendez-vous créé' : 'Rendez-vous enregistré', 'success');
      onSaved && onSaved();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

// Rendu d'une liste de RDV (sections projet / client). rdvs = records [{id, fields}].
// Les items portent data-rdv-id pour binder l'édition (cf. bindRdvList).
export function renderRdvList(rdvs) {
  if (!rdvs || !rdvs.length) return `<div class="compact-empty"><span>Aucun rendez-vous planifié</span></div>`;
  const sorted = rdvs.slice().sort((a, b) =>
    String(a.fields?.['Date et heure'] || '').localeCompare(String(b.fields?.['Date et heure'] || '')));
  return `<div class="commandes-list">${sorted.map(r => {
    const f = r.fields || {};
    const annule = f.Statut === 'Annulé';
    return `
      <button class="card commande-card rdv-item" data-rdv-id="${esc(r.id)}" style="width:100%;text-align:left${annule ? ';opacity:.55' : ''}">
        <div class="commande-head">
          <div><strong>${esc(f.Objet || '(sans objet)')}</strong>
            ${f.Type ? `<span class="badge" style="margin-left:6px">${esc(f.Type)}</span>` : ''}
            ${f.Statut ? `<span class="badge" style="margin-left:4px">${esc(f.Statut)}</span>` : ''}
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:4px">
          ${f['Date et heure'] ? `${icon('calendar', 11)} ${esc(formatRdvDate(f['Date et heure']))}` : ''}${f.Lieu ? ` · ${esc(f.Lieu)}` : ''}${f['Assigné à'] ? ` · ${esc(f['Assigné à'])}` : ''}
        </div>
      </button>`;
  }).join('')}</div>`;
}

// Binde les clics d'une liste RDV rendue par renderRdvList → ouvre la modale d'édition.
export function bindRdvList(container, rdvs, onSaved) {
  container.querySelectorAll('.rdv-item').forEach(el => {
    el.addEventListener('click', () => {
      const rdv = rdvs.find(r => r.id === el.dataset.rdvId);
      if (rdv) openModalRdv({ rdv, onSaved });
    });
  });
}
