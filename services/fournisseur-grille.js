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

// Les 6 catégories de la grille (dimensions du champ Fournisseurs.Catégories).
const CATEGORIES_GRILLE = ['Meuble', 'Plan de travail', 'Électroménager', 'Évier', 'Robinetterie', 'Crédence'];

// Type de bon de commande + référence courte (code fournisseur sur le BC) par
// catégorie canonique. `type` reste compatible avec l'existant (Meubles au
// pluriel, etc.) pour ne rien casser en aval de la signature.
const CANON_BC = {
  'Meuble':          { type: 'Meubles',         ref: 'NOVA_CUC' },
  'Plan de travail': { type: 'Plan de travail', ref: 'PLAN_TRAV' },
  'Électroménager':  { type: 'Électroménager',  ref: 'ELECTRO' },
  'Évier':           { type: 'Évier',           ref: 'EVIER' },
  'Robinetterie':    { type: 'Robinetterie',    ref: 'ROBI' },
  'Crédence':        { type: 'Crédence',        ref: 'CREDENCE' },
  'Accessoires':     { type: 'Accessoires',     ref: 'ACCESS' },
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
 *               / 'Dépose' / 'Divers'), ou null si non reconnue.
 *   - commande: faut-il créer une commande fournisseur ? (Dépose/Divers = non)
 *   - grille  : la catégorie est-elle une dimension de la grille fournisseurs ?
 *   - raison  : explication (affichée, jamais tue) quand utile.
 */
function classifierCategorie(raw) {
  const n = normalize(raw);
  const grille = c => ({ canon: c, commande: true, grille: true });
  if (!n) return { canon: null, commande: true, grille: false, raison: 'Catégorie absente sur la ligne' };
  const has = (...subs) => subs.some(x => n.includes(x));

  // Ordre volontaire : « plan de travail » avant « meuble » ; robinetterie/évier
  // testés ensemble car souvent regroupés (« Eviers et robinetterie »).
  if (n.includes('plan') && n.includes('travail')) return grille('Plan de travail');
  if (has('credence', 'pied vert')) return grille('Crédence');
  if (has('electromenager', 'electro')) return grille('Électroménager');

  const evier = has('evier');
  const robin = has('robinet');
  const sanit = has('sanitaire');
  if (evier || robin || sanit) {
    // Section purement robinetterie → Robinetterie ; sinon (évier seul, sanitaire
    // générique, ou combiné évier+robinetterie) → Évier, couvert par les
    // fournisseurs évier qui assurent aussi la robinetterie.
    if (robin && !evier && !sanit) return grille('Robinetterie');
    return grille('Évier');
  }

  if (has('meuble', 'panneaux de recouvrement', 'caisson')) return grille('Meuble');
  if (has('produits de vente', 'accessoire')) return { canon: 'Accessoires', commande: true, grille: false };
  if (has('depose')) return { canon: 'Dépose', commande: false, grille: false, raison: 'Dépose : pas de commande fournisseur' };
  if (has('divers')) return { canon: 'Divers', commande: false, grille: false, raison: 'Divers : pas de commande fournisseur' };

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
 * @param {string[]} [opts.forcer] - catégories canoniques à TOUJOURS produire, même
 *        sans ligne (ex. ['Plan de travail'] : le BC PT est complété sur chantier).
 * @returns {Array<object>} groupes { canon, type, ref, commande, grille, aClasser,
 *   lignes, montant, fournisseurId?, fournisseurNom?, candidats[], raison? }
 */
function routeCommandes(lignes, fournisseurs, opts = {}) {
  const idx = indexFournisseurs(fournisseurs);
  const montantDe = opts.montantDe || (l => Number(l.fields && l.fields['Montant HT']) || 0);
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const groupes = new Map();

  // Catégories imposées (BC créé même à vide) : on pose le groupe d'abord, les
  // lignes réelles s'y ajouteront ensuite s'il y en a.
  for (const canon of (opts.forcer || [])) {
    if (!CANON_BC[canon]) continue;
    const bc = CANON_BC[canon];
    groupes.set(canon, {
      canon, aClasser: false, commande: true, grille: CATEGORIES_GRILLE.includes(canon),
      type: bc.type, ref: bc.ref, raison: null, categorieBrute: null,
      candidats: [], lignes: [], montant: 0,
    });
  }

  for (const l of lignes || []) {
    const raw = (l.fields && l.fields['Catégorie']) != null ? l.fields['Catégorie'] : l['Catégorie'];
    const cl = classifierCategorie(raw);
    const cle = cl.canon != null ? cl.canon : `__aclasser__:${normalize(raw) || '∅'}`;
    if (!groupes.has(cle)) {
      const bc = cl.canon ? CANON_BC[cl.canon] : null;
      groupes.set(cle, {
        canon: cl.canon,
        aClasser: cl.canon == null,
        commande: cl.commande,
        grille: cl.grille,
        type: cl.canon == null ? 'À classer' : (bc ? bc.type : cl.canon),
        ref: cl.canon == null ? 'A_CLASSER' : (bc ? bc.ref : normalize(cl.canon).replace(/ /g, '_').toUpperCase()),
        raison: cl.raison || null,
        categorieBrute: raw != null && String(raw).trim() ? String(raw).trim() : null,
        candidats: [],
        lignes: [],
        montant: 0,
      });
    }
    const g = groupes.get(cle);
    g.lignes.push(l);
    g.montant += montantDe(l);
  }

  for (const g of groupes.values()) {
    g.montant = round2(g.montant);
    if (g.grille && g.canon) {
      const cands = idx.get(normalize(g.canon)) || [];
      g.candidats = cands;
      if (cands.length === 1) {
        g.fournisseurId = cands[0].id;
        g.fournisseurNom = cands[0].nom;
      } else if (cands.length === 0) {
        g.raison = g.raison || `Aucun fournisseur dans la grille pour « ${g.canon} » — à rattacher`;
      } else {
        // Plusieurs fournisseurs possibles : on ne tranche PAS au hasard (leçon
        // Barbier : un mauvais rattachement silencieux coûte plus qu'un champ vide).
        g.raison = g.raison || `${cands.length} fournisseurs possibles (${cands.map(c => c.nom).join(', ')}) — à choisir`;
      }
    }
  }

  return [...groupes.values()];
}

module.exports = {
  CATEGORIES_GRILLE, CANON_BC,
  normalize, classifierCategorie, indexFournisseurs, routeCommandes,
};
