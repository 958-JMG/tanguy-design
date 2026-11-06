// Import d'un prix de vente HT : aucune marge ajoutée, éco comptée une seule fois.
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast } from '../core/ui.js';
import { parseDevisFournisseur, creerDevisClientExpress, calculEcoContribution } from '../core/api.js';
import { libelleProjet, filtrerProjets } from '../core/projet-recherche.mjs';
import { calculPrixImport } from '../core/devis-prix.mjs';
import { creerSuiviEco } from '../core/devis-eco.mjs';
import { importProgress } from '../core/import-progress.js';
import { state } from '../core/state.js';
import { renderElectro } from './devis-electro.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n) => (n == null || Number.isNaN(Number(n)))
  ? '—'
  : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// État courant du dernier parsing (pour le recalcul live).
let current = null;
let importEnCours = false;
let fichierEnCours = '', erreurImport = '', debutImport = 0;
let dernierFichier = null;
let stopAnimation = null;

// Deux modes (demande JMG 14/10/2026) : le devis FOURNISSEUR d'avant (meubles,
// plans de travail : prix de vente HT du document) et l'ÉLECTROMÉNAGER (projet FINDIS :
// prix de vente, d'achat et éco article par article). Mode mémorisé par navigateur.
const MODE_CLE = 'tanguy.devisExpress.mode';
function modeMemorise() {
  try { return localStorage.getItem(MODE_CLE) === 'electro' ? 'electro' : 'fournisseur'; } catch { return 'fournisseur'; }
}

export function renderDevisFournisseur(app) {
  if (!state.isAdmin) {
    app.innerHTML = `<div class="card"><h2>Accès réservé</h2><p class="muted">Devis express (import d'un devis fournisseur pour générer un devis client) est réservé aux administrateurs.</p></div>`;
    return;
  }
  let mode = modeMemorise();
  app.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${icon('calculator', 22)} Devis express</h1>
      <p class="muted" id="dx-intro"></p>
    </div>
    <div class="filter-chips" role="tablist" aria-label="Type de devis express" style="margin-bottom:14px">
      <button class="chip" role="tab" data-mode="fournisseur">Devis fournisseur</button>
      <button class="chip" role="tab" data-mode="electro">Électroménager (FINDIS)</button>
    </div>
    <div id="dx-panel"></div>
  `;
  hydrateIcons(app);
  const afficher = () => {
    app.querySelectorAll('[data-mode]').forEach(b => {
      const actif = b.dataset.mode === mode;
      b.classList.toggle('is-active', actif);
      b.setAttribute('aria-selected', actif ? 'true' : 'false');
    });
    app.querySelector('#dx-intro').textContent = mode === 'electro'
      ? 'Déposez le projet FINDIS → un devis client article par article, avec le prix d\'achat et la marge.'
      : 'Déposez un devis fournisseur (PDF) → le prix de vente HT du document est conservé, sans coefficient supplémentaire.';
    const panel = app.querySelector('#dx-panel');
    panel.querySelector('#df-result')?._ecoDetruire?.();
    if (mode === 'electro') renderElectro(panel);
    else renderPanelFournisseur(panel);
  };
  app.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    try { localStorage.setItem(MODE_CLE, mode); } catch { /* navigation privée : sans mémoire */ }
    afficher();
  }));
  afficher();
}

function renderPanelFournisseur(app) {
  app.innerHTML = `
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
  afficherEtatImport();
}

