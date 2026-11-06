'use strict';

// L'ordre de lecture du PDF est distinct du repère imprimé (1, 1.10, 501…).
// Les anciennes lignes, sans ordre source, utilisent un tri naturel de secours.
const FIELDS_WINNER = [
  { name: 'Ordre Winner', type: 'number', options: { precision: 0 } },
  { name: 'Section Winner', type: 'singleLineText' },
  { name: 'Fournisseur Winner', type: 'singleLineText' },
  { name: 'Marque Winner', type: 'singleLineText' },
];
const texte = v => String(v ?? '').trim();
const normaliser = v => texte(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function moduleWinner(categorie) {
  const n = normaliser(categorie);
  if (n.includes('plan') && n.includes('travail') && n.includes('credence')) return 'Plan de travail & crédence';
  if (n.includes('plan') && n.includes('travail')) return 'Plan de travail';
  if (/credence|pied vert/.test(n)) return 'Crédence';
  if (/evier|robinet|sanitaire|mitigeur/.test(n)) return 'Sanitaire';
  if (n.includes('panneaux de recouvrement')) return 'Panneaux de recouvrement';
  if (/meuble|mobilier|caisson/.test(n)) return 'Mobilier';
  if (/electro/.test(n)) return 'Électroménager';
  if (/luminaire|eclairage|lumiere|applique|suspension|lampe|spot/.test(n)) return 'Luminaire';
  if (/accessoire|produits de vente/.test(n)) return 'Accessoires';
  if (/depose/.test(n)) return 'Dépose';
  return texte(categorie) || 'À classer';
}

function ordonnerLignes(lignes) {
  const ordre = l => {
    const n = Number(l.fields?.['Ordre Winner']);
    return Number.isInteger(n) && n > 0 ? n : Infinity;
  };
  return [...(lignes || [])].sort((a, b) => {
    const oa = ordre(a), ob = ordre(b);
    if (oa !== ob) return oa < ob ? -1 : 1;
    if (oa !== Infinity) return 0;
    const pa = texte(a.fields?.Position), pb = texte(b.fields?.Position);
    if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
    return pa.localeCompare(pb, 'fr', { numeric: true });
  });
}

// Un enfant reprend le contexte du parent précédent uniquement si le contexte
// explicite est compatible. Aucun tri, aucune renumérotation à l'import.
function preparerLignesWinner(lignes = []) {
  if (!Array.isArray(lignes)) throw new Error('Liste de lignes Winner invalide');
  const vues = [];
  return lignes.map((source, index) => {
    const l = { ...source, position: texte(source.position), position_parent: texte(source.position_parent) };
    const parent = l.position_parent && vues.findLast(p => p.position === l.position_parent &&
      ['zone_nom', 'section', 'fournisseur', 'marque'].every(k => !l[k] || !p[k] || normaliser(l[k]) === normaliser(p[k])));
    if (parent) {
      for (const k of ['zone_nom', 'section', 'categorie', 'fournisseur', 'marque']) if (!l[k]) l[k] = parent[k];
    }
    vues.push(l);
    return { ...l, ordre_winner: index + 1 };
  });
}

function champsWinner(l) {
  return {
    'Ordre Winner': l.ordre_winner,
    'Section Winner': texte(l.section),
    'Fournisseur Winner': texte(l.fournisseur),
    'Marque Winner': texte(l.marque),
  };
}

// Le fournisseur explicite prime sur la grille. Une marque n'est jamais un
// fournisseur présumé ; un nom absent/ambigu reste visible et non rattaché.
function fournisseurWinner(ligne, fournisseurs = []) {
  const f = ligne.fields || {};
  const ids = Array.isArray(f.Fournisseur) ? f.Fournisseur : [];
  const nomSource = texte(f['Fournisseur Winner']);
  const candidats = ids.length
    ? fournisseurs.filter(s => ids.includes(s.id))
    : nomSource ? fournisseurs.filter(s => normaliser(s.fields?.Nom) === normaliser(nomSource)) : [];
  const certain = candidats.length === 1 && ids.length <= 1;
  return {
    explicite: !!(ids.length || nomSource),
    cle: ids.length ? `id:${ids.join(',')}` : nomSource ? `nom:${normaliser(nomSource)}` : '',
    id: certain ? candidats[0].id : null,
    nom: certain ? candidats[0].fields.Nom : nomSource,
    raison: certain ? null : ids.length || nomSource
      ? `Fournisseur « ${nomSource || 'lié au devis'} » ${candidats.length > 1 || ids.length > 1 ? 'ambigu' : 'introuvable'} — à rattacher`
      : null,
  };
}

function enrichirLignesWinner(lignes, zones = [], fournisseurs = []) {
  const ordonnees = ordonnerLignes(lignes);
  const vues = [];
  return ordonnees.map(l => {
    const fields = { ...l.fields };
    const parent = fields['Position parent'] && vues.findLast(p =>
      texte(p.fields.Position) === texte(fields['Position parent']) &&
      (!fields.Zone?.[0] || fields.Zone[0] === p.fields.Zone?.[0]) &&
      (!fields['Section Winner'] || fields['Section Winner'] === p.fields['Section Winner']));
    if (parent && !fields.Zone?.length) fields.Zone = parent.fields.Zone;
    const zone = zones.find(z => z.id === fields.Zone?.[0]);
    const resultat = { ...l, fields,
      moduleWinner: moduleWinner(fields['Catégorie']),
      fournisseurNom: fournisseurWinner({ fields }, fournisseurs).nom,
      marqueNom: fields['Marque Winner'] || zone?.fields?.Marque || '',
    };
    vues.push(resultat);
    return resultat;
  });
}

module.exports = { FIELDS_WINNER, moduleWinner, ordonnerLignes, preparerLignesWinner, champsWinner, fournisseurWinner, enrichirLignesWinner };
