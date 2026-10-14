// Vue « Devis express — Électroménager (FINDIS) » (demande JMG du 14/10/2026).
//
// On dépose la page « Projet » FINDIS : le PDF obtenu par « Imprimer mon projet »
// (lu par son TEXTE, exact) ou des captures d'écran (lues par l'IA : prix à
// vérifier). Chaque article arrive avec son prix de vente TTC, son prix d'achat
// HT (la promo quand il y en a une) et son éco-participation HT. On coche les
// articles retenus — un projet FINDIS est souvent un comparatif —, on ajuste si
// besoin, et on crée le devis client : une ligne par article, prix d'achat et
// fournisseur Findis conservés (marge de la partie, BC Findis à la signature).
//
// Le calcul affiché reprend celui de services/devis-electro.js (montantsLigne,
// totauxArticles) ; à la création, le serveur recalcule et fait foi.

import { icon, hydrateIcons } from '../core/lucide.js';
import { toast } from '../core/ui.js';
import { lireProjetFindis, creerDevisElectro } from '../core/api.js';
import { state } from '../core/state.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n) => (n == null || Number.isNaN(Number(n)))
  ? '—'
  : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pct = (n) => (n == null ? '—' : String(Number(n).toFixed(1)).replace('.', ',') + ' %');
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const FAMILLES = ['Électroménager', 'Robinetterie', 'Luminaire'];

let lecture = null;        // réponse de /findis/lire
let retenus = new Map();   // id article → coché ?
let tva = 20;

function montants(a) {
  const q = Number(a.quantite) || 1;
  const venteTtc = round2((Number(a.venteTtcUnit) || 0) * q);
  const venteHt = round2(venteTtc / (1 + tva / 100));
  const ecoHt = round2((Number(a.ecoHtUnit) || 0) * q);
  const venteHtHorsEco = round2(venteHt - ecoHt);
  const achatHt = round2((Number(a.achatRetenuHtUnit) || 0) * q);
  const marge = round2(venteHtHorsEco - achatHt);
  return { venteTtc, venteHt, ecoHt, venteHtHorsEco, achatHt, marge, margePct: venteHtHorsEco > 0 ? (marge / venteHtHorsEco) * 100 : null };
}

// Totaux sur les SOMMES (TTC, éco, achat) puis convertis, comme le devis créé.
function totaux(articles) {
  const acc = () => ({ venteTtc: 0, ecoHt: 0, achatHt: 0, nb: 0 });
  const global = acc();
  const parFamille = {};
  for (const a of articles) {
    const m = montants(a);
    for (const c of [global, (parFamille[a.famille] ||= acc())]) {
      c.venteTtc = round2(c.venteTtc + m.venteTtc); c.ecoHt = round2(c.ecoHt + m.ecoHt); c.achatHt = round2(c.achatHt + m.achatHt); c.nb += 1;
    }
  }
  const fin = o => {
    const venteHt = round2(o.venteTtc / (1 + tva / 100));
    const venteHtHorsEco = round2(venteHt - o.ecoHt);
    const marge = round2(venteHtHorsEco - o.achatHt);
    return { ...o, venteHt, venteHtHorsEco, marge, margePct: venteHtHorsEco > 0 ? (marge / venteHtHorsEco) * 100 : null };
  };
  return { global: fin(global), parFamille: Object.fromEntries(Object.entries(parFamille).map(([k, v]) => [k, fin(v)])) };
}

const articlesRetenus = () => (lecture?.articles || []).filter(a => a.selectionnable && retenus.get(a.id));

