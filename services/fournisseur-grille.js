'use strict';
// ────────────────────────────────────────────────────────────────────────────
// services/fournisseur-grille.js — Grille fournisseurs & routage des commandes
//
// Chantier JMG 2026-09-14. À la signature d'un devis Winner, chaque ligne doit
// partir dans la BONNE commande fournisseur selon sa catégorie (Meuble, Plan de
// travail, Électroménager, Évier, Robinetterie, Crédence). Avant, une ligne dont
// la catégorie n'était pas dans une table figée était JETÉE EN SILENCE
// (`if (!type) continue`). Règle 9·58 : jamais de silence — une ligne qu'on ne
// sait pas classer part dans une commande « À classer » VISIBLE, avec la raison.
//
// Ce module est PUR (aucun réseau, aucune dépendance Airtable) → testable seul.
//
// La « grille » = la table Fournisseurs, où chaque fournisseur porte un champ
// multi-sélection `Catégories` (les 6 catégories ci-dessous). Un fournisseur peut
// en couvrir plusieurs (ex. Bradano/Franke = Évier + Robinetterie).
// ────────────────────────────────────────────────────────────────────────────

// Les catégories de la grille (dimensions du champ Fournisseurs.Catégories).
// Refonte JMG 2026-09-14 : « Plan de travail & crédence » regroupe plan de
// travail + évier + robinetterie + crédence ; « Meuble » devient « Mobilier » ;
// ajout de « Luminaire ». Le 06/11/2026, Sanitaire devient une colonne de routage
// distincte ; la ventilation financière historique reste inchangée.
const { moduleWinner, categorieLigneWinner, fournisseurWinner, ordonnerLignes } = require('./winner-lignes');

const CATEGORIES_GRILLE = ['Mobilier', 'Électroménager', 'Luminaire', 'Plan de travail & crédence', 'Sanitaire', 'Plaque de cuisson'];

// Type de bon de commande + référence courte (code fournisseur sur le BC) par
// catégorie canonique.
const CANON_BC = {
  'Mobilier':                   { type: 'Mobilier',                   ref: 'MOBILIER' },
  'Électroménager':             { type: 'Électroménager',             ref: 'ELECTRO' },
  'Luminaire':                  { type: 'Luminaire',                  ref: 'LUMIN' },
  'Plan de travail & crédence': { type: 'Plan de travail & crédence', ref: 'PLAN_CRED' },
  'Plaque de cuisson':          { type: 'Plaque de cuisson',          ref: 'PLAQUE' },
  'Accessoires':                { type: 'Accessoires',                ref: 'ACCESS' },
  'Plan de travail':            { type: 'Plan de travail',            ref: 'PLAN' },
  'Crédence':                   { type: 'Crédence',                   ref: 'CREDENCE' },
  'Sanitaire':                  { type: 'Sanitaire',                  ref: 'SANITAIRE' },
  'Panneaux de recouvrement':    { type: 'Panneaux de recouvrement',    ref: 'PANNEAUX' },
};

// Normalise pour comparer sans se faire piéger par accents/casse/ponctuation.
const normalize = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Classe une catégorie BRUTE (titre de section Winner / sortie OCR) en une
 * décision de routage. Ne DEVINE jamais : une catégorie non reconnue renvoie
 * `canon: null` (→ « À classer »), jamais un rattachement au hasard.
 *
 * @param {string} raw
 * @returns {{ canon: string|null, commande: boolean, grille: boolean, raison?: string }}
 *   - canon   : catégorie canonique (une des CATEGORIES_GRILLE, ou 'Accessoires'
 *               / 'Dépose'), ou null → commande « À classer » (inconnue, absente,
 *               ou Divers depuis le 14/10/2026).
 *   - commande: faut-il créer une commande fournisseur ? (Dépose = non)
 *   - grille  : la catégorie est-elle une dimension de la grille fournisseurs ?
 *   - raison  : explication (affichée, jamais tue) quand utile.
 */
function classifierCategorie(raw) {
  const n = normalize(raw);
  const grille = c => ({ canon: c, commande: true, grille: true });
  if (!n) return { canon: null, commande: true, grille: false, raison: 'Catégorie absente sur la ligne' };
  const has = (...subs) => subs.some(x => n.includes(x));

  // Refonte JMG 2026-09-14 : plan de travail, évier, robinetterie, crédence et
  // sanitaire tombent tous dans « Plan de travail & crédence ».
  const PTC = 'Plan de travail & crédence';
  if (n.includes('plan') && n.includes('travail')) return grille(PTC);
  if (has('credence', 'pied vert')) return grille(PTC);
  if (has('evier', 'robinet', 'sanitaire', 'mitigeur')) return grille(PTC);

  if (has('luminaire', 'eclairage', 'lumiere', 'applique', 'suspension', 'lampe', 'spot')) return grille('Luminaire');
  if (moduleWinner(raw) === 'Plaque de cuisson') return grille('Électroménager');
  if (has('electromenager', 'electro')) return grille('Électroménager');

  if (has('meuble', 'mobilier', 'panneaux de recouvrement', 'caisson')) return grille('Mobilier');
  if (has('produits de vente', 'accessoire')) return { canon: 'Accessoires', commande: true, grille: false };
  if (has('depose')) return { canon: 'Dépose', commande: false, grille: false, raison: 'Dépose : pas de commande fournisseur' };
  // Décision JMG du 14/10/2026 : le Divers part dans une commande « À classer »
  // VISIBLE au lieu de nulle part. Ce sont des articles hors catalogue Winner
  // (meuble LAGO du devis 650/1/1, flexible, colonne sur mesure…) qui se
  // commandent aussi ; aucun fournisseur ne se devine depuis « Divers ».
  if (has('divers')) return { canon: null, commande: true, grille: false, raison: 'Divers : article hors catalogue, fournisseur à choisir' };

  return { canon: null, commande: true, grille: false, raison: `Catégorie « ${String(raw).trim()} » non reconnue` };
}

