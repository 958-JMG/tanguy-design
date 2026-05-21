// Vue Projet v3 (Sprint 2) — fiche complète avec stepper + bilan + zones éditables.
// Pattern porté de v2 (computeParcours + zones) mais modulaire ES + Lucide icons.

import { state } from '../core/state.js';
import { navigateTo, router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import {
  fetchProjetDetail, patchProjet, patchTache, createTache, deleteTache,
  appendJournalEntry, uploadAttachment, deleteAttachment,
  fetchArtisans, setProjetArtisans,
  importDevisClient, signDevisTanguy,
  importDevisArtisan, parsePlaud,
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
  const { projet, client, taches, commandes, devis, reunionsPlaud, devisArtisans, fournisseurs, artisans: allArtisans } = data;
  const pf = projet.fields || {};
  const phase = pf['Phase commerciale'] || pf.Statut || '—';
  const chantier = pf['Statut chantier'] || '';
  const stepper = computeParcours(projet, taches, devis, commandes);

  // L'endpoint /api/projets/:id renvoie TOUS les artisans de la base (utile pour le mapping ID → nom
  // depuis devisArtisans.Artisan[0]). Pour la section "Artisans affectés", on filtre par projet.Artisans.
  const projetArtisanIds = Array.isArray(pf.Artisans) ? pf.Artisans : [];
  const artisans = allArtisans.filter(a => projetArtisanIds.includes(a.id));

  // Bilan financier prévi
  const caHT = pf['Budget HT'] || 0;
  const coutFourn = commandes.reduce((s, c) => s + (c.fields?.['Montant HT'] || 0), 0);
  const coutArtisans = devisArtisans.reduce((s, d) => s + (d.fields?.['Montant HT'] || 0), 0);
  const retro = devisArtisans.filter(d => {
    const aId = (d.fields?.Artisan || [])[0];
    // Lookup sur allArtisans : un devis peut référencer un artisan qui n'est plus dans la liste projet.
    const a = aId ? allArtisans.find(x => x.id === aId) : null;
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
        const refCourte = c.fields?.['Référence courte'] || c.fields?.Type || '?';
        return `
        <a class="card commande-card commande-link" href="#commande/${encodeURIComponent(c.id)}">
          <div class="commande-head">
            <div><strong>${esc(c.fields?.['Numéro'] || '?')}</strong>
              <span class="muted" style="margin-left:6px">${esc(refCourte)}</span>
              ${fNoms ? ` · ${esc(fNoms)}` : ' · <em class="muted">fournisseur non rattaché</em>'}
            </div>
            <span class="badge">${esc(c.fields?.Statut || '—')}</span>
          </div>
          ${c.fields?.['Modèle choisi'] ? `<div class="muted" style="margin-top:6px;font-size:12px">${esc(c.fields['Modèle choisi'].split('\n')[0])}</div>` : ''}
        </a>`;
      }).join('')}
    </div>
    ` : ''}

    <!-- Devis Tanguy (Sprint v3.2 — import PDF Winner + signature → rétro-planning) -->
    <div class="section-header">
      <h2 class="section-title">Devis Tanguy (${devis.length})</h2>
      <button class="btn btn-primary btn-sm" id="btn-import-devis">${icon('plus', 14)} Importer devis Winner</button>
    </div>
    <div class="commandes-list">
      ${devis.length === 0
        ? `<div class="card"><p class="muted">Aucun devis. Importer un PDF Winner pour créer le devis et déclencher le workflow complet.</p></div>`
        : devis.map(d => {
          const f = d.fields || {};
          const isSigned = f.Statut === 'Signé';
          return `
        <div class="card commande-card" data-devis-id="${esc(d.id)}">
          <div class="commande-head">
            <div><strong>${esc(f['Numéro devis'] || '?')}</strong>
              <span class="badge">${esc(f['Type devis'] || 'Principal')}</span>
              <span class="badge ${isSigned ? 'phase-signe' : ''}">${esc(f.Statut || '—')}</span>
            </div>
            <div><strong>${euros(f['Total TTC'])}</strong> TTC</div>
          </div>
          ${f['Date devis'] ? `<div class="muted">Daté du ${esc(f['Date devis'])}</div>` : ''}
          ${!isSigned ? `
            <div style="margin-top:10px;display:flex;gap:8px">
              <button class="btn btn-primary btn-sm" data-action="sign-devis" data-id="${esc(d.id)}">${icon('check', 14)} Signer ce devis</button>
              <span class="muted" style="font-size:12px;align-self:center">→ génère commandes + tâches + planning chantier</span>
            </div>
          ` : ''}
        </div>`;
      }).join('')}
    </div>

    <!-- Artisans affectés (Sprint v3.2) -->
    <div class="section-header">
      <h2 class="section-title">Artisans affectés (${artisans.length})</h2>
      <button class="btn btn-primary btn-sm" id="btn-add-artisan">${icon('plus', 14)} Affecter un artisan</button>
    </div>
    <div class="commandes-list">
      ${artisans.length === 0
        ? `<div class="card"><p class="muted">Aucun artisan rattaché à ce projet.</p></div>`
        : artisans.map(a => {
          const af = a.fields || {};
          return `
        <div class="card commande-card" data-artisan-id="${esc(a.id)}">
          <div class="commande-head">
            <div><strong>${esc(af.Nom || '?')}</strong>
              ${af.Spécialité ? `<span class="muted"> · ${esc(af.Spécialité)}</span>` : ''}
              ${af.Contractuel ? '<span class="badge phase-signe" style="margin-left:8px">Contractuel (−5%)</span>' : '<span class="badge" style="margin-left:8px">Non contractuel</span>'}
            </div>
            <button class="btn btn-ghost btn-sm" data-action="remove-artisan" data-id="${esc(a.id)}" aria-label="Retirer">${icon('trash', 14)}</button>
          </div>
          ${af.Téléphone || af.Email ? `<div class="muted" style="margin-top:6px;font-size:12px">${esc(af.Téléphone || '')}${af.Téléphone && af.Email ? ' · ' : ''}${esc(af.Email || '')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>

    <!-- Devis Artisans (Sprint v3.2 — import PDF + calcul auto rétro-commission 5%) -->
    <div class="section-header">
      <h2 class="section-title">Devis artisans (${devisArtisans.length})</h2>
      <button class="btn btn-primary btn-sm" id="btn-import-devis-artisan">${icon('plus', 14)} Importer PDF devis artisan</button>
    </div>
    <div class="commandes-list">
      ${devisArtisans.length === 0
        ? `<div class="card"><p class="muted">Aucun devis artisan. Le calcul rétro 5% se fait auto sur les contractuels.</p></div>`
        : devisArtisans.map(d => {
          const df = d.fields || {};
          const aId = (df.Artisan || [])[0];
          // Lookup sur allArtisans (un devis peut référencer un artisan détaché du projet).
          const a = aId ? allArtisans.find(x => x.id === aId) : null;
          const aNom = a?.fields?.Nom || '?';
          const isContractuel = a?.fields?.Contractuel;
          const montantHT = df['Montant HT'] || 0;
          const retroCom = df['Rétro-commission HT'] || (isContractuel ? montantHT * 0.05 : 0);
          return `
        <div class="card commande-card">
          <div class="commande-head">
            <div><strong>${esc(aNom)}</strong>
              ${isContractuel ? '<span class="badge phase-signe" style="margin-left:8px">Contractuel</span>' : ''}
              ${df['Numéro devis'] ? `<span class="muted" style="margin-left:8px">· ${esc(df['Numéro devis'])}</span>` : ''}
              <span class="badge" style="margin-left:8px">${esc(df.Statut || 'À valider')}</span>
            </div>
            <div style="text-align:right">
              <div><strong>${euros(montantHT)}</strong> HT</div>
              ${isContractuel ? `<div class="muted" style="font-size:12px">Rétro 5 % : <strong>${euros(retroCom)}</strong></div>` : ''}
            </div>
          </div>
          ${df['Description travaux'] ? `<div class="muted" style="margin-top:6px;font-size:12px;max-width:80ch">${esc(String(df['Description travaux']).slice(0,200))}${df['Description travaux'].length > 200 ? '…' : ''}</div>` : ''}
        </div>`;
      }).join('')}
    </div>

    <!-- Réunions Plaud R1/R2 (Sprint v3.2 — bouton "Nouvelle réunion" qui parse transcript) -->
    <div class="section-header">
      <h2 class="section-title">Réunions Plaud (${reunionsPlaud.length})</h2>
      <button class="btn btn-primary btn-sm" id="btn-new-plaud">${icon('plus', 14)} Nouvelle réunion</button>
    </div>
    <div class="commandes-list">
      ${reunionsPlaud.length === 0
        ? `<div class="card"><p class="muted">Aucune réunion. Importer un transcript Plaud (R1 découverte ou R2 chantier) — les tâches sont créées automatiquement.</p></div>`
        : reunionsPlaud.map(r => `
        <div class="card">
          <div class="commande-head">
            <div><strong>${esc(r.fields?.Niveau || '?')}</strong> ${esc(r.fields?.['Type réunion'] || '')}
              ${r.fields?.['Date heure'] ? `<span class="muted"> · ${esc(r.fields['Date heure'])}</span>` : ''}
              ${r.fields?.Lieu ? `<span class="muted"> · ${esc(r.fields.Lieu)}</span>` : ''}
            </div>
          </div>
          ${r.fields?.Synthèse ? `<details><summary>Synthèse</summary><p style="white-space:pre-line;margin-top:8px">${esc(r.fields.Synthèse)}</p></details>` : ''}
          ${r.fields?.Attentes ? `<details><summary>Attentes</summary><p style="white-space:pre-line;margin-top:8px">${esc(r.fields.Attentes)}</p></details>` : ''}
          ${r.fields?.['Tâches identifiées'] ? `<details><summary>Tâches identifiées</summary><p style="white-space:pre-line;margin-top:8px">${esc(r.fields['Tâches identifiées'])}</p></details>` : ''}
        </div>
      `).join('')}
    </div>

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

  // Sprint v3.2 — actions nouvelles
  document.getElementById('btn-import-devis')?.addEventListener('click', () => openModalImportDevis(projet, devis));
  document.getElementById('btn-add-artisan')?.addEventListener('click', () => openModalAddArtisan(projet, artisans));
  document.getElementById('btn-import-devis-artisan')?.addEventListener('click', () => openModalImportDevisArtisan(projet, artisans));
  document.getElementById('btn-new-plaud')?.addEventListener('click', () => openModalPlaud(projet, client));

  // Signature devis (bouton sur chaque card devis non signé)
  app.querySelectorAll('[data-action="sign-devis"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const devisId = btn.dataset.id;
      const d = devis.find(x => x.id === devisId);
      const num = d?.fields?.['Numéro devis'] || devisId;
      const ok = await confirmModal(
        `Signer le devis ${num} ?\nCela va : créer les commandes fournisseurs avec rétro-planning, générer les tâches de suivi (acompte, BC, notif artisans, planning chantier J+60), passer le devis à « Signé » et le projet à « Commandes ».`,
        { okLabel: 'Signer', danger: false }
      );
      if (!ok) return;
      btn.disabled = true;
      btn.innerHTML = 'Signature en cours…';
      try {
        const result = await signDevisTanguy(devisId);
        toast(`Devis signé · ${result.commandes_creees} commande(s) · ${result.taches_creees} tâche(s)`, 'success', 5000);
        router();
      } catch (err) {
        toast('Erreur signature : ' + err.message, 'error', 5000);
        btn.disabled = false;
        btn.innerHTML = '<span>Signer ce devis</span>';
      }
    });
  });

  // Retrait artisan (croix sur chaque artisan affecté)
  app.querySelectorAll('[data-action="remove-artisan"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const artisanId = btn.dataset.id;
      const a = artisans.find(x => x.id === artisanId);
      const nom = a?.fields?.Nom || '?';
      const ok = await confirmModal(`Retirer ${nom} de ce projet ?`, { okLabel: 'Retirer', danger: true });
      if (!ok) return;
      try {
        const remaining = artisans.filter(x => x.id !== artisanId).map(x => x.id);
        await setProjetArtisans(projet.id, remaining);
        toast(`${nom} retiré`, 'success');
        router();
      } catch (err) {
        toast('Erreur retrait : ' + err.message, 'error', 5000);
      }
    });
  });

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

// =============================================================================
// Sprint v3.2 — 4 modales feature parity v1 (devis client, artisan, devis artisan, plaud)
// =============================================================================

// Import devis client Winner (PDF) — Principal ou Additif.
// Le parsing Claude prend 60-120s côté backend (withKeepAlive).
function openModalImportDevis(projet, devisExistants) {
  const hasPrincipal = devisExistants.some(d => (d.fields?.['Type devis'] || 'Principal') === 'Principal');
  const typeParDefaut = hasPrincipal ? 'Additif' : 'Principal';
  const { modal, close } = modalShell('Importer devis Winner', `
    <form id="form-import-devis">
      <p class="muted" style="margin-top:0">PDF Winner. Le devis (header + zones + lignes + échéances) sera créé et lié à ce projet.</p>
      <label>Type de devis
        <select name="type">
          <option value="Principal" ${typeParDefaut === 'Principal' ? 'selected' : ''}>Principal (premier devis)</option>
          <option value="Additif" ${typeParDefaut === 'Additif' ? 'selected' : ''}>Additif (augmentation de scope)</option>
        </select>
      </label>
      <label>Fichier PDF
        <input type="file" name="pdf" accept="application/pdf" required>
      </label>
      <p class="muted" style="font-size:12px">Le parsing Claude peut prendre 1 à 2 minutes — ne ferme pas la modale.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Importer</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;
  document.getElementById('form-import-devis').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('pdf');
    const type = fd.get('type');
    if (!file || file.size === 0) return;
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = 'Parsing PDF (1-2 min)…';
    try {
      const result = await importDevisClient({ file, projetId: projet.id, type });
      toast(`Devis ${type} importé · ${result.lignes_count || 0} lignes`, 'success', 5000);
      close();
      router();
    } catch (err) {
      toast('Erreur import : ' + err.message, 'error', 7000);
      btn.disabled = false;
      btn.innerHTML = 'Importer';
    }
  });
}

