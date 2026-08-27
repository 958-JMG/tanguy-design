// RDV (rendez-vous) — module partagé : modale create/edit + rendu de liste.
// Utilisé par les vues projet, client et calendrier. CRUD via /api/data/rendez-vous.

import { icon, hydrateIcons } from './lucide.js';
import { resoudreClient } from './client-match.js';
import { toast, confirmModal } from './ui.js';
import { state } from './state.js';
import { createRendezVous, patchRendezVous, deleteRendezVous, fetchClients } from './api.js';

// Agenda v2 — « Réception » et « Pose » remplacent l'ancien type combiné « Réception/Pose »
// (conservé en fin de liste pour l'affichage des RDV historiques). ⚠️ Si le champ Airtable
// « Type » est un singleSelect, ces deux nouvelles options doivent exister côté base :
// voir scripts/setup-agenda-v2-types.js (additif, à exécuter avant merge).
export const RDV_TYPES = ['Découverte', 'Métré', 'Présentation devis', 'Suivi chantier', 'Réception', 'Pose', 'SAV', 'Autre'];
const STATUTS = ['Planifié', 'Confirmé', 'Réalisé', 'Annulé'];
const ASSIGNES = ['Virginie', 'Solène', 'Sébastien', 'Marine'];

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

// Slug statique pour la classe CSS de couleur d'un type de RDV (cf. styles.css .rtype-*).
export function rdvTypeSlug(t) {
  return 'rtype-' + String(t || 'autre').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Heuristique « journée entière » sans champ Airtable dédié : un RDV dont l'heure locale
// est exactement 00:00 est considéré comme une journée entière (date sans heure).
export function isAllDay(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getHours() === 0 && d.getMinutes() === 0;
}

// N° de semaine ISO-8601 (pour l'affichage des réceptions prévisionnelles « Sxx »).
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
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

// ISO (Airtable dateTime) → valeur input datetime-local (heure locale).
function toLocalInput(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  } catch { return ''; }
}

// Formatage lisible FR d'une date/heure ISO. Journée entière (00:00) → date seule, sans heure.
export function formatRdvDate(iso) {
  if (!iso) return '';
  try {
    const opts = isAllDay(iso) ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' };
    return new Date(iso).toLocaleString('fr-FR', opts);
  } catch { return String(iso); }
}

// Nom d'un client à partir de son id (state.clients), pour préremplir le sélecteur.
function clientNameById(id) {
  if (!id) return '';
  const c = (state.clients || []).find(x => x.id === id);
  return c ? (c.Nom || '') : '';
}

