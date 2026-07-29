// Vue Projet v3 (Sprint 2) — fiche complète avec stepper + bilan + zones éditables.
// Pattern porté de v2 (computeParcours + zones) mais modulaire ES + Lucide icons.

import { state } from '../core/state.js';
import { navigateTo, router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import {
  fetchProjetDetail, patchProjet, patchTache, createTache, deleteTache,
  appendJournalEntry, deleteJournalEntry, uploadAttachment, deleteAttachment,
  fetchArtisans, setProjetArtisans,
  importDevisClient, signDevisTanguy,
  importDevisArtisan, parsePlaud, patchDevisArtisan, deleteDevisArtisan,
  genererTacheFacturation, marquerEncaisse, createClient, createArtisan, fetchRendezVous,
  patchEcheance,
} from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';
import { openModalRdv, renderRdvList, bindRdvList } from '../core/rdv.js';

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

// Sprint v3.14 — Répare les filenames mojibake (UTF-8 mal décodé en Latin1).
// Ex: "prÃ©sentation" → "présentation". Vient d'uploads passés à travers une
// chaîne mal configurée (cockpit v1 / Airtable form).
function fixMojibake(s) {
  if (!s || !/Ã[^\x00-\x7F]?/.test(s)) return s;
  try {
    const bytes = new Uint8Array([...String(s)].map(c => c.charCodeAt(0) & 0xff));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return s; // pas réparable, on garde l'original
  }
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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
  const chantier = pf['Statut chantier'] || '';

  // Helpers
  const hasR1 = (state.projets || []).length > 0;
  const devisSigne = devis.some(d => d.fields?.Statut === 'Signé');
  const taskDone = (titrePart) => taches.some(t => {
    const titre = (t.fields?.Titre || '').toLowerCase();
    return titre.includes(titrePart.toLowerCase()) && t.fields?.Statut === 'Terminée';
  });
  const planTechCount = (pf['Plan technique'] || []).length;

  // Sprint v3.5/v3.11 — Source de vérité étapes facturation = échéances Airtable
  // OU tâche de facturation liée terminée (Virginie a marqué la facture envoyée).
  const isEncaisse = e => e?.fields?.Statut === 'Encaissé';
  const findEch = (rx) => echeances.find(e => rx.test(e.fields?.['Libellé'] || ''));
  const echAcompte   = findEch(/acompte|signature/i);
  const echReception = findEch(/r[ée]ception|livraison/i);
  const echSolde     = findEch(/solde|fin\s+pose|fin\s+chantier/i);
  const tacheLieeTerminee = (ech) => ech && taches.some(t =>
    (t.fields?.Description || '').includes(`[echeance:${ech.id}]`) &&
    t.fields?.Statut === 'Terminée'
  );

  // Sprint v3.11 — Pass 1 : calculer si chaque étape est DONE (terminée).
  // Pass 2 : la première étape pas done devient "cur", les suivantes restent "pending".
  // Garantit qu'une seule étape soit en orange à la fois → workflow lisible.
  const steps = STEPS.map(s => {
    let done = false;
    switch (s.key) {
      case 'decouverte': done = !!pf['Date découverte'] || hasR1; break;
      case 'devis':      done = devis.length > 0; break;
      case 'signature':  done = devisSigne; break;
      case 'acompte':    done = isEncaisse(echAcompte) || tacheLieeTerminee(echAcompte) || taskDone('acompte'); break;
      case 'plans_tech': done = planTechCount > 0; break;
      case 'commandes':  done = commandes.length > 0; break;
      case 'reception':  done = commandes.length > 0 && commandes.every(c => ['Livrée', 'Posée'].includes(c.fields?.Statut)); break;
      case 'pose':       done = chantier === 'Terminé'; break;
      case 'pv':         done = taskDone('pv') || taskDone('réception chantier'); break;
      case 'solde':      done = isEncaisse(echSolde) || tacheLieeTerminee(echSolde) || taskDone('solde'); break;
      case 'avis':       done = taskDone('avis'); break;
      case 'sav':        done = false; // jamais "done" (état terminal pour SAV en cours)
    }
    return { ...s, done };
  });

  // Étape "cur" = première étape NON done dans l'ordre du funnel.
  // Cas SAV : si chantier === 'SAV', on force cur sur SAV en plus.
  let curFound = false;
  return steps.map(s => {
    let state_;
    if (s.done) {
      state_ = 'done';
    } else if (!curFound) {
      state_ = 'cur';
      curFound = true;
    } else {
      state_ = 'pending';
    }
    // SAV : override si chantier=SAV
    if (s.key === 'sav' && chantier === 'SAV') state_ = 'cur';
    return { key: s.key, label: s.label, icon: s.icon, state: state_ };
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
  const archId = (pf.Architecte || [])[0];
  const archName = archId ? ((state.clients || []).find(c => c.id === archId)?.Nom || '') : '';
  const stepper = computeParcours(projet, taches, devis, commandes, echeances);

  // L'endpoint /api/projets/:id renvoie TOUS les artisans de la base (utile pour le mapping ID → nom
  // depuis devisArtisans.Artisan[0]). Pour la section "Artisans affectés", on filtre par projet.Artisans.
  const projetArtisanIds = Array.isArray(pf.Artisans) ? pf.Artisans : [];
  const artisans = allArtisans.filter(a => projetArtisanIds.includes(a.id));

  // Bilan financier
  // P-A (2026-06-24) — CA HT = prévisionnel saisi (Budget HT) tant qu'aucun devis n'est signé,
  // puis bascule sur le RÉEL (somme des « Total HT final » des devis signés : principal + additifs).
  // On n'écrase plus le prévi : la bascule est calculée à l'affichage. Si un projet est signé mais
  // sans total réel exploitable (devis sans montant), on retombe sur le prévi (évite un CA à 0).
  const budgetPrevi = pf['Budget HT'] || 0;
  const devisSignes = devis.filter(d => d.fields?.['Statut'] === 'Signé');
  const caReel = devisSignes.reduce((s, d) => s + (d.fields?.['Total HT final'] || 0), 0);
  const caEstReel = devisSignes.length > 0 && caReel > 0;
  const caHT = caEstReel ? caReel : budgetPrevi;

  // P1a — le coût fournisseurs = montant RÉEL confirmé par l'AR de commande.
  // Une commande sans AR reçu compte 0 (« 0 strict » validé par JMG) : la marge
  // n'intègre que du réel confirmé. Le « Montant HT » reste l'estimé devis, affiché
  // en sous-texte tant que des AR manquent (cf. card Fournisseurs).
  const coutFourn = commandes.reduce((s, c) => s + (c.fields?.['Montant AR'] || 0), 0);
  const coutFournEstime = commandes.reduce((s, c) => s + (c.fields?.['Montant HT'] || 0), 0);
  const arManquants = commandes.filter(c => !(c.fields?.['Montant AR'] > 0)).length;

  // P-B (2026-06-24) — dédoublonnage des devis artisans : un même devis (même n° + même montant)
  // a parfois été importé plusieurs fois. On déduplique avant de sommer pour ne pas gonfler la card
  // Artisans. Les numéros vides ou « AUTO-… » (sans n° réel) ne sont jamais dédupliqués entre eux.
  const _daSeen = new Set();
  const devisArtisansUniq = devisArtisans.filter(d => {
    const num = String(d.fields?.['Numéro devis'] || '').trim();
    const mt = d.fields?.['Montant HT'] || 0;
    const key = (!num || num.startsWith('AUTO-')) ? `id:${d.id}` : `${num}|${mt}`;
    if (_daSeen.has(key)) return false;
    _daSeen.add(key);
    return true;
  });
  // Rétro-commission 9·58 : 5% du montant total de TOUS les devis artisans (aligné sur
  // l'import, qui stocke déjà 'Rétro-commission HT' = 5% pour chaque devis). Plus de
  // filtre « contractuel » — le 5% s'applique à tous les devis artisans.
  const retro = devisArtisansUniq.reduce((s, d) => s + (d.fields?.['Rétro-commission HT'] || (d.fields?.['Montant HT'] || 0) * 0.05), 0);
  // Modèle Tanguy : les devis artisans ne sont PAS un coût pour Tanguy (le client les
  // paie) — seule la rétro-commission 5% des artisans contractuels est un revenu.
  const margeAbs = caHT - coutFourn + retro;
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
          ${phase === 'Refus' ? `<span class="badge" style="background:var(--red-lo,#fde8e8);color:var(--red,#c0392b)" title="${pf['Note refus'] ? esc(pf['Note refus']) : 'Projet refusé'}">Refus${pf['Motif refus'] ? ' · ' + esc(pf['Motif refus']) : ''}</span>` : ''}
          ${chantier && chantier !== 'Archivé' ? `<span class="badge phase-haute" title="Statut chantier">${esc(chantier)}</span>` : ''}
          ${chantier === 'Archivé' ? `<span class="badge" title="Statut chantier">Archivé</span>` : ''}
          <button class="btn btn-ghost btn-sm" id="btn-edit-projet" aria-label="Éditer le projet">${icon('edit', 14)} Éditer</button>
          ${chantier === 'Archivé'
            ? `<button class="btn btn-ghost btn-sm" id="btn-unarchive" aria-label="Désarchiver">${icon('arrowLeft', 14)} Désarchiver</button>`
            : `<button class="btn btn-ghost btn-sm" id="btn-archive" aria-label="Archiver">${icon('archive', 14)} Archiver</button>`}
        </div>
      </div>
      ${(pf['Type de projet'] || archName) ? `<div class="projet-submeta muted" style="font-size:13px;margin-top:4px;display:flex;gap:16px;flex-wrap:wrap">
        ${pf['Type de projet'] ? `<span>${esc(pf['Type de projet'])}</span>` : ''}
        ${archName ? `<span>${icon('landmark', 12)} Architecte : ${esc(archName)}</span>` : ''}
      </div>` : ''}

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
        <div class="kpi-card"><div class="kpi-value">${euros(caHT)}</div><div class="kpi-label">CA HT <span class="muted" style="font-weight:400" title="${caEstReel ? 'Réel : somme des devis signés' : 'Prévisionnel saisi (aucun devis signé)'}">· ${caEstReel ? 'réel' : 'prévi'}</span></div></div>
        <div class="kpi-card"><div class="kpi-value">${euros(coutFourn)}</div><div class="kpi-label">Fournisseurs${arManquants > 0 && coutFournEstime > 0 ? ` <span class="muted" style="font-weight:400" title="${arManquants} commande(s) sans AR reçu — montant confirmé fournisseur manquant">· estimé ${euros(coutFournEstime)}</span>` : ''}</div></div>
        <div class="kpi-card"><div class="kpi-value">${euros(retro)}</div><div class="kpi-label">Rétro artisans 5%</div></div>
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

    <!-- Sprint v3.17 — Facturation client en pleine largeur (vs col droite étroite avant) -->
    ${renderFacturationSection(
      (() => {
        const dSigne = devis.find(d => d.fields?.Statut === 'Signé');
        if (!dSigne) return echeances;
        const ids = new Set(dSigne.fields?.['Échéances devis'] || []);
        return ids.size ? echeances.filter(e => ids.has(e.id)) : echeances;
      })(),
      taches, devis
    )}

    <!-- Grid 2 colonnes : opérationnel à gauche, références à droite -->
    <div class="projet-grid">
      <div class="projet-col projet-col-left">

        <!-- Tâches -->
        <section class="projet-section" aria-label="Tâches" data-section="taches">
          <div class="projet-section-header">
            <h2>Tâches <span class="count">(${taches.length})</span></h2>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" id="btn-dossier-chantier" title="Génère la checklist administrative avant démarrage chantier (plans signés, autorisations, acompte, assurances, accès, dossier technique)">${icon('folder', 14)} Dossier chantier</button>
              <button class="btn btn-primary btn-sm" id="btn-new-tache">${icon('plus', 14)} Nouvelle</button>
            </div>
          </div>
          ${taches.length === 0
            ? `<div class="compact-empty"><span>Aucune tâche</span></div>`
            : `<div class="taches-list">${taches.map(t => renderTacheRow(t)).join('')}</div>`}
        </section>

        <!-- Rendez-vous -->
        <section class="projet-section" aria-label="Agenda du projet" data-section="rdv">
          <div class="projet-section-header">
            <h2>Agenda du projet</h2>
            <button class="btn btn-primary btn-sm" id="btn-new-rdv">${icon('plus', 14)} Nouveau RDV</button>
          </div>
          <div id="rdv-container"><div class="compact-empty"><span>Chargement…</span></div></div>
        </section>

        <!-- Journal chantier (Sprint v3.8 — entrées supprimables individuellement) -->
        <section class="projet-section" aria-label="Journal chantier" data-section="journal">
          <div class="projet-section-header">
            <h2>Journal chantier</h2>
            <button class="btn btn-ghost btn-sm" id="btn-add-journal">${icon('plus', 14)} Entrée</button>
          </div>
          ${pf['Journal chantier']
            ? `<ul class="journal-list" role="list">${
                pf['Journal chantier']
                  .split('\n')
                  .map(l => l.trim())
                  .filter(l => l.length > 0)
                  .map(line => {
                    // Format attendu : "[YYYY-MM-DD HH:MM — Auteur] texte"
                    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
                    const meta = m ? m[1] : '';
                    const body = m ? m[2] : line;
                    return `
                      <li class="journal-entry">
                        ${meta ? `<div class="journal-entry-meta">${esc(meta)}</div>` : ''}
                        <div class="journal-entry-body">${esc(body)}</div>
                        <button class="btn-icon-danger journal-entry-del" data-action="del-journal" data-entry="${esc(line)}" aria-label="Supprimer cette entrée">${icon('trash', 12)}</button>
                      </li>`;
                  }).join('')
              }</ul>`
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
            <div style="display:flex;gap:6px">
              ${artisans.length > 0 ? `<button class="btn btn-ghost btn-sm" id="btn-planning-artisans" title="Génère un récap planning (dates + adresse chantier) à envoyer aux artisans par mail">${icon('calendar', 14)} Planning</button>` : ''}
              <button class="btn btn-primary btn-sm" id="btn-add-artisan">${icon('plus', 14)} Affecter</button>
            </div>
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
              const retroCom = df['Rétro-commission HT'] || montantHT * 0.05;
              return `
              <div class="card commande-card">
                <div class="commande-head">
                  <div><strong>${esc(aNom)}</strong>
                    ${isContractuel ? '<span class="badge phase-signe" style="margin-left:8px">Contractuel</span>' : ''}
                    <span class="badge" style="margin-left:6px">${esc(df.Statut || 'À valider')}</span>
                  </div>
                  <div style="text-align:right">
                    <div><strong>${euros(montantHT)}</strong> <span class="muted" style="font-size:11px">HT</span></div>
                    <div class="muted" style="font-size:12px">Rétro 5% : <strong>${euros(retroCom)}</strong></div>
                  </div>
                </div>
                ${df['Description travaux'] ? `<div class="muted" style="margin-top:4px;font-size:12px">${esc(String(df['Description travaux']).slice(0,150))}${df['Description travaux'].length > 150 ? '…' : ''}</div>` : ''}
                ${((df.Statut || 'À valider') === 'À valider' || state.isAdmin) ? `<div style="margin-top:8px;text-align:right;display:flex;gap:6px;justify-content:flex-end">
                  ${(df.Statut || 'À valider') === 'À valider' ? `<button class="btn btn-primary btn-sm" data-action="valider-devis-artisan" data-id="${esc(d.id)}">${icon('check', 14)} Valider</button>` : ''}
                  ${state.isAdmin ? `<button class="btn btn-ghost btn-sm" data-action="supprimer-devis-artisan" data-id="${esc(d.id)}" data-artisan="${esc(aNom)}" style="color:var(--accent)" title="Supprimer ce devis pour réimporter la version modifiée">${icon('trash', 14)} Supprimer</button>` : ''}
                </div>` : ''}
              </div>`;
            }).join('')}</div>`}
        </section>

      </div>
    </div>

    <!-- Documents (attachments) — Sprint v3.17 : sortie du grid 2 cols pour
         occuper toute la largeur disponible (4 cards de 200-300px au lieu
         de 150px étranglés dans la col droite) -->
    <section class="projet-section projet-section-full" aria-label="Documents" data-section="documents">
      <div class="projet-section-header">
        <h2>Documents</h2>
        <span class="muted" style="font-size:12px">Drag & drop ou clic « + » · Limite Airtable 5 MB par fichier</span>
      </div>
      <div class="attachments-grid">
        ${renderAttachmentsCard('Plan 3D', pf['Plan 3D'], projet.id)}
        ${renderAttachmentsCard('Plan technique', pf['Plan technique'], projet.id)}
        ${renderAttachmentsCard('Images', pf['Images'], projet.id)}
        ${renderAttachmentsCard('Documents projet', pf['Documents projet'], projet.id)}
      </div>
    </section>
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

  // Sprint v5 — checklist administrative avant démarrage chantier (Virginie)
  document.getElementById('btn-dossier-chantier')?.addEventListener('click', async () => {
    const ok = await confirmModal('Générer la checklist « Dossier chantier » (6 tâches assignées à Virginie, échéance pose − 30 j) ? Les tâches déjà présentes ne seront pas dupliquées.', { okLabel: 'Générer' });
    if (!ok) return;
    try {
      const r = await fetch(`/api/projets/${encodeURIComponent(projet.id)}/dossier-chantier`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || r.statusText);
      toast(j.creees ? `${j.creees} tâche${j.creees > 1 ? 's' : ''} dossier chantier créée${j.creees > 1 ? 's' : ''}` : 'Checklist déjà complète', 'success');
      renderProjet(document.getElementById('app'), projet.id);
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });

  // Sprint v3.2 — actions nouvelles
  document.getElementById('btn-import-devis')?.addEventListener('click', () => openModalImportDevis(projet, devis));
  document.getElementById('btn-add-artisan')?.addEventListener('click', () => openModalAddArtisan(projet, artisans));
  document.getElementById('btn-planning-artisans')?.addEventListener('click', () => openModalPlanningArtisans(projet, client, artisans));
  document.getElementById('btn-import-devis-artisan')?.addEventListener('click', () => openModalImportDevisArtisan(projet, artisans));
  document.getElementById('btn-new-plaud')?.addEventListener('click', () => openModalPlaud(projet, client));

  // Rendez-vous — bouton « Nouveau » + chargement async de la liste du projet
  document.getElementById('btn-new-rdv')?.addEventListener('click', () => openModalRdv({
    projetId: projet.id, clientId: client?.id,
    contextLabel: `Projet ${pf.Référence || ''}${client?.fields?.Nom ? ' · ' + client.fields.Nom : ''}`,
    onSaved: () => router(),
  }));
  (async () => {
    try {
      const all = await fetchRendezVous();
      const rdvs = all.filter(r => (r.fields?.Projet || []).includes(projet.id));
      const c = document.getElementById('rdv-container');
      if (c) { c.innerHTML = renderRdvList(rdvs); hydrateIcons(c); bindRdvList(c, rdvs, () => router()); }
    } catch (e) {
      const c = document.getElementById('rdv-container');
      if (c) c.innerHTML = `<div class="compact-empty"><span>Erreur chargement rendez-vous</span></div>`;
    }
  })();

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

  // ── P-D (2026-06-24) — acomptes paramétrables : édition montant + recalcul ──
  {
    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const dSigne = devis.find(d => d.fields?.Statut === 'Signé');
    const caTTC = dSigne?.fields?.['Total TTC'] || 0;
    const factEch = (() => {
      if (!dSigne) return echeances;
      const ids = new Set(dSigne.fields?.['Échéances devis'] || []);
      return ids.size ? echeances.filter(e => ids.has(e.id)) : echeances;
    })();
    const ordered = factEch.slice().sort((a, b) => (a.fields?.Ordre || 0) - (b.fields?.Ordre || 0));
    const acompteEch = ordered.find(e => /acompte|commande|signat/i.test(e.fields?.['Libellé'] || '')) || ordered[0];
    const soldeEch = [...ordered].reverse().find(e => /solde|fin de pose|r[ée]ception/i.test(e.fields?.['Libellé'] || '')) || ordered[ordered.length - 1];
    const encaisse = e => e?.fields?.Statut === 'Encaissé';

    // Édition libre du montant d'une échéance
    app.querySelectorAll('[data-action="edit-echeance"]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        openModalEditEcheance(btn.dataset.echeance, Number(btn.dataset.montant) || 0);
      });
    });

    // Acompte 30 % du TTC + rééquilibrage du solde
    const btn30 = app.querySelector('[data-action="acompte-30"]');
    if (btn30) btn30.addEventListener('click', async () => {
      if (!acompteEch || !soldeEch || acompteEch.id === soldeEch.id) { toast('Il faut au moins 2 échéances distinctes', 'error'); return; }
      if (encaisse(acompteEch) || encaisse(soldeEch)) { toast('Acompte ou solde déjà encaissé — modification bloquée', 'error', 5000); return; }
      const newAcompte = round2(0.30 * caTTC);
      const others = ordered.filter(e => e.id !== acompteEch.id && e.id !== soldeEch.id).reduce((s, e) => s + (e.fields?.['Montant prévu'] || 0), 0);
      const newSolde = round2(caTTC - newAcompte - others);
      if (newSolde < 0) { toast('30 % dépasse le total restant', 'error'); return; }
      const ok = await confirmModal(`Poser l'acompte « ${esc(acompteEch.fields?.['Libellé'] || '?')} » à ${euros(newAcompte)} (30 %) et le solde « ${esc(soldeEch.fields?.['Libellé'] || '?')} » à ${euros(newSolde)} ?`, { okLabel: 'Appliquer' });
      if (!ok) return;
      try {
        await patchEcheance(acompteEch.id, { 'Montant prévu': newAcompte });
        await patchEcheance(soldeEch.id, { 'Montant prévu': newSolde });
        toast('Acompte 30 % appliqué', 'success');
        router();
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    });

    // Rééquilibrer le solde = total devis − somme des autres échéances
    const btnReq = app.querySelector('[data-action="reequilibrer-solde"]');
    if (btnReq) btnReq.addEventListener('click', async () => {
      if (!soldeEch) { toast('Aucune échéance de solde', 'error'); return; }
      if (encaisse(soldeEch)) { toast('Solde déjà encaissé — modification bloquée', 'error', 5000); return; }
      const others = ordered.filter(e => e.id !== soldeEch.id).reduce((s, e) => s + (e.fields?.['Montant prévu'] || 0), 0);
      const newSolde = round2(caTTC - others);
      if (newSolde < 0) { toast('Les autres échéances dépassent déjà le total', 'error'); return; }
      const ok = await confirmModal(`Ajuster le solde « ${esc(soldeEch.fields?.['Libellé'] || '?')} » à ${euros(newSolde)} pour retomber sur le total du devis ?`, { okLabel: 'Ajuster' });
      if (!ok) return;
      try {
        await patchEcheance(soldeEch.id, { 'Montant prévu': newSolde });
        toast('Solde rééquilibré', 'success');
        router();
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    });
  }

  // Sprint v3.8 — Suppression d'une entrée journal individuelle
  app.querySelectorAll('[data-action="del-journal"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const entry = btn.dataset.entry;
      const preview = entry.length > 80 ? entry.slice(0, 80) + '…' : entry;
      const ok = await confirmModal(`Supprimer cette entrée du journal ?\n\n${preview}`, { okLabel: 'Supprimer', danger: true });
      if (!ok) return;
      try {
        await deleteJournalEntry(projet.id, entry);
        toast('Entrée supprimée', 'success');
        router();
      } catch (err) {
        toast('Erreur : ' + err.message, 'error', 5000);
      }
    });
  });

  // Sprint v3.6 — Marquer encaissée (action manuelle quand le client a payé)
  app.querySelectorAll('[data-action="encaisser"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      openModalEncaisser(btn.dataset.echeance);
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

  // Devis artisan : bouton « Valider » (passe le statut « À valider » → « Validé »)
  app.querySelectorAll('[data-action="valider-devis-artisan"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const id = btn.dataset.id;
      const da = devisArtisans.find(x => x.id === id);
      const num = da?.fields?.['Numéro devis'] || '';
      const ok = await confirmModal(`Valider le devis artisan ${num} ?`.replace('  ', ' '), { okLabel: 'Valider', danger: false });
      if (!ok) return;
      btn.disabled = true;
      btn.innerHTML = 'Validation…';
      try {
        await patchDevisArtisan(id, { 'Statut': 'Validé' });
        toast('Devis artisan validé', 'success');
        router();
      } catch (err) {
        toast('Erreur validation : ' + err.message, 'error', 5000);
        btn.disabled = false;
        btn.innerHTML = `${icon('check', 14)} Valider`;
      }
    });
  });

  // Devis artisan : bouton « Supprimer » (admin) — pour réimporter une version modifiée.
  app.querySelectorAll('[data-action="supprimer-devis-artisan"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const id = btn.dataset.id;
      const nom = btn.dataset.artisan || 'cet artisan';
      const ok = await confirmModal(`Supprimer le devis artisan de ${nom} ? Vous pourrez réimporter la version modifiée juste après.`, { okLabel: 'Supprimer', danger: true });
      if (!ok) return;
      btn.disabled = true;
      btn.innerHTML = 'Suppression…';
      try {
        await deleteDevisArtisan(id);
        toast('Devis artisan supprimé — réimportez le nouveau PDF', 'success', 4000);
        router();
      } catch (err) {
        toast('Erreur suppression : ' + err.message, 'error', 5000);
        btn.disabled = false;
        btn.innerHTML = `${icon('trash', 14)} Supprimer`;
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
        ${(attachments || []).map(a => {
          const fname = fixMojibake(a.filename || '');
          return `<li class="attachment-file" data-id="${esc(a.id)}">
            <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(fname)}</a>
            <button class="attachment-del" data-action="delete" data-attachment="${esc(a.id)}" aria-label="Supprimer ${esc(fname)}">${icon('trash', 12)}</button>
          </li>`;
        }).join('')}
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

// Chantier fichiers volumineux (2026-07) : plafond 100 Mo (relais Scaleway côté
// serveur au-delà de 5 Mo). En cas de refus, on affiche le message JSON du
// serveur (taille, limite, consigne SwissTransfer) — plus d'échec générique.
const UPLOAD_MAX_MO = 100;
let uploadEnCours = false;

async function doUpload(file, field, projetId) {
  const sizeMo = file.size / 1024 / 1024;
  const sizeLabel = sizeMo.toFixed(1).replace('.', ',');
  if (sizeMo > UPLOAD_MAX_MO) {
    toast(`${file.name} fait ${sizeLabel} Mo — la limite est de ${UPLOAD_MAX_MO} Mo. Envoyez-le à jmg@958.fr via SwissTransfer.`, 'error', 8000);
    return;
  }
  if (uploadEnCours) {
    toast('Un envoi est déjà en cours — patiente quelques secondes.', 'info', 3000);
    return;
  }

  // État visuel pendant l'upload (un fichier de 100 Mo peut prendre ~1 min).
  const card = document.querySelector(`.attachment-card[data-field="${CSS.escape(field)}"]`);
  const drop = card?.querySelector('[data-action="drop"]');
  const dropText = drop?.textContent;
  const gros = sizeMo > 5;
  if (drop) {
    drop.classList.add('is-uploading');
    drop.innerHTML = `<span class="upload-spinner" aria-hidden="true"></span> Envoi de ${esc(file.name)} (${sizeLabel} Mo)…`;
  }
  toast(`Envoi de ${file.name} (${sizeLabel} Mo)…${gros ? ' Fichier volumineux : cela peut prendre une minute, ne ferme pas la page.' : ''}`, 'info', gros ? 8000 : 3000);

  uploadEnCours = true;
  try {
    await uploadAttachment(projetId, field, file);
    toast(`${file.name} ajouté à ${field}`, 'success');
    router();
  } catch (err) {
    // err.message = message JSON du serveur (taille, limite, consigne) si dispo.
    toast(err.message || 'Erreur pendant l’envoi du fichier.', 'error', 9000);
  } finally {
    uploadEnCours = false;
    if (drop) {
      drop.classList.remove('is-uploading');
      drop.textContent = dropText;
    }
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
  const architectes = (state.clients || []).filter(c => c.Type === 'Architecte');
  const archSel = (p.Architecte || [])[0] || '';
  const { modal, close } = modalShell('Éditer projet', `
    <form id="form-edit-projet">
      <label>Référence <input name="Référence" value="${esc(p.Référence || '')}" required></label>
      <label>Phase commerciale
        <select name="Phase commerciale">
          ${['Découverte','Dessin','Présentation devis','En attente décision','Signé','Refus'].map(v => `<option ${p['Phase commerciale'] === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Statut chantier
        <select name="Statut chantier">
          <option value="">—</option>
          ${['Pré-pose','Pose en cours','Terminé','SAV','Archivé'].map(v => `<option ${p['Statut chantier'] === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Type de projet
        <select name="Type de projet">
          <option value="">—</option>
          ${['Construction neuve','Rénovation','Extension','Aménagement','Autre'].map(v => `<option ${p['Type de projet'] === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <label>Architecte
        <select name="Architecte">
          <option value="">— Aucun —</option>
          ${architectes.map(a => `<option value="${esc(a.id)}" ${archSel === a.id ? 'selected' : ''}>${esc(a.Nom || '(sans nom)')}</option>`).join('')}
          <option value="__new__">＋ Créer un architecte…</option>
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
      if (k === 'Architecte') continue; // champ lien — traité à part (peut créer un architecte)
      if (v === '' && k !== 'Statut chantier') continue;
      fields[k] = k === 'Budget HT' ? Number(v) : v;
    }
    // Architecte = champ lien Airtable (tableau d'ids). « __new__ » = créer un client Architecte à la volée.
    let archVal = fd.get('Architecte');
    if (archVal === '__new__') {
      const nom = (prompt("Nom de l'architecte à créer :") || '').trim();
      if (nom) {
        try {
          const created = await createClient({ Nom: nom, Type: 'Architecte' });
          archVal = created.id;
          if (state.clients) state.clients.push({ id: created.id, Nom: nom, Type: 'Architecte' });
        } catch (err) { toast('Erreur création architecte : ' + err.message, 'error', 5000); return; }
      } else {
        archVal = null; // annulé → on ne touche pas à l'architecte
      }
    }
    if (archVal !== null) fields['Architecte'] = archVal ? [archVal] : [];
    try { await patchProjet(projet.id, fields); close(); toast('Projet enregistré', 'success'); router(); }
    catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

function openModalTache(tache, projet, client) {
  const t = tache?.fields || {};
  const clientNom = client?.fields?.Nom || '';
  // P-G (2026-06-24) — préfixe auto « [Client · Projet] / » pour savoir d'office de quel
  // client/projet relève la tâche (demande JMG : le nom du projet client devant).
  const projetRef = projet?.fields?.['Référence'] || '';
  const autoPrefix = (clientNom && projetRef) ? `${clientNom} · ${projetRef}` : (clientNom || projetRef);
  const isNew = !tache;
  const { modal, close } = modalShell(isNew ? 'Nouvelle tâche' : 'Éditer tâche', `
    <form id="form-tache">
      <label>Titre
        <input name="Titre" value="${esc(t.Titre || '')}" required placeholder="${autoPrefix ? '[' + esc(autoPrefix) + '] / ' : ''}…">
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
    // Préfixe auto « [Client · Projet] » si Titre nu (et création seule)
    if (isNew && autoPrefix && fields.Titre && !fields.Titre.includes('[')) {
      fields.Titre = `[${autoPrefix}] / ${fields.Titre}`;
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

// Sprint v5.x — Planning chantier envoyable aux artisans (mailto souverain, pas de SMTP).
// Même esprit que le récap commande fournisseur : on construit un récap lisible
// (référence, dates de pose, adresse du chantier, liste des artisans), on l'affiche
// dans une modale « à valider avant envoi », puis on ouvre un mailto pré-rempli
// vers les artisans qui ont un email. Lecture seule des données ; journalisation
// optionnelle dans le Journal chantier après envoi. Aucune écriture Airtable requise.
function fmtDateFr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function buildPlanningRecap(projet, client, artisans) {
  const pf = projet.fields || {};
  const cf = client?.fields || {};
  const ref = pf['Référence'] || '(sans référence)';
  const debut = fmtDateFr(pf['Date pose prévue']);
  const fin = fmtDateFr(pf['Date pose fin']);

  let datesLine;
  if (debut && fin && debut !== fin) datesLine = `Du ${debut} au ${fin}`;
  else if (debut) datesLine = `Le ${debut}`;
  else datesLine = 'Dates à confirmer';

  // Adresse du chantier = adresse du client lié
  const adresseParts = [];
  if (cf['Adresse']) adresseParts.push(String(cf['Adresse']).trim());
  const cpVille = [cf['CP'], cf['Ville']].filter(Boolean).join(' ');
  if (cpVille) adresseParts.push(cpVille);
  const adresse = adresseParts.length ? adresseParts.join(', ') : 'Adresse à préciser';

  const lines = [];
  lines.push('Bonjour,');
  lines.push('');
  lines.push(`Voici le planning d'intervention pour le chantier ${ref}.`);
  lines.push('');
  lines.push(`Référence chantier : ${ref}`);
  lines.push(`Dates de pose : ${datesLine}`);
  if (pf['Statut chantier']) lines.push(`Statut chantier : ${pf['Statut chantier']}`);
  lines.push('');
  lines.push('Adresse du chantier :');
  lines.push(adresse);
  if (cf['Nom']) lines.push(`Client : ${cf['Nom']}`);
  if (cf['Téléphone']) lines.push(`Téléphone client : ${cf['Téléphone']}`);
  lines.push('');
  lines.push('Artisans intervenant sur le chantier :');
  artisans.forEach(a => {
    const af = a.fields || {};
    const spec = af['Spécialité'] ? ` — ${af['Spécialité']}` : '';
    lines.push(`- ${af['Nom'] || '(sans nom)'}${spec}`);
  });
  lines.push('');
  lines.push('Merci de me confirmer votre disponibilité sur ces dates.');
  lines.push('Cordialement,');
  lines.push('Tanguy Design');

  return lines.join('\n');
}

function openModalPlanningArtisans(projet, client, artisans) {
  const pf = projet.fields || {};
  const ref = pf['Référence'] || '';

  // Artisans avec email (destinataires) vs sans email (à contacter manuellement)
  const withEmail = artisans.filter(a => a.fields?.Email);
  const noEmail = artisans.filter(a => !a.fields?.Email);
  const recap = buildPlanningRecap(projet, client, artisans);

  const recipientsLabel = withEmail.length
    ? withEmail.map(a => esc(a.fields?.Email)).join(', ')
    : '<span class="muted">Aucun artisan assigné n\'a d\'email renseigné</span>';

  const { modal, close } = modalShell('Planning chantier — à valider avant envoi', `
    <div class="planning-recap">
      <div class="muted" style="font-size:13px;margin-bottom:10px">${icon('mail', 14)} Destinataires : ${recipientsLabel}</div>
      ${noEmail.length ? `<div class="alert" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:10px">
        ${icon('users', 14)} À contacter manuellement (pas d'email renseigné) : ${noEmail.map(a => esc(a.fields?.Nom || 'artisan')).join(', ')}
      </div>` : ''}
      <pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:0;max-height:45vh;overflow:auto">${esc(recap)}</pre>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="planning-cancel">Annuler</button>
        <button type="button" class="btn btn-primary" id="planning-send" ${withEmail.length ? '' : 'disabled'}>${icon('mail', 14)} Préparer le mail</button>
      </div>
    </div>
  `);
  hydrateIcons(modal);
  modal.querySelector('#planning-cancel').onclick = close;

  modal.querySelector('#planning-send')?.addEventListener('click', () => {
    close();
    const emails = withEmail.map(a => a.fields.Email).join(',');
    const subject = `Planning chantier — ${ref}`;
    const mailto = `mailto:${encodeURIComponent(emails)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(recap)}`;

    // Fallback presse-papier si le mailto dépasse la limite navigateur (~8000),
    // même garde que l'envoi commande fournisseur.
    if (mailto.length > 8000) {
      navigator.clipboard?.writeText(recap).then(() => {
        toast('Planning trop long pour le mail : contenu copié dans le presse-papier', 'info', 6000);
        window.location.href = `mailto:${encodeURIComponent(emails)}?subject=${encodeURIComponent(subject)}`;
      });
    } else {
      toast('Mail planning prêt — vérifie les destinataires avant envoi', 'info', 6000);
      window.location.href = mailto;
    }

    // Journalisation optionnelle (best-effort, n'interrompt pas l'envoi).
    const noms = withEmail.map(a => a.fields?.Nom || 'artisan').join(', ');
    appendJournalEntry(projet.id, `Planning chantier envoyé aux artisans : ${noms}`)
      .catch(() => { /* silencieux : la journalisation est secondaire */ });
  });
}

// Sprint v3.6 (refondu) — Section Facturation client : cards horizontales, mobile-first, a11y.
// 4 états visuels :
//   À encaisser : neutre, bouton "Créer tâche"
//   Tâche créée : ambre/info, attente Virginie
//   Envoyé      : jaune, tâche terminée mais pas encore payée, bouton "Marquer encaissée"
//   Encaissé    : vert, paiement reçu
function renderFacturationSection(echeances, taches, devis) {
  const devisSigne = devis.find(d => d.fields?.Statut === 'Signé');
  const caHT = devisSigne?.fields?.['Total HT final']
    || devisSigne?.fields?.['Total HT après remise']
    || devisSigne?.fields?.['Total HT articles']
    || 0;
  const caTTC = devisSigne?.fields?.['Total TTC'] || 0;

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

  const totalPrevu = ordered.reduce((s, e) => s + (e.fields?.['Montant prévu'] || 0), 0);

  return `
    <section class="facturation-card-block" aria-label="Facturation client" data-section="facturation">
      <header class="facturation-header">
        <h3><span aria-hidden="true">${icon('mail', 14)}</span> <span>Facturation client</span></h3>
        ${caHT > 0 || caTTC > 0 ? `<div class="facturation-ca">${caHT > 0 ? 'HT <strong>' + euros(caHT) + '</strong>' : ''}${caTTC > 0 ? ` · TTC <strong>${euros(caTTC)}</strong>` : ''}</div>` : ''}
      </header>
      ${ordered.length >= 2 && caTTC > 0 ? `
      <div class="facturation-tools" style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px">
        <button class="btn btn-ghost btn-sm" data-action="acompte-30" title="Pose l'acompte à 30 % du total TTC et ajuste le solde">Acompte 30 %</button>
        <button class="btn btn-ghost btn-sm" data-action="reequilibrer-solde" title="Ajuste le solde pour que le total des échéances = total du devis">${icon('check', 12)} Rééquilibrer le solde</button>
      </div>` : ''}
      <ul class="facturation-grid" role="list">
        ${ordered.map(e => {
          const ef = e.fields || {};
          const isEncaisse = ef.Statut === 'Encaissé';
          const tacheLiee = taches.find(t => (t.fields?.Description || '').includes(`[echeance:${e.id}]`));
          const tacheTerminee = tacheLiee && tacheLiee.fields?.Statut === 'Terminée';
          const tacheEnCours = tacheLiee && tacheLiee.fields?.Statut !== 'Terminée';
          // Le champ Airtable "Montant prévu" stocke le TTC (le client paie TTC).
          // Le pourcentage est relatif au total TTC des échéances pour totaliser 100%.
          const montantTTC = ef['Montant prévu'] || 0;
          const pct = totalPrevu > 0 ? Math.round((montantTTC / totalPrevu) * 100) : null;

          let stateCls, badge, meta, action = '';
          if (isEncaisse) {
            stateCls = 'is-encaisse';
            badge = `<span class="facturation-badge fb-encaisse">${icon('check', 11)} Encaissée</span>`;
            meta = ef['Date règlement'] ? `Réglée le ${esc(ef['Date règlement'])}` : 'Encaissée';
          } else if (tacheTerminee) {
            stateCls = 'is-envoye';
            badge = `<span class="facturation-badge fb-envoye">${icon('mail', 11)} Envoyée</span>`;
            meta = 'Facture envoyée au client';
            action = `<button class="btn btn-primary btn-sm facturation-action" data-action="encaisser" data-echeance="${esc(e.id)}">${icon('check', 12)} Marquer encaissée</button>`;
          } else if (tacheEnCours) {
            stateCls = 'is-tache';
            badge = `<span class="facturation-badge fb-tache">${icon('clock', 11)} Tâche en cours</span>`;
            meta = `${esc(tacheLiee.fields?.['Assignée à'] || 'Virginie')}${tacheLiee.fields?.Échéance ? ' · ' + esc(tacheLiee.fields.Échéance) : ''}`;
          } else {
            stateCls = 'is-pending';
            badge = `<span class="facturation-badge fb-pending">À encaisser</span>`;
            meta = ef['Date prévue'] ? `Prévue le ${esc(ef['Date prévue'])}` : '';
            action = `<button class="btn btn-primary btn-sm facturation-action" data-action="facturer" data-echeance="${esc(e.id)}">${icon('plus', 12)} Créer la tâche pour Virginie</button>`;
          }

          return `
            <li class="facturation-item ${stateCls}" data-echeance-id="${esc(e.id)}">
              <div class="facturation-item-top">
                <div class="facturation-item-label">${icon('file', 12)} ${esc(ef['Libellé'] || '?')}</div>
                ${badge}
              </div>
              <div class="facturation-item-amount">
                <span class="facturation-amount-value">${euros(montantTTC)}</span>
                <span class="facturation-amount-unit">TTC${pct != null ? ' · ' + pct + ' %' : ''}</span>
                ${!isEncaisse ? `<button class="btn btn-ghost btn-sm" data-action="edit-echeance" data-echeance="${esc(e.id)}" data-montant="${montantTTC}" title="Modifier le montant" style="padding:2px 6px;margin-left:6px">${icon('pencil', 12)}</button>` : ''}
              </div>
              ${meta ? `<div class="facturation-item-meta">${meta}</div>` : ''}
              ${action}
            </li>`;
        }).join('')}
      </ul>
      ${caTTC > 0 ? (() => {
        const ecart = Math.round((totalPrevu - caTTC) * 100) / 100;
        const ok = Math.abs(ecart) < 1;
        return `<div class="facturation-total muted" style="font-size:13px;margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <span>Total échéances : <strong>${euros(totalPrevu)}</strong> / Devis ${euros(caTTC)} TTC</span>
          <span style="color:${ok ? 'var(--green,#2e7d32)' : 'var(--red,#c0392b)'}">${ok ? '✓ équilibré' : '· écart ' + euros(ecart)}</span>
        </div>`;
      })() : ''}
    </section>`;
}

// P-D — modale d'édition du montant d'une échéance (acompte ou autre).
function openModalEditEcheance(echeanceId, currentMontant) {
  const { modal, close } = modalShell('Modifier le montant', `
    <form id="form-edit-echeance">
      <label>Montant TTC (€)
        <input name="montant" type="number" step="0.01" min="0" value="${currentMontant}" required autofocus>
      </label>
      <p class="muted" style="font-size:13px">Après avoir changé l'acompte, clique « Rééquilibrer le solde » pour que le total des échéances retombe sur le devis.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);
  modal.querySelector('[data-cancel]').onclick = close;
  modal.querySelector('#form-edit-echeance').addEventListener('submit', async e => {
    e.preventDefault();
    const val = Math.round((Number(new FormData(e.target).get('montant')) || 0) * 100) / 100;
    try {
      await patchEcheance(echeanceId, { 'Montant prévu': val });
      close();
      toast('Montant mis à jour', 'success');
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
      <p class="muted" style="font-size:12px">L'analyse du PDF prend 1 à 2 minutes. Tu peux fermer sans risque : l'import se termine tout seul, et réimporter le même fichier ne crée jamais de doublon.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Importer</button>
      </div>
    </form>
  `);
  const cancelBtn = document.getElementById('cancel');
  cancelBtn.onclick = close;
  let submitting = false; // garde anti double-envoi
  document.getElementById('form-import-devis').addEventListener('submit', async e => {
    e.preventDefault();
    if (submitting) return;
    const fd = new FormData(e.target);
    const file = fd.get('pdf');
    const type = fd.get('type');
    if (!file || file.size === 0) return;
    submitting = true;
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;

    // Compteur de temps écoulé (le parsing prend 1-3 min selon la taille du PDF).
    // On NE coupe PAS la requête à la fermeture : l'anti-doublon serveur rend
    // l'annulation/relance sans danger, donc « Fermer » laisse l'import se terminer.
    const startTime = Date.now();
    const update = () => {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const min = Math.floor(sec / 60);
      const remSec = sec % 60;
      btn.innerHTML = `Analyse… ${min > 0 ? min + 'min ' : ''}${remSec}s`;
    };
    const interval = setInterval(update, 1000);
    update();
    // Le bouton « Annuler » devient « Fermer » : ferme la fenêtre mais l'import continue.
    cancelBtn.innerHTML = 'Fermer';
    cancelBtn.onclick = () => {
      toast('Import en cours en arrière-plan, tu peux continuer. Ne réimporte pas ce devis.', 'info', 6000);
      close();
    };

    try {
      const result = await importDevisClient({ file, projetId: projet.id, type });
      clearInterval(interval);
      if (result.deduplicated) {
        toast('Ce devis avait déjà été importé — doublon évité', 'info', 6000);
      } else {
        toast(`Devis ${type} importé`, 'success', 5000);
      }
      close();
      router();
    } catch (err) {
      clearInterval(interval);
      toast('Erreur import : ' + err.message, 'error', 8000);
      submitting = false;
      btn.disabled = false;
      btn.innerHTML = 'Importer';
      cancelBtn.innerHTML = 'Annuler';
      cancelBtn.onclick = close;
    }
  });
}

// Affecter un artisan : sélection depuis liste complète (hors déjà affectés).
// #7 — Modale d'encaissement : choisir le mode de règlement (Virement/Chèque/Espèces/CB).
function openModalEncaisser(echeanceId) {
  const { modal, close } = modalShell('Marquer la facture encaissée', `
    <form id="form-encaisser">
      <p class="muted" style="margin-top:0">Confirme le règlement reçu et son mode.</p>
      <label>Mode de règlement
        <select name="mode" required>
          <option value="Virement">Virement</option>
          <option value="Chèque">Chèque</option>
          <option value="Espèces">Espèces</option>
          <option value="CB">CB</option>
        </select>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="enc-cancel">Annuler</button>
        <button type="submit" class="btn btn-primary">Marquer encaissée</button>
      </div>
    </form>
  `);
  document.getElementById('enc-cancel').onclick = close;
  document.getElementById('form-encaisser').addEventListener('submit', async e => {
    e.preventDefault();
    const mode = new FormData(e.target).get('mode');
    try {
      await marquerEncaisse(echeanceId, mode);
      close();
      toast(`Facture encaissée (${mode})`, 'success');
      router();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

async function openModalAddArtisan(projet, artisansCourants) {
  const { modal, close } = modalShell('Affecter un artisan', `
    <form id="form-add-artisan">
      <p class="muted" style="margin-top:0">Choisis l'artisan à rattacher au projet. Une fois rattaché, il pourra envoyer son devis (rétro 5% auto sur les contractuels).</p>
      <div id="artisans-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:8px">
        <p class="muted">Chargement…</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="btn-new-artisan" style="margin-top:8px">${icon('plus', 12)} Nouvel artisan</button>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary" id="submit-btn" disabled>Affecter</button>
      </div>
    </form>
  `);
  document.getElementById('cancel').onclick = close;

  // #3 — Créer un artisan à la volée puis l'affecter directement au projet.
  document.getElementById('btn-new-artisan')?.addEventListener('click', async () => {
    const nom = (prompt("Nom du nouvel artisan / entreprise :") || '').trim();
    if (!nom) return;
    try {
      const created = await createArtisan({ Nom: nom });
      const newId = created.record?.id || created.id;
      await setProjetArtisans(projet.id, [...artisansCourants.map(a => a.id), newId]);
      close();
      toast(`Artisan « ${nom} » créé et affecté`, 'success');
      router();
    } catch (err) { toast('Erreur création artisan : ' + err.message, 'error', 5000); }
  });

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
