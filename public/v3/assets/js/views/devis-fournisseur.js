// Vue « Devis express » (P-H3) — accessible à toute l'équipe.
//
// Flux : on dépose un PDF de devis FOURNISSEUR → le backend le parse via Claude
// (POST /api/devis-fournisseur/parse, requireAuth) et renvoie le parsing enrichi
// (coefficient de marge du fournisseur + éco-participation suggérée + prix client
// suggéré). La vue affiche un tableau de saisie éditable qui recalcule le prix
// client HT et le TTC en temps réel.
//
// La CRÉATION du devis client (rattachement projet + insert Airtable) est l'étape
// suivante (P-H4) : le bouton est présent mais désactivé tant que l'endpoint create
// n'est pas livré.

import { icon, hydrateIcons } from '../core/lucide.js';
import { toast } from '../core/ui.js';
import { parseDevisFournisseur, creerDevisClientExpress } from '../core/api.js';
import { state } from '../core/state.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n) => (n == null || Number.isNaN(Number(n)))
  ? '—'
  : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// État courant du dernier parsing (pour le recalcul live).
let current = null;

export function renderDevisFournisseur(app) {
  app.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${icon('calculator', 22)} Devis express</h1>
      <p class="muted">Déposez un devis fournisseur (PDF) → un devis client pré-rempli, avec votre marge et l'éco-participation.</p>
    </div>

    <div class="card" id="df-dropzone" style="text-align:center;padding:32px 20px;border:2px dashed var(--line2);cursor:pointer">
      <div style="font-size:32px;color:var(--ink3)">${icon('upload', 32)}</div>
      <p style="margin-top:8px;font-weight:500">Déposer un devis fournisseur (PDF)</p>
      <p class="muted" style="font-size:13px">ou cliquer pour choisir un fichier — Granit Evolution, Novamobili, Metron…</p>
      <input type="file" id="df-file" accept="application/pdf" style="display:none">
    </div>

    <div id="df-status" style="margin-top:16px"></div>
    <div id="df-result" style="margin-top:16px"></div>
  `;
  hydrateIcons(app);

  const dz = app.querySelector('#df-dropzone');
  const input = app.querySelector('#df-file');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
  // Drag & drop
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = 'var(--line2)'; });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.style.borderColor = 'var(--line2)';
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
}

async function handleFile(file) {
  const statusEl = document.getElementById('df-status');
  const resultEl = document.getElementById('df-result');
  resultEl.innerHTML = '';
  if (file.type !== 'application/pdf') {
    statusEl.innerHTML = `<div class="card" style="color:var(--accent)">Seuls les fichiers PDF sont acceptés.</div>`;
    return;
  }
  statusEl.innerHTML = `<div class="card"><p class="muted">${icon('clock', 14)} Analyse de « ${esc(file.name)} » en cours… (peut prendre 1 à 2 minutes)</p></div>`;
  try {
    const res = await parseDevisFournisseur({ file });
    statusEl.innerHTML = '';
    current = res;
    renderResult(resultEl, res);
  } catch (e) {
    statusEl.innerHTML = `<div class="card" style="color:var(--accent)">Échec de l'analyse : ${esc(e.message)}</div>`;
  }
}


// ---------------------------------------------------------------------------
// Éco-contribution des tablettes et panneaux (barème à la dimension)
// ---------------------------------------------------------------------------
// Le barème dépend de la LONGUEUR, de la HAUTEUR, du matériau et de la gestion
// durable — jamais du poids. Les tarifs de la grille sont en TTC : la conversion
// vers le HT du Devis express se fait avec le taux de TVA du devis.
// Chaque ligne reste modifiable : dimensions relevées après coup, cas non prévu
// par la grille. Le total se recalcule et se reporte dans l'éco-participation.

const MATERIAUX_UI = [
  'Panneaux de particules ≥ 75%',
  'Bois massif ≥ 75%',
  'Bois et dérivés certifiés, matériaux biosourcés ≥ 50%',
];

