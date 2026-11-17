'use strict';
const PDFDocument = require('pdfkit');
const { createHash } = require('node:crypto');
const { ordonnerLignes } = require('./winner-lignes');
const { titreZone, detailsZone } = require('./description-devis-helper');

// Retirer uniquement le rappel standard en fin de descriptif général. Les
// prestations chiffrées restent dans les repères détaillés et dans les totaux.
// Toute variante contenant une précision technique est conservée intégralement.
function sansRappelPrestations(texte) {
  const lignes = String(texte || '').split(/\r?\n/);
  const normaliser = l => l.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const debut = lignes.findLastIndex(l => normaliser(l) === 'livraison, pose et eco-participation');
  if (debut < 0) return texte;
  const rappel = lignes.slice(debut).map(normaliser).filter(Boolean).join('\n');
  const quantite = 'quantite\\s*:\\s*\\d+(?:[.,]\\d+)?';
  const attendu = new RegExp(`^livraison, pose et eco-participation\\nlivraison\\n${quantite}\\npose\\n${quantite}\\neco-participation mobilier\\n${quantite}\\nremise commerciale\\nremise commerciale\\n${quantite}$`);
  return attendu.test(rappel) ? lignes.slice(0, debut).join('\n').trimEnd() : texte;
}

// Liste blanche descriptive : ni prix d’achat, ni marge, ni notes internes.
function contenuAnnexe(devis, lignes = [], zones = [], options = {}) {
  if (devis['Détail import']) return contenuDetail(devis, options);
  const blocs = [];
  for (const z of [...zones].sort((a, b) => (a.fields?.Ordre ?? 999) - (b.fields?.Ordre ?? 999))) {
    const f = z.fields || z;
    const texte = [f['Nom zone'], titreZone(f), ...detailsZone(f)].filter(Boolean).join('\n');
    if (texte) blocs.push({ titre: 'Modèle et finitions', texte });
  }
  for (const l of ordonnerLignes(lignes)) {
    const f = l.fields || l;
    const titre = [f['Section Winner'] || f['Catégorie'], f.Position != null ? `Repère ${f.Position}` : '', f['Code produit']].filter(Boolean).join(' · ');
    const texte = [f['Désignation'], f['Quantité'] != null ? `Quantité : ${f['Quantité']}` : ''].filter(Boolean).join('\n');
    if (texte) blocs.push({ titre: titre || 'Article', texte });
  }
  const numero = String(devis['Numéro devis'] || 'Devis');
  const empreinte = createHash('sha256').update(JSON.stringify({ numero, blocs })).digest('hex').slice(0, 16);
  return { numero, blocs, filename: `descriptif-${numero.replace(/[^a-z0-9-]/gi, '-').slice(0, 60)}-${empreinte}.pdf` };
}
function contenuDetail(devis, { nouvelleVersion = false } = {}) {
  const s = JSON.parse(devis['Détail import']);
  if (s.version !== 1 || s.etat !== 'complet') throw new Error('Import détaillé incomplet : annexe indisponible.');
  // Les devis déjà créés conservent leur annexe d'origine et ses contrôles.
  // Seule une création/régénération explicite adopte la nouvelle présentation.
  const ancienRendu = Boolean(s.pennylane) && s.pennylane.rendu !== 2 && !nouvelleVersion;
  const d = s.document, t = d.totaux, blocs = [];
  const euro = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u00a0\u202f]/g, ' ') + ' EUR';
  const descriptif = ancienRendu ? d.descriptif_complet : sansRappelPrestations(d.descriptif_complet);
  if (descriptif) blocs.push({ titre: 'Descriptif général', texte: descriptif });
  for (const [i, l] of d.lignes_detail.entries()) {
    blocs.push({ titre: [l.section, `Repère ${i + 1}`, l.code_produit].filter(Boolean).join(' · '),
      texte: [l.designation, l.code_produit ? `Références : ${l.code_produit}` : l.type === 'eco' ? '' : 'Prestation ou sur-mesure sans référence catalogue (confirmé).',
        `Quantité : ${l.quantite}${l.pu_ht != null ? ` · PU brut HT hors éco : ${euro(l.pu_ht)}` : ''}`,
        l.remise_ht > 0 ? `Remise article : -${euro(l.remise_ht)} HT${l.remise_pct != null ? ` (${l.remise_pct} %)` : ''}` : '',
        `Net de la ligne HT : ${euro(l.total_ht)} · TVA ${l.tva_taux} %`,
        l.eco_ht > 0 ? `Dont éco-participation : ${euro(l.eco_ht)} HT` : '',
      ].filter(Boolean).join('\n') });
  }
  blocs.push({ titre: 'Récapitulatif du devis', texte: [
    `Remises articles : -${euro(d.lignes_detail.reduce((s, l) => s + Number(l.remise_ht || 0), 0))} HT (déjà déduites des lignes ci-dessus)`,
    `Remise globale : -${euro(t.remise_globale_ht || 0)} HT${t.remise_globale_pct != null ? ` (${t.remise_globale_pct} % hors éco)` : ''}`,
    `Total net HT : ${euro(devis['Total HT final'])}`,
    `Total TTC : ${euro(devis['Total TTC'])}`,
    `Dont éco-participation : ${euro(devis['Éco-participation'] || 0)} TTC`,
  ].join('\n') });
  const numero = String(devis['Numéro devis'] || 'Devis');
  // Le rendu fait partie de la version interne : une ancienne annexe ne doit
  // pas être prise pour la nouvelle, même si seules les mentions ont changé.
  const empreinte = createHash('sha256').update(JSON.stringify({ ...(ancienRendu ? {} : { rendu: 2 }), numero, date: devis['Date devis'], blocs })).digest('hex').slice(0, 16);
  return { numero, date: devis['Date devis'], blocs, commercial: true, version: empreinte, rendu: ancienRendu ? 1 : 2,
    filename: `descriptif-${numero.replace(/[^a-z0-9-]/gi, '-').slice(0, 60)}-${empreinte}.pdf` };
}
function genererAnnexe(contenu) {
  if (!contenu.blocs.length) throw new Error('Aucun descriptif disponible pour cette annexe.');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 55, left: 48, right: 48 }, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#26251f').text('TANGUY DESIGN');
    doc.moveDown(.4).fontSize(14).text(`Descriptif — devis ${contenu.numero}`);
    doc.moveDown(.5).font('Helvetica').fontSize(9).fillColor('#66645c').text(contenu.commercial
      ? `Descriptif détaillé joint au devis. À conserver avec le devis commercial.\nDate du devis : ${contenu.date || '—'}${contenu.rendu === 1 ? ` · Version ${contenu.version}` : ''}\nLes montants ci-dessous détaillent le total du devis ; ils ne s’y ajoutent pas.`
      : 'Annexe descriptive au devis. Montants et conditions figurent sur le devis commercial.');
    doc.moveDown(1);
    for (const b of contenu.blocs) {
      if (doc.y > doc.page.height - 135) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#38362d').text(b.titre);
      doc.moveDown(.3).font('Helvetica').fontSize(10).fillColor('#26251f').text(String(b.texte), { lineGap: 2 });
      doc.moveDown(1);
    }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#77756c').text(`${contenu.numero} — Descriptif · ${i + 1}/${pages.count}`, 48, doc.page.height - 36, { lineBreak: false });
    }
    doc.end();
  });
}
module.exports = { contenuAnnexe, genererAnnexe };
