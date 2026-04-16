/**
 * services/fiche-mission-generator.js
 *
 * Génère un PDF "Fiche de mission" pour un artisan donné, contenant :
 * - Entête Tanguy Design
 * - Référence projet + date
 * - Client + adresse chantier
 * - Artisan destinataire
 * - Description travaux
 * - Montants (HT, TTC, acompte 30%)
 * - Modalités (demande d'acompte, facturation)
 *
 * Retourne un Buffer PDF.
 */

const PDFDocument = require('pdfkit');

function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * @param {object} opts
 * @param {string} opts.projetRef
 * @param {string} opts.clientNom
 * @param {string} opts.adresseChantier
 * @param {string} opts.artisanNom
 * @param {string} opts.artisanContact
 * @param {string} opts.artisanEmail
 * @param {string} opts.artisanSpecialite
 * @param {string} opts.numeroDevis
 * @param {string} opts.dateDevis          ISO
 * @param {string} opts.dateDemarrage      ISO (optional)
 * @param {number} opts.montantHT
 * @param {number} opts.montantTTC
 * @param {string} opts.descriptionTravaux
 * @param {string} opts.notes              (optional)
 * @returns {Promise<Buffer>}
 */
function generateFicheMission(opts) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const GOLD = '#b8965a';
      const DARK = '#1a1a1a';
      const MUTED = '#6b6b6b';

      // --- En-tête ---
      doc
        .fillColor(DARK)
        .font('Helvetica-Bold').fontSize(22).text('TANGUY DESIGN', { continued: false })
        .fillColor(MUTED)
        .font('Helvetica').fontSize(9).text('Agence cuisine sur-mesure · Auray')
        .moveDown(0.3)
        .fillColor(GOLD)
        .font('Helvetica-Bold').fontSize(16).text('FICHE DE MISSION')
        .moveDown(0.8);

      // --- Intro ---
      doc
        .fillColor(DARK).font('Helvetica').fontSize(10)
        .text('Bonjour,')
        .moveDown(0.3)
        .text(`Le chantier ci-dessous vous est confié. Vous trouverez ci-après les informations principales nécessaires à son exécution.`)
        .moveDown(1);

      // --- Bloc Chantier ---
      sectionTitle(doc, 'CHANTIER', GOLD);
      keyValue(doc, 'Référence projet', opts.projetRef || '—');
      keyValue(doc, 'Client', opts.clientNom || '—');
      keyValue(doc, 'Adresse chantier', opts.adresseChantier || '—');
      if (opts.dateDemarrage) keyValue(doc, 'Démarrage prévu', formatDate(opts.dateDemarrage));
      doc.moveDown(0.6);

      // --- Bloc Artisan ---
      sectionTitle(doc, 'DESTINATAIRE', GOLD);
      keyValue(doc, 'Entreprise', opts.artisanNom || '—');
      if (opts.artisanSpecialite) keyValue(doc, 'Lot', opts.artisanSpecialite);
      if (opts.artisanContact) keyValue(doc, 'Contact', opts.artisanContact);
      if (opts.artisanEmail) keyValue(doc, 'Email', opts.artisanEmail);
      doc.moveDown(0.6);

      // --- Bloc Prestation ---
      if (opts.numeroDevis || opts.dateDevis || opts.descriptionTravaux) {
        sectionTitle(doc, 'PRESTATION', GOLD);
        if (opts.numeroDevis) keyValue(doc, 'Devis artisan', opts.numeroDevis);
        if (opts.dateDevis) keyValue(doc, 'Daté du', formatDate(opts.dateDevis));
        if (opts.descriptionTravaux) {
          doc.moveDown(0.2);
          doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('Description des travaux');
          doc.fillColor(DARK).font('Helvetica').fontSize(10)
            .text(opts.descriptionTravaux, { align: 'left', lineGap: 2 });
        }
        doc.moveDown(0.6);
      }

      if (opts.notes) {
        sectionTitle(doc, 'NOTES', GOLD);
        doc.fillColor(DARK).font('Helvetica').fontSize(10)
          .text(opts.notes, { lineGap: 2 });
        doc.moveDown(0.6);
      }

      // --- Pied de page ---
      doc
        .fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(`Fiche générée le ${formatDate(new Date().toISOString())} par le cockpit Tanguy Design`,
          50, doc.page.height - 60, { align: 'center', width: doc.page.width - 100 });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function sectionTitle(doc, label, color) {
  doc
    .fillColor(color).font('Helvetica-Bold').fontSize(11)
    .text(label)
    .moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(color).lineWidth(0.8).stroke()
    .moveDown(0.3);
}

function keyValue(doc, key, value) {
  const x = doc.x;
  doc
    .fillColor('#6b6b6b').font('Helvetica').fontSize(9).text(key, { continued: false, width: 160 });
  doc.moveUp();
  doc
    .fillColor('#1a1a1a').font('Helvetica').fontSize(10).text(String(value), 210, doc.y, { width: 340 });
  doc.x = x;
  doc.moveDown(0.15);
}

module.exports = { generateFicheMission };
