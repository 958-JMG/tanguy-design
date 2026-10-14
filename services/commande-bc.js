'use strict';
// ────────────────────────────────────────────────────────────────────────────
// services/commande-bc.js — Fabrication d'un bon de commande fournisseur (BC)
//
// Une seule forme de BC, qu'il naisse de la SIGNATURE d'un devis ou du bouton
// « Créer la commande » de la fiche devis (lignes restées sans commande).
//
// Retour Virginie du 14/10/2026 (devis 650/1/1, meuble LAGO) : les 3 lignes du
// devis étaient classées « Divers » à l'import ; la signature ne crée pas de BC
// pour du Divers et ne le disait nulle part. Seul le BC « Plan de travail », vide
// par conception, existait. Une fois celui-ci supprimé, rien ne permettait de
// refaire la commande d'un devis déjà signé. D'où `lignesSansCommande` : la fiche
// devis montre les lignes qu'aucun BC du devis ne porte, et le bouton qui les
// met dans un BC.
//
// Module PUR (aucun réseau, aucune dépendance Airtable) → testable seul.
// ────────────────────────────────────────────────────────────────────────────

const { classifierCategorie } = require('./fournisseur-grille');

// Sprint 2 — Format BC en tableau structuré (Pos | Code | Description | SENS | Cote | Qté)
// SANS MONTANTS, à la demande JMG. Retour : string ASCII alignée + version HTML pour mail.
function buildBcTableau(lignes) {
  if (!lignes || lignes.length === 0) return { texte: '— Pas de ligne disponible —', html: '<p>Pas de ligne disponible.</p>' };

  const rows = lignes.map(l => {
    const f = l.fields || {};
    return {
      pos:   String(f['Position'] || ''),
      code:  String(f['Code produit'] || f['Code'] || ''),
      desc:  String(f['Désignation'] || f['Description'] || '').replace(/\s+/g, ' ').slice(0, 80),
      sens:  String(f['Sens'] || ''),
      cote:  String(f['Côté visible'] || f['Cote visible'] || ''),
      qte:   String(f['Quantité'] || ''),
      unite: String(f['Unité'] || ''),
    };
  }).filter(r => r.code || r.desc); // ignorer les lignes vides

  // Largeurs auto (alignement texte)
  const widths = {
    pos: Math.max(3, ...rows.map(r => r.pos.length)),
    code: Math.max(4, ...rows.map(r => r.code.length)),
    desc: Math.min(50, Math.max(11, ...rows.map(r => r.desc.length))),
    sens: Math.max(4, ...rows.map(r => r.sens.length)),
    cote: Math.max(4, ...rows.map(r => r.cote.length)),
    qte: Math.max(3, ...rows.map(r => r.qte.length)),
  };
  const pad = (s, n, right = false) => right ? String(s).padStart(n) : String(s).padEnd(n);

  const header = `${pad('Pos', widths.pos)} | ${pad('Code', widths.code)} | ${pad('Description', widths.desc)} | ${pad('SENS', widths.sens)} | ${pad('Cote', widths.cote)} | ${pad('Qté', widths.qte, true)}`;
  const sep    = `${'-'.repeat(widths.pos)}-+-${'-'.repeat(widths.code)}-+-${'-'.repeat(widths.desc)}-+-${'-'.repeat(widths.sens)}-+-${'-'.repeat(widths.cote)}-+-${'-'.repeat(widths.qte)}`;
  const body   = rows.map(r => `${pad(r.pos, widths.pos)} | ${pad(r.code, widths.code)} | ${pad(r.desc, widths.desc)} | ${pad(r.sens, widths.sens)} | ${pad(r.cote, widths.cote)} | ${pad(r.qte + (r.unite ? ' ' + r.unite : ''), widths.qte, true)}`).join('\n');

  const texte = [header, sep, body].join('\n');

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const html = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:monospace;font-size:12px">
  <thead><tr style="background:#f4f4f4"><th>Pos</th><th>Code</th><th>Description</th><th>SENS</th><th>Cote visible</th><th>Qté</th></tr></thead>
  <tbody>${rows.map(r => `<tr><td>${esc(r.pos)}</td><td>${esc(r.code)}</td><td>${esc(r.desc)}</td><td>${esc(r.sens)}</td><td>${esc(r.cote)}</td><td style="text-align:right">${esc(r.qte)}${r.unite ? ' ' + esc(r.unite) : ''}</td></tr>`).join('')}</tbody>
</table>`;

  return { texte, html };
}

// Lignes structurées (champ « Lignes BC », JSON) — éditables depuis la vue commande.
function lignesBcStructurees(lignes) {
  return (lignes || []).map(l => {
    const f = l.fields || {};
    return {
      pos: String(f.Position || ''),
      code: String(f['Code produit'] || ''),
      description: String(f['Désignation'] || ''),
      sens: String(f.Sens || ''),
      coteVisible: String(f['Côté visible'] || ''),
      quantite: f.Quantité != null ? Number(f.Quantité) : null,
      unite: String(f.Unité || ''),
      largeurMm: f['Largeur mm'] || null,
      hauteurMm: f['Hauteur mm'] || null,
      profondeurMm: f['Profondeur mm'] || null,
      notes: String(f.Notes || ''),
    };
  });
}

// Rétro-planning : date d'envoi prévue = date de pose − 105 jours (3,5 mois).
// Dans le passé → aujourd'hui (le BC sort tout de suite). Sans date de pose → null.
function dateEnvoiDepuisPose(datePose, todayIso) {
  if (!datePose) return null;
  const d = new Date(datePose + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 105);
  const calculated = d.toISOString().slice(0, 10);
  return calculated < todayIso ? todayIso : calculated;
}

// Clé d'identité d'une ligne dans un BC : position + code produit (les deux
// figurent dans « Lignes BC »). Normalisée pour ne pas rater « 1 » vs « 1 ».
const cleLigne = (pos, code) => `${String(pos ?? '').trim()}|${String(code ?? '').trim().toUpperCase()}`;

/**
 * Lignes d'un devis qu'AUCUN bon de commande du devis ne porte.
 * @param {Array} lignesDevis  - records Airtable des lignes du devis ({ id, fields })
 * @param {Array} lignesBcJson - contenu brut du champ « Lignes BC » de chaque BC du devis
 * @returns {{ lignes: Array, bcIllisibles: number, bcSansListe: number }}
 *   lignes : { id, position, code, designation, categorie, montantHT,
 *              famille: string|null, commandeAuto: bool, raison: string|null }
 *   commandeAuto = la signature en fait un BC (faux pour la Dépose ; vrai pour le
 *   Divers depuis le 14/10/2026 — un Divers hors BC vient d'une signature antérieure
 *   ou d'un BC supprimé).
 *   bcIllisibles = BC dont le JSON est invalide ; bcSansListe = BC sans « Lignes BC »
 *   (antérieurs à ce champ). Dans les deux cas on le DIT, on ne conclut pas.
 */
function lignesSansCommande(lignesDevis, lignesBcJson) {
  const couvertes = new Set();
  let bcIllisibles = 0;
  let bcSansListe = 0;
  for (const raw of lignesBcJson || []) {
    if (!raw) { bcSansListe++; continue; }
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { bcIllisibles++; continue; }
    if (!Array.isArray(arr)) { bcIllisibles++; continue; }
    for (const l of arr) couvertes.add(cleLigne(l && l.pos, l && l.code));
  }
  const lignes = (lignesDevis || [])
    .filter(l => !couvertes.has(cleLigne(l.fields?.Position, l.fields?.['Code produit'])))
    .map(l => {
      const f = l.fields || {};
      const cl = classifierCategorie(f['Catégorie']);
      return {
        id: l.id,
        position: String(f.Position || ''),
        code: String(f['Code produit'] || ''),
        designation: String(f['Désignation'] || ''),
        categorie: f['Catégorie'] || null,
        montantHT: Number(f['Montant HT']) || 0,
        famille: cl.canon,
        commandeAuto: cl.commande,
        raison: cl.raison || null,
      };
    })
    .sort((a, b) => (parseFloat(a.position) || 0) - (parseFloat(b.position) || 0));
  return { lignes, bcIllisibles, bcSansListe };
}

/**
 * Prochain suffixe libre « <numéro devis>-N » parmi les BC existants du devis
 * (« CLIENT · MOBILIER · 650/1/1-2 » → 2). Évite deux BC au même numéro.
 */
function prochainIndexBc(numerosBc, numeroDevis) {
  const n = String(numeroDevis || '').trim();
  if (!n) return 1;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}-(\\d+)`);
  const max = (numerosBc || []).reduce((m, s) => {
    const mm = re.exec(String(s || ''));
    return mm ? Math.max(m, parseInt(mm[1], 10)) : m;
  }, 0);
  return max + 1;
}

