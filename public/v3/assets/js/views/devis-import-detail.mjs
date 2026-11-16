import { controlerDetail, eurosDetail, lireDetail } from '../core/devis-detail.mjs';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const familles = ['Mobilier', 'Plan de travail & crédence', 'Sanitaire', 'Électroménager', 'Luminaire', 'Accessoires', 'Pose', 'Livraison', 'Autre'];
function champ(l, key, label, type = 'number') {
  return `<label style="display:grid;gap:4px;font-size:12px">${label}<input data-champ="${key}" aria-label="${label}" type="${type}" ${type === 'number' ? 'step="any" min="0"' : ''} value="${esc(l[key] ?? '')}" style="width:100%"></label>`;
}
function ligneEdition(l, i) {
  return `<article class="card" data-detail-ligne="${i}" style="margin-top:10px;padding:18px">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><strong>${esc(l.section || (l.type === 'eco' ? 'Éco-participation' : 'Article'))} · ${i + 1}</strong><strong data-net>${l.total_ht != null ? eurosDetail(l.total_ht) : 'Net HT à préciser'}</strong></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px">
      ${champ(l, 'code_produit', 'Références complètes', 'text')}
      <label style="display:grid;gap:4px;font-size:12px">Descriptif intégral<textarea data-champ="designation" aria-label="Descriptif intégral" rows="3">${esc(l.designation)}</textarea></label>
    </div>
    <label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:8px"><input data-champ="sans_reference_confirme" type="checkbox" ${l.sans_reference_confirme ? 'checked' : ''}>Sans référence catalogue (prestation ou sur-mesure confirmé)</label>
    <details style="margin-top:12px" ${Number(l.remise_ht) > 0 || Number(l.remise_pct) > 0 ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">Quantité, prix et remise${Number(l.remise_ht) > 0 ? ` · −${eurosDetail(l.remise_ht)} HT` : ''}</summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:12px;margin-top:12px">
        ${champ(l, 'quantite', 'Quantité')}${champ(l, 'pu_ht', 'PU brut HT hors éco')}${champ(l, 'remise_pct', 'Remise article %')}${champ(l, 'remise_ht', 'Remise article HT')}${champ(l, 'eco_ht', 'Éco de cette ligne HT')}${champ(l, 'total_ht', 'Net HT, éco comprise')}
        <label>TVA<select data-champ="tva_taux" aria-label="TVA de la ligne"><option value="">À préciser</option>${[0, 5.5, 10, 20].map(n => `<option value="${n}" ${Number(l.tva_taux) === n && l.tva_taux != null ? 'selected' : ''}>${n} %</option>`).join('')}</select></label>
        <label>Type<select data-champ="type" aria-label="Type de ligne"><option value="article">Article / prestation</option><option value="eco" ${l.type === 'eco' ? 'selected' : ''}>Éco seule</option></select></label>
        <label>Famille<select data-champ="categorie" aria-label="Famille de l’article"><option value="">À choisir</option>${[...new Set([...familles, l.categorie].filter(Boolean))].map(f => `<option ${l.categorie === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      </div>
      <p class="muted" style="font-size:12px;margin-bottom:0">La remise en euros porte sur toute la ligne. Le net lu est contrôlé, jamais remplacé automatiquement.</p>
    </details>
  </article>`;
}
export function renderImportDetail(out, res, creer) {
  out._ecoDetruire?.(); out._ecoEtat = null; out.classList.add('devis-import-detail');
  const p = structuredClone(res.parsed || {}), t = p.totaux || {};
  const lignes = (p.lignes_detail || []).map(l => ({ ...l, tva_taux: l.tva_taux ?? t.tva_taux }));
  out.innerHTML = `<div class="card">
    <span class="badge">Import détaillé · ${lignes.length} lignes</span>
    <h2 style="margin:12px 0 8px">Vérifier le devis avant de le créer</h2>
    <p class="muted">Références, descriptifs et remises seront conservés sur la fiche et dans l’annexe complète du devis.</p>
    ${p.alertes_parsing ? `<p role="alert">${esc(p.alertes_parsing)}</p>` : ''}
    <label>Intitulé du devis<input id="dd-designation" style="width:100%" value="${esc(p.produit_resume)}"></label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:16px">
      ${champ(t, 'total_ht', 'Total HT du document')}${champ(t, 'total_ttc', 'Total TTC du document')}${champ(t, 'tva_montant', 'TVA totale du document')}
      ${champ(t, 'remise_globale_ht', 'Remise globale HT')}${champ(t, 'remise_globale_pct', 'Remise globale %')}${champ(t, 'eco_ht', 'Éco totale HT du document')}
      <label>Éco dans le total du document<select id="dd-incluse"><option value="">À préciser</option><option value="oui" ${t.eco_incluse === true ? 'selected' : ''}>Déjà incluse</option><option value="non" ${t.eco_incluse === false ? 'selected' : ''}>À ajouter une seule fois</option></select></label>
    </div>
  </div>
  <div id="dd-lignes">${lignes.map(ligneEdition).join('')}</div>
  <div class="card" style="margin-top:16px">
    <details><summary style="cursor:pointer;font-weight:600">Informations communes au descriptif</summary><textarea id="dd-descriptif" rows="6" style="width:100%;margin-top:10px">${esc(p.descriptif_complet || '')}</textarea></details>
    <div id="dd-controle" role="status" aria-live="polite" style="margin-top:16px"></div>
    <label style="display:flex;align-items:flex-start;gap:8px;margin-top:18px"><input id="dd-verifie" type="checkbox">J’ai vérifié les références, les descriptifs, les remises et les totaux avec le document d’origine.</label>
    <p id="dd-erreur" role="alert"></p>
    <button class="btn btn-primary" id="dd-creer" style="margin-top:12px">Choisir le client et créer le devis</button>
  </div>`;
  const lire = () => {
    const d = { ...p, produit_resume: out.querySelector('#dd-designation').value.trim(), descriptif_complet: out.querySelector('#dd-descriptif').value, totaux: { ...t }, lignes_detail: [] };
    for (const el of out.querySelectorAll(':scope > .card:first-child [data-champ]')) d.totaux[el.dataset.champ] = el.value === '' ? null : el.value;
    const incl = out.querySelector('#dd-incluse').value; d.totaux.eco_incluse = incl === 'oui' ? true : incl === 'non' ? false : null;
    for (const row of out.querySelectorAll('[data-detail-ligne]')) {
      const l = { ...lignes[Number(row.dataset.detailLigne)] };
      for (const el of row.querySelectorAll('[data-champ]')) l[el.dataset.champ] = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.dataset.champ === 'tva_taux' ? el.value === '' ? null : el.value : el.value;
      d.lignes_detail.push(l);
    }
    return { document: d, controle: controlerDetail(d), verifie: out.querySelector('#dd-verifie').checked, source: res.source };
  };
  out._lireDetail = lire;
  const calculer = e => {
    if (e && e.target.id !== 'dd-verifie') out.querySelector('#dd-verifie').checked = false;
    const { controle: c } = lire();
    out.querySelector('#dd-controle').innerHTML = `<div class="kpi-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
      <div><small>Remises articles</small><div><strong>−${eurosDetail(c.totaux.remise_lignes_ht)}</strong></div></div>
      <div><small>Remise globale</small><div><strong>−${eurosDetail(c.totaux.remise_globale_ht)}</strong></div></div>
      <div><small>Net HT, éco comprise</small><div><strong>${eurosDetail(c.totaux.total_ht)}</strong></div></div>
      <div><small>Total TTC</small><div><strong>${eurosDetail(c.totaux.total_ttc)}</strong></div></div></div>
      ${c.ok ? '<p style="color:var(--success,#37624b)"><strong>Les totaux correspondent au document.</strong></p>' : `<p><strong>À corriger avant création</strong></p><ul>${c.erreurs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}
      ${c.alertes.filter(x => !x.includes('aucune référence')).map(x => `<p class="muted">${esc(x)}</p>`).join('')}`;
    c.lignes.forEach((l, i) => { out.querySelector(`[data-detail-ligne="${i}"] [data-net]`).textContent = l.total_ht != null ? eurosDetail(l.total_ht) + ' HT' : 'Net HT à préciser'; });
    out.querySelector('#dd-erreur').textContent = '';
  };
  out.addEventListener('input', calculer);
  out.addEventListener('change', calculer);
  out._ecoDetruire = () => { out.removeEventListener('input', calculer); out.removeEventListener('change', calculer); delete out._lireDetail; out.classList.remove('devis-import-detail'); };
  out.querySelector('#dd-creer').onclick = () => {
    const d = lire();
    if (!d.controle.ok || !d.verifie) { out.querySelector('#dd-erreur').textContent = d.controle.ok ? 'Coche la vérification après relecture du document.' : 'Corrige les points signalés ci-dessus avant de créer le devis.'; out.querySelector('#dd-controle').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    creer();
  };
  calculer();
}

export function renderDetailEnregistre(fields) {
  let s;
  try { s = lireDetail(fields); } catch (e) { return `<p role="alert">${esc(e.message)}</p>`; }
  if (!s) return '';
  const c = controlerDetail(s.document);
  return `${s.etat !== 'complet' ? '<p role="alert"><strong>Import incomplet. Reprends le même document et le même projet depuis Devis express pour terminer sans doublon.</strong></p>' : ''}
    <div class="card" style="margin-bottom:16px"><strong>Remises conservées</strong><p>Articles : −${eurosDetail(c.totaux.remise_lignes_ht)} HT · Globale : −${eurosDetail(c.totaux.remise_globale_ht)} HT</p><p class="muted">Annexe détaillée disponible · Toutes les références figurent dans le descriptif téléchargeable.</p></div>
    ${c.lignes.map(l => `<article class="card devis-detail-card" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:12px"><strong>${esc(l.section || (l.type === 'eco' ? 'Éco-participation' : 'Article'))} · ${esc(l.position)}</strong><strong>${eurosDetail(l.total_ht)} HT</strong></div>
      ${l.code_produit ? `<p><strong>${esc(l.code_produit)}</strong></p>` : ''}<p style="white-space:pre-line">${esc(l.designation)}</p>
      <p class="muted">Quantité : ${esc(l.quantite)}${l.pu_ht !== null ? ` · PU brut : ${eurosDetail(l.pu_ht)} HT` : ''}${l.remise_ht ? ` · Remise : −${eurosDetail(l.remise_ht)} HT${l.remise_pct !== null ? ` (${l.remise_pct} %)` : ''}` : ''}${l.eco_ht ? ` · Dont éco : ${eurosDetail(l.eco_ht)} HT` : ''} · TVA ${esc(l.tva_taux)} %</p></article>`).join('')}`;
}