export function renderElectro(panel) {
  panel.innerHTML = `
    <div class="card" id="dx-dropzone" style="text-align:center;padding:28px 20px;border:2px dashed var(--line2);cursor:pointer">
      <div style="color:var(--ink3)">${icon('upload', 32)}</div>
      <p style="margin-top:8px;font-weight:500">Déposer le projet FINDIS</p>
      <p class="muted" style="font-size:13px;max-width:560px;margin:4px auto 0">
        Le PDF obtenu par « Imprimer mon projet » est lu <strong>exactement</strong>.
        Des captures d'écran de la page marchent aussi (plusieurs à la fois) : elles sont lues par l'IA, vérifie les prix.
      </p>
      <input type="file" id="dx-files" multiple accept="application/pdf,image/png,image/jpeg,image/webp" style="display:none">
    </div>
    <div id="dx-status" style="margin-top:16px"></div>
    <div id="dx-result" style="margin-top:16px"></div>
  `;
  hydrateIcons(panel);
  const dz = panel.querySelector('#dx-dropzone');
  const input = panel.querySelector('#dx-files');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files.length) lire([...input.files]); input.value = ''; });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = 'var(--line2)'; });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.style.borderColor = 'var(--line2)';
    if (e.dataTransfer.files.length) lire([...e.dataTransfer.files]);
  });
  if (lecture) renderResultat();
}