// Modèle choisi + détails (BC Mobilier) depuis la 1re zone du devis (triée par Ordre).
function modeleDepuisZone(z0) {
  if (!z0) return { modeleHeader: '', detailsModele: '' };
  const modeleHeader = [z0['Marque'], z0['Modèle']].filter(Boolean).join(' — ') +
    (z0['Porte épaisseur'] ? `\nPorte épaisseur ${z0['Porte épaisseur']}` : '');
  const champs = ['Modularité', 'Exécution façade', 'Coloris façade', 'Chant façade', 'Coloris caisson',
    'Exécution côté finition', 'Coloris côté finition', 'Type de gorge', 'Exécution gorges',
    'Finition gorges', 'Profondeur', 'Option ouverture', 'Finition socle'];
  const detailsModele = champs.filter(k => z0[k]).map(k => `${k} : ${z0[k]}`).join('\n');
  return { modeleHeader, detailsModele };
}

/**
 * Champs Airtable d'un BC. Une seule forme, pour la signature et pour « Créer la
 * commande » depuis la fiche devis.
 * @param {object} p
 * @param {string} p.numCmd
 * @param {object} p.groupe   - { type, ref, canon, montant, lignes[], fournisseurId? }
 * @param {string} p.notes
 * @param {string} [p.clientNom]
 * @param {string} [p.projetId]
 * @param {string|null} [p.dateEnvoi]
 * @param {{modeleHeader:string, detailsModele:string}} [p.modele] - BC Mobilier uniquement
 * @param {string} p.today    - AAAA-MM-JJ
 */