// Affecter un artisan : sélection depuis liste complète (hors déjà affectés).
async function openModalAddArtisan(projet, artisansCourants) {
  const { modal, close } = modalShell('Affecter un artisan', `
    <form id="form-add-artisan">
      <p class="muted" style="margin-top:0">Choisis l'artisan à rattacher au projet. Une fois rattaché, il pourra envoyer son devis (rétro 5% auto sur les contractuels).</p>
      <div id="artisans-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:8px">
        <p class="muted">Chargement…</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary" id="submit-btn" disabled>Affecter</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;

  // Charge la liste des artisans
  let selectedId = null;
  try {
    const allArtisans = await fetchArtisans();
    const dejaAffecteIds = new Set(artisansCourants.map(a => a.id));
    const disponibles = allArtisans.filter(a => !dejaAffecteIds.has(a.id));
    const list = document.getElementById('artisans-list');
    if (disponibles.length === 0) {
      list.innerHTML = '<p class="muted">Tous les artisans sont déjà affectés à ce projet.</p>';
      return;
    }
    list.innerHTML = disponibles.map(a => `
      <label style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;border-radius:4px" class="artisan-item">
        <input type="radio" name="artisan" value="${esc(a.id)}">
        <div style="flex:1">
          <strong>${esc(a.Nom || '?')}</strong>
          ${a.Spécialité ? `<span class="muted"> · ${esc(a.Spécialité)}</span>` : ''}
          ${a.Contractuel ? '<span class="badge phase-signe" style="margin-left:8px;font-size:10px">Contractuel</span>' : ''}
        </div>
      </label>
    `).join('');
    list.querySelectorAll('input[name="artisan"]').forEach(r => {
      r.addEventListener('change', () => {
        selectedId = r.value;
        document.getElementById('submit-btn').disabled = false;
      });
    });
  } catch (err) {
    document.getElementById('artisans-list').innerHTML = `<p class="muted">Erreur chargement : ${esc(err.message)}</p>`;
    return;
  }

  document.getElementById('form-add-artisan').addEventListener('submit', async e => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      const newIds = [...artisansCourants.map(a => a.id), selectedId];
      await setProjetArtisans(projet.id, newIds);
      toast('Artisan affecté', 'success');
      close();
      router();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}

// Import devis artisan PDF (calcul auto rétro 5% côté backend + auto-affectation au projet).
function openModalImportDevisArtisan(projet, artisansCourants) {
  const optionsArtisans = artisansCourants.map(a =>
    `<option value="${esc(a.id)}">${esc(a.fields?.Nom || '?')}${a.fields?.Contractuel ? ' (contractuel)' : ''}</option>`
  ).join('');
  const { modal, close } = modalShell('Importer devis artisan', `
    <form id="form-import-devis-artisan">
      <p class="muted" style="margin-top:0">PDF du devis artisan. Le montant HT, la rétro-commission 5% et le statut sont remplis automatiquement.</p>
      <label>Artisan (optionnel — sinon match auto par nom d'entreprise)
        <select name="artisanId">
          <option value="">— Auto-match —</option>
          ${optionsArtisans}
        </select>
      </label>
      <label>Fichier PDF
        <input type="file" name="pdf" accept="application/pdf" required>
      </label>
      <p class="muted" style="font-size:12px">Parsing Claude 1-2 min.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Importer</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;
  document.getElementById('form-import-devis-artisan').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('pdf');
    const artisanId = fd.get('artisanId') || null;
    if (!file || file.size === 0) return;
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = 'Parsing PDF (1-2 min)…';
    try {
      const result = await importDevisArtisan({ file, projetId: projet.id, artisanId });
      const retro = result.parsed_summary?.retrocommission || 0;
      toast(`Devis artisan importé · Rétro 5% : ${retro} €`, 'success', 5000);
      close();
      router();
    } catch (err) {
      toast('Erreur import : ' + err.message, 'error', 7000);
      btn.disabled = false;
      btn.innerHTML = 'Importer';
    }
  });
}

