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
  genererTacheFacturation,
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

// Sprint v3.3 — calcule 3 à 5 actions prioritaires selon la phase du projet.
// Trié : urgent > normal, puis ordre métier (suit le funnel découverte → signature → pose).
function computeNextActions({ projet, taches, devis, commandes, artisans, reunionsPlaud }) {
  const pf = projet.fields || {};
  const phase = pf['Phase commerciale'] || pf.Statut || '';
  const items = [];
  const todayIso = new Date().toISOString().slice(0, 10);

  // Tâches en retard — toujours en premier (toutes phases)
  const tachesRetard = taches.filter(t =>
    t.fields?.Statut !== 'Terminée' &&
    t.fields?.Échéance && t.fields.Échéance < todayIso
  );
  if (tachesRetard.length) {
    items.push({
      icon: 'wrench', severity: 'urgent',
      label: `${tachesRetard.length} tâche${tachesRetard.length>1?'s':''} en retard`,
      scrollTo: '[data-section="taches"]',
    });
  }

  // Phase Découverte sans R1
  const hasR1 = reunionsPlaud.some(r => r.fields?.Niveau === 'R1');
  if (phase === 'Découverte' && !hasR1) {
    items.push({
      icon: 'mail', severity: 'normal',
      label: 'Importer transcript Plaud R1 (découverte)',
      action: 'btn-new-plaud',
    });
  }

  // R1 fait mais pas de devis
  if (hasR1 && devis.length === 0) {
    items.push({
      icon: 'file', severity: 'normal',
      label: 'Importer le devis Winner',
      action: 'btn-import-devis',
    });
  }

  // Devis Brouillon (existe mais pas signé)
  const devisBrouillon = devis.find(d => d.fields?.Statut === 'Brouillon');
  if (devisBrouillon) {
    items.push({
      icon: 'check', severity: 'normal',
      label: `Signer le devis ${devisBrouillon.fields?.['Numéro devis'] || ''}`,
      navigateTo: `devis/${devisBrouillon.id}`,
    });
  }

  // Phase ≥ Signé sans artisans
  if (['Signé', 'Commandes', 'Pose'].includes(phase) && artisans.length === 0) {
    items.push({
      icon: 'user', severity: 'normal',
      label: 'Affecter les artisans contractuels',
      action: 'btn-add-artisan',
    });
  }

  // Commandes sans fournisseur rattaché (phase commandes ou pose)
  if (['Signé', 'Commandes', 'Pose'].includes(phase)) {
    const cmdSansFourn = commandes.filter(c => !(c.fields?.Fournisseur || []).length);
    if (cmdSansFourn.length) {
      items.push({
        icon: 'archive', severity: 'normal',
        label: `${cmdSansFourn.length} BC sans fournisseur rattaché`,
        scrollTo: '[data-section="commandes"]',
      });
    }
  }

  // Phase Signé sans date pose
  if (['Signé', 'Commandes'].includes(phase) && !pf['Date pose prévue']) {
    items.push({
      icon: 'calendar', severity: 'normal',
      label: 'Définir la date de pose prévue',
      action: 'btn-edit-projet',
    });
  }

  // Pose passée sans PV réception
  if (pf['Date pose prévue'] && pf['Date pose prévue'] < todayIso) {
    const pvDone = taches.some(t => /pv|réception/i.test(t.fields?.Titre || '') && t.fields?.Statut === 'Terminée');
    if (!pvDone) {
      items.push({
        icon: 'check', severity: 'normal',
        label: 'PV de réception chantier',
        action: 'btn-new-tache',
      });
    }
  }

  // Tri urgent first puis ordre d'insertion (= ordre métier naturel)
  return items.sort((a, b) =>
    (a.severity === 'urgent' ? 0 : 1) - (b.severity === 'urgent' ? 0 : 1)
  ).slice(0, 5);
}

