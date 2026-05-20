// Vue Projet v3 (Sprint 2) — fiche complète avec stepper + bilan + zones éditables.
// Pattern porté de v2 (computeParcours + zones) mais modulaire ES + Lucide icons.

import { state } from '../core/state.js';
import { navigateTo, router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import {
  fetchProjetDetail, patchProjet, patchTache, createTache, deleteTache,
  appendJournalEntry, uploadAttachment, deleteAttachment
} from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';

// === Stepper 12 étapes (porté v2) ===
const STEPS = [
  { key: 'decouverte',  label: 'Découverte',     icon: 'compass' },
  { key: 'devis',       label: 'Devis présenté', icon: 'file' },
  { key: 'signature',   label: 'Signature',      icon: 'check' },
  { key: 'acompte',     label: 'Acompte 30 %',   icon: 'mail' },
  { key: 'plans_tech',  label: 'Plans tech.',    icon: 'pencil' },
  { key: 'commandes',   label: 'Commandes',      icon: 'archive' },
  { key: 'reception',   label: 'Réception',      icon: 'check' },
  { key: 'pose',        label: 'Pose',           icon: 'hammer' },
  { key: 'pv',          label: 'PV réception',   icon: 'file' },
  { key: 'solde',       label: 'Facture solde',  icon: 'mail' },
  { key: 'avis',        label: 'Avis client',    icon: 'check' },
  { key: 'sav',         label: 'SAV',            icon: 'wrench' },
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

function computeParcours(projet, taches, devis, commandes) {
  const pf = projet.fields || {};
  const phase = pf['Phase commerciale'] || '';
  const chantier = pf['Statut chantier'] || '';
  const statutLegacy = (pf['Statut'] || '').toLowerCase();

  // Helpers status calcul (porté v2)
  const hasR1 = (state.projets || []).length > 0; // toujours OK pour data fictive
  const devisSigne = devis.some(d => d.fields?.Statut === 'Signé');
  const taskDone = (titrePart) => taches.some(t => {
    const titre = (t.fields?.Titre || '').toLowerCase();
    return titre.includes(titrePart.toLowerCase()) && t.fields?.Statut === 'Terminée';
  });
  const planTechCount = (pf['Plan technique'] || []).length;
  const datePose = pf['Date pose prévue'];

  return STEPS.map(s => {
    let state_ = 'pending';
    switch (s.key) {
      case 'decouverte': state_ = pf['Date découverte'] || hasR1 ? 'done' : 'pending'; break;
      case 'devis':      state_ = devis.length > 0 ? 'done' : 'pending'; break;
      case 'signature':  state_ = devisSigne ? 'done' : 'pending'; break;
      case 'acompte':    state_ = taskDone('acompte') ? 'done' : (devisSigne ? 'cur' : 'pending'); break;
      case 'plans_tech': state_ = planTechCount > 0 ? 'done' : (devisSigne ? 'cur' : 'pending'); break;
      case 'commandes':  state_ = commandes.length > 0 ? 'done' : (devisSigne ? 'cur' : 'pending'); break;
      case 'reception':  state_ = chantier === 'Pose en cours' || chantier === 'Terminé' ? 'done' : 'pending'; break;
      case 'pose':       state_ = chantier === 'Pose en cours' ? 'cur' : (chantier === 'Terminé' ? 'done' : (datePose && new Date(datePose) < new Date() ? 'cur' : 'pending')); break;
      case 'pv':         state_ = taskDone('pv') || taskDone('réception') ? 'done' : 'pending'; break;
      case 'solde':      state_ = taskDone('solde') ? 'done' : 'pending'; break;
      case 'avis':       state_ = taskDone('avis') ? 'done' : 'pending'; break;
      case 'sav':        state_ = chantier === 'SAV' ? 'cur' : 'pending'; break;
    }
    return { ...s, state: state_ };
  });
}

// === Render principal ===
export async function renderProjet(app, projetId) {
  app.innerHTML = `<div class="loading">Chargement fiche projet…</div>`;
  try {
    const data = await fetchProjetDetail(projetId);
    renderFiche(app, data);
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Erreur</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

function renderFiche(app, data) {
  const { projet, client, taches, commandes, devis, reunionsPlaud, devisArtisans, fournisseurs, artisans } = data;
  const pf = projet.fields || {};
  const phase = pf['Phase commerciale'] || pf.Statut || '—';
  const chantier = pf['Statut chantier'] || '';
  const stepper = computeParcours(projet, taches, devis, commandes);

  // Bilan financier prévi
  const caHT = pf['Budget HT'] || 0;
  const coutFourn = commandes.reduce((s, c) => s + (c.fields?.['Montant HT'] || 0), 0);
  const coutArtisans = devisArtisans.reduce((s, d) => s + (d.fields?.['Montant HT'] || 0), 0);
  const retro = devisArtisans.filter(d => {
    const aId = (d.fields?.Artisan || [])[0];
    const a = aId ? artisans.find(x => x.id === aId) : null;
    return a?.fields?.Contractuel;
  }).reduce((s, d) => s + (d.fields?.['Montant HT'] || 0) * 0.05, 0);
  const margeAbs = caHT - coutFourn - coutArtisans + retro;
  const margePct = caHT > 0 ? (margeAbs / caHT) * 100 : null;

  app.innerHTML = `
    <nav class="breadcrumb">
      <a href="#clients">Clients</a> &rsaquo;
      ${client ? `<a href="#clients/${encodeURIComponent(client.id)}">${esc(client.fields?.Nom)}</a> &rsaquo;` : ''}
      <strong>${esc(pf.Référence || '(sans référence)')}</strong>
    </nav>

    <div class="client-header">
      <div class="client-header-left">
        <div class="client-header-icon">${icon('folder', 36)}</div>
        <div>
          <h1 class="page-title" style="margin:0">${esc(pf.Référence || '(sans référence)')}</h1>
          <div class="muted" style="margin-top:4px">
            ${client ? `Client : <strong>${esc(client.fields?.Nom)}</strong>` : 'Pas de client lié'}
            · Phase : <strong>${esc(phase)}</strong>
            ${chantier ? ` · Chantier : <strong>${esc(chantier)}</strong>` : ''}
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

    <!-- Stepper 12 étapes -->
    <h2 class="section-title">Parcours chantier</h2>
    <div class="stepper">
      ${stepper.map(s => `
        <div class="step step-${s.state}" title="${esc(s.label)}">
          <div class="step-icon">${icon(s.icon, 18)}</div>
          <div class="step-label">${esc(s.label)}</div>
        </div>
      `).join('')}
    </div>

    <!-- Bilan financier -->
    <h2 class="section-title">Bilan financier prévisionnel</h2>
    <div class="kpi-row" style="margin-bottom:24px">
      <div class="kpi-card"><div class="kpi-value">${euros(caHT)}</div><div class="kpi-label">CA HT</div></div>
      <div class="kpi-card"><div class="kpi-value">${euros(coutFourn)}</div><div class="kpi-label">Fournisseurs</div></div>
      <div class="kpi-card"><div class="kpi-value">${euros(coutArtisans - retro)}</div><div class="kpi-label">Artisans (− 5 % rétro)</div></div>
      <div class="kpi-card"${margeAbs < 0 ? ' style="background:var(--accent-lo)"' : ''}>
        <div class="kpi-value">${euros(margeAbs)}</div>
        <div class="kpi-label">Marge ${margePct != null ? '(' + margePct.toFixed(1) + ' %)' : ''}</div>
      </div>
    </div>

    <!-- Tâches -->
    <div class="section-header">
      <h2 class="section-title">Tâches (${taches.length})</h2>
      <button class="btn btn-primary btn-sm" id="btn-new-tache">${icon('plus', 14)} Nouvelle tâche</button>
    </div>
    <div class="taches-list">
      ${taches.length === 0
        ? `<div class="card"><p class="muted">Pas de tâche pour ce projet.</p></div>`
        : taches.map(t => renderTacheRow(t)).join('')}
    </div>

    <!-- Commandes -->
    ${commandes.length > 0 ? `
    <h2 class="section-title">Commandes fournisseurs (${commandes.length})</h2>
    <div class="commandes-list">
      ${commandes.map(c => {
        const fIds = c.fields?.Fournisseur || [];
        const fNoms = fIds.map(id => fournisseurs.find(f => f.id === id)?.fields?.Nom || id).join(', ');
        return `
        <div class="card commande-card">
          <div class="commande-head">
            <div><strong>${esc(c.fields?.['Numéro'] || c.fields?.['numéro'] || '?')}</strong> — ${esc(fNoms)}</div>
            <span class="badge">${esc(c.fields?.Statut || '—')}</span>
          </div>
          ${c.fields?.Notes ? `<pre class="commande-notes">${esc(c.fields.Notes.slice(0, 400))}${c.fields.Notes.length > 400 ? '…' : ''}</pre>` : ''}
        </div>`;
      }).join('')}
    </div>
    ` : ''}

    <!-- Devis Tanguy -->
    ${devis.length > 0 ? `
    <h2 class="section-title">Devis Tanguy (${devis.length})</h2>
    <div class="commandes-list">
      ${devis.map(d => `
        <div class="card commande-card">
          <div class="commande-head">
            <div><strong>${esc(d.fields?.['Numéro devis'] || '?')}</strong>
              <span class="badge">${esc(d.fields?.['Type devis'] || 'Principal')}</span>
              <span class="badge">${esc(d.fields?.Statut || '—')}</span>
            </div>
            <div><strong>${euros(d.fields?.['Total TTC'])}</strong> TTC</div>
          </div>
          ${d.fields?.['Date devis'] ? `<div class="muted">Daté du ${esc(d.fields['Date devis'])}</div>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}

    <!-- Devis Artisans -->
    ${devisArtisans.length > 0 ? `
    <h2 class="section-title">Devis artisans (${devisArtisans.length})</h2>
    <div class="commandes-list">
      ${devisArtisans.map(d => {
        const aId = (d.fields?.Artisan || [])[0];
        const a = aId ? artisans.find(x => x.id === aId) : null;
        const aNom = a?.fields?.Nom || '?';
        const contractuel = a?.fields?.Contractuel ? ' · contractuel (− 5 %)' : '';
        return `
        <div class="card commande-card">
          <div class="commande-head">
            <div><strong>${esc(aNom)}</strong><span class="muted">${esc(contractuel)}</span></div>
            <div><strong>${euros(d.fields?.['Montant HT'])}</strong> HT</div>
          </div>
        </div>`;
      }).join('')}
    </div>
    ` : ''}

    <!-- Réunions Plaud R1/R2 -->
    ${reunionsPlaud.length > 0 ? `
    <h2 class="section-title">Réunions Plaud (${reunionsPlaud.length})</h2>
    <div class="commandes-list">
      ${reunionsPlaud.map(r => `
        <div class="card">
          <div class="commande-head">
            <div><strong>${esc(r.fields?.Niveau || '?')}</strong> ${esc(r.fields?.['Type réunion'] || '')}
              ${r.fields?.['Date heure'] ? `<span class="muted">${esc(r.fields['Date heure'])}</span>` : ''}
            </div>
          </div>
          ${r.fields?.Synthèse ? `<details><summary>Synthèse</summary><p style="white-space:pre-line;margin-top:8px">${esc(r.fields.Synthèse)}</p></details>` : ''}
          ${r.fields?.Attentes ? `<details><summary>Attentes</summary><p style="white-space:pre-line;margin-top:8px">${esc(r.fields.Attentes)}</p></details>` : ''}
          ${r.fields?.['Tâches identifiées'] ? `<details><summary>Tâches identifiées</summary><p style="white-space:pre-line;margin-top:8px">${esc(r.fields['Tâches identifiées'])}</p></details>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}

    <!-- Journal chantier -->
    <div class="section-header">
      <h2 class="section-title">Journal chantier</h2>
      <button class="btn btn-ghost btn-sm" id="btn-add-journal">${icon('plus', 14)} Ajouter entrée</button>
    </div>
    <div class="card">
      ${pf['Journal chantier']
        ? `<pre class="journal" style="white-space:pre-wrap;font-family:'DM Mono',monospace;font-size:12px">${esc(pf['Journal chantier'])}</pre>`
        : `<p class="muted">Pas encore d'entrée. Cliquez sur « Ajouter entrée » pour démarrer.</p>`}
    </div>

    <!-- Attachments -->
    <h2 class="section-title">Documents</h2>
    <div class="attachments-grid">
      ${renderAttachmentsCard('Plan 3D', pf['Plan 3D'], projet.id)}
      ${renderAttachmentsCard('Plan technique', pf['Plan technique'], projet.id)}
      ${renderAttachmentsCard('Images', pf['Images'], projet.id)}
      ${renderAttachmentsCard('Documents projet', pf['Documents projet'], projet.id)}
    </div>
    <p class="muted" style="margin-top:8px;font-size:12px">Drag & drop ou clic « + » sur chaque zone. Limite Airtable : 5 MB par fichier.</p>
  `;

  hydrateIcons(app);
  bindAttachmentCards(app, projet.id);

  // === Bindings ===
  document.getElementById('btn-edit-projet')?.addEventListener('click', () => openModalEditProjet(projet));
  document.getElementById('btn-archive')?.addEventListener('click', () => archiveProjet(projet, 'Archivé'));
  document.getElementById('btn-unarchive')?.addEventListener('click', () => archiveProjet(projet, ''));
  document.getElementById('btn-new-tache')?.addEventListener('click', () => openModalTache(null, projet, client));
  document.getElementById('btn-add-journal')?.addEventListener('click', () => openModalJournal(projet));

  // Tâches : checkbox + click row → édition
  document.querySelectorAll('[data-tache-id]').forEach(row => {
    const tacheId = row.dataset.tacheId;
    const t = taches.find(x => x.id === tacheId);
    if (!t) return;
    row.querySelector('.tache-check')?.addEventListener('click', async e => {
      e.stopPropagation();
      const newStatut = t.fields?.Statut === 'Terminée' ? 'À faire' : 'Terminée';
      try {
        await patchTache(tacheId, { Statut: newStatut });
        t.fields.Statut = newStatut;
        router();
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    });
    row.querySelector('.tache-edit')?.addEventListener('click', e => {
      e.stopPropagation();
      openModalTache(t, projet, client);
    });
    row.querySelector('.tache-delete')?.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Supprimer la tâche « ${t.fields?.Titre || '?'} » ?`)) return;
      try { await deleteTache(tacheId); router(); }
      catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    });
  });
}

function renderTacheRow(t) {
  const f = t.fields || {};
  const done = f.Statut === 'Terminée';
  return `
    <div class="tache-row" data-tache-id="${t.id}">
      <button class="tache-check" aria-label="${done ? 'Marquer à faire' : 'Marquer terminée'}">
        ${done ? icon('check', 18) : '<span class="tache-check-empty"></span>'}
      </button>
      <div class="tache-content ${done ? 'is-done' : ''}">
        <div class="tache-title">${esc(f.Titre || '?')}</div>
        <div class="tache-meta">
          ${f['Assignée à'] ? `<span>${icon('user', 12)} ${esc(f['Assignée à'])}</span>` : ''}
          ${f.Priorité ? `<span class="badge phase-${esc(f.Priorité).toLowerCase()}">${esc(f.Priorité)}</span>` : ''}
          ${f.Échéance ? `<span>${icon('calendar', 12)} ${esc(f.Échéance)}</span>` : ''}
        </div>
      </div>
      <div class="tache-actions">
        <button class="tache-edit" aria-label="Éditer">${icon('edit', 14)}</button>
        <button class="tache-delete" aria-label="Supprimer">${icon('trash', 14)}</button>
      </div>
    </div>
  `;
}

function renderAttachmentsCard(label, attachments, projetId) {
  const count = (attachments || []).length;
  return `
    <div class="card attachment-card" data-field="${esc(label)}" data-projet="${esc(projetId)}">
      <div class="attachment-head">
        <h3 class="card-title" style="margin:0">${esc(label)}</h3>
        <button class="btn btn-ghost btn-sm" data-action="upload" aria-label="Ajouter">${icon('plus', 12)}</button>
      </div>
      <div class="attachment-count">
        <span class="kpi-value" style="font-size:22px">${count}</span>
        <span class="muted" style="font-size:12px">fichier${count > 1 ? 's' : ''}</span>
      </div>
      <ul class="attachments-files">
        ${(attachments || []).map(a => `<li class="attachment-file" data-id="${esc(a.id)}">
          <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.filename)}</a>
          <button class="attachment-del" data-action="delete" data-attachment="${esc(a.id)}" aria-label="Supprimer ${esc(a.filename)}">${icon('trash', 12)}</button>
        </li>`).join('')}
      </ul>
      <div class="attachment-drop" data-action="drop">Glisse un fichier ici</div>
    </div>
  `;
}