// Index catégorie canonique (normalisée) → [{id, nom}] depuis la grille.
function indexFournisseurs(fournisseurs) {
  const idx = new Map();
  for (const fo of fournisseurs || []) {
    const cats = (fo.fields && fo.fields['Catégories']) || fo['Catégories'] || [];
    for (const c of (Array.isArray(cats) ? cats : [])) {
      const key = normalize(c);
      if (!key) continue;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push({ id: fo.id, nom: (fo.fields && fo.fields.Nom) || fo.Nom || '?' });
    }
  }
  return idx;
}

/**
 * Route les lignes d'un devis vers des groupes de commande, en s'appuyant sur la
 * grille fournisseurs. NE PERD JAMAIS une ligne : l'inconnu part dans un groupe
 * « À classer ». Le rattachement fournisseur n'est posé QUE s'il est certain (un
 * seul fournisseur candidat) — jamais un choix au hasard entre homonymes.
 *
 * @param {Array} lignes  - records Airtable de lignes (fields['Catégorie'], fields['Montant HT'])
 * @param {Array} fournisseurs - records Airtable (fields.Nom, fields['Catégories'])
 * @param {object} [opts]
 * @param {(l:any)=>number} [opts.montantDe] - extracteur de montant HT (défaut : fields['Montant HT'])
 * @returns {Array<object>} groupes { canon, type, ref, commande, grille, aClasser,
 *   lignes, montant, fournisseurId?, fournisseurNom?, candidats[], raison? }
 */
function routeCommandes(lignes, fournisseurs, opts = {}) {
  const idx = indexFournisseurs(fournisseurs);
  const montantDe = opts.montantDe || (l => Number(l.fields && l.fields['Montant HT']) || 0);
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const groupes = new Map();

  for (const l of ordonnerLignes(lignes)) {
    const raw = categorieLigneWinner(l.fields || l);
    const sectionCl = classifierCategorie(l.fields?.['Section Winner']);
    const cl = sectionCl.canon ? sectionCl : classifierCategorie(raw);
    const module = raw === 'Plaque de cuisson' ? raw : moduleWinner(l.fields?.['Section Winner'] || raw);
    const source = fournisseurWinner(l, fournisseurs);
    // Les marques distinctes sans fournisseur connu restent séparées : une
    // grille générale ne prouve pas le distributeur d'une marque donnée.
    const marque = l.fields?.['Marque Winner'] || '';
    const cle = JSON.stringify([module, source.cle || normalize(marque)]);
    if (!groupes.has(cle)) {
      const bc = CANON_BC[module] || CANON_BC[cl.canon];
      groupes.set(cle, {
        canon: cl.canon, module,
        aClasser: cl.canon == null,
        commande: cl.commande, grille: cl.grille,
        type: bc?.type || 'À classer', ref: bc?.ref || 'A_CLASSER',
        raison: source.raison || cl.raison || null,
        categorieBrute: raw ? String(raw).trim() : null,
        source, marque, candidats: [], lignes: [], montant: 0,
      });
    }
    const g = groupes.get(cle);
    g.lignes.push(l);
    g.montant += montantDe(l);
  }

  for (const g of groupes.values()) {
    g.montant = round2(g.montant);
    if (g.source?.explicite) {
      g.fournisseurNom = g.source.nom;
      if (g.source.id) {
        g.fournisseurId = g.source.id;
        g.parFournisseur = true;
      }
    } else if (g.grille && g.canon) {
      // Sanitaire a sa propre colonne de routage ; canon garde la ventilation de marge historique.
      const famille = ['Sanitaire', 'Plaque de cuisson'].includes(g.module) ? g.module : g.canon;
      const cands = idx.get(normalize(famille)) || [];
      g.candidats = cands;
      if (cands.length === 1 && !g.marque) {
        g.fournisseurId = cands[0].id;
        g.fournisseurNom = cands[0].nom;
      } else {
        g.raison = g.raison || (cands.length === 0
          ? `Aucun fournisseur dans la grille pour « ${famille} » — à rattacher`
          : `${cands.length} fournisseur(s) possible(s) (${cands.map(c => c.nom).join(', ')})${g.marque ? ` ; marque ${g.marque}` : ''} — à choisir`);
      }
    }
  }

  return [...groupes.values()];
}

module.exports = {
  CATEGORIES_GRILLE, CANON_BC,
  normalize, classifierCategorie, indexFournisseurs, routeCommandes,
};