async function lire(files) {
  const statusEl = document.getElementById('dx-status');
  const resultEl = document.getElementById('dx-result');
  resultEl.innerHTML = '';
  const images = files.filter(f => /^image\//.test(f.type)).length;
  statusEl.innerHTML = `<div class="card"><p class="muted" style="margin:0">${icon('clock', 14)} Lecture de ${files.length} fichier${files.length > 1 ? 's' : ''}…${images ? ' Les captures passent par l\'IA : compter 15 à 45 secondes.' : ''}</p></div>`;
  hydrateIcons(statusEl);
  try {
    lecture = await lireProjetFindis(files);
  } catch (e) {
    lecture = null;
    statusEl.innerHTML = `<div class="card" style="border-left:3px solid var(--accent)"><p style="margin:0">${icon('alert', 14)} Lecture impossible : ${esc(e.message)}</p><p class="muted" style="font-size:13px;margin:6px 0 0">Dépose de nouveau le fichier, ou le PDF « Imprimer mon projet » plutôt qu'une capture.</p></div>`;
    hydrateIcons(statusEl);
    return;
  }
  statusEl.innerHTML = '';
  // Pré-sélection : tout ce qui a un prix, SAUF les articles d'un comparatif — ceux-là
  // se choisissent (cocher d'office trois réfrigérateurs ferait un devis faux).
  const enComparatif = new Set((lecture.comparatifs || []).flatMap(c => c.ids));
  retenus = new Map(lecture.articles.map(a => [a.id, a.selectionnable && !enComparatif.has(a.id)]));
  renderResultat();
}

function ligneHtml(a) {
  const m = montants(a);
  const coche = !!retenus.get(a.id);
  const badges = [
    a.promoRetenue ? `<span class="badge" style="background:var(--green-lo,#e8f5e9);color:var(--green,#2e7d32)" title="P.Achat ${eur(a.achatHtUnit)} → promo ${eur(a.promoHtUnit)}">promo</span>` : '',
    a.horsTarif ? '<span class="badge">hors tarif</span>' : '',
  ].filter(Boolean).join(' ');
  const notes = (a.notes || []).filter(n => !/^Hors tarif/.test(n)).join(' · ');
  const input = (k, v, w = 84) => `<input data-k="${k}" type="number" min="0" step="${k === 'quantite' ? 1 : 0.01}" value="${v ?? ''}" ${a.selectionnable ? '' : 'disabled'} style="width:${w}px;text-align:right">`;
  return `
    <tr data-id="${a.id}" style="${coche ? '' : 'opacity:.62'}">
      <td><input type="checkbox" data-k="retenu" ${coche ? 'checked' : ''} ${a.selectionnable ? '' : 'disabled'} aria-label="Retenir ${esc(a.marque)} ${esc(a.reference)}"></td>
      <td style="min-width:220px">
        <strong style="word-break:break-word">${esc([a.marque, a.libelle].filter(Boolean).join(' '))}</strong> ${badges}
        <div class="muted" style="font-size:12px">${esc([a.reference, a.typeFindis].filter(Boolean).join(' · '))}</div>
        ${a.selectionnable ? (notes ? `<div class="muted" style="font-size:11px">${esc(notes)}</div>` : '') : `<div style="font-size:12px;color:var(--accent)">${icon('alert', 12)} ${esc(a.raisonNonSelectionnable)}</div>`}
      </td>
      <td><select data-k="famille" ${a.selectionnable ? '' : 'disabled'}>${FAMILLES.map(f => `<option ${f === a.famille ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
      <td class="num">${input('quantite', a.quantite, 56)}</td>
      <td class="num">${input('venteTtcUnit', a.venteTtcUnit)}</td>
      <td class="num">${input('achatRetenuHtUnit', a.achatRetenuHtUnit)}</td>
      <td class="num">${input('ecoHtUnit', a.ecoHtUnit, 70)}</td>
      <td class="num" data-cell="marge" style="white-space:nowrap">${a.selectionnable ? `<strong>${eur(m.marge)}</strong><div class="muted" style="font-size:11px">${pct(m.margePct)}</div>` : '—'}</td>
    </tr>`;
}

function renderResultat() {
  const out = document.getElementById('dx-result');
  if (!out || !lecture) return;
  const lectures = lecture.lectures || [];
  const alertes = lecture.alertes || [];
  const comparatifs = lecture.comparatifs || [];
  out.innerHTML = `
    <div class="card">
      <div class="section-header" style="margin-bottom:6px">
        <h2 class="section-title">${icon('file-text', 18)} Projet FINDIS${lecture.projetFindis ? ` n° ${esc(lecture.projetFindis)}` : ''} <span class="count">(${lecture.articles.length} article${lecture.articles.length > 1 ? 's' : ''})</span></h2>
      </div>
      <ul style="margin:0 0 0 18px;padding:0;font-size:13px">
        ${lectures.map(l => `<li>${esc(l.fichier)} : ${l.mode === 'texte'
          ? `lu par son texte, <strong>exact</strong> · ${l.articles} article${l.articles > 1 ? 's' : ''}`
          : `<span style="color:var(--accent)">lu par l'IA, vérifie les prix</span> · ${l.articles} article${l.articles > 1 ? 's' : ''}`}</li>`).join('')}
      </ul>
      ${alertes.length ? `<ul style="margin:8px 0 0 18px;padding:0;font-size:13px;color:var(--accent)">${alertes.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${comparatifs.length ? `<div style="margin-top:10px;padding:10px 12px;border-radius:var(--r-sm);background:var(--bg-soft,#f7f7f5);font-size:13px">
        ${icon('alert', 14)} <strong>Comparatif à trancher</strong> : ${comparatifs.map(c => `${c.ids.length} × ${esc(c.type.toLowerCase())}`).join(', ')}. Ces articles ne sont pas cochés : coche ceux que le client retient.
      </div>` : ''}
      <div class="table-scroll" style="margin-top:12px">
        <table class="pipeline-table" id="dx-table" style="min-width:860px">
          <thead><tr>
            <th></th><th>Article</th><th>Famille</th><th class="num">Qté</th>
            <th class="num" title="Prix de vente unitaire, éco comprise">Vente TTC</th>
            <th class="num" title="Prix d'achat unitaire : la promo FINDIS quand il y en a une">Achat HT</th>
            <th class="num" title="Éco-participation unitaire, reversée (hors marge)">Éco HT</th>
            <th class="num">Marge HT</th>
          </tr></thead>
          <tbody>${lecture.articles.map(ligneHtml).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:16px" id="dx-totaux"></div>
  `;
  hydrateIcons(out);
  const tbody = out.querySelector('#dx-table tbody');
  const onEdit = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const a = lecture.articles.find(x => String(x.id) === tr.dataset.id);
    const k = e.target.dataset.k;
    if (!a || !k) return;
    if (k === 'retenu') { retenus.set(a.id, e.target.checked); tr.style.opacity = e.target.checked ? '' : '.62'; }
    else if (k === 'famille') a.famille = e.target.value;
    else if (k === 'quantite') a.quantite = Math.max(1, Math.round(Number(e.target.value) || 1));
    else a[k] = e.target.value === '' ? null : Number(e.target.value);
    // Prix d'achat corrigé à la main : la mention « promo retenue » ne vaut plus que s'il égale la promo.
    if (k === 'achatRetenuHtUnit') a.promoRetenue = a.promoHtUnit != null && Number(a.achatRetenuHtUnit) === Number(a.promoHtUnit);
    const m = montants(a);
    const cell = tr.querySelector('[data-cell=marge]');
    if (cell && a.selectionnable) cell.innerHTML = `<strong>${eur(m.marge)}</strong><div class="muted" style="font-size:11px">${pct(m.margePct)}</div>`;
    renderTotaux();
  };
  tbody.addEventListener('input', onEdit);
  tbody.addEventListener('change', onEdit);
  renderTotaux();
}

function renderTotaux() {
  const box = document.getElementById('dx-totaux');
  if (!box) return;
  const arts = articlesRetenus();
  const t = totaux(arts);
  const ligne = (nom, o, fort = false) => `
    <tr${fort ? ' style="font-weight:600"' : ''}>
      <td>${esc(nom)} <span class="muted" style="font-weight:400">(${o.nb})</span></td>
      <td class="num">${eur(o.venteTtc)}</td><td class="num">${eur(o.venteHt)}</td><td class="num">${eur(o.ecoHt)}</td>
      <td class="num">${eur(o.achatHt)}</td><td class="num">${eur(o.marge)}</td><td class="num">${pct(o.margePct)}</td>
    </tr>`;
  const familles = Object.keys(t.parFamille);
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <h2 class="section-title" style="margin:0">Devis client · ${arts.length} article${arts.length > 1 ? 's' : ''} retenu${arts.length > 1 ? 's' : ''}</h2>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px">TVA
        <select id="dx-tva">${[20, 10, 5.5].map(v => `<option value="${v}" ${v === tva ? 'selected' : ''}>${String(v).replace('.', ',')} %</option>`).join('')}</select>
      </label>
    </div>
    ${arts.length ? `
    <div class="table-scroll" style="margin-top:10px">
      <table class="pipeline-table" style="min-width:640px">
        <thead><tr><th>Partie</th><th class="num">Vente TTC</th><th class="num">Vente HT</th><th class="num">dont éco HT</th><th class="num">Achat HT</th><th class="num">Marge HT</th><th class="num">Marge</th></tr></thead>
        <tbody>
          ${familles.length > 1 ? familles.map(f => ligne(f, t.parFamille[f])).join('') : ''}
          ${ligne(familles.length > 1 ? 'Total' : (familles[0] || 'Total'), t.global, true)}
        </tbody>
      </table>
    </div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Marge = vente HT hors éco − achat HT. L'éco-participation est reversée : elle part dans Pennylane sur une ligne hors chiffre d'affaires.</p>`
    : '<p class="muted" style="margin:10px 0 0">Coche au moins un article.</p>'}
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-primary" id="dx-creer" ${arts.length ? '' : 'disabled'}>${icon('plus', 14)} Créer le devis client</button>
      <span class="muted" style="font-size:12px">Brouillon, une ligne par article, modifiable ensuite.</span>
    </div>`;
  hydrateIcons(box);
  box.querySelector('#dx-tva').addEventListener('change', (e) => {
    tva = Number(e.target.value);
    lecture.articles.forEach(a => {
      const tr = document.querySelector(`#dx-table tr[data-id="${a.id}"] [data-cell=marge]`);
      if (tr && a.selectionnable) { const m = montants(a); tr.innerHTML = `<strong>${eur(m.marge)}</strong><div class="muted" style="font-size:11px">${pct(m.margePct)}</div>`; }
    });
    renderTotaux();
  });
  box.querySelector('#dx-creer')?.addEventListener('click', () => openModalCreer());
}

