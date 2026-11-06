'use strict';
const PDFDocument = require('pdfkit');
const { createHash } = require('node:crypto');
const { ordonnerLignes } = require('./winner-lignes');
const { titreZone, detailsZone } = require('./description-devis-helper');

// Liste blanche descriptive : ni prix d’achat, ni marge, ni notes internes.
function contenuAnnexe(devis, lignes = [], zones = []) {
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
function genererAnnexe(contenu) {
  if (!contenu.blocs.length) throw new Error('Aucun descriptif disponible pour cette annexe.');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 55, left: 48, right: 48 }, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#26251f').text('TANGUY DESIGN');
    doc.moveDown(.4).fontSize(14).text(`Descriptif — devis ${contenu.numero}`);
    doc.moveDown(.5).font('Helvetica').fontSize(9).fillColor('#66645c').text('Annexe descriptive au devis. Montants et conditions figurent sur le devis commercial.');
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