function bindAttachmentCards(app, projetId) {
  app.querySelectorAll('.attachment-card').forEach(card => {
    const field = card.dataset.field;
    const dropZone = card.querySelector('[data-action="drop"]');
    const uploadBtn = card.querySelector('[data-action="upload"]');

    const triggerUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        if (input.files && input.files[0]) await doUpload(input.files[0], field, projetId);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    };
    uploadBtn.addEventListener('click', triggerUpload);
    dropZone.addEventListener('click', triggerUpload);

    ['dragenter', 'dragover'].forEach(ev => {
      dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('is-active'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('is-active'); });
    });
    dropZone.addEventListener('drop', async e => {
      const files = e.dataTransfer.files;
      if (files && files[0]) await doUpload(files[0], field, projetId);
    });

    card.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        const attachmentId = btn.dataset.attachment;
        const ok = await confirmModal('Supprimer ce fichier ?', { okLabel: 'Supprimer', danger: true });
        if (!ok) return;
        try {
          await deleteAttachment(projetId, field, attachmentId);
          toast('Fichier supprimé', 'success');
          router();
        } catch (err) {
          toast('Erreur suppression : ' + err.message, 'error', 5000);
        }
      });
    });
  });
}

async function doUpload(file, field, projetId) {
  if (file.size > 5 * 1024 * 1024) {
    toast(`Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} MB > 5 MB max Airtable)`, 'error', 5000);
    return;
  }
  toast(`Upload de ${file.name}…`, 'info', 3000);
  try {
    await uploadAttachment(projetId, field, file);
    toast(`${file.name} ajouté à ${field}`, 'success');
    router();
  } catch (err) {
    toast('Erreur upload : ' + err.message, 'error', 5000);
  }
}

