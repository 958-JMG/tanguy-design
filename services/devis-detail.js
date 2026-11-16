'use strict';
const { createHash } = require('node:crypto');
const { moduleWinner } = require('./winner-lignes');
const CHAMP_DETAIL = 'Détail import';
const core = () => import('../public/v3/assets/js/core/devis-detail.mjs');
const nettoyage = f => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== ''));

async function preparerDetail(document, { numero = '', date = '', type = 'Principal', source = {}, famille = '' } = {}) {
  const { controlerDetail } = await core();
  const controle = controlerDetail(document);
  if (!controle.ok) throw Object.assign(new Error(controle.erreurs.join('\n')), { status: 422, controle });
  const d = { document: { numero: String(document.document?.numero || ''), date: document.document?.date || null },
    produit_resume: String(document.produit_resume || ''), descriptif_complet: String(document.descriptif_complet || ''),
    lignes_detail: controle.lignes, totaux: { ...document.totaux, remise_globale_ht: controle.totaux.remise_globale_ht } };
  const snapshot = { version: 1, etat: 'en_cours', famille, source: { nom: String(source.nom || '').slice(0, 250), empreinte: String(source.empreinte || '') }, document: d };
  if (JSON.stringify(snapshot).length > 90000) throw Object.assign(new Error('Ce document dépasse la taille conservable en une fois. Scinde-le en plusieurs devis.'), { status: 422 });
  const t = controle.totaux;
  const lignes = controle.lignes.map((l, i) => nettoyage({
    'Position': String(i + 1), 'Ordre Winner': i + 1, 'Section Winner': l.section,
    'Code produit': l.code_produit, 'Désignation': l.designation, 'Quantité': l.quantite,
    'Catégorie': l.type === 'eco' ? 'Éco-participation' : moduleWinner(l.categorie || famille),
    'TVA pourcentage': l.tva_taux, 'Montant HT': Math.round((l.total_ht - l.eco_ht) * 100) / 100,
    'Eco-participation': l.eco_ht,
  }));
  const fields = { 'Numéro devis': numero, 'Date devis': date, 'Statut': 'Brouillon', 'Type devis': type,
    'Total HT articles': Math.round((t.avant_remise_ht - t.eco_ht) * 100) / 100,
    'Montant remise': t.remise_globale_ht, 'Total HT après remise': Math.round((t.total_ht - t.eco_ht) * 100) / 100,
    'Total HT final': t.total_ht, 'Total TTC': t.total_ttc, 'Éco-participation': t.eco_ttc,
    ...(t.remise_globale_pct !== null ? { 'Remise pourcentage': t.remise_globale_pct / 100 } : {}),
    [CHAMP_DETAIL]: JSON.stringify(snapshot),
    'Notes internes': `Import détaillé vérifié. Source : ${snapshot.source.nom || d.document.numero || 'document'}.\nDescriptif détaillé joint au devis : annexe à conserver avec le devis commercial.`,
  };
  t.bases.forEach((g, i) => {
    fields[`TVA taux ${i + 1} pourcentage`] = g.taux; fields[`TVA taux ${i + 1} base`] = g.base; fields[`TVA taux ${i + 1} montant`] = g.tva;
  });
  return { fields: nettoyage(fields), lignes, snapshot, controle };
}

function empreinteDetail(document, cible) {
  // Inclut les corrections relues et la cible. Le même document pour deux
  // clients ne doit jamais renvoyer la fiche du premier client.
  return createHash('sha256').update(JSON.stringify({ version: 1, cible, document })).digest('hex');
}

async function verifierDetail(fields, lignes, { incomplet = false } = {}) {
  const { lireDetail, centimes } = await core();
  const snapshot = lireDetail(fields);
  if (!snapshot) return null;
  if (!incomplet && snapshot.etat !== 'complet') throw Object.assign(new Error('Import incomplet : reprends sa création pour récupérer les lignes manquantes.'), { status: 409 });
  const r = await preparerDetail(snapshot.document, { numero: fields['Numéro devis'], date: fields['Date devis'], type: fields['Type devis'], source: snapshot.source, famille: snapshot.famille });
  for (const key of ['Total HT final', 'Total TTC', 'Montant remise', 'Éco-participation', ...Object.keys(r.fields).filter(k => k.startsWith('TVA taux '))]) {
    if (fields[key] === undefined || centimes(fields[key]) !== centimes(r.fields[key])) throw Object.assign(new Error('Les montants du devis ont changé depuis la vérification du détail. Réimporte le document corrigé avant de poursuivre.'), { status: 409 });
  }
  if (!Array.isArray(lignes) || lignes.length !== r.lignes.length) throw Object.assign(new Error('Toutes les lignes du descriptif ne sont pas enregistrées. Reprends l’import avant de poursuivre.'), { status: 409 });
  for (const attendu of r.lignes) {
    const correspondantes = lignes.filter(l => String(l.fields?.Position) === attendu.Position);
    if (correspondantes.length !== 1 || !ligneIdentique(correspondantes[0].fields, attendu)) throw Object.assign(new Error(`Le repère ${attendu.Position} ne correspond plus au descriptif vérifié. Réimporte la version corrigée.`), { status: 409 });
  }
  return r;
}
function ligneIdentique(actual, attendu) {
  return Object.entries(attendu).every(([k, v]) => actual[k] === v || (v === 0 && actual[k] === undefined));
}
function verifierVersionCommerciale(fields, contenu) {
  if (!fields[CHAMP_DETAIL]) return;
  const lie = JSON.parse(fields[CHAMP_DETAIL]).pennylane;
  if (!lie || lie.quoteId !== String(fields['Pennylane quote ID']) || lie.annexe !== contenu.filename) throw Object.assign(new Error('Le descriptif a changé depuis la création du devis commercial. Utilise « Régénérer » pour que le devis cite la bonne version de son annexe.'), { status: 409 });
}
module.exports = { CHAMP_DETAIL, preparerDetail, empreinteDetail, verifierDetail, ligneIdentique, verifierVersionCommerciale };
