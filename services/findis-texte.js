'use strict';
// ────────────────────────────────────────────────────────────────────────────
// services/findis-texte.js — Lecture EXACTE d'un PDF FINDIS par son texte
//
// Un PDF imprimé depuis FINDIS (« Imprimer mon projet ») porte son texte : on
// le lit tel quel, sans IA. Mesuré le 14/10/2026 sur 6 projets réels (45
// articles) : la lecture d'image par le modèle standard faisait 13 erreurs,
// dont des prix d'achat faux et une promo inventée ; le texte, lui, est exact
// par construction. Bonus : rien ne quitte le serveur (le bloc client n'est
// même pas lu : l'analyse commence à « Ajouter un article »).
//
// Produit la MÊME forme que la lecture IA (montants en texte), pour que
// normaliserArticles() (services/devis-electro.js) traite les deux pareil.
// Module PUR, testé sur le texte réel des 6 projets (services/fixtures/findis/).
// ────────────────────────────────────────────────────────────────────────────

const TITRE = /^(.+?) \| (.+)$/;
// Une référence FINDIS : majuscules/chiffres (au moins un chiffre), « # » et « - » admis.
const REF = /^(?=.*\d)[A-Z0-9#-]{5,}$/;
const MAJ = /^[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9&'.]+$/;
// Bruit de mise en page : pied de page, saut de page, colonnes latérales vides.
const BRUIT = /^(https?:\/\/|\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}|R$|Observations :?$|Lignes de cadeaux$|Ajouter un article)/;

// Deux lignes d'un titre coupé : « Micro- » + « ondes » → « Micro-ondes » ;
// « encastrable - » + « RB289300 » → « encastrable - RB289300 ».
const recoller = (a, b) => (/[\p{L}\d]-$/u.test(a) ? a + b : `${a} ${b}`);

/** « MIELE PRESTIGE - Four vapeur … DGC7460HCPRO » → { marque, libelle, reference } */
function decouperTitre(titre) {
  const t = titre.replace('[Hors Tarif]', '').trim().split(/\s+/);
  const reference = t.length && REF.test(t[t.length - 1]) ? t.pop() : '';
  const marque = [];
  while (t.length > 1 && MAJ.test(t[0]) && !REF.test(t[0])) marque.push(t.shift());
  const libelle = t.join(' ').replace(/^[\s-]+|[\s-]+$/g, '');
  return { marque: marque.join(' '), libelle, reference };
}

/**
 * Texte d'un PDF FINDIS → { projet_findis, articles, alertes }.
 * @param {string} texte - texte du PDF, pages jointes par « \n »
 */
function articlesDepuisTexte(texte) {
  const brut = String(texte || '');
  const projet = (/Projet n°\s*(\d+)/.exec(brut) || [])[1] || null;
  const debut = brut.indexOf('Ajouter un article');
  if (debut < 0) return { projet_findis: projet, articles: [], alertes: ['Mise en page FINDIS non reconnue (« Ajouter un article » absent).'] };
  const lignes = brut.slice(debut).split('\n').map(s => s.trim()).filter(l => l && !BRUIT.test(l));

  const alertes = [];
  const articles = [];
  let k = 0;
  while (k < lignes.length) {
    const m = TITRE.exec(lignes[k]);
    if (!m) { k++; continue; }
    const typeFindis = m[1].trim();
    let titre = m[2].trim();
    let j = k + 1;
    const sansHt = titre.replace('[Hors Tarif]', '').trim();
    // Titre sur deux lignes tant qu'il ne finit ni par la référence ni par « [Hors Tarif] ».
    if (!REF.test(sansHt.split(/\s+/).pop()) && !titre.includes('[Hors Tarif]') && j < lignes.length && !TITRE.test(lignes[j])) {
      titre = recoller(titre, lignes[j]);
      j++;
    }
    // Bloc de l'article : jusqu'au titre suivant.
    let fin = j;
    while (fin < lignes.length && !TITRE.test(lignes[fin])) fin++;
    const bloc = lignes.slice(j, fin);
    const iPrix = bloc.findIndex(l => /^Votre prix public\s*:/.test(l));
    const a = { source: 0, type_findis: typeFindis, ...decouperTitre(titre), hors_tarif: titre.includes('[Hors Tarif]') };
    // La quantité est le nombre seul juste avant « Votre prix public ».
    a.quantite = iPrix > 0 && /^\d+$/.test(bloc[iPrix - 1]) ? Number(bloc[iPrix - 1]) : 1;
    for (let x = Math.max(iPrix, 0); x < bloc.length; x++) {
      const l = bloc[x];
      let mm;
      if ((mm = /^Votre prix public\s*:\s*(.+)$/.exec(l))) a.prix_public_ttc = mm[1].trim();
      else if ((mm = /^P\.Vente\s*:\s*(.+?)\s*€\s*TTC$/.exec(l))) a.prix_vente_ttc = mm[1].trim();
      else if ((mm = /^P\.Achat\s*:\s*(.+?)\s*€\s*HT$/.exec(l))) a.prix_achat_ht = mm[1].trim();
      else if ((mm = /^Promo\s*:\s*(.+?)\s*€\s*HT$/.exec(l))) a.promo_ht = mm[1].trim();
      else if ((mm = /éco-part\.\s*:\s*(.+?)\s*€\s*HT$/.exec(l))) a.eco_part_ht = mm[1].trim();
      else if ((mm = /^Stock\s*:\s*(\d+)\s*\/\s*Cde\s*:\s*(\d+)$/.exec(l))) { a.stock = Number(mm[1]); a.cde = Number(mm[2]); }
      else if ((mm = /^Délai\s*:\s*(.+)$/.exec(l))) a.delai = mm[1].trim();
      else if (l === 'Sur commande') a.sur_commande = true;
      else if ((mm = /^Article remplacé par la(?:\s+référence\s+(\S+))?$/.exec(l))) {
        a.remplace_par = mm[1] || ((/^référence\s+(\S+)$/.exec(bloc[x + 1] || '') || [])[1]) || '?';
      }
    }
    if (iPrix < 0) alertes.push(`« ${a.marque} ${a.reference || a.libelle} » : bloc de prix introuvable.`);
    articles.push(a);
    k = fin;
  }
  if (!articles.length) alertes.push('Aucun article reconnu dans le texte de ce PDF.');
  return { projet_findis: projet, articles, alertes };
}

module.exports = { articlesDepuisTexte, decouperTitre };
