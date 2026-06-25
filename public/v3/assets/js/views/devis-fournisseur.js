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
import { parseDevisFournisseur } from '../core/api.js';

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

function renderResult(out, res) {
  const p = res.parsed || {};
  const enr = res.enrichissement || {};
  const four = p.fournisseur || {};
  const doc = p.document || {};
  const tot = p.totaux || {};
  const marge = enr.marge || {};
  const ecopart = enr.ecopart || {};

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
        <button class="btn btn-primary" id="df-create" disabled title="Disponible à l'étape suivante (P-H4)">${icon('filePlus', 14)} Créer le devis client</button>
        <span class="muted" style="font-size:12px;align-self:center">Création du devis client : étape suivante (P-H4).</span>
      </div>
    </div>
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
}