// Ligne vierge : sert à la saisie manuelle quand le devis ne porte pas ses
// dimensions (nomenclatures) ou que la lecture automatique n'a rien trouvé.
const LIGNE_ECO_VIDE = {
  designation: '', quantite: 1, longueurMm: null, hauteurMm: null,
  materiau: 'Panneaux de particules ≥ 75%', gestionDurable: 'certifiee', tarifUnitaireTtc: null,
};

function renderEcoSection(eco) {
  // La section est TOUJOURS affichée, même sans pièce détectée : le calcul ne
  // doit pas dépendre entièrement de ce que la lecture automatique a trouvé.
  // Sans pièce, une ligne vierge attend la saisie.
  const detecte = !!(eco && eco.lignes && eco.lignes.length);
  if (!detecte) {
    eco = { lignes: [{ ...LIGNE_ECO_VIDE }], complet: false, piecesIncalculables: 1, avertissements: [] };
  }

  const alerte = !eco.complet
    ? `<p class="muted" style="font-size:13px;color:var(--accent)">${icon('alert', 13)}
        ${eco.piecesIncalculables} pièce${eco.piecesIncalculables > 1 ? 's' : ''} sans dimensions exploitables :
        le total ci-dessous est <strong>partiel</strong>. Complète la longueur et la hauteur, ou saisis le tarif à la main.</p>`
    : '';
  const avertissements = (eco.avertissements || []).length
    ? `<p class="muted" style="font-size:12px">${eco.avertissements.map(a => `${icon('alert', 12)} ${esc(a)}`).join('<br>')}</p>`
    : '';

  const rows = eco.lignes.map((l, i) => ligneEcoHtml(l, i)).join('');
  return sectionEcoHtml({ eco, rows, detecte, alerte, avertissements });
}