// === Modales ===
function modalShell(title, content) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${content}</div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function k(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); }
  });
  return { modal, close };
}

function openModalEditProjet(projet) {
  const p = projet.fields || {};
  const { modal, close } = modalShell('Éditer projet', `
    <form id="form-edit-projet">
      <label>Référence <input name="Référence" value="${esc(p.Référence || '')}" required></label>
      <label>Phase commerciale
        <select name="Phase commerciale">
          ${['Découverte','Dessin','Présentation devis','En attente décision','Signé'].map(v => `<option ${p['Phase commerciale'] === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Statut chantier
        <select name="Statut chantier">
          <option value="">—</option>
          ${['Pré-pose','Pose en cours','Terminé','SAV','Archivé'].map(v => `<option ${p['Statut chantier'] === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Budget HT (€) <input name="Budget HT" type="number" step="0.01" value="${p['Budget HT'] || ''}"></label>
      <label>Date pose prévue <input name="Date pose prévue" type="date" value="${p['Date pose prévue'] || ''}"></label>
      <label>Date pose fin <input name="Date pose fin" type="date" value="${p['Date pose fin'] || ''}"></label>
      <label>Description <textarea name="Description" rows="3">${esc(p.Description || '')}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;
  document.getElementById('form-edit-projet').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) {
      if (v === '' && k !== 'Statut chantier') continue;
      fields[k] = k === 'Budget HT' ? Number(v) : v;
    }
    try { await patchProjet(projet.id, fields); close(); toast('Projet enregistré', 'success'); router(); }
    catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

function openModalTache(tache, projet, client) {
  const t = tache?.fields || {};
  const clientNom = client?.fields?.Nom || '';
  const isNew = !tache;
  const { modal, close } = modalShell(isNew ? 'Nouvelle tâche' : 'Éditer tâche', `
    <form id="form-tache">
      <label>Titre
        <input name="Titre" value="${esc(t.Titre || '')}" required placeholder="${clientNom ? '[' + esc(clientNom) + '] / ' : ''}…">
      </label>
      <label>Assignée à
        <select name="Assignée à">
          <option value="">—</option>
          ${['Virginie','Solène','Sébastien','Marine'].map(v => `<option ${t['Assignée à'] === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Priorité
        <select name="Priorité">
          ${['Haute','Moyenne','Basse'].map(v => `<option ${t.Priorité === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Statut
        <select name="Statut">
          ${['À faire','En cours','Terminée'].map(v => `<option ${t.Statut === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Échéance <input name="Échéance" type="date" value="${t.Échéance || ''}"></label>
      <label>Description <textarea name="Description" rows="3">${esc(t.Description || '')}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Créer' : 'Enregistrer'}</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;
  document.getElementById('form-tache').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) if (v) fields[k] = v;
    // Préfixe auto client si Titre nu (et création seule)
    if (isNew && clientNom && fields.Titre && !fields.Titre.includes('[')) {
      fields.Titre = `[${clientNom}] / ${fields.Titre}`;
    }
    if (isNew) fields.Projet = [projet.id];
    try {
      if (isNew) await createTache(fields); else await patchTache(tache.id, fields);
      close();
      toast(isNew ? 'Tâche créée' : 'Tâche enregistrée', 'success');
      router();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

function openModalJournal(projet) {
  const { modal, close } = modalShell('Ajouter une entrée journal', `
    <form id="form-journal">
      <label>Texte de l'entrée
        <textarea name="texte" rows="5" required placeholder="Ex : Réunion chantier OK avec Sébastien…"></textarea>
      </label>
      <label>Auteur (optionnel)
        <input name="auteur" value="${esc(state.user || '')}">
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Ajouter</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;
  document.getElementById('form-journal').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await appendJournalEntry(projet.id, fd.get('texte'));
      close();
      toast('Entrée journal ajoutée', 'success');
      router();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

async function archiveProjet(projet, newChantier) {
  const label = newChantier === 'Archivé' ? 'archiver' : 'désarchiver';
  if (!confirm(`Voulez-vous ${label} ce projet ?`)) return;
  try {
    await patchProjet(projet.id, { 'Statut chantier': newChantier || 'Pré-pose' });
    toast(newChantier === 'Archivé' ? 'Projet archivé' : 'Projet désarchivé', 'success');
    router();
  } catch (e) {
    toast(`Erreur ${label} : ${e.message}`, 'error', 5000);
  }
}