// Nouvelle réunion Plaud R1/R2 — paste transcript ou upload .txt.
// Le backend parse via Claude, structure synthese/contexte/attentes/etc, crée la réunion,
// et crée auto les tâches depuis prochaines_actions[].
function openModalPlaud(projet, client) {
  const { modal, close } = modalShell('Nouvelle réunion Plaud', `
    <form id="form-plaud">
      <p class="muted" style="margin-top:0">Colle le transcript Plaud ou charge un .txt. Le parsing structure la fiche projet et crée les tâches automatiquement.</p>
      <label>Niveau / Type
        <select name="niveau_type">
          <option value="R1|Découverte">R1 — Découverte (avant signature)</option>
          <option value="R1|Présentation devis">R1 — Présentation devis</option>
          <option value="R2|Suivi chantier">R2 — Suivi chantier</option>
          <option value="R2|SAV">R2 — SAV</option>
        </select>
      </label>
      <label>Fichier .txt (optionnel — sinon coller le texte ci-dessous)
        <input type="file" name="txt" accept=".txt,text/plain">
      </label>
      <label>Transcript (texte brut)
        <textarea name="transcript" rows="10" placeholder="Coller ici le transcript Plaud…" style="font-family:'DM Mono',monospace;font-size:12px"></textarea>
      </label>
      <p class="muted" style="font-size:12px">Parsing Claude 30-60s. Les tâches identifiées seront créées sur ce projet.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Importer & parser</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;

  // Auto-lecture du .txt dans le textarea
  const fileInput = modal.querySelector('input[name="txt"]');
  const textarea = modal.querySelector('textarea[name="transcript"]');
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) {
      toast('Fichier trop volumineux (> 1 MB)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => { textarea.value = e.target.result; };
    reader.readAsText(f, 'UTF-8');
  });

  document.getElementById('form-plaud').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const transcript = (fd.get('transcript') || '').trim();
    if (!transcript) {
      toast('Transcript vide', 'error');
      return;
    }
    const [niveau, type_reunion] = (fd.get('niveau_type') || 'R1|Découverte').split('|');
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = 'Parsing (30-60s)…';
    try {
      const clientId = client?.id || null;
      const result = await parsePlaud({ transcript, projetId: projet.id, clientId, niveau, type_reunion });
      const nTaches = result.tachesCreees?.length || 0;
      toast(`Réunion ${niveau} créée · ${nTaches} tâche(s) auto`, 'success', 5000);
      close();
      router();
    } catch (err) {
      toast('Erreur parsing : ' + err.message, 'error', 7000);
      btn.disabled = false;
      btn.innerHTML = 'Importer & parser';
    }
  });
}