function afficherEtatImport() {
  stopAnimation?.(); stopAnimation = null;
  const statusEl = document.getElementById('df-status');
  const resultEl = document.getElementById('df-result');
  if (!statusEl || !resultEl) return;
  document.querySelectorAll('#df-file, [data-mode]').forEach(el => el.disabled = importEnCours);
  if (importEnCours) {
    resultEl._ecoDetruire?.();
    resultEl.innerHTML = '';
    stopAnimation = importProgress(statusEl, `Analyse de « ${fichierEnCours} » en cours`, debutImport);
  } else {
    statusEl.innerHTML = erreurImport ? `<div class="card" role="alert" style="color:var(--accent)"><p>${esc(erreurImport)}</p>${dernierFichier ? '<button type="button" class="btn btn-primary" id="df-reessayer">Réessayer l’analyse</button>' : ''}</div>` : '';
    statusEl.querySelector('#df-reessayer')?.addEventListener('click', () => handleFile(dernierFichier));
    if (current) renderResult(resultEl, current);
  }
}
async function handleFile(file) {
  if (importEnCours) { toast('Un import est déjà en cours. Patiente sans le relancer.', 'info'); return; }
  if (file.type !== 'application/pdf') { toast('Seuls les fichiers PDF sont acceptés.', 'error'); return; }
  dernierFichier = file;
  importEnCours = true; debutImport = Date.now(); fichierEnCours = file.name; current = null; erreurImport = '';
  afficherEtatImport();
  try { current = await parseDevisFournisseur({ file }); }
  catch (e) { erreurImport = `Échec de l’analyse : ${e.message}`; }
  finally { importEnCours = false; afficherEtatImport(); }
}

// ---------------------------------------------------------------------------
// Éco-contribution des tablettes et panneaux (barème Ecomaison 2026)
// ---------------------------------------------------------------------------
// Barème OFFICIEL 2026, à la tranche de POIDS (HT), le poids estimé depuis les
// dimensions du panneau. SOURCE UNIQUE : l'endpoint /api/eco-contribution/calcul
// (services/eco-contribution-2026.js). AUCUNE grille répliquée ici — un barème
// change à un seul endroit. Ces pièces sont des tablettes/panneaux → type
// « Joue / panneau » (poids = largeur × hauteur × épaisseur × densité).

// Matériau simple affiché → classe matière du barème 2026 (+ gestion durable).
const MATERIAUX_UI = ['Panneaux de particules', 'Bois massif', 'Biosourcé'];
function classeMatiere2026(materiau, gestionDurableCertifiee) {
  const gd = gestionDurableCertifiee;
  const n = String(materiau || '').toLowerCase();
  if (n.includes('massif')) return gd ? 'Bois massif >95% - gestion durable certifiée' : 'Bois massif >95% - sans gestion durable';
  if (n.includes('biosourc')) return gd ? 'Biosourcés ≥50% - gestion durable certifiée' : 'Biosourcés ≥50% - sans gestion durable';
  return gd ? 'Panneaux particules ≥75% - gestion durable certifiée' : 'Panneaux particules ≥75% - sans gestion durable';
}

const LIGNE_ECO_VIDE = {
  designation: '', quantite: 1, longueurMm: null, hauteurMm: null,
  epaisseurMm: 19, materiau: 'Panneaux de particules', gestionDurable: 'sans',
};

// Normalise une pièce (parsing: longueur_mm/hauteur_mm/… ou déjà normalisée).
function normEcoPiece(p = {}) {
  const mat = p.materiau || 'Panneaux de particules';
  return {
    designation: p.designation || '',
    quantite: p.quantite || 1,
    longueurMm: p.longueurMm ?? p.longueur_mm ?? null,
    hauteurMm: p.hauteurMm ?? p.hauteur_mm ?? null,
    epaisseurMm: Object.hasOwn(p, 'epaisseur_mm') ? p.epaisseur_mm : (p.epaisseurMm ?? 19),
    materiau: /massif/i.test(mat) ? 'Bois massif' : (/biosourc/i.test(mat) ? 'Biosourcé' : 'Panneaux de particules'),
    gestionDurable: p.gestionDurable === 'certifiee' ? 'certifiee' : 'sans',
  };
}

function renderEcoSection(pieces) {
  const detecte = Array.isArray(pieces) && pieces.length > 0;
  const lignes = detecte ? pieces.map(normEcoPiece) : [normEcoPiece(LIGNE_ECO_VIDE)];
  const rows = lignes.map((l, i) => ligneEcoHtml(l, i)).join('');
  return sectionEcoHtml({ nb: lignes.length, rows, detecte });
}

