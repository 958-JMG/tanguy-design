// Vue Devis Tanguy v3 (Sprint v3.3) — détail complet d'un devis.
// Affiche : breadcrumb · header (numéro/type/statut/date/total) · actions (éditer/re-importer/signer)
// · tableau lignes groupé par zone · tableau échéances.

import { state } from '../core/state.js';
import { router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import {
  fetchDevisDetail, patchDevis, signDevisTanguy, importDevisClient,
  pushDevisToPennylane, pennylanePdfUrl,
  pushEcheancesFactures, echeancePdfUrl,
} from '../core/api.js';
import { toast, confirmModal } from '../core/ui.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function eurosPrecis(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export async function renderDevis(app, devisId) {
  app.innerHTML = `<div class="loading">Chargement du devis…</div>`;
  try {
    const data = await fetchDevisDetail(devisId);
    renderFiche(app, data);
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Erreur</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

function renderFiche(app, data) {
  const { devis, zones, lignes, echeances } = data;
  const f = devis.fields || {};
  const numero = f['Numéro devis'] || '?';
  const statut = f.Statut || 'Brouillon';
  const isSigned = statut === 'Signé';
  const type = f['Type devis'] || 'Principal';
  const plQuote = f['Pennylane quote ID'];

  // Resolve projet + client depuis state (déjà chargé via navigation)
  const projetId = (f.Projet || [])[0];
  const clientId = (f.Client || [])[0];
  const projet = projetId ? (state.projets || []).find(p => p.id === projetId) : null;
  const client = clientId ? (state.clients || []).find(c => c.id === clientId) : null;

  // Groupe les lignes par zone
  const lignesByZoneId = new Map();
  const lignesHorsZone = [];
  for (const l of lignes) {
    const zoneIds = l.fields?.Zone || [];
    if (zoneIds[0]) {
      const arr = lignesByZoneId.get(zoneIds[0]) || [];
      arr.push(l);
      lignesByZoneId.set(zoneIds[0], arr);
    } else {
      lignesHorsZone.push(l);
    }
  }

  app.innerHTML = `
    <nav class="breadcrumb" aria-label="Fil d'Ariane">
      <a href="#clients">Clients</a> &rsaquo;
      ${client ? `<a href="#clients/${encodeURIComponent(client.id)}">${esc(client.fields?.Nom || client.Nom)}</a> &rsaquo;` : ''}
      ${projet ? `<a href="#projet/${encodeURIComponent(projet.id)}">${esc(projet.fields?.Référence || projet.Référence)}</a> &rsaquo;` : ''}
      <strong>Devis ${esc(numero)}</strong>
    </nav>

    <div class="client-header">
      <div class="client-header-left">
        <div class="client-header-icon">${icon('file', 32)}</div>
        <div>
          <h1 class="page-title" style="margin:0;font-size:24px">Devis ${esc(numero)}</h1>
          <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span class="badge">${esc(type)}</span>
            <span class="badge ${isSigned ? 'phase-signe' : ''}">${esc(statut)}</span>
            ${f['Date devis'] ? `<span class="muted" style="font-size:13px">Daté du ${esc(f['Date devis'])}</span>` : ''}
            ${f["Valable jusqu'au"] ? `<span class="muted" style="font-size:13px">· Valable jusqu'au ${esc(f["Valable jusqu'au"])}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="btn-edit-devis">${icon('edit', 14)} Éditer</button>
        <button class="btn btn-ghost btn-sm" id="btn-reimport-devis">${icon('plus', 14)} Re-importer PDF</button>
        ${plQuote
          ? `<a class="btn btn-ghost btn-sm" href="${esc(pennylanePdfUrl(devis.id))}">${icon('download', 14)} Télécharger PDF</a>
             <a class="btn btn-ghost btn-sm" href="https://app.pennylane.com" target="_blank" rel="noopener">${icon('external-link', 14)} Ouvrir dans Pennylane</a>`
          : `<button class="btn btn-ghost btn-sm" id="btn-pennylane">${icon('file-text', 14)} Générer le brouillon Pennylane</button>`}
        ${echeances.length ? `<button class="btn btn-ghost btn-sm" id="btn-pennylane-echeances">${icon('file-text', 14)} Factures d'échéance (brouillon)</button>` : ''}
        ${!isSigned ? `<button class="btn btn-primary btn-sm" id="btn-sign-devis">${icon('check', 14)} Signer ce devis</button>` : ''}
      </div>
    </div>

    ${plQuote ? `<div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:8px">
      ${icon('check-circle', 16)}<span>Brouillon dans Pennylane${f['Pennylane numéro'] ? ` · ${esc(f['Pennylane numéro'])}` : ''}. Virginie l'envoie depuis Pennylane ou télécharge le PDF pour l'envoyer depuis sa boîte mail.</span>
    </div>` : ''}

    <!-- Totaux KPIs -->
    <div class="kpi-row" style="margin-bottom:24px;display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      <div class="kpi-card"><div class="kpi-value">${euros(f['Total HT final'] || f['Total HT après remise'] || f['Total HT articles'])}</div><div class="kpi-label">Total HT</div></div>
      <div class="kpi-card"><div class="kpi-value">${euros(f['Total TTC'])}</div><div class="kpi-label">Total TTC</div></div>
    </div>

    <!-- Lignes par zone -->
    <section class="projet-section" aria-label="Lignes du devis">
      <div class="projet-section-header">
        <h2>Lignes <span class="count">(${lignes.length})</span></h2>
      </div>
      ${zones.length === 0 && lignes.length === 0
        ? `<div class="compact-empty"><span>Aucune ligne dans ce devis</span></div>`
        : zones
            .sort((a, b) => (a.fields?.Ordre || 0) - (b.fields?.Ordre || 0))
            .map(z => renderZone(z, lignesByZoneId.get(z.id) || []))
            .join('') + (lignesHorsZone.length ? renderZone({ fields: { 'Nom zone': '(hors zone)' } }, lignesHorsZone) : '')}
    </section>

    <!-- Échéances -->
    ${echeances.length > 0 ? `
    <section class="projet-section" aria-label="Échéances" style="margin-top:24px">
      <div class="projet-section-header">
        <h2>Échéances <span class="count">(${echeances.length})</span></h2>
      </div>
      <table class="devis-detail-table" style="background:white;border:1px solid var(--line);border-radius:var(--r-sm)">
        <thead>
          <tr>
            <th>Libellé</th>
            <th>Date prévue</th>
            <th>Date encaissement</th>
            <th>Statut</th>
            <th class="num">Montant</th>
            <th>Pennylane</th>
          </tr>
        </thead>
        <tbody>
          ${echeances.map(e => {
            const ef = e.fields || {};
            const inv = ef['Pennylane invoice ID'];
            return `
            <tr>
              <td>${esc(ef['Libellé'] || ef.Libelle || '?')}</td>
              <td>${esc(ef['Date prévue'] || '—')}</td>
              <td>${esc(ef['Date encaissement'] || '—')}</td>
              <td><span class="badge">${esc(ef.Statut || '—')}</span></td>
              <td class="num">${ef['Montant prévu'] != null ? eurosPrecis(ef['Montant prévu']) : '—'}</td>
              <td>${inv ? `<a class="btn btn-ghost btn-sm" href="${esc(echeancePdfUrl(e.id))}">${icon('download', 13)} PDF</a>` : '<span class="muted" style="font-size:12px">—</span>'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>` : ''}
  `;

  hydrateIcons(app);

  // Bindings
  document.getElementById('btn-edit-devis')?.addEventListener('click', () => openModalEditDevis(devis));
  document.getElementById('btn-reimport-devis')?.addEventListener('click', () => openReimportDevis(devis, projet));
  document.getElementById('btn-sign-devis')?.addEventListener('click', () => signFlow(devis, projet));
  document.getElementById('btn-pennylane')?.addEventListener('click', () => pennylaneFlow(devis));
  document.getElementById('btn-pennylane-echeances')?.addEventListener('click', () => pennylaneEcheancesFlow(devis));
}

// Génère les factures brouillon d'échéance dans Pennylane (acompte/livraison/solde).
async function pennylaneEcheancesFlow(devis, opts = {}) {
  const btn = document.getElementById('btn-pennylane-echeances');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Création des factures…'; }
  try {
    const r = await pushEcheancesFactures(devis.id, opts);
    if (r && r.needsCustomerConfirmation) {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Factures d\'échéance (brouillon)'; }
      const choice = await chooseCustomerModal(r.clientNom, r.candidates);
      if (!choice) return;
      return pennylaneEcheancesFlow(devis, choice === '__new__' ? { create_customer: true } : { pennylane_customer_id: choice });
    }
    const created = r.created || 0;
    const already = (r.results || []).filter(x => x.already).length;
    const skipped = (r.results || []).filter(x => x.skipped).length;
    const errs = (r.results || []).filter(x => x.error);
    const reconKo = (r.results || []).filter(x => x.reconciliation && x.reconciliation.ok === false);
    toast(`${created} facture(s) brouillon créée(s)${already ? ` · ${already} déjà présente(s)` : ''}${skipped ? ` · ${skipped} encaissée(s) ignorée(s)` : ''}`, 'success', 7000);
    if (errs.length) toast(`⚠️ ${errs.length} échéance(s) sans montant exploitable`, 'error', 8000);
    if (reconKo.length) toast(`⚠️ écart TVA sur ${reconKo.length} facture(s) — vérifie dans Pennylane`, 'error', 9000);
    renderDevis(document.getElementById('app'), devis.id);
  } catch (err) {
    toast('Erreur factures Pennylane : ' + err.message, 'error', 8000);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Factures d\'échéance (brouillon)'; }
  }
}

// Génère le devis brouillon dans Pennylane. Gère la confirmation anti-doublon
// (homonyme sans correspondance exacte) et la réconciliation TTC.
async function pennylaneFlow(devis, opts = {}) {
  const btn = document.getElementById('btn-pennylane');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Création du brouillon…'; }
  try {
    const r = await pushDevisToPennylane(devis.id, opts);

    // Homonyme sans correspondance exacte → Virginie tranche (jamais de doublon auto).
    if (r && r.needsCustomerConfirmation) {
      if (btn) { btn.disabled = false; btn.innerHTML = `${'Générer le brouillon Pennylane'}`; }
      const choice = await chooseCustomerModal(r.clientNom, r.candidates);
      if (!choice) return;
      return pennylaneFlow(devis, choice === '__new__' ? { create_customer: true } : { pennylane_customer_id: choice });
    }

    if (r && r.already) {
      toast('Ce devis est déjà dans Pennylane', 'info', 5000);
    } else {
      toast('Brouillon créé dans Pennylane' + (r.customerCreated ? ' · client créé' : ''), 'success', 6000);
      if (r.reconciliation && r.reconciliation.ok === false) {
        toast(`⚠️ Écart TTC ${r.reconciliation.diff} € — vérifie le devis dans Pennylane avant envoi`, 'error', 9000);
      }
    }
    // Re-render pour afficher « ouvrir / télécharger »
    renderDevis(document.getElementById('app'), devis.id);
  } catch (err) {
    toast('Erreur Pennylane : ' + err.message, 'error', 8000);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Générer le brouillon Pennylane'; }
  }
}

// Modale de choix client quand un homonyme existe côté Pennylane sans match exact.
// Retourne un id client Pennylane, '__new__' (créer), ou null (annulé).
function chooseCustomerModal(nom, candidates) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>Client dans Pennylane</h2>
        <p class="muted" style="margin-top:0">Aucune correspondance exacte pour <strong>${esc(nom)}</strong>. Choisis le bon client Pennylane pour éviter un doublon, ou crée-le.</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin:12px 0">
          ${candidates.map(c => `<button type="button" class="btn btn-ghost" data-id="${esc(c.id)}" style="justify-content:flex-start">${esc(c.name)}</button>`).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="pl-cancel">Annuler</button>
          <button type="button" class="btn btn-primary" id="pl-new">Créer « ${esc(nom)} » dans Pennylane</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const done = v => { modal.remove(); resolve(v); };
    modal.addEventListener('click', e => { if (e.target === modal) done(null); });
    modal.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => done(b.dataset.id));
    modal.querySelector('#pl-cancel').onclick = () => done(null);
    modal.querySelector('#pl-new').onclick = () => done('__new__');
  });
}

