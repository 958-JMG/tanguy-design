// Même contrôle dans l'écran et sur le serveur. Les documents fournissent les
// données ; ce module ne cherche ni référence ni prix dans un catalogue.
export const CHAMP_DETAIL = 'Détail import';
export const centimes = n => Math.round((Number(n) + Number.EPSILON) * 100);
export const eurosDetail = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
export function nombreDetail(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[\s\u00a0\u202f€%]/g, '').replace(',', '.');
  return /^-?\d+(?:\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
}
const texte = v => typeof v === 'string' ? v.trim() : '';
const money = v => { const n = nombreDetail(v); return n === null ? null : centimes(n); };
const same = (a, b) => a === b;

export function controlerDetail(document = {}) {
  const erreurs = [], alertes = [];
  const tot = document.totaux || {};
  for (const k of ['total_ht', 'total_ttc', 'eco_ht', 'remise_globale_ht', 'remise_globale_pct', 'tva_montant', 'tva_taux']) {
    if (tot[k] != null && tot[k] !== '' && nombreDetail(tot[k]) === null) erreurs.push(`Récapitulatif : montant invalide (${k}).`);
  }
  const source = Array.isArray(document.lignes_detail) ? document.lignes_detail : [];
  if (!source.length || source.length > 300) erreurs.push('Le devis doit contenir entre 1 et 300 lignes.');
  const lignes = source.slice(0, 300).map((l, i) => {
    const nom = `Ligne ${i + 1}`;
    for (const k of ['quantite', 'pu_ht', 'total_ht', 'remise_ht', 'remise_pct', 'eco_ht', 'tva_taux']) {
      if (l[k] != null && l[k] !== '' && nombreDetail(l[k]) === null) erreurs.push(`${nom} : nombre invalide (${k}).`);
    }
    const type = l.type === 'eco' ? 'eco' : 'article';
    const quantite = nombreDetail(l.quantite);
    const pu = nombreDetail(l.pu_ht);
    const netLu = money(l.total_ht);
    const eco = type === 'eco' ? (netLu ?? (pu !== null && quantite !== null ? centimes(pu * quantite) : 0)) : (money(l.eco_ht) ?? 0);
    const remisePct = nombreDetail(l.remise_pct);
    const brut = pu !== null && quantite !== null ? centimes(pu * quantite) : null;
    const remiseLue = money(l.remise_ht);
    const remiseCalculee = brut !== null && remisePct !== null ? Math.round(brut * remisePct / 100) : null;
    const remise = remiseLue ?? remiseCalculee ?? 0;
    if (remiseLue !== null && remiseCalculee !== null && !same(remiseLue, remiseCalculee)) erreurs.push(`${nom} : le montant et le pourcentage de remise ne correspondent pas.`);
    const net = netLu ?? (brut !== null ? brut - remise + (type === 'eco' ? 0 : eco) : null);
    const tva = nombreDetail(l.tva_taux ?? tot.tva_taux);
    const code = texte(l.code_produit);
    if (l.code_produit !== undefined && l.code_produit !== null && typeof l.code_produit !== 'string') erreurs.push(`${nom} : la référence doit être du texte, pour conserver ses zéros initiaux.`);
    if (!texte(l.designation)) erreurs.push(`${nom} : descriptif manquant.`);
    if (texte(l.designation).length > 30000 || code.length > 10000) erreurs.push(`${nom} : descriptif trop long, scinde le devis.`);
    if (!(quantite > 0) || quantite > 100000) erreurs.push(`${nom} : quantité à préciser.`);
    if (pu !== null && (pu < 0 || pu > 1e8)) erreurs.push(`${nom} : prix unitaire invalide.`);
    if (net === null || net < 0 || net > 1e10) erreurs.push(`${nom} : montant net HT à préciser (remises négatives à rattacher à l’article ou au total).`);
    if (remise < 0 || (remisePct !== null && (remisePct < 0 || remisePct > 100))) erreurs.push(`${nom} : remise invalide.`);
    if (eco < 0 || (net !== null && eco > net)) erreurs.push(`${nom} : éco-participation invalide.`);
    if (type === 'eco' && remise !== 0) erreurs.push(`${nom} : aucune remise ne doit être appliquée à l’éco-participation.`);
    if (brut !== null && net !== null && !same(brut - remise + (type === 'eco' ? 0 : eco), net)) erreurs.push(`${nom} : quantité × prix − remise + éco ne correspond pas au net HT lu.`);
    if (![0, 5.5, 10, 20].includes(tva)) erreurs.push(`${nom} : taux de TVA à préciser.`);
    if (!code && type !== 'eco' && !l.sans_reference_confirme) alertes.push(`${nom} : aucune référence indiquée — confirme « Sans référence » si c’est une prestation ou du sur-mesure.`);
    if (!code && type !== 'eco' && !l.sans_reference_confirme) erreurs.push(`${nom} : référence à compléter ou absence de référence à confirmer.`);
    return { position: String(i + 1), type, section: texte(l.section), code_produit: code,
      designation: texte(l.designation), quantite, pu_ht: pu, remise_pct: remisePct,
      remise_ht: remise / 100, eco_ht: eco / 100, total_ht: net === null ? null : net / 100,
      tva_taux: tva, categorie: texte(l.categorie), sans_reference_confirme: l.sans_reference_confirme === true };
  });
  const somme = lignes.reduce((s, l) => s + centimes(l.total_ht || 0), 0);
  const eco = lignes.reduce((s, l) => s + centimes(l.eco_ht), 0);
  const remiseLignes = lignes.reduce((s, l) => s + centimes(l.remise_ht), 0);
  const globalPct = nombreDetail(tot.remise_globale_pct);
  const globalLu = money(tot.remise_globale_ht);
  const globalCalcule = globalPct === null ? null : Math.round((somme - eco) * globalPct / 100);
  const globale = globalLu ?? globalCalcule ?? 0;
  if (globalLu !== null && globalCalcule !== null && !same(globalLu, globalCalcule)) erreurs.push('La remise globale en euros ne correspond pas au pourcentage hors éco.');
  if (globale < 0 || globale > somme - eco || (globalPct !== null && (globalPct < 0 || globalPct > 100))) erreurs.push('Remise globale invalide.');
  const ecoLu = money(tot.eco_ht);
  if (ecoLu === null) erreurs.push('Confirme le montant total d’éco-participation du document (0 si aucune).');
  if (ecoLu !== null && ecoLu !== eco) erreurs.push(`Éco-participation : ${eurosDetail(eco / 100)} dans les lignes, ${eurosDetail(ecoLu / 100)} dans le document. Complète les lignes concernées.`);
  if (eco > 0 && typeof tot.eco_incluse !== 'boolean') erreurs.push('Précise si l’éco-participation est comprise dans le total du document.');
  const total = somme - globale;
  const attenduHt = money(tot.total_ht);
  const sourceHt = total - (tot.eco_incluse === false ? eco : 0);
  if (!(attenduHt > 0)) erreurs.push('Le total HT du document est requis pour vérifier les lignes.');
  else if (sourceHt !== attenduHt) erreurs.push(`Écart HT : lignes ${eurosDetail(sourceHt / 100)}, document ${eurosDetail(attenduHt / 100)}. Vérifie les lignes et les remises.`);
  // Répartition au centime, hors éco, par taux. L'ordre ne modifie pas le total.
  const groupes = new Map();
  for (const l of lignes) {
    const g = groupes.get(l.tva_taux) || { taux: l.tva_taux, avant: 0, eco: 0 };
    g.avant += centimes(l.total_ht || 0); g.eco += centimes(l.eco_ht);
    groupes.set(l.tva_taux, g);
  }
  const bases = [...groupes.values()].sort((a, b) => b.avant - b.eco - (a.avant - a.eco));
  if (bases.length > 2) erreurs.push('Ce devis contient plus de deux taux de TVA : scinde-le avant import.');
  let distribue = 0;
  bases.forEach((g, i) => {
    g.remise = i === bases.length - 1 ? globale - distribue : Math.round(globale * (g.avant - g.eco) / (somme - eco || 1));
    distribue += g.remise; g.base = g.avant - g.remise; g.tva = Math.round(g.base * g.taux / 100);
  });
  if (bases.length > 1 && globale > 0) alertes.push('La remise globale est répartie au prorata des montants hors éco entre les taux de TVA.');
  const tva = bases.reduce((s, g) => s + g.tva, 0);
  const tvaSource = bases.reduce((s, g) => s + Math.round((g.base - (tot.eco_incluse === false ? g.eco : 0)) * g.taux / 100), 0);
  const ttcLu = money(tot.total_ttc), tvaLue = money(tot.tva_montant);
  if (ttcLu === null) erreurs.push('Le total TTC du document est requis.');
  else if (sourceHt + tvaSource !== ttcLu) erreurs.push(`Écart TTC : calcul ${eurosDetail((sourceHt + tvaSource) / 100)}, document ${eurosDetail(ttcLu / 100)}.`);
  if (tvaLue !== null && tvaLue !== tvaSource) erreurs.push('La TVA recalculée ne correspond pas à la TVA du document.');
  return { ok: erreurs.length === 0, erreurs: [...new Set(erreurs)], alertes: [...new Set(alertes)], lignes,
    totaux: { avant_remise_ht: somme / 100, remise_lignes_ht: remiseLignes / 100, remise_globale_ht: globale / 100,
      remise_globale_pct: globalPct, eco_ht: eco / 100, total_ht: total / 100, tva_montant: tva / 100,
      total_ttc: (total + tva) / 100, eco_ttc: bases.reduce((s, g) => s + g.eco + Math.round(g.eco * g.taux / 100), 0) / 100,
      bases: bases.map(g => ({ taux: g.taux, base: g.base / 100, tva: g.tva / 100 })) } };
}

export function lireDetail(fields) {
  if (!fields?.[CHAMP_DETAIL]) return null;
  try {
    const d = JSON.parse(fields[CHAMP_DETAIL]);
    if (d.version !== 1 || !d.document || !Array.isArray(d.document.lignes_detail)) throw new Error();
    return d;
  } catch { throw new Error('Le détail de cet import est illisible. Fais vérifier le devis avant de poursuivre.'); }
}