function computeParcours(projet, taches, devis, commandes, echeances = []) {
  const pf = projet.fields || {};
  const phase = pf['Phase commerciale'] || '';
  const chantier = pf['Statut chantier'] || '';

  // Helpers
  const hasR1 = (state.projets || []).length > 0; // toujours OK pour data fictive
  const devisSigne = devis.some(d => d.fields?.Statut === 'Signé');
  const taskDone = (titrePart) => taches.some(t => {
    const titre = (t.fields?.Titre || '').toLowerCase();
    return titre.includes(titrePart.toLowerCase()) && t.fields?.Statut === 'Terminée';
  });
  const planTechCount = (pf['Plan technique'] || []).length;
  const datePose = pf['Date pose prévue'];

  // Sprint v3.5 — Source de vérité pour les étapes facturation = échéances Airtable.
  // Une échéance "Encaissé" passe l'étape correspondante en vert (done).
  const isEncaisse = e => e?.fields?.Statut === 'Encaissé';
  const findEch = (rx) => echeances.find(e => rx.test(e.fields?.['Libellé'] || ''));
  const echAcompte   = findEch(/acompte|signature/i);
  const echReception = findEch(/r[ée]ception|livraison/i);
  const echSolde     = findEch(/solde|fin\s+pose|fin\s+chantier/i);

  return STEPS.map(s => {
    let state_ = 'pending';
    switch (s.key) {
      case 'decouverte': state_ = pf['Date découverte'] || hasR1 ? 'done' : 'pending'; break;
      case 'devis':      state_ = devis.length > 0 ? 'done' : 'pending'; break;
      case 'signature':  state_ = devisSigne ? 'done' : 'pending'; break;
      case 'acompte':    state_ = isEncaisse(echAcompte) || taskDone('acompte') ? 'done' : (devisSigne ? 'cur' : 'pending'); break;
      case 'plans_tech': state_ = planTechCount > 0 ? 'done' : (devisSigne ? 'cur' : 'pending'); break;
      case 'commandes':  state_ = commandes.length > 0 ? 'done' : (devisSigne ? 'cur' : 'pending'); break;
      case 'reception':  state_ = isEncaisse(echReception) || chantier === 'Pose en cours' || chantier === 'Terminé' ? 'done' : (chantier === 'Pré-pose' ? 'cur' : 'pending'); break;
      case 'pose':       state_ = chantier === 'Pose en cours' ? 'cur' : (chantier === 'Terminé' ? 'done' : (datePose && new Date(datePose) < new Date() ? 'cur' : 'pending')); break;
      case 'pv':         state_ = taskDone('pv') || taskDone('réception chantier') ? 'done' : 'pending'; break;
      case 'solde':      state_ = isEncaisse(echSolde) || taskDone('solde') ? 'done' : 'pending'; break;
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
  const { projet, client, taches, commandes, devis, reunionsPlaud, devisArtisans, fournisseurs, artisans: allArtisans, echeances = [] } = data;
  const pf = projet.fields || {};
  const phase = pf['Phase commerciale'] || pf.Statut || '—';
  const chantier = pf['Statut chantier'] || '';
  const stepper = computeParcours(projet, taches, devis, commandes, echeances);

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

  // Calcul des actions prioritaires selon la phase (Sprint v3.3)
  const nextActions = computeNextActions({ projet, taches, devis, commandes, artisans, reunionsPlaud });
  const hasUrgent = nextActions.some(a => a.severity === 'urgent');
  const margeNegative = margeAbs < 0;

  app.innerHTML = `
    <header role="banner" class="projet-sticky-header" id="projet-sticky-header">
      <nav class="breadcrumb" aria-label="Fil d'Ariane">
        <a href="#clients">Clients</a> &rsaquo;
        ${client ? `<a href="#clients/${encodeURIComponent(client.id)}">${esc(client.fields?.Nom)}</a> &rsaquo;` : ''}
        <strong>${esc(pf.Référence || '(sans référence)')}</strong>
      </nav>

      <!-- Ligne titre : nom projet à gauche, chips meta + actions à droite -->
      <div class="projet-title-row">
        <h1 class="page-title projet-title">${esc(pf.Référence || '(sans référence)')}</h1>
        <div class="projet-title-meta">
          ${chantier && chantier !== 'Archivé' ? `<span class="badge phase-haute" title="Statut chantier">${esc(chantier)}</span>` : ''}
          ${chantier === 'Archivé' ? `<span class="badge" title="Statut chantier">Archivé</span>` : ''}
          <button class="btn btn-ghost btn-sm" id="btn-edit-projet" aria-label="Éditer le projet">${icon('edit', 14)} Éditer</button>
          ${chantier === 'Archivé'
            ? `<button class="btn btn-ghost btn-sm" id="btn-unarchive" aria-label="Désarchiver">${icon('arrowLeft', 14)} Désarchiver</button>`
            : `<button class="btn btn-ghost btn-sm" id="btn-archive" aria-label="Archiver">${icon('archive', 14)} Archiver</button>`}
        </div>
      </div>

      <!-- Stepper chips horizontaux compactés -->
      <ol class="stepper-chips" aria-label="Parcours chantier">
        ${stepper.map((s, i) => `
          <li class="stepper-chip is-${s.state === 'cur' ? 'cur' : (s.state === 'done' ? 'done' : 'pending')}"
              ${s.state === 'cur' ? 'aria-current="step"' : ''}
              aria-label="Étape ${i+1} sur ${stepper.length} : ${esc(s.label)}">
            ${icon(s.icon, 13)} <span>${esc(s.label)}</span>
          </li>
        `).join('')}
      </ol>

      <!-- Bilan KPIs compactés -->
      <div class="kpi-row is-compact" aria-label="Bilan financier prévisionnel">
        <div class="kpi-card"><div class="kpi-value">${euros(caHT)}</div><div class="kpi-label">CA HT</div></div>
        <div class="kpi-card"><div class="kpi-value">${euros(coutFourn)}</div><div class="kpi-label">Fournisseurs</div></div>
        <div class="kpi-card"><div class="kpi-value">${euros(coutArtisans - retro)}</div><div class="kpi-label">Artisans (−5%)</div></div>
        <div class="kpi-card ${margeNegative ? 'is-negative' : ''}" ${margeNegative ? 'aria-label="Marge négative — attention"' : ''}>
          <div class="kpi-value">${euros(margeAbs)}</div>
          <div class="kpi-label">Marge ${margePct != null ? '(' + margePct.toFixed(1) + ' %)' : ''}</div>
        </div>
      </div>
    </header>

    <!-- Bandeau "À faire maintenant" -->
    ${nextActions.length > 0 ? `
    <section class="next-actions-card ${hasUrgent ? '' : 'is-quiet'}" aria-label="À faire maintenant">
      <h3>À faire maintenant</h3>
      <ul>
        ${nextActions.map((a, i) => `
          <li>
            <button class="next-action-item ${a.severity === 'urgent' ? 'is-urgent' : ''}"
                    data-next-action-idx="${i}">
              ${icon(a.icon, 16)} <span>${esc(a.label)}</span>
            </button>
          </li>
        `).join('')}
      </ul>
    </section>` : ''}

    <!-- Grid 2 colonnes : opérationnel à gauche, références à droite -->
    <div class="projet-grid">
      <div class="projet-col projet-col-left">

        <!-- Tâches -->
        <section class="projet-section" aria-label="Tâches" data-section="taches">
          <div class="projet-section-header">
            <h2>Tâches <span class="count">(${taches.length})</span></h2>
            <button class="btn btn-primary btn-sm" id="btn-new-tache">${icon('plus', 14)} Nouvelle</button>
          </div>
          ${taches.length === 0
            ? `<div class="compact-empty"><span>Aucune tâche</span></div>`
            : `<div class="taches-list">${taches.map(t => renderTacheRow(t)).join('')}</div>`}
        </section>

        <!-- Journal chantier -->
        <section class="projet-section" aria-label="Journal chantier" data-section="journal">
          <div class="projet-section-header">
            <h2>Journal chantier</h2>
            <button class="btn btn-ghost btn-sm" id="btn-add-journal">${icon('plus', 14)} Entrée</button>
          </div>
          ${pf['Journal chantier']
            ? `<div class="card"><pre class="journal" style="white-space:pre-wrap;font-family:'DM Mono',monospace;font-size:12px;margin:0">${esc(pf['Journal chantier'])}</pre></div>`
            : `<div class="compact-empty"><span>Pas encore d'entrée</span></div>`}
        </section>

        <!-- Réunions Plaud R1/R2 -->
        <section class="projet-section" aria-label="Réunions Plaud" data-section="plaud">
          <div class="projet-section-header">
            <h2>Réunions Plaud <span class="count">(${reunionsPlaud.length})</span></h2>
            <button class="btn btn-primary btn-sm" id="btn-new-plaud">${icon('plus', 14)} Nouvelle</button>
          </div>
          ${reunionsPlaud.length === 0
            ? `<div class="compact-empty"><span>R1 découverte ou R2 chantier — tâches créées auto</span></div>`
            : `<div class="commandes-list">${reunionsPlaud.map(r => `
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
            `).join('')}</div>`}
        </section>

      </div>
      <div class="projet-col projet-col-right">

        <!-- Devis Tanguy (cliquable, route #devis/<id>) -->
        <section class="projet-section" aria-label="Devis Tanguy" data-section="devis">
          <div class="projet-section-header">
            <h2>Devis Tanguy <span class="count">(${devis.length})</span></h2>
            <button class="btn btn-primary btn-sm" id="btn-import-devis">${icon('plus', 14)} Importer PDF</button>
          </div>
          ${devis.length === 0
            ? `<div class="compact-empty"><span>Aucun devis. Importer un PDF Winner pour déclencher le workflow.</span></div>`
            : `<div class="commandes-list">${devis.map(d => {
              const f = d.fields || {};
              const isSigned = f.Statut === 'Signé';
              return `
              <a class="card-devis-link" href="#devis/${encodeURIComponent(d.id)}" data-devis-id="${esc(d.id)}">
                <div class="commande-head" style="padding-right:24px">
                  <div><strong>${esc(f['Numéro devis'] || '?')}</strong>
                    <span class="badge" style="margin-left:6px">${esc(f['Type devis'] || 'Principal')}</span>
                    <span class="badge ${isSigned ? 'phase-signe' : ''}" style="margin-left:4px">${esc(f.Statut || '—')}</span>
                  </div>
                  <div><strong>${euros(f['Total TTC'])}</strong> <span class="muted" style="font-size:11px">TTC</span></div>
                </div>
                ${f['Date devis'] ? `<div class="muted" style="font-size:12px;margin-top:4px">Daté du ${esc(f['Date devis'])}</div>` : ''}
              </a>`;
            }).join('')}</div>`}
        </section>

        <!-- Facturation client (Sprint v3.5/v3.6 — 3 cards horizontales + CA signé) -->
        ${renderFacturationSection(echeances, taches, devis)}

        <!-- Commandes fournisseurs -->
        <section class="projet-section" aria-label="Commandes fournisseurs" data-section="commandes">
          <div class="projet-section-header">
            <h2>Commandes fournisseurs <span class="count">(${commandes.length})</span></h2>
          </div>
          ${commandes.length === 0
            ? `<div class="compact-empty"><span>Les BC sont générés à la signature du devis</span></div>`
            : `<div class="commandes-list">${commandes.map(c => {
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
            }).join('')}</div>`}
        </section>

        <!-- Artisans affectés -->
        <section class="projet-section" aria-label="Artisans affectés" data-section="artisans">
          <div class="projet-section-header">
            <h2>Artisans affectés <span class="count">(${artisans.length})</span></h2>
            <button class="btn btn-primary btn-sm" id="btn-add-artisan">${icon('plus', 14)} Affecter</button>
          </div>
          ${artisans.length === 0
            ? `<div class="compact-empty"><span>Aucun artisan rattaché</span></div>`
            : `<div class="commandes-list">${artisans.map(a => {
              const af = a.fields || {};
              return `
              <div class="card commande-card" data-artisan-id="${esc(a.id)}">
                <div class="commande-head">
                  <div><strong>${esc(af.Nom || '?')}</strong>
                    ${af.Spécialité ? `<span class="muted"> · ${esc(af.Spécialité)}</span>` : ''}
                    ${af.Contractuel ? '<span class="badge phase-signe" style="margin-left:8px">Contractuel (−5%)</span>' : '<span class="badge" style="margin-left:8px">Non contractuel</span>'}
                  </div>
                  <button class="btn-icon-danger" data-action="remove-artisan" data-id="${esc(a.id)}" aria-label="Retirer ${esc(af.Nom || 'artisan')} du projet">${icon('trash', 14)}</button>
                </div>
                ${af.Téléphone || af.Email ? `<div class="muted" style="margin-top:4px;font-size:12px">${esc(af.Téléphone || '')}${af.Téléphone && af.Email ? ' · ' : ''}${esc(af.Email || '')}</div>` : ''}
              </div>`;
            }).join('')}</div>`}
        </section>

        <!-- Devis artisans + rétro 5% -->
        <section class="projet-section" aria-label="Devis artisans" data-section="devis-artisans">
          <div class="projet-section-header">
            <h2>Devis artisans <span class="count">(${devisArtisans.length})</span></h2>
            <button class="btn btn-primary btn-sm" id="btn-import-devis-artisan">${icon('plus', 14)} Importer PDF</button>
          </div>
          ${devisArtisans.length === 0
            ? `<div class="compact-empty"><span>Rétro 5% calculée auto sur contractuels</span></div>`
            : `<div class="commandes-list">${devisArtisans.map(d => {
              const df = d.fields || {};
              const aId = (df.Artisan || [])[0];
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
                    <span class="badge" style="margin-left:6px">${esc(df.Statut || 'À valider')}</span>
                  </div>
                  <div style="text-align:right">
                    <div><strong>${euros(montantHT)}</strong> <span class="muted" style="font-size:11px">HT</span></div>
                    ${isContractuel ? `<div class="muted" style="font-size:12px">Rétro 5% : <strong>${euros(retroCom)}</strong></div>` : ''}
                  </div>
                </div>
                ${df['Description travaux'] ? `<div class="muted" style="margin-top:4px;font-size:12px">${esc(String(df['Description travaux']).slice(0,150))}${df['Description travaux'].length > 150 ? '…' : ''}</div>` : ''}
              </div>`;
            }).join('')}</div>`}
        </section>

        <!-- Documents (attachments) -->
        <section class="projet-section" aria-label="Documents" data-section="documents">
          <div class="projet-section-header">
            <h2>Documents</h2>
          </div>
          <div class="attachments-grid" style="grid-template-columns:repeat(2,1fr);gap:12px">
            ${renderAttachmentsCard('Plan 3D', pf['Plan 3D'], projet.id)}
            ${renderAttachmentsCard('Plan technique', pf['Plan technique'], projet.id)}
            ${renderAttachmentsCard('Images', pf['Images'], projet.id)}
            ${renderAttachmentsCard('Documents projet', pf['Documents projet'], projet.id)}
          </div>
          <p class="muted" style="margin-top:8px;font-size:11px">Drag & drop ou clic « + » · Limite Airtable 5 MB par fichier.</p>
        </section>

      </div>
    </div>
  `;

  // Stocke les actions pour les bindings post-render
  app._nextActions = nextActions;

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

  // Sprint v3.3 — bandeau next-actions : router les clics vers le bon handler
  app.querySelectorAll('[data-next-action-idx]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.nextActionIdx, 10);
      const a = app._nextActions?.[idx];
      if (!a) return;
      if (a.scrollTo) {
        document.querySelector(a.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (a.action) {
        document.getElementById(a.action)?.click();
      } else if (a.navigateTo) {
        location.hash = '#' + a.navigateTo;
      }
    });
  });

  // Sprint v3.3 — shadow sur sticky header au scroll
  const stickyHeader = document.getElementById('projet-sticky-header');
  if (stickyHeader && window.matchMedia('(min-width: 1024px)').matches) {
    const onScroll = () => {
      stickyHeader.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

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

  // Sprint v3.5 — Création tâche facturation depuis une échéance
  app.querySelectorAll('[data-action="facturer"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const echeanceId = btn.dataset.echeance;
      btn.disabled = true;
      btn.innerHTML = 'Création…';
      try {
        await genererTacheFacturation(projet.id, echeanceId);
        toast('Tâche créée pour Virginie', 'success');
        router();
      } catch (err) {
        toast('Erreur : ' + err.message, 'error', 5000);
        btn.disabled = false;
        btn.innerHTML = `${icon('plus', 14)} Créer la tâche pour Virginie`;
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

// Sprint v3.6 — Section Facturation client en 3 cards horizontales (style screenshot JMG).
// Affiche CA signé HT en header + une card par échéance (Acompte / Réception / Solde)
// avec pourcentage calculé sur le total.
function renderFacturationSection(echeances, taches, devis) {
  const devisSigne = devis.find(d => d.fields?.Statut === 'Signé');
  const caHT = devisSigne?.fields?.['Total HT final']
    || devisSigne?.fields?.['Total HT après remise']
    || devisSigne?.fields?.['Total HT articles']
    || 0;

  const ordered = (echeances || []).slice().sort((a,b) => (a.fields?.Ordre||0) - (b.fields?.Ordre||0));

  if (ordered.length === 0) {
    return `
      <section class="projet-section" aria-label="Facturation client" data-section="facturation">
        <div class="projet-section-header">
          <h2>Facturation client</h2>
        </div>
        <div class="compact-empty"><span>Échéances générées à l'import du devis Winner</span></div>
      </section>`;
  }

  // Montant prévu est en HT (champ "Montant prévu" type currency). On calcule les
  // pourcentages relatifs au total des échéances pour qu'ils somment à 100%.
  const totalPrevu = ordered.reduce((s, e) => s + (e.fields?.['Montant prévu'] || 0), 0);

  return `
    <section class="facturation-card-block" aria-label="Facturation client" data-section="facturation">
      <div class="facturation-header">
        <h3>${icon('mail', 14)} <span>Facturation client</span></h3>
        ${caHT > 0 ? `<div class="muted facturation-ca">CA SIGNÉ HT : <strong>${euros(caHT)}</strong></div>` : ''}
      </div>
      <div class="facturation-grid">
        ${ordered.map(e => {
          const ef = e.fields || {};
          const isEncaisse = ef.Statut === 'Encaissé';
          const tacheEnCours = taches.find(t => {
            const d = t.fields?.Description || '';
            return d.includes(`[echeance:${e.id}]`) && t.fields?.Statut !== 'Terminée';
          });
          const montantHt = ef['Montant prévu'] || 0;
          const pct = totalPrevu > 0 ? Math.round((montantHt / totalPrevu) * 100) : null;
          const stateCls = isEncaisse ? 'is-encaisse' : (tacheEnCours ? 'is-tache' : 'is-pending');
          return `
            <div class="facturation-item ${stateCls}" data-echeance-id="${esc(e.id)}">
              <div class="facturation-item-head">
                <strong>${icon('file', 13)} ${esc(ef['Libellé'] || '?')}</strong>
                ${isEncaisse ? `<span class="badge phase-signe">Encaissé</span>` : (tacheEnCours ? `<span class="badge phase-en-cours">Tâche</span>` : '')}
              </div>
              <div class="facturation-item-amount">
                <strong>${euros(montantHt)}</strong>
                <span class="muted">HT${pct != null ? ' (' + pct + '%)' : ''}</span>
              </div>
              ${isEncaisse
                ? `<div class="muted facturation-item-meta">Réglée ${ef['Date règlement'] ? 'le ' + esc(ef['Date règlement']) : ''}</div>`
                : (tacheEnCours
                  ? `<div class="muted facturation-item-meta">${esc(tacheEnCours.fields?.['Assignée à'] || 'Virginie')}${tacheEnCours.fields?.Échéance ? ' · ' + esc(tacheEnCours.fields.Échéance) : ''}</div>`
                  : `<button class="btn btn-primary btn-sm facturation-item-btn" data-action="facturer" data-echeance="${esc(e.id)}">${icon('plus', 12)} Créer tâche</button>`)}
            </div>`;
        }).join('')}
      </div>
    </section>`;
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
  const cancelBtn = document.getElementById('cancel');
  cancelBtn.onclick = close;
  document.getElementById('form-import-devis').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('pdf');
    const type = fd.get('type');
    if (!file || file.size === 0) return;
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;

    // Compteur temps écoulé + bouton annuler (parsing peut prendre 1-3 min selon taille PDF)
    const startTime = Date.now();
    const controller = new AbortController();
    let aborted = false;
    const update = () => {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const min = Math.floor(sec / 60);
      const remSec = sec % 60;
      btn.innerHTML = `Parsing… ${min > 0 ? min + 'min ' : ''}${remSec}s`;
    };
    const interval = setInterval(update, 1000);
    update();
    cancelBtn.innerHTML = 'Annuler';
    cancelBtn.onclick = () => {
      aborted = true;
      controller.abort();
    };

    try {
      const result = await importDevisClient({ file, projetId: projet.id, type, signal: controller.signal });
      clearInterval(interval);
      const lignes = result.lignes_count || result.zones_count || result.devis?.id ? 'OK' : '?';
      toast(`Devis ${type} importé`, 'success', 5000);
      close();
      router();
    } catch (err) {
      clearInterval(interval);
      if (aborted || err.name === 'AbortError') {
        toast('Import annulé', 'info', 3000);
      } else {
        toast('Erreur import : ' + err.message, 'error', 8000);
      }
      btn.disabled = false;
      btn.innerHTML = 'Importer';
      cancelBtn.innerHTML = 'Annuler';
      cancelBtn.onclick = close;
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