// Modale création / édition d'un RDV.
// opts : { rdv?, projetId?, clientId?, contextLabel?, onSaved? }
export function openModalRdv({ rdv = null, projetId = null, clientId = null, contextLabel = '', onSaved = null } = {}) {
  const f = rdv?.fields || {};
  const isNew = !rdv;

  // Type : si la valeur historique (ex. « Réception/Pose ») n'est plus dans la liste active,
  // on la conserve comme option pour ne pas la perdre à l'édition.
  const typeOptions = f.Type && !RDV_TYPES.includes(f.Type) ? [f.Type, ...RDV_TYPES] : RDV_TYPES;

  // Client : sélecteur recherchable (datalist). Prérempli depuis le contexte ou le RDV existant.
  const initialClientId = (rdv ? f.Client?.[0] : clientId) || null;
  const initialClientName = clientNameById(initialClientId);

  // Journée entière (heuristique 00:00) : pilote le type de l'input date.
  const hasDate = !!f['Date et heure'];
  const journeeInit = hasDate && isAllDay(f['Date et heure']);
  const dtFull = toLocalInput(f['Date et heure']);          // YYYY-MM-DDTHH:mm
  const dtDay = dtFull.slice(0, 10);                         // YYYY-MM-DD

  const { modal, close } = modalShell(isNew ? 'Nouveau rendez-vous' : 'Éditer le rendez-vous', `
    <form id="form-rdv">
      ${contextLabel ? `<p class="muted" style="margin-top:0">${esc(contextLabel)}</p>` : ''}
      <label>Client
        <input name="__clientName" id="rdv-client" list="rdv-client-list" autocomplete="off"
               value="${esc(initialClientName)}" placeholder="Rechercher un client…">
        <datalist id="rdv-client-list">
          ${(state.clients || []).map(c => `<option value="${esc(c.Nom || '')}"></option>`).join('')}
        </datalist>
      </label>
      <label>Objet <span class="muted">(optionnel)</span>
        <input name="Objet" value="${esc(f.Objet || '')}" placeholder="Ex : Métré cuisine — ou laisser vide">
      </label>
      <label class="rdv-allday"><input type="checkbox" name="__journee" id="rdv-journee" ${journeeInit ? 'checked' : ''}> Journée entière (sans heure)</label>
      <label>Date${journeeInit ? '' : ' et heure'} <input name="Date et heure" id="rdv-date" type="${journeeInit ? 'date' : 'datetime-local'}" value="${journeeInit ? dtDay : dtFull}" required></label>
      <label>Type
        <select name="Type">
          ${typeOptions.map(v => `<option ${f.Type === v ? 'selected' : ''}>${v}</option>`).join('')}
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

  // Si la liste clients n'est pas encore chargée, on la récupère et on remplit la datalist.
  if (!(state.clients || []).length) {
    fetchClients().then(() => {
      const dl = modal.querySelector('#rdv-client-list');
      if (dl) dl.innerHTML = (state.clients || []).map(c => `<option value="${esc(c.Nom || '')}"></option>`).join('');
    }).catch(() => {});
  }

  // Toggle Journée entière → bascule l'input entre date et datetime-local en conservant la date.
  const dateInput = modal.querySelector('#rdv-date');
  modal.querySelector('#rdv-journee').addEventListener('change', e => {
    const day = (dateInput.value || '').slice(0, 10);
    if (e.target.checked) {
      dateInput.type = 'date';
      dateInput.value = day;
    } else {
      dateInput.type = 'datetime-local';
      dateInput.value = day ? `${day}T09:00` : '';
    }
  });

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
    const journee = fd.get('__journee') === 'on';
    const clientName = String(fd.get('__clientName') || '').trim();
    const fields = {};
    for (const [k, v] of fd.entries()) {
      if (k === '__journee' || k === '__clientName') continue;   // champs auxiliaires UI
      if (v !== '') fields[k] = v;
    }
    // Date : journée entière → minuit local ; sinon datetime-local complet.
    const rawDate = fields['Date et heure'];
    if (rawDate) {
      if (journee) {
        const [y, m, d] = rawDate.slice(0, 10).split('-').map(Number);
        fields['Date et heure'] = new Date(y, m - 1, d, 0, 0, 0).toISOString();
      } else {
        fields['Date et heure'] = new Date(rawDate).toISOString();
      }
    }
    // Résolution du client saisi → id (match exact sur le Nom, insensible à la casse).
    let resolvedClientId = null;
    if (clientName) {
      // Même résolution tolérante que le SAV (espaces parasites, accents, casse).
      const c = resoudreClient(clientName, state.clients || []).client;
      if (c) resolvedClientId = c.id;
    }
    if (resolvedClientId) fields.Client = [resolvedClientId];
    if (isNew && projetId) fields.Projet = [projetId];
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
function rdvCard(r) {
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
}

// Agenda : « À venir » (chronologique) puis « Passés » (récents d'abord). #5 — passés ET futurs.
export function renderRdvList(rdvs) {
  if (!rdvs || !rdvs.length) return `<div class="compact-empty"><span>Aucun rendez-vous planifié</span></div>`;
  const now = Date.now();
  const items = rdvs.map(r => ({ r, t: Date.parse(r.fields?.['Date et heure'] || '') || 0 }));
  const avenir = items.filter(x => x.t >= now).sort((a, b) => a.t - b.t);
  const passes = items.filter(x => x.t < now).sort((a, b) => b.t - a.t);
  const grp = (label, arr) => arr.length
    ? `<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:10px 0 6px">${label}</div><div class="commandes-list">${arr.map(x => rdvCard(x.r)).join('')}</div>`
    : '';
  return grp('À venir', avenir) + grp('Passés', passes);
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
