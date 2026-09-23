/**
 * services/description-devis-helper.js — Descriptif commercial d'un devis
 *
 * Le devis Tanguy n'a pas de champ « Description » : ce qui décrit l'affaire vit
 * sur la ZONE (marque, modèle, coloris, finitions, gorges…). Ce descriptif était
 * déjà assemblé à la signature pour remplir « Modèle choisi » / « Détails modèle »
 * du bon de commande ; il est désormais partagé, pour que le BC et la facture
 * Pennylane racontent la MÊME chose.
 *
 * Demande JMG (27/08/2026) : sur les factures Pennylane, le libellé produit doit
 * rester constant (« Produit cuisine ») et c'est la DESCRIPTION qui doit reprendre
 * celle du devis — aujourd'hui elle n'est reprise nulle part.
 *
 * Logique PURE, testable sans Airtable (ADR-004) : on passe les `fields` des zones.
 */

// Ordre d'affichage : identique à celui du bon de commande, pour que les deux
// documents se lisent pareil.
const CHAMPS_DETAIL = [
  ['Modularité', 'Modularité'],
  ['Exécution façade', 'Exécution façade'],
  ['Coloris façade', 'Coloris façade'],
  ['Chant façade', 'Chant façade'],
  ['Coloris caisson', 'Coloris caisson'],
  ['Exécution côté finition', 'Exécution côté finition'],
  ['Coloris côté finition', 'Coloris côté finition'],
  ['Type de gorge', 'Type de gorge'],
  ['Exécution gorges', 'Exécution gorges'],
  ['Finition gorges', 'Finition gorges'],
  ['Profondeur', 'Profondeur'],
  ['Option ouverture', 'Option ouverture'],
  ['Finition socle', 'Finition socle'],
];

/** Zone principale = plus petit « Ordre ». Accepte des records Airtable ou des fields. */
function zonePrincipale(zones) {
  const list = (zones || []).map(z => (z && z.fields) ? { ...z.fields, _id: z.id } : z).filter(Boolean);
  if (!list.length) return null;
  return list.slice().sort((a, b) => (a.Ordre ?? 999) - (b.Ordre ?? 999))[0];
}

/** Titre court : « Marque — Modèle ». */
function titreZone(z) {
  if (!z) return '';
  return [z['Marque'], z['Modèle']].filter(Boolean).join(' — ');
}

/** Lignes de détail « Libellé : valeur », dans l'ordre du bon de commande. */
function detailsZone(z) {
  if (!z) return [];
  return CHAMPS_DETAIL
    .filter(([champ]) => z[champ] != null && String(z[champ]).trim() !== '')
    .map(([champ, libelle]) => `${libelle} : ${String(z[champ]).trim()}`);
}

/**
 * Descriptif complet d'un devis.
 * @param {Array} zones - zones du devis (records Airtable ou fields)
 * @param {{ separateur?: string, maxLongueur?: number }} [opts]
 * @returns {{ titre:string, details:string[], texte:string, vide:boolean }}
 *          `vide` = aucun descriptif exploitable → l'appelant doit le DIRE
 *          plutôt que d'envoyer une description blanche sans prévenir.
 */
function descriptionDevis(zones, { separateur = '\n', maxLongueur = null, toutesZones = false } = {}) {
  const list = (zones || []).map(z => (z && z.fields) ? { ...z.fields, _id: z.id } : z)
    .filter(Boolean).sort((a, b) => (a.Ordre ?? 999) - (b.Ordre ?? 999));
  const z = list[0] || null;
  const titre = titreZone(z);
  const details = detailsZone(z);

  // Multi-zones (JMG 2026-09-14) : un devis à plusieurs ensembles (cuisine, living,
  // dressing…) doit apparaître EN ENTIER sur la facture, pas seulement la 1re zone.
  // On récapitule chaque ensemble avec sa finition, puis les détails techniques
  // communs (gorges, profondeur, socle) portés par la zone principale.
  let texte;
  if (toutesZones && list.length > 1) {
    const pieces = list.map(zz => {
      const nom = (zz['Nom zone'] && String(zz['Nom zone']).trim()) || titreZone(zz) || 'Ensemble';
      const fin = [zz['Exécution façade'], zz['Coloris façade']].map(v => v && String(v).trim()).filter(Boolean).join(' ');
      return fin ? `• ${nom} : ${fin}` : `• ${nom}`;
    });
    texte = [titre, `Ensembles (${list.length}) :`, ...pieces, ...details].filter(Boolean).join(separateur);
  } else {
    texte = [titre, ...details].filter(Boolean).join(separateur);
  }

  if (maxLongueur && texte.length > maxLongueur) {
    texte = texte.slice(0, Math.max(0, maxLongueur - 1)).trimEnd() + '…';
  }
  return { titre, details, texte, vide: texte.trim() === '' };
}