function renderZone(zone, lignes) {
  const zf = zone.fields || {};
  const nom = zf['Nom zone'] || 'Zone';
  const modele = [zf.Marque, zf.Modèle].filter(Boolean).join(' — ');
  return `
    <h3 class="devis-zone-title">${esc(nom)}${modele ? ` <span class="muted" style="font-weight:400;font-size:12px">— ${esc(modele)}</span>` : ''}</h3>
    ${lignes.length === 0
      ? `<p class="muted" style="font-size:12px;margin:0 0 8px 12px">Aucune ligne</p>`
      : `<table class="devis-detail-table" style="background:white;border:1px solid var(--line);border-radius:var(--r-sm)">
          <thead>
            <tr>
              <th style="width:50px">Pos</th>
              <th style="width:120px">Code</th>
              <th>Désignation</th>
              <th class="num" style="width:80px">Qté</th>
              <th class="num" style="width:110px">Montant HT</th>
            </tr>
          </thead>
          <tbody>
            ${lignes
              .sort((a, b) => String(a.fields?.Position || '').localeCompare(String(b.fields?.Position || ''), 'fr', { numeric: true }))
              .map(l => {
                const lf = l.fields || {};
                return `
                <tr>
                  <td>${esc(lf.Position || '')}</td>
                  <td><strong>${esc(lf['Code produit'] || '')}</strong></td>
                  <td>${esc((lf.Désignation || '').slice(0, 120))}${(lf.Désignation || '').length > 120 ? '…' : ''}</td>
                  <td class="num">${lf.Quantité != null ? Number(lf.Quantité).toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : ''}${lf.Unité ? ' ' + esc(lf.Unité) : ''}</td>
                  <td class="num">${lf['Montant HT'] != null ? eurosPrecis(lf['Montant HT']) : '—'}</td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>`}
  `;
}

// Modale édition champs header (Numéro, Type, Statut, Date, Valable, Notes)
function openModalEditDevis(devis) {
  const f = devis.fields || {};
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Éditer le devis</h2>
      <form id="form-edit-devis">
        <label>Numéro devis <input name="Numéro devis" value="${esc(f['Numéro devis'] || '')}"></label>
        <label>Type devis
          <select name="Type devis">
            ${['Principal','Additif'].map(v => `<option ${f['Type devis']===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Statut
          <select name="Statut">
            ${['Brouillon','Présenté','En attente','Signé','Refusé'].map(v => `<option ${f.Statut===v?'selected':''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Date devis <input name="Date devis" type="date" value="${esc(f['Date devis'] || '')}"></label>
        <label>Valable jusqu'au <input name="Valable jusqu'au" type="date" value="${esc(f["Valable jusqu'au"] || '')}"></label>
        <label>Notes <textarea name="Notes" rows="3">${esc(f.Notes || '')}</textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.getElementById('cancel').onclick = close;
  document.getElementById('form-edit-devis').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) if (v) fields[k] = v;
    try {
      await patchDevis(devis.id, fields);
      close();
      toast('Devis enregistré', 'success');
      router();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}

// Re-import PDF Winner (remplace les zones/lignes existantes)
async function openReimportDevis(devis, projet) {
  const ok = await confirmModal(
    'Re-importer un PDF Winner va créer un NOUVEAU devis à côté de celui-ci (l\'ancien reste). Pour remplacer les lignes, supprime d\'abord l\'ancien depuis Airtable. Continuer ?',
    { okLabel: 'Continuer', danger: false }
  );
  if (!ok) return;

  // Re-utilise la modale d'import existante (avec projetId)
  const projetId = projet?.id || (devis.fields?.Projet || [])[0];
  if (!projetId) { toast('Projet non trouvé', 'error'); return; }

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Re-importer devis Winner</h2>
      <form id="form-reimport">
        <p class="muted" style="margin-top:0">Le nouveau devis sera lié au même projet. Choisis "Additif" si c'est une augmentation de scope, "Principal" pour remplacer.</p>
        <label>Type
          <select name="type">
            <option value="Principal">Principal (remplace)</option>
            <option value="Additif" selected>Additif (s'ajoute)</option>
          </select>
        </label>
        <label>Fichier PDF
          <input type="file" name="pdf" accept="application/pdf" required>
        </label>
        <p class="muted" style="font-size:12px">Parsing Claude 1 à 2 minutes — ne ferme pas la modale.</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel">Annuler</button>
          <button type="submit" class="btn btn-primary" id="submit-btn">Importer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('cancel').onclick = close;
  document.getElementById('form-reimport').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get('pdf');
    const type = fd.get('type');
    if (!file || file.size === 0) return;
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = 'Parsing (1-2 min)…';
    try {
      await importDevisClient({ file, projetId, type });
      toast(`Nouveau devis ${type} importé`, 'success', 5000);
      close();
      // Retour à la fiche projet pour voir les 2 devis
      location.hash = '#projet/' + projetId;
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 7000);
      btn.disabled = false;
      btn.innerHTML = 'Importer';
    }
  });
}

// Workflow signature — confirmation + appel signDevisTanguy + retour fiche projet
async function signFlow(devis, projet) {
  const num = devis.fields?.['Numéro devis'] || devis.id;
  const ok = await confirmModal(
    `Signer le devis ${num} ?\nCela va :\n• Créer les commandes fournisseurs (avec rétro-planning si date pose connue)\n• Générer 4 tâches de suivi (acompte, BC, notif artisans, planning chantier J+60)\n• Passer le devis à « Signé » et le projet à « Commandes »`,
    { okLabel: 'Signer', danger: false }
  );
  if (!ok) return;
  const btn = document.getElementById('btn-sign-devis');
  if (btn) { btn.disabled = true; btn.innerHTML = 'Signature en cours…'; }
  try {
    const result = await signDevisTanguy(devis.id);
    toast(`Devis signé · ${result.commandes_creees} commande(s) · ${result.taches_creees} tâche(s)`, 'success', 6000);
    // Retour fiche projet pour voir les BC générés
    if (projet?.id) {
      location.hash = '#projet/' + projet.id;
    } else {
      router();
    }
  } catch (err) {
    toast('Erreur signature : ' + err.message, 'error', 7000);
    if (btn) { btn.disabled = false; btn.innerHTML = '<span>Signer ce devis</span>'; }
  }
}