function ligneEcoHtml(l, i) {
  return `
    <tr data-eco-row="${i}">
      <td><input data-eco="designation" value="${esc(l.designation)}" style="width:100%;min-width:130px"></td>
      <td class="num"><input data-eco="quantite" type="number" min="1" step="1" value="${l.quantite}" style="width:60px;text-align:right"></td>
      <td class="num"><input data-eco="longueur" type="number" min="0" step="1" value="${l.longueurMm ?? ''}" placeholder="mm" style="width:76px;text-align:right"></td>
      <td class="num"><input data-eco="hauteur" type="number" min="0" step="1" value="${l.hauteurMm ?? ''}" placeholder="mm" style="width:76px;text-align:right"></td>
      <td class="num"><input data-eco="epaisseur" type="number" min="0" step="1" value="${l.epaisseurMm ?? ''}" placeholder="19" style="width:58px;text-align:right"></td>
      <td>
        <select data-eco="materiau" style="max-width:170px">
          ${MATERIAUX_UI.map(m => `<option value="${esc(m)}" ${l.materiau === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
      </td>
      <td class="num"><input data-eco="gd" type="checkbox" ${l.gestionDurable === 'certifiee' ? 'checked' : ''} title="Gestion durable certifiée"></td>
      <td class="num"><input data-eco="tarif" type="number" min="0" step="0.01" value="" placeholder="auto" style="width:76px;text-align:right" title="Vide = tarif du barème (HT), recalculé. Une valeur saisie ici prime."></td>
      <td class="num"><strong data-eco="total">—</strong></td>
    </tr>`;
}

function sectionEcoHtml({ nb, rows, detecte }) {
  return `
    <div class="card" style="margin-top:16px">
      <div class="section-header" style="margin-bottom:6px">
        <h2 class="section-title">Éco-contribution <span class="count" id="df-eco-count">(${nb} ligne${nb > 1 ? 's' : ''})</span></h2>
      </div>
      <p class="muted" style="font-size:13px">
        Barème Ecomaison <strong>2026</strong> (officiel, à la tranche de poids, en HT). Le poids est estimé depuis les dimensions du panneau. Modifie une ligne : le total suit.
      </p>
      ${!detecte ? `<p class="muted" style="font-size:13px">${icon('alert', 13)} Aucune tablette ni panneau lu automatiquement. Saisis les pièces ci-dessous.</p>` : ''}
      <div id="df-eco-avert"></div>
      <div style="overflow-x:auto">
        <table class="pipeline-table" style="margin-top:10px;min-width:780px">
          <thead>
            <tr>
              <th>Pièce</th><th class="num">Qté</th><th class="num">Long. (mm)</th><th class="num">Haut. (mm)</th>
              <th class="num">Épais.</th><th>Matériau</th><th class="num" title="Gestion durable certifiée">GD</th>
              <th class="num" title="Vide = calculé par le barème">Tarif HT</th><th class="num">Total HT</th>
            </tr>
          </thead>
          <tbody id="df-eco-rows">${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="8"><strong>Total éco-contribution HT</strong> <span class="muted" id="df-eco-partiel"></span></td>
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

// Lit les pièces saisies dans le tableau (pour l'appel serveur).
function lireEcoRows(out) {
  const tbody = out.querySelector('#df-eco-rows');
  if (!tbody) return [];
  return [...tbody.querySelectorAll('tr[data-eco-row]')].map(tr => {
    const tarifBrut = tr.querySelector('[data-eco=tarif]').value;
    return {
      _tr: tr,
      designation: tr.querySelector('[data-eco=designation]').value.trim(),
      quantite: Math.max(1, Number(tr.querySelector('[data-eco=quantite]').value) || 1),
      type: 'Joue / panneau',
      largeurMm: Number(tr.querySelector('[data-eco=longueur]').value) || null,
      hauteurMm: Number(tr.querySelector('[data-eco=hauteur]').value) || null,
      epaisseurMm: Number(tr.querySelector('[data-eco=epaisseur]').value) || null,
      classeMatiere: classeMatiere2026(tr.querySelector('[data-eco=materiau]').value, tr.querySelector('[data-eco=gd]').checked),
      tarifHtManuel: (tarifBrut !== '' && Number.isFinite(Number(tarifBrut))) ? Number(tarifBrut) : undefined,
    };
  });
}

// Affiche uniquement la réponse correspondant aux pièces encore à l'écran.
function afficherCalculEco(out, res) {
  const rows = lireEcoRows(out);
  const lignes = res.lignes || [];
  rows.forEach((r, i) => {
    const l = lignes[i] || {};
    const cell = r._tr.querySelector('[data-eco=total]');
    const tarifInput = r._tr.querySelector('[data-eco=tarif]');
    if (l.ecoHtUnitaire == null) {
      cell.textContent = '—';
      cell.title = (l.manquants || []).length ? 'Manque : ' + l.manquants.join(', ') : 'Non calculable';
      cell.style.color = 'var(--accent)';
    } else {
      cell.textContent = eur(l.totalHt);
      cell.style.color = '';
      cell.title = l.source === 'tarif-fournisseur' ? 'Tarif saisi à la main' : `${l.poidsKg} kg (${l.tranche || ''})`;
      if (tarifInput.value === '') tarifInput.placeholder = Number(l.ecoHtUnitaire).toFixed(2).replace('.', ',');
    }
  });
  out.querySelector('#df-eco-total-ht').textContent = res.piecesCalculees ? eur(res.totalHt) : '—';
  out.querySelector('#df-eco-partiel').textContent = res.piecesIncalculables
    ? `— partiel : ${res.piecesIncalculables} pièce(s) sans dimensions`
    : '';
  const av = out.querySelector('#df-eco-avert');
  if (av) av.innerHTML = (res.avertissements || []).length
    ? `<p class="muted" style="font-size:12px;color:var(--accent)">${res.avertissements.map(a => `${icon('alert', 12)} ${esc(a)}`).join('<br>')}</p>`
    : '';
}

function wireEco(out, { source, recompute }) {
  const tbody = out.querySelector('#df-eco-rows');
  if (!tbody) return;
  let t;
  const suivi = creerSuiviEco({
    source,
    calculer: pieces => calculEcoContribution(pieces, 20),
    reporter: total => { out.querySelector('#df-eco').value = total; },
    changer: etat => {
      out._ecoEtat = etat;
      if (etat.resultat) afficherCalculEco(out, etat.resultat);
      let message;
      if (etat.source === 'document') message = 'Montant d’éco lu dans le document, conservé pour la ligne Pennylane.';
      else if (etat.source === 'manuel') message = 'Montant d’éco saisi manuellement, retenu pour la ligne Pennylane.';
      else if (etat.statut === 'complet') message = `${eur(etat.resultat.totalHt)} HT calculés sur les pièces et reportés pour la ligne Pennylane.`;
      else if (etat.statut === 'erreur') message = `Calcul éco indisponible : ${etat.erreur}. Réessaie avec « Reporter » ou saisis un montant vérifié.`;
      else if (etat.statut === 'incomplet') message = 'Éco à compléter : vérifie les pièces et leurs dimensions, ou saisis un montant vérifié avant de créer le devis.';
      else message = 'Calcul de l’éco-participation en cours…';
      for (const id of ['#df-eco-etat', '#df-eco-report-msg']) {
        out.querySelector(id).textContent = message;
      }
      out.querySelector('#df-eco-report').disabled = etat.statut === 'calcul';
      if (etat.statut === 'erreur') out.querySelector('#df-eco-avert').textContent = message;
      recompute();
    },
  });
  const actualiser = () => suivi.actualiser(lireEcoRows(out).map(({ _tr, ...p }) => p));
  out._ecoDetruire = () => { clearTimeout(t); suivi.detruire(); };
  const debounced = () => {
    clearTimeout(t); suivi.invalider();
    t = setTimeout(actualiser, 250);
  };
  tbody.addEventListener('input', debounced);
  tbody.addEventListener('change', debounced);
  out.querySelector('#df-eco').addEventListener('input', () => suivi.manuel());
  out.querySelector('#df-eco-report')?.addEventListener('click', () => {
    clearTimeout(t); suivi.utiliserPanneaux(); actualiser();
  });
  out.querySelector('#df-eco-add')?.addEventListener('click', () => {
    clearTimeout(t); suivi.invalider();
    const index = tbody.querySelectorAll('tr[data-eco-row]').length;
    tbody.insertAdjacentHTML('beforeend', ligneEcoHtml(normEcoPiece(LIGNE_ECO_VIDE), index));
    out.querySelector('#df-eco-count').textContent = `(${index + 1} lignes)`;
    actualiser();
    tbody.querySelector(`tr[data-eco-row="${index}"] [data-eco=designation]`)?.focus();
  });
  actualiser();
}


// ---------------------------------------------------------------------------
// P-H4 — Création du devis client depuis le chiffrage
// ---------------------------------------------------------------------------
// Rattachement (choix JMG 27/08) : un projet existant, ou un client dont le
// projet est créé à la volée. Le devis part en BROUILLON et reste modifiable.

function openModalCreerDevis(out) {
  let prix;
  try { prix = prixDepuisEcran(out); }
  catch (e) {
    afficherErreurCreation(out, e);
    const cible = out.querySelector({ montantDocumentHt: '#df-totalht', ecoHt: '#df-eco', ecoIncluse: '#df-eco-incluse', piecesEco: '#df-eco-etat' }[e.champ] || '#df-validation');
    cible?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cible?.focus({ preventScroll: true });
    return;
  }
  const { prixClientHt, ecoHt: eco } = prix;
  const totalHt = Number(out.querySelector('#df-totalht').value);
  const tva = Number(out.querySelector('#df-tva').value) || 0;
  const designation = out.querySelector('#df-designation')?.value || '';
  // Famille proposée d'après le fournisseur lu : les plans de travail chez Granit
  // Evolution, le reste en mobilier. Virginie corrige si besoin.
  const nomFournisseur = String(current?.parsed?.fournisseur?.nom || current?.parsed?.fournisseur?.type_detecte || '');
  const familleParDefaut = /granit|plan de travail|quartz|c[ée]ramique/i.test(nomFournisseur + ' ' + designation) ? 'Plan de travail & crédence' : 'Mobilier';

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
        <label>Rechercher un projet ou un client <input id="cd-recherche" type="search" placeholder="Nom du client, référence du projet…" autocomplete="off"></label>
        <p id="cd-recherche-info" class="muted" aria-live="polite"></p>
        <label>Projet
          <select id="cd-projet" style="width:100%">
            <option value="">— choisir —</option>
            ${projets.map(p => `<option value="${esc(p.id)}">${esc(libelleProjet(p, clients))}</option>`).join('')}
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

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:10px">
        <label>Famille (commande et marge)
          <select id="cd-famille" style="width:100%">
            ${['Mobilier', 'Plan de travail & crédence', 'Sanitaire', 'Électroménager', 'Luminaire', 'Accessoires'].map(f => `<option ${f === familleParDefaut ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </label>
        <label>Type de devis
          <select id="cd-type" style="width:100%">
            <option value="">Automatique (Additif si le projet a déjà son principal)</option>
            <option value="Principal">Principal</option>
            <option value="Additif">Additif</option>
          </select>
        </label>
      </div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Le prix de vente est conservé. Le prix d’achat n’est enregistré que si vous l’avez renseigné séparément.</p>
      <p id="cd-erreur" role="alert" style="color:var(--accent)"></p>
      <div class="modal-actions" style="margin-top:18px">
        <button type="button" class="btn btn-ghost" id="cd-cancel">Annuler</button>
        <button type="button" class="btn btn-primary" id="cd-ok">Créer le devis</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  hydrateIcons(modal);
  let creationEnCours = false;
  const close = () => { if (!creationEnCours) modal.remove(); };
  modal.querySelector('#cd-cancel').onclick = close;
  modal.querySelector('#cd-recherche').addEventListener('input', e => {
    const select = modal.querySelector('#cd-projet');
    const retenus = filtrerProjets(projets, clients, e.target.value);
    const selected = select.value;
    select.innerHTML = '<option value="">— choisir —</option>' + retenus.map(p => `<option value="${esc(p.id)}">${esc(libelleProjet(p, clients))}</option>`).join('');
    if (retenus.some(p => p.id === selected)) select.value = selected;
    modal.querySelector('#cd-recherche-info').textContent = `${retenus.length} projet(s) trouvé(s)`;
  });
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  modal.querySelectorAll('input[name=cd-mode]').forEach(r => r.addEventListener('change', () => {
    const parProjet = modal.querySelector('input[name=cd-mode]:checked').value === 'projet';
    modal.querySelector('#cd-bloc-projet').style.display = parProjet ? '' : 'none';
    modal.querySelector('#cd-bloc-client').style.display = parProjet ? 'none' : '';
  }));

  modal.querySelector('#cd-ok').addEventListener('click', async () => {
    if (creationEnCours) return;
    const parProjet = modal.querySelector('input[name=cd-mode]:checked').value === 'projet';
    const projetId = parProjet ? modal.querySelector('#cd-projet').value : '';
    const clientId = parProjet ? '' : modal.querySelector('#cd-client').value;
    if ((parProjet && !projetId) || (!parProjet && !clientId)) {
      modal.querySelector('#cd-erreur').textContent = parProjet ? 'Choisis un projet pour créer le devis.' : 'Choisis un client pour créer le devis.';
      modal.querySelector(parProjet ? '#cd-projet' : '#cd-client').focus();
      return;
    }

    const btn = modal.querySelector('#cd-ok');
    creationEnCours = true;
    modal.querySelector('#cd-erreur').textContent = '';
    modal.querySelector('#cd-cancel').disabled = true;
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
        famille: modal.querySelector('#cd-famille').value,
        typeDevis: modal.querySelector('#cd-type').value || undefined,
        montantDocumentHt: totalHt,
        ecoIncluse: out.querySelector('#df-eco-incluse').value === 'oui',
        prixAchatHt: Number(out.querySelector('#df-achat').value) || undefined,
        descriptif: out.querySelector('#df-descriptif').value.trim(),
      });
      creationEnCours = false; close();
      // Jamais de silence : ce qui n'a pas pu être fait est annoncé, pas avalé
      // sous un message de succès.
      if (r.avertissements?.length) toast(r.avertissements.join(' · '), 'error', 7000);
      toast(`Devis ${r.numero} créé${r.typeDevis ? ` (${r.typeDevis})` : ''}${r.projetCree ? ' · projet créé' : ''}`, 'success');
      location.hash = `#devis/${r.devisId}`;
    } catch (err) {
      creationEnCours = false;
      modal.querySelector('#cd-cancel').disabled = false;
      modal.querySelector('#cd-erreur').textContent = 'Création impossible : ' + (err.message || err);
      btn.disabled = false; btn.textContent = 'Créer le devis';
      toast('Erreur : ' + (err.message || err), 'error', 6000);
    }
  });
}

function renderResult(out, res) {
  out._ecoDetruire?.();
  out._ecoEtat = null;
  const p = res.parsed || {};
  const enr = res.enrichissement || {};
  const four = p.fournisseur || {};
  const doc = p.document || {};
  const tot = p.totaux || {};
  const ecopart = enr.ecopart || {};
  const ecoPieces = enr.eco_pieces || null;

  const variante = p.variante_prix && p.variante_prix !== 'INCONNU'
    ? `<span class="badge">${esc(p.variante_prix)}</span>` : '';
  const ecoInit = ecopart.montant_ht != null ? ecopart.montant_ht : 0;
  const tvaInit = tot.tva_taux != null ? tot.tva_taux : 20;

  const alerteMasque = p.prix_par_ligne_disponible === false
    ? `<p class="muted" style="font-size:13px;color:var(--accent)">${icon('alert', 13)} Prix par ligne masqués sur ce devis — on travaille sur le total net.</p>` : '';
  const alerteParsing = p.alertes_parsing
    ? `<p class="muted" style="font-size:13px">${icon('alert', 13)} ${esc(p.alertes_parsing)}</p>` : '';


  out.innerHTML = `
    <div class="card">
      <div class="section-header" style="margin-bottom:8px">
        <h2 class="section-title">${esc(four.nom || four.type_detecte || 'Fournisseur')} ${variante}</h2>
      </div>
      <p class="muted" style="font-size:13px">
        ${doc.numero ? 'N° ' + esc(doc.numero) : ''}${doc.reference_chantier ? ' · réf. ' + esc(doc.reference_chantier) : ''}${doc.date ? ' · ' + esc(doc.date) : ''}
      </p>
      <p style="margin-top:6px">${esc(p.produit_resume || '')}</p>
      ${alerteMasque}${alerteParsing}

      <table class="pipeline-table" style="margin-top:14px">
        <tbody>
          <tr><td>Prix de vente HT du document</td><td class="num"><input id="df-totalht" aria-label="Prix de vente HT du document" type="number" step="0.01" min="0" value="${esc(tot.total_ht ?? '')}" style="width:140px;text-align:right"> €</td></tr>
          <tr>
            <td>Désignation (ligne client)</td>
            <td><input id="df-designation" aria-label="Désignation" value="${esc(p.produit_resume || (four.nom || '') )}" style="width:100%"></td>
          </tr>
          <tr>
            <td>Éco-participation HT${ecopart.categorie ? ' (' + esc(ecopart.categorie) + ')' : ''}</td>
            <td class="num"><div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;flex-wrap:wrap">
              <span style="white-space:nowrap"><input id="df-eco" aria-label="Éco-participation HT" aria-describedby="df-eco-ttc" type="number" step="0.01" min="0" value="${ecoInit}" style="width:90px;text-align:right"> € HT</span>
              <span id="df-eco-ttc" aria-live="polite" style="white-space:nowrap">— TTC</span>
            </div></td>
          </tr>
          <tr>
            <td>L’éco-participation est-elle dans le montant ci-dessus ?</td>
            <td><select id="df-eco-incluse" aria-label="Traitement de l’éco-participation"><option value="">À confirmer si éco &gt; 0</option><option value="oui" ${tot.eco_incluse === true ? 'selected' : ''}>Oui, déjà incluse</option><option value="non" ${tot.eco_incluse === false ? 'selected' : ''}>Non, à ajouter une fois</option></select></td>
          </tr>
          <tr><td>Prix d’achat HT (facultatif, si connu)</td><td class="num"><input id="df-achat" aria-label="Prix d’achat HT si connu" type="number" min="0" step="0.01" placeholder="Non renseigné" style="width:140px"></td></tr>
          <tr>
            <td>TVA</td>
            <td class="num">
              <select id="df-tva" aria-label="TVA" style="width:90px">
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

      <p id="df-eco-etat" role="status" aria-live="polite" tabindex="-1"></p>
      <p id="df-validation" role="status" aria-live="polite" tabindex="-1" style="color:var(--accent)"></p>
    </div>

    ${renderEcoSection(ecoPieces)}

    <div class="card" style="margin-top:16px">
      <label style="display:block">Descriptif complet pour l’annexe du devis
        <textarea id="df-descriptif" rows="8" style="display:block;width:100%;margin-top:8px">${esc(p.descriptif_complet || p.produit_resume || '')}</textarea>
      </label>
      <p class="muted" id="df-prix-erreur" role="status"></p>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="df-create" aria-describedby="df-prix-erreur">${icon('filePlus', 14)} Créer le devis client</button>
        <span class="muted" style="font-size:12px;align-self:center">Choisir le client et le projet, puis créer le devis dans Pennylane depuis sa fiche.</span>
      </div>
    </div>
  `;
  hydrateIcons(out);

  const recompute = () => {
    out.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
    const tva = Number(out.querySelector('#df-tva').value) || 0;
    const ecoSaisie = out.querySelector('#df-eco').value;
    const ecoHt = Number(ecoSaisie);
    const ecoTtc = Math.round((ecoHt * (1 + tva / 100) + Number.EPSILON) * 100) / 100;
    out.querySelector('#df-eco-ttc').textContent = ecoSaisie.trim() !== '' && Number.isFinite(ecoHt) && ecoHt >= 0
      ? `soit ${eur(ecoTtc)} TTC · TVA ${tva.toLocaleString('fr-FR')} %`
      : '— TTC';
    let prix;
    try { prix = prixDepuisEcran(out); }
    catch (e) {
      out.querySelector('#df-prixht').textContent = '—';
      out.querySelector('#df-prixttc').textContent = '—';
      afficherErreurCreation(out, e);
      return;
    }
    out.querySelector('#df-validation').textContent = '';
    out.querySelector('#df-prix-erreur').textContent = 'Aucun coefficient ajouté. L’éco-participation est comptée une seule fois.';
    out.querySelector('#df-prix-erreur').style.color = '';
    const ht = prix.prixClientHt;
    const ttc = Math.round(ht * (1 + tva / 100) * 100) / 100;
    out.querySelector('#df-prixht').textContent = eur(ht);
    out.querySelector('#df-prixttc').textContent = eur(ttc);
  };
  ['#df-totalht', '#df-eco', '#df-eco-incluse', '#df-tva'].forEach(sel => {
    out.querySelector(sel).addEventListener('input', recompute);
    out.querySelector(sel).addEventListener('change', recompute);
  });
  recompute();

  // Éco-contribution : tableau par pièce, recalcul live, report dans le prix.
  const ecoDocument = tot.eco_ht != null || ecopart.source === 'document';
  const panneauxAttendus = ecoPieces?.length > 0 || p.categorie_suggeree === 'Meuble'
    || /novamobili|metron|dressing|tablette|panneau/i.test(`${four.nom || ''} ${four.type_detecte || ''} ${p.produit_resume || ''}`);
  wireEco(out, { source: ecoDocument ? 'document' : panneauxAttendus ? 'panneaux' : 'manuel', recompute });

  // P-H4 — création du devis client à partir du chiffrage affiché.
  out.querySelector('#df-create')?.addEventListener('click', () => openModalCreerDevis(out));
}

function prixDepuisEcran(out) {
  if (out._ecoEtat?.bloque) {
    const e = new Error(out.querySelector('#df-eco-etat').textContent);
    e.champ = 'piecesEco'; throw e;
  }
  const inclusion = out.querySelector('#df-eco-incluse').value;
  return calculPrixImport({ montantDocumentHt: out.querySelector('#df-totalht').value, ecoHt: out.querySelector('#df-eco').value, ecoIncluse: inclusion === 'oui' ? true : inclusion === 'non' ? false : undefined });
}

function afficherErreurCreation(out, erreur) {
  const message = `À compléter avant création : ${erreur.message}`;
  out.querySelector('#df-validation').textContent = message;
  out.querySelector('#df-prix-erreur').textContent = message;
  out.querySelector('#df-prix-erreur').style.color = 'var(--accent)';
  const champ = out.querySelector({ montantDocumentHt: '#df-totalht', ecoHt: '#df-eco', ecoIncluse: '#df-eco-incluse' }[erreur.champ] || '#df-eco');
  champ.setAttribute('aria-invalid', 'true');
  champ.setAttribute('aria-describedby', 'df-validation');
}