/** Variante d'une seule ligne (pour un libellé ou un sujet de mail). */
function descriptionCourte(zones, maxLongueur = 120) {
  return descriptionDevis(zones, { separateur: ' · ', maxLongueur }).texte;
}

/**
 * Liste des LIGNES d'un devis, groupées par zone — pour la description Pennylane.
 * Demande JMG (2026-09-23) : « la génération du devis dans Pennylane doit reprendre
 * les lignes du devis dans la description ». PURE et testable (pas d'Airtable).
 *
 * @param {Array} lignes - records (ou fields) de « Lignes devis » : Position,
 *        « Code produit », Désignation, Quantité, Unité, lien Zone.
 * @param {Array} zones  - records (ou fields, avec id) de « Zones devis » : Nom zone,
 *        Marque, Modèle, Ordre. Sert à titrer et ordonner les groupes.
 * @param {{ max?: number }} [opts] - longueur cible (défaut 900, marge sous le cap
 *        Pennylane de 1000). Au-delà on TRONQUE et on l'annonce (jamais de coupe muette).
 * @returns {{ texte:string, total:number, inclus:number, tronque:boolean, vide:boolean }}
 */
function lignesDevisTexte(lignes, zones, { max = 900 } = {}) {
  const L = (lignes || []).map(l => (l && l.fields) ? { ...l.fields, _id: l.id } : l).filter(Boolean);
  const Z = (zones || []).map(z => (z && z.fields) ? { ...z.fields, _id: z.id } : z).filter(Boolean);
  const zoneById = new Map(Z.map(z => [z._id, z]));
  const ordreZone = z => (z && z.Ordre != null) ? z.Ordre : 999;

  // Lignes triées par Position (numérique-aware), puis groupées par zone.
  L.sort((a, b) => String(a.Position ?? '').localeCompare(String(b.Position ?? ''), 'fr', { numeric: true }));
  const groupes = new Map(); // zoneId | '' → lignes[]
  for (const l of L) {
    const zid = (Array.isArray(l.Zone) ? l.Zone[0] : l.Zone) || '';
    if (!groupes.has(zid)) groupes.set(zid, []);
    groupes.get(zid).push(l);
  }
  const ordreZid = zid => zid ? ordreZone(zoneById.get(zid)) : 1000; // hors zone en dernier
  const zids = [...groupes.keys()].sort((a, b) => ordreZid(a) - ordreZid(b));

  const titreGroupe = zid => {
    if (!zid) return 'Hors ensemble';
    const z = zoneById.get(zid);
    return (z && (z['Nom zone'] || [z.Marque, z.Modèle].filter(Boolean).join(' — '))) || 'Ensemble';
  };
  const ligneTexte = l => {
    const libelle = [String(l['Code produit'] || '').trim(), String(l['Désignation'] || '').trim()]
      .filter(Boolean).join(' ') || '(sans libellé)';
    const q = l['Quantité'];
    const unite = String(l['Unité'] || '').trim();
    const qte = (q != null && q !== '')
      ? ` (×${Number(q).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}${unite ? ' ' + unite : ''})`
      : '';
    return `- ${libelle}${qte}`;
  };

  const total = L.length;
  const out = [];
  let inclus = 0, tronque = false, len = 0;
  const fits = s => (len + s.length + 1) <= max;
  outer:
  for (const zid of zids) {
    const entete = `[${titreGroupe(zid)}]`;
    if (!fits(entete)) { tronque = true; break; }
    out.push(entete); len += entete.length + 1;
    for (const l of groupes.get(zid)) {
      const t = ligneTexte(l);
      if (!fits(t)) { tronque = true; break outer; }
      out.push(t); len += t.length + 1; inclus++;
    }
  }
  if (tronque && inclus < total) {
    const reste = total - inclus;
    out.push(`… (+${reste} ligne${reste > 1 ? 's' : ''}, détail complet sur le devis Tanguy)`);
  }
  const texte = out.join('\n');
  return { texte, total, inclus, tronque, vide: texte.trim() === '' };
}

module.exports = { CHAMPS_DETAIL, zonePrincipale, titreZone, detailsZone, descriptionDevis, descriptionCourte, lignesDevisTexte };