function champsCommande({ numCmd, groupe, notes, clientNom, projetId, dateEnvoi, modele, today }) {
  const montant = Number(groupe.montant) || 0;
  const cf = {
    'Numéro': numCmd,
    // "À compléter" pas dans le singleSelect Statut (PATCH choices 422), on garde
    // "Créée" + mention explicite dans Notes pour le BC Plan de travail vide.
    'Statut': 'Créée',
    'Date création': today,
    ...(montant > 0 ? { 'Montant HT': Math.round(montant * 100) / 100 } : {}),
    'Notes': notes,
    'Contremarque': clientNom || '',
    'Contact Tanguy': 'Solène',
    'Référence courte': groupe.ref || String(groupe.type || '').toUpperCase(),
    // Rattachement fournisseur AUTOMATIQUE depuis la grille, quand il est certain.
    ...(groupe.fournisseurId ? { 'Fournisseur': [groupe.fournisseurId] } : {}),
    // Modèle choisi + détails uniquement pour les commandes Meubles (utile sur le BC)
    ...(groupe.canon === 'Mobilier' && modele ? { 'Modèle choisi': modele.modeleHeader, 'Détails modèle': modele.detailsModele } : {}),
    // Rétro-planning : date envoi = date pose - 3,5 mois (cf. demande JMG 2026-05-21).
    // Si pas de date pose connue, le champ reste vide et Virginie le remplira manuellement.
    ...(dateEnvoi ? { 'Date envoi': dateEnvoi } : {}),
    'Lignes BC': JSON.stringify(lignesBcStructurees(groupe.lignes), null, 2),
  };
  if (projetId) cf['Projet'] = [projetId];
  // Nettoyage : retirer les champs vides
  Object.keys(cf).forEach(k => { if (cf[k] === '' || cf[k] == null) delete cf[k]; });
  return cf;
}

/** Numéro de BC : « <CLIENT> · <TYPE> · <num devis>-<idx> » (format legacy sans client). */
function numeroBc({ clientNom, type, numeroDevis, idx }) {
  return clientNom
    ? `${clientNom} · ${String(type).toUpperCase()} · ${numeroDevis}-${idx}`
    : `${numeroDevis}-${String(type).slice(0, 3).toUpperCase()}-${idx}`;
}

module.exports = {
  buildBcTableau, lignesBcStructurees, dateEnvoiDepuisPose, modeleDepuisZone, champsCommande,
  cleLigne, lignesSansCommande, prochainIndexBc, numeroBc,
};