// Une ligne du tableau éco. Extraite pour être réutilisée par « Ajouter une pièce ».
function ligneEcoHtml(l, i) {
  return `
    <tr data-eco-row="${i}">
      <td><input data-eco="designation" value="${esc(l.designation)}" style="width:100%;min-width:140px"></td>
      <td class="num"><input data-eco="quantite" type="number" min="1" step="1" value="${l.quantite}" style="width:64px;text-align:right"></td>
      <td class="num"><input data-eco="longueur" type="number" min="0" step="1" value="${l.longueurMm ?? ''}" placeholder="mm" style="width:80px;text-align:right"></td>
      <td class="num"><input data-eco="hauteur" type="number" min="0" step="1" value="${l.hauteurMm ?? ''}" placeholder="mm" style="width:80px;text-align:right"></td>
      <td>
        <select data-eco="materiau" style="max-width:180px">
          ${MATERIAUX_UI.map(m => `<option value="${esc(m)}" ${l.materiau === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
      </td>
      <td class="num"><input data-eco="gd" type="checkbox" ${l.gestionDurable === 'certifiee' ? 'checked' : ''} title="Gestion durable certifiée"></td>
      <!-- Volontairement VIDE : un champ prérempli serait lu comme une saisie
           manuelle et figerait la ligne — corriger une dimension ne recalculerait
           plus rien. Le tarif de la grille s'affiche en repère (placeholder). -->
      <td class="num"><input data-eco="tarif" type="number" min="0" step="0.01" value="" placeholder="auto" style="width:80px;text-align:right" title="Vide = tarif de la grille, recalculé à chaque changement. Une valeur saisie ici prend le pas."></td>
      <td class="num"><strong data-eco="total">—</strong></td>
    </tr>`;
}

function sectionEcoHtml({ eco, rows, detecte, alerte, avertissements }) {
  return `
    <div class="card" style="margin-top:16px">
      <div class="section-header" style="margin-bottom:6px">
        <h2 class="section-title">Éco-contribution <span class="count">(${eco.lignes.length} pièce${eco.lignes.length > 1 ? 's' : ''})</span></h2>
      </div>
      <p class="muted" style="font-size:13px">
        Barème tablettes et panneaux revêtus, <strong>à la dimension</strong> (longueur × hauteur), pas au poids.
        Tarifs de la grille en TTC. Modifie n'importe quelle ligne : le total suit.
      </p>
      ${!detecte ? `<p class="muted" style="font-size:13px">
        ${icon('alert', 13)} Aucune tablette ni panneau lu automatiquement dans ce devis.
        Saisis les pièces ci-dessous — le tarif se calcule tout seul dès que longueur et hauteur sont renseignées.
      </p>` : alerte}${avertissements}
      <div style="overflow-x:auto">
        <table class="pipeline-table" style="margin-top:10px;min-width:720px">
          <thead>
            <tr>
              <th>Pièce</th><th class="num">Qté</th><th class="num">Long. (mm)</th><th class="num">Haut. (mm)</th>
              <th>Matériau</th><th class="num" title="Gestion durable certifiée">GD</th>
              <th class="num" title="Vide = calculé par la grille">Tarif TTC</th><th class="num">Total TTC</th>
            </tr>
          </thead>
          <tbody id="df-eco-rows">${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="7"><strong>Total éco-contribution</strong> <span class="muted" id="df-eco-partiel"></span></td>
              <td class="num"><strong id="df-eco-total-ttc">—</strong></td>
            </tr>
            <tr>
              <td colspan="7" class="muted">soit en HT (TVA <span id="df-eco-tva">—</span>), reporté dans l'éco-participation ci-dessus</td>
              <td class="num"><strong id="df-eco-total-ht">—</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost btn-sm" id="df-eco-add">${icon('plus', 14)} Ajouter une pièce</button>
        <button class="btn btn-ghost btn-sm" id="df-eco-report">${icon('check', 14)} Reporter dans l'éco-participation</button>
        <span class="muted" style="font-size:12px" id="df-eco-report-msg"></span>
      </div>
    </div>`;
}

// Barème répliqué côté navigateur : le recalcul est instantané à la frappe, sans
// aller-retour serveur. MÊMES VALEURS que services/eco-contribution-bareme.js —
// toute correction de la grille doit être faite AUX DEUX ENDROITS.
const GRILLE_ECO_TTC = {
  'Bois massif ≥ 75%': {
    '0 à 600 mm':    { 'h<250': { sans: 0.19, certifiee: 0.06 }, 'h>=250': { sans: 0.41, certifiee: 0.11 } },
    '610 à 1200 mm': { 'h<250': { sans: 0.35, certifiee: 0.11 }, 'h>=250': { sans: 0.70, certifiee: 0.29 } },
    '> 1200 mm':     { 'h<250': { sans: 0.40, certifiee: 0.29 }, 'h>=250': { sans: 0.96, certifiee: 0.29 } },
  },
  'Panneaux de particules ≥ 75%': {
    '0 à 600 mm':    { 'h<250': { sans: 0.19, certifiee: 0.06 }, 'h>=250': { sans: 0.41, certifiee: 0.11 } },
    '610 à 1200 mm': { 'h<250': { sans: 0.35, certifiee: 0.11 }, 'h>=250': { sans: 0.70, certifiee: 0.29 } },
    '> 1200 mm':     { 'h<250': { sans: 0.64, certifiee: 0.29 }, 'h>=250': { sans: 0.96, certifiee: 0.40 } },
  },
  'Bois et dérivés certifiés, matériaux biosourcés ≥ 50%': {
    '0 à 600 mm':    { 'h<250': { sans: 0.22, certifiee: 0.08 }, 'h>=250': { sans: 0.47, certifiee: 0.17 } },
    '610 à 1200 mm': { 'h<250': { sans: 0.41, certifiee: 0.17 }, 'h>=250': { sans: 0.82, certifiee: 0.41 } },
    '> 1200 mm':     { 'h<250': { sans: 0.76, certifiee: 0.41 }, 'h>=250': { sans: 1.08, certifiee: 0.48 } },
  },
};

function tarifEcoTtc({ longueurMm, hauteurMm, materiau, gestionDurable }) {
  const l = Number(longueurMm), h = Number(hauteurMm);
  if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(h) || h <= 0) return null;
  const tranche = l <= 600 ? '0 à 600 mm' : (l <= 1200 ? '610 à 1200 mm' : '> 1200 mm');
  const cleH = h < 250 ? 'h<250' : 'h>=250';
  const g = GRILLE_ECO_TTC[materiau];
  if (!g) return null;
  return g[tranche][cleH][gestionDurable ? 'certifiee' : 'sans'];
}

// Recalcule le tableau et renvoie le total TTC (null si rien de calculable).
function recomputeEco(out) {
  const tbody = out.querySelector('#df-eco-rows');
  if (!tbody) return null;
  // Le taux de TVA convertit le barème (TTC) vers le HT du prix client. S'il est
  // introuvable, on NE retombe PAS sur 0 % : afficher un TTC en le nommant « HT »
  // fausserait un montant déclaré sans qu'aucune alerte ne le dise.
  const champTva = out.querySelector('#df-tva') || document.querySelector('#df-tva');
  const tva = champTva && champTva.value !== '' ? Number(champTva.value) : null;
  let totalTtc = 0, incalculables = 0, lignes = 0;

  tbody.querySelectorAll('tr[data-eco-row]').forEach(tr => {
    lignes++;
    const q = Math.max(1, Number(tr.querySelector('[data-eco=quantite]').value) || 1);
    const saisi = tr.querySelector('[data-eco=tarif]').value;
    const manuel = saisi !== '' && Number.isFinite(Number(saisi));
    const tarif = manuel ? Number(saisi) : tarifEcoTtc({
      longueurMm: tr.querySelector('[data-eco=longueur]').value,
      hauteurMm: tr.querySelector('[data-eco=hauteur]').value,
      materiau: tr.querySelector('[data-eco=materiau]').value,
      gestionDurable: tr.querySelector('[data-eco=gd]').checked,
    });
    const champTarif = tr.querySelector('[data-eco=tarif]');
    // Repère visible du tarif que la grille applique, sans le "saisir" à la place
    // de l'utilisateur.
    if (!manuel) champTarif.placeholder = tarif == null ? 'auto' : tarif.toFixed(2).replace('.', ',');
    const cell = tr.querySelector('[data-eco=total]');
    if (tarif == null) {
      incalculables++;
      cell.textContent = '—';
      cell.title = 'Longueur et hauteur nécessaires, ou saisis un tarif à la main';
      cell.style.color = 'var(--accent)';
    } else {
      const t = Math.round(tarif * q * 100) / 100;
      totalTtc += t;
      cell.textContent = eur(t);
      cell.title = manuel ? 'Tarif saisi à la main' : 'Tarif de la grille';
      cell.style.color = '';
    }
  });

  totalTtc = Math.round(totalTtc * 100) / 100;
  const totalHt = (tva == null || !Number.isFinite(tva))
    ? null
    : Math.round((totalTtc / (1 + tva / 100)) * 100) / 100;
  out.querySelector('#df-eco-total-ttc').textContent = lignes ? eur(totalTtc) : '—';
  out.querySelector('#df-eco-total-ht').textContent = (lignes && totalHt != null) ? eur(totalHt) : '—';
  out.querySelector('#df-eco-tva').textContent = tva == null ? 'taux introuvable' : tva + ' %';
  // Jamais de silence : un total partiel se présente comme partiel.
  out.querySelector('#df-eco-partiel').textContent = incalculables
    ? `— partiel : ${incalculables} pièce${incalculables > 1 ? 's' : ''} sans dimensions`
    : '';
  return { totalTtc, totalHt, incalculables, lignes };
}

// Reporte le total HT dans le champ « Éco-participation » qui alimente le prix client.
function reporterEco(out, { silencieux = false } = {}) {
  const r = recomputeEco(out);
  const msg = out.querySelector('#df-eco-report-msg');
  if (!r || !r.lignes) return;
  if (r.totalHt == null) {
    if (msg) { msg.textContent = 'Taux de TVA introuvable — montant HT non calculable, rien reporté.'; msg.style.color = 'var(--accent)'; }
    if (!silencieux) toast('Taux de TVA introuvable : rien n\'a été reporté', 'error', 5000);
    return;
  }
  const champ = out.querySelector('#df-eco');
  champ.value = r.totalHt;
  champ.dispatchEvent(new Event('input', { bubbles: true }));
  if (msg) {
    msg.textContent = r.incalculables
      ? `${eur(r.totalHt)} HT reporté — total partiel, ${r.incalculables} pièce(s) non chiffrée(s).`
      : `${eur(r.totalHt)} HT reporté dans le prix client.`;
    msg.style.color = r.incalculables ? 'var(--accent)' : '';
  }
  if (!silencieux) toast('Éco-contribution reportée', 'success');
}

function wireEco(out) {
  const tbody = out.querySelector('#df-eco-rows');
  if (!tbody) return;
  tbody.addEventListener('input', () => recomputeEco(out));
  tbody.addEventListener('change', () => recomputeEco(out));
  out.querySelector('#df-tva')?.addEventListener('change', () => recomputeEco(out));
  out.querySelector('#df-eco-report')?.addEventListener('click', () => reporterEco(out));
  // Ajout d'une pièce à la main : indispensable quand le devis ne porte pas ses
  // dimensions (nomenclatures) ou qu'une pièce a été oubliée à la lecture.
  out.querySelector('#df-eco-add')?.addEventListener('click', () => {
    const tbody = out.querySelector('#df-eco-rows');
    const index = tbody.querySelectorAll('tr[data-eco-row]').length;
    tbody.insertAdjacentHTML('beforeend', ligneEcoHtml({ ...LIGNE_ECO_VIDE }, index));
    recomputeEco(out);
    // Curseur dans la désignation de la ligne qui vient d'apparaître.
    tbody.querySelector(`tr[data-eco-row="${index}"] [data-eco=designation]`)?.focus();
  });
  const r = recomputeEco(out);
  // Report automatique UNIQUEMENT si tout est chiffré : un total partiel ne
  // s'invite pas dans le prix client sans que quelqu'un l'ait décidé.
  if (r && r.lignes && !r.incalculables) reporterEco(out, { silencieux: true });
}


// ---------------------------------------------------------------------------
// P-H4 — Création du devis client depuis le chiffrage
// ---------------------------------------------------------------------------
// Rattachement (choix JMG 27/08) : un projet existant, ou un client dont le
// projet est créé à la volée. Le devis part en BROUILLON et reste modifiable.

function openModalCreerDevis(out) {
  const coef = Number(out.querySelector('#df-coef')?.value);
  const prixHtTexte = out.querySelector('#df-prixht')?.textContent || '';
  if (!coef || coef <= 0) { toast('Renseigne d\'abord le coefficient de marge', 'error'); return; }

  const totalHt = Number(out.querySelector('#df-totalht').dataset.v) || 0;
  const eco = Number(out.querySelector('#df-eco').value) || 0;
  const tva = Number(out.querySelector('#df-tva').value) || 0;
  const prixClientHt = Math.round((totalHt * coef + eco) * 100) / 100;
  const designation = out.querySelector('#df-designation')?.value || '';

  const projets = (state.projets || []).slice().sort((a, b) =>
    String(a['Référence'] || '').localeCompare(String(b['Référence'] || ''), 'fr'));
  const clients = (state.clients || []).slice().sort((a, b) =>
    String(a.Nom || '').localeCompare(String(b.Nom || ''), 'fr'));

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cd-title" style="max-width:560px">
      <h2 id="cd-title">Créer le devis client</h2>
      <p class="muted" style="margin-top:0">
        ${esc(designation || 'Prestation')} — <strong>${eur(prixClientHt)} HT</strong>
        ${eco > 0 ? ` (dont ${eur(eco)} d'éco-contribution)` : ''} · TVA ${tva} %
      </p>

      <div style="display:flex;gap:16px;margin:14px 0 10px">
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer">
          <input type="radio" name="cd-mode" value="projet" checked> Projet existant
        </label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer">
          <input type="radio" name="cd-mode" value="client"> Nouveau chantier pour un client
        </label>
      </div>

      <div id="cd-bloc-projet">
        <label>Projet
          <select id="cd-projet" style="width:100%">
            <option value="">— choisir —</option>
            ${projets.map(p => `<option value="${esc(p.id)}">${esc(p['Référence'] || '(sans référence)')}</option>`).join('')}
          </select>
        </label>
        ${projets.length ? '' : '<p class="muted" style="font-size:13px">Aucun projet chargé — utilise « Nouveau chantier pour un client ».</p>'}
      </div>

      <div id="cd-bloc-client" style="display:none">
        <label>Client
          <select id="cd-client" style="width:100%">
            <option value="">— choisir —</option>
            ${clients.map(c => `<option value="${esc(c.id)}">${esc(c.Nom || '(sans nom)')}</option>`).join('')}
          </select>
        </label>
        <p class="muted" style="font-size:13px;margin-top:4px">Un projet sera créé automatiquement pour ce client.</p>
      </div>

      <div class="modal-actions" style="margin-top:18px">
        <button type="button" class="btn btn-ghost" id="cd-cancel">Annuler</button>
        <button type="button" class="btn btn-primary" id="cd-ok">Créer le devis</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  hydrateIcons(modal);
  const close = () => modal.remove();
  modal.querySelector('#cd-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelectorAll('input[name=cd-mode]').forEach(r => r.addEventListener('change', () => {
    const parProjet = modal.querySelector('input[name=cd-mode]:checked').value === 'projet';
    modal.querySelector('#cd-bloc-projet').style.display = parProjet ? '' : 'none';
    modal.querySelector('#cd-bloc-client').style.display = parProjet ? 'none' : '';
  }));

  modal.querySelector('#cd-ok').addEventListener('click', async () => {
    const parProjet = modal.querySelector('input[name=cd-mode]:checked').value === 'projet';
    const projetId = parProjet ? modal.querySelector('#cd-projet').value : '';
    const clientId = parProjet ? '' : modal.querySelector('#cd-client').value;
    if (parProjet && !projetId) { toast('Choisis un projet', 'error'); return; }
    if (!parProjet && !clientId) { toast('Choisis un client', 'error'); return; }

    const btn = modal.querySelector('#cd-ok');
    btn.disabled = true; btn.textContent = 'Création…';
    try {
      const r = await creerDevisClientExpress({
        projetId: projetId || undefined,
        clientId: clientId || undefined,
        designation,
        prixClientHt,
        tvaTaux: tva,
        ecoHt: eco,
        origine: current?.parsed?.document?.numero || '',
      });
      close();
      // Jamais de silence : ce qui n'a pas pu être fait est annoncé, pas avalé
      // sous un message de succès.
      if (r.avertissements?.length) toast(r.avertissements.join(' · '), 'error', 7000);
      toast(`Devis ${r.numero} créé${r.projetCree ? ' (projet créé)' : ''}`, 'success');
      location.hash = `#devis/${r.devisId}`;
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Créer le devis';
      toast('Erreur : ' + (err.message || err), 'error', 6000);
    }
  });
}

function renderResult(out, res) {
  const p = res.parsed || {};
  const enr = res.enrichissement || {};
  const four = p.fournisseur || {};
  const doc = p.document || {};
  const tot = p.totaux || {};
  const marge = enr.marge || {};
  const ecopart = enr.ecopart || {};
  const eco = enr.eco_contribution || null;

  const variante = p.variante_prix && p.variante_prix !== 'INCONNU'
    ? `<span class="badge">${esc(p.variante_prix)}</span>` : '';
  const coefInit = marge.coefficient != null ? marge.coefficient : '';
  const ecoInit = ecopart.montant_ht != null ? ecopart.montant_ht : 0;
  const tvaInit = tot.tva_taux != null ? tot.tva_taux : 20;

  const alerteMasque = p.prix_par_ligne_disponible === false
    ? `<p class="muted" style="font-size:13px;color:var(--accent)">${icon('alert', 13)} Prix par ligne masqués sur ce devis — on travaille sur le total net.</p>` : '';
  const alerteParsing = p.alertes_parsing
    ? `<p class="muted" style="font-size:13px">${icon('alert', 13)} ${esc(p.alertes_parsing)}</p>` : '';
  const alerteCoef = marge.coefficient == null
    ? `<p class="muted" style="font-size:13px;color:var(--accent)">${icon('alert', 13)} Aucun coefficient de marge connu pour « ${esc(four.nom || four.type_detecte || 'ce fournisseur')} ». Saisissez-le ci-dessous (ou complétez la grille dans Admin).</p>` : '';

  out.innerHTML = `
    <div class="card">
      <div class="section-header" style="margin-bottom:8px">
        <h2 class="section-title">${esc(four.nom || four.type_detecte || 'Fournisseur')} ${variante}</h2>
      </div>
      <p class="muted" style="font-size:13px">
        ${doc.numero ? 'N° ' + esc(doc.numero) : ''}${doc.reference_chantier ? ' · réf. ' + esc(doc.reference_chantier) : ''}${doc.date ? ' · ' + esc(doc.date) : ''}
      </p>
      <p style="margin-top:6px">${esc(p.produit_resume || '')}</p>
      ${alerteMasque}${alerteParsing}${alerteCoef}

      <table class="pipeline-table" style="margin-top:14px">
        <tbody>
          <tr><td>Total net fournisseur HT</td><td class="num"><strong id="df-totalht" data-v="${tot.total_ht ?? ''}">${eur(tot.total_ht)}</strong></td></tr>
          <tr>
            <td>Désignation (ligne client)</td>
            <td><input id="df-designation" value="${esc(p.produit_resume || (four.nom || '') )}" style="width:100%"></td>
          </tr>
          <tr>
            <td>Coefficient de marge (×)</td>
            <td class="num"><input id="df-coef" type="number" step="0.01" min="0" value="${coefInit}" placeholder="ex. 2" style="width:90px;text-align:right"></td>
          </tr>
          <tr>
            <td>Éco-participation HT${ecopart.categorie ? ' (' + esc(ecopart.categorie) + ')' : ''}</td>
            <td class="num"><input id="df-eco" type="number" step="0.01" min="0" value="${ecoInit}" style="width:90px;text-align:right"> €</td>
          </tr>
          <tr>
            <td>TVA</td>
            <td class="num">
              <select id="df-tva" style="width:90px">
                <option value="10" ${Number(tvaInit) === 10 ? 'selected' : ''}>10 %</option>
                <option value="20" ${Number(tvaInit) === 20 ? 'selected' : ''}>20 %</option>
                <option value="5.5" ${Number(tvaInit) === 5.5 ? 'selected' : ''}>5,5 %</option>
              </select>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td><strong>Prix client HT</strong></td><td class="num"><strong id="df-prixht">—</strong></td></tr>
          <tr><td><strong>Prix client TTC</strong></td><td class="num"><strong id="df-prixttc">—</strong></td></tr>
        </tfoot>
      </table>

      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="df-create">${icon('filePlus', 14)} Créer le devis client</button>
        <span class="muted" style="font-size:12px;align-self:center">Le devis part en brouillon et reste modifiable.</span>
      </div>
    </div>

    ${renderEcoSection(eco)}
  `;
  hydrateIcons(out);

  const recompute = () => {
    const totalHt = Number(out.querySelector('#df-totalht').dataset.v) || 0;
    const coef = Number(out.querySelector('#df-coef').value);
    const eco = Number(out.querySelector('#df-eco').value) || 0;
    const tva = Number(out.querySelector('#df-tva').value) || 0;
    if (!coef || coef <= 0) {
      out.querySelector('#df-prixht').textContent = '—';
      out.querySelector('#df-prixttc').textContent = '—';
      return;
    }
    const ht = Math.round((totalHt * coef + eco) * 100) / 100;
    const ttc = Math.round(ht * (1 + tva / 100) * 100) / 100;
    out.querySelector('#df-prixht').textContent = eur(ht);
    out.querySelector('#df-prixttc').textContent = eur(ttc);
  };
  ['#df-coef', '#df-eco', '#df-tva'].forEach(sel => {
    out.querySelector(sel).addEventListener('input', recompute);
    out.querySelector(sel).addEventListener('change', recompute);
  });
  recompute();

  // Éco-contribution : tableau par pièce, recalcul live, report dans le prix.
  wireEco(out);

  // P-H4 — création du devis client à partir du chiffrage affiché.
  out.querySelector('#df-create')?.addEventListener('click', () => openModalCreerDevis(out));
}