function openModalCreer() {
  const arts = articlesRetenus();
  if (!arts.length) return;
  const t = totaux(arts).global;
  const projets = (state.projets || []).slice().sort((a, b) => String(a['Référence'] || '').localeCompare(String(b['Référence'] || ''), 'fr'));
  const clients = (state.clients || []).slice().sort((a, b) => String(a.Nom || '').localeCompare(String(b.Nom || ''), 'fr'));
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dxc-title" style="max-width:560px">
      <h2 id="dxc-title">Créer le devis électroménager</h2>
      <p class="muted" style="margin-top:0">${arts.length} article${arts.length > 1 ? 's' : ''} — <strong>${eur(t.venteTtc)} TTC</strong> · marge prévue ${eur(t.marge)} HT (${pct(t.margePct)})</p>
      <div style="display:flex;gap:16px;margin:14px 0 10px;flex-wrap:wrap">
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="radio" name="dxc-mode" value="projet" checked> Projet existant</label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="radio" name="dxc-mode" value="client"> Nouveau chantier pour un client</label>
      </div>
      <div id="dxc-bloc-projet">
        <label>Projet
          <select id="dxc-projet" style="width:100%"><option value="">— choisir —</option>
            ${projets.map(p => `<option value="${esc(p.id)}">${esc(p['Référence'] || '(sans référence)')}</option>`).join('')}
          </select>
        </label>
      </div>
      <div id="dxc-bloc-client" style="display:none">
        <label>Client
          <select id="dxc-client" style="width:100%"><option value="">— choisir —</option>
            ${clients.map(c => `<option value="${esc(c.id)}">${esc(c.Nom || '(sans nom)')}</option>`).join('')}
          </select>
        </label>
        <p class="muted" style="font-size:13px;margin-top:4px">Un projet sera créé pour ce client.</p>
      </div>
      <label style="margin-top:10px">Type de devis
        <select id="dxc-type" style="width:100%">
          <option value="">Automatique : « Additif » si le projet a déjà son devis principal</option>
          <option value="Principal">Principal</option>
          <option value="Additif">Additif (s'ajoute au devis principal)</option>
        </select>
      </label>
      <div class="modal-actions" style="margin-top:18px">
        <button type="button" class="btn btn-ghost" id="dxc-cancel">Annuler</button>
        <button type="button" class="btn btn-primary" id="dxc-ok">Créer le devis</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#dxc-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelectorAll('input[name=dxc-mode]').forEach(r => r.addEventListener('change', () => {
    const parProjet = modal.querySelector('input[name=dxc-mode]:checked').value === 'projet';
    modal.querySelector('#dxc-bloc-projet').style.display = parProjet ? '' : 'none';
    modal.querySelector('#dxc-bloc-client').style.display = parProjet ? 'none' : '';
  }));
  modal.querySelector('#dxc-ok').addEventListener('click', async () => {
    const parProjet = modal.querySelector('input[name=dxc-mode]:checked').value === 'projet';
    const projetId = parProjet ? modal.querySelector('#dxc-projet').value : '';
    const clientId = parProjet ? '' : modal.querySelector('#dxc-client').value;
    if (parProjet && !projetId) { toast('Choisis un projet', 'error'); return; }
    if (!parProjet && !clientId) { toast('Choisis un client', 'error'); return; }
    const btn = modal.querySelector('#dxc-ok');
    btn.disabled = true; btn.textContent = 'Création…';
    try {
      const r = await creerDevisElectro({
        projetId: projetId || undefined,
        clientId: clientId || undefined,
        typeDevis: modal.querySelector('#dxc-type').value || undefined,
        tvaTaux: tva,
        projetFindis: lecture.projetFindis || '',
        articles: arts.map(a => ({
          reference: a.reference, marque: a.marque, libelle: a.libelle, typeFindis: a.typeFindis, famille: a.famille,
          quantite: a.quantite, venteTtcUnit: a.venteTtcUnit, achatHtUnit: a.achatHtUnit, promoHtUnit: a.promoHtUnit,
          promoRetenue: a.promoRetenue, achatRetenuHtUnit: a.achatRetenuHtUnit, ecoHtUnit: a.ecoHtUnit, notes: a.notes,
        })),
      });
      close();
      // Jamais de silence : ce qui n'a pas pu être fait est annoncé, pas avalé.
      for (const av of (r.avertissements || [])) toast(av, 'error', 9000);
      const g = r.totaux?.global;
      toast(`Devis ${r.numero} créé (${r.typeDevis})${r.projetCree ? ' · projet créé' : ''}${g ? ` · marge prévue ${eur(g.marge)} HT` : ''}`, 'success', 7000);
      location.hash = `#devis/${r.devisId}`;
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Créer le devis';
      toast('Erreur : ' + (err.message || err), 'error', 7000);
    }
  });
}
