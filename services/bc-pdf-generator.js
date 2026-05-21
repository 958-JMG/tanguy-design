/**
 * services/bc-pdf-generator.js
 *
 * Génère un Bon de Commande PDF propre via pdfkit (A4), calé sur le format
 * "BON DE COMMANDE" type Tanguy Design.
 *
 * Réutilise la donnée structurée passée à renderBcHtml (commande + fournisseur +
 * lignes parsées depuis "Lignes BC" JSON) mais produit un PDF natif imprimable
 * et joignable à un mail, plutôt qu'un mailto texte aplati par les clients mail.
 *
 * Retourne un Buffer PDF.
 */

const PDFDocument = require('pdfkit');

function euros(n) {
  if (n == null || isNaN(n)) return '';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function safe(s) { return String(s ?? ''); }

/**
 * @param {object} opts
 * @param {object} opts.commande  - fields Airtable de la commande
 * @param {object} opts.fournisseur - fields Airtable du fournisseur (peut être null)
 * @param {Array}  opts.lignes    - lignes BC structurées {pos, code, description, sens, coteVisible, quantite, unite, largeurMm, hauteurMm, profondeurMm, notes}
 * @returns {Promise<Buffer>}
 */
function generateBcPdf(opts) {
  return new Promise((resolve, reject) => {
    try {
      const { commande = {}, fournisseur, lignes = [] } = opts;
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const COLORS = {
        dark: '#1a1a1a',
        muted: '#6b6b6b',
        line: '#dddddd',
        accent: '#C84B26',
      };
      const numero    = safe(commande['Numéro']);
      const ref       = safe(commande['Référence courte']);
      const contremarque = safe(commande['Contremarque']);
      const dateCrea  = formatDate(commande['Date création'] || new Date().toISOString());
      const livSemaine = safe(commande['Livraison semaine']);
      const dateLivPrev = formatDate(commande['Date livraison prévue']);
      const dateEnvoi  = formatDate(commande['Date envoi']);
      const modele    = safe(commande['Modèle choisi']);
      const details   = safe(commande['Détails modèle']);
      const fournNom  = safe(fournisseur?.fields?.Nom);
      const fournAdr  = safe(fournisseur?.fields?.Adresse);
      const fournTel  = safe(fournisseur?.fields?.Téléphone);
      const fournEmail = safe(fournisseur?.fields?.Email);
      const contact   = safe(commande['Contact Tanguy'] || 'Solène');

      // === ENTÊTE ===
      doc.fontSize(20).fillColor(COLORS.dark).font('Helvetica-Bold').text('TANGUY DESIGN', 40, 40);
      doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica')
        .text('Cuisines sur-mesure', 40, doc.y)
        .text('4 Rue Louis Blériot · ZA Toul Garros · 56400 AURAY', 40, doc.y + 2)
        .text('Tél. 02 97 56 28 53 · admin@tanguydesign.com', 40, doc.y + 2);

      // Numéro BC en haut à droite
      doc.fontSize(11).fillColor(COLORS.accent).font('Helvetica-Bold')
        .text('BON DE COMMANDE', 380, 40, { width: 175, align: 'right' });
      doc.fontSize(14).fillColor(COLORS.dark)
        .text(numero, 380, doc.y + 2, { width: 175, align: 'right' });
      doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica')
        .text(`Émis le ${dateCrea}`, 380, doc.y + 2, { width: 175, align: 'right' });

      // Ligne séparation
      doc.moveTo(40, 130).lineTo(555, 130).strokeColor(COLORS.line).lineWidth(1).stroke();

      let y = 145;

      // === DESTINATAIRE / CONTREMARQUE ===
      doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica-Bold').text('FOURNISSEUR', 40, y);
      doc.fontSize(8).text('CONTREMARQUE', 300, y);
      y += 12;
      doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica-Bold')
        .text(fournNom || '— Non rattaché —', 40, y, { width: 250 });
      doc.text(contremarque || '—', 300, y, { width: 250 });
      y += 14;
      if (fournAdr) {
        doc.fontSize(9).font('Helvetica').fillColor(COLORS.dark)
          .text(fournAdr, 40, y, { width: 250 });
        y = Math.max(y + 12, doc.y);
      }
      if (fournTel || fournEmail) {
        doc.fontSize(8).fillColor(COLORS.muted)
          .text([fournTel, fournEmail].filter(Boolean).join(' · '), 40, y, { width: 250 });
        y += 12;
      }

      y = Math.max(y, 190);
      doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.line).stroke();
      y += 10;

      // === MÉTA COMMANDE ===
      const metaItems = [
        ['Référence courte', ref],
        ['Livraison souhaitée', livSemaine],
        ['Date livraison prévue', dateLivPrev !== '—' ? dateLivPrev : ''],
        ['Date envoi', dateEnvoi !== '—' ? dateEnvoi : ''],
        ['Contact Tanguy', contact],
      ].filter(([_, v]) => v);
      const metaPerRow = 3;
      for (let i = 0; i < metaItems.length; i += metaPerRow) {
        const rowItems = metaItems.slice(i, i + metaPerRow);
        for (let j = 0; j < rowItems.length; j++) {
          const [label, val] = rowItems[j];
          const x = 40 + j * 175;
          doc.fontSize(7).fillColor(COLORS.muted).font('Helvetica').text(label.toUpperCase(), x, y);
          doc.fontSize(10).fillColor(COLORS.dark).font('Helvetica-Bold').text(val, x, y + 9, { width: 170 });
        }
        y += 32;
      }

      // === MODÈLE CHOISI (si BC meubles) ===
      if (modele) {
        doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.line).stroke();
        y += 10;
        doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica-Bold').text('CHOIX DU MODÈLE', 40, y);
        y += 12;
        doc.fontSize(11).fillColor(COLORS.dark).font('Helvetica-Bold').text(modele, 40, y, { width: 515 });
        y = doc.y + 4;
        if (details) {
          doc.fontSize(9).font('Helvetica').fillColor(COLORS.dark).text(details, 40, y, { width: 515 });
          y = doc.y + 4;
        }
      }

      doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.line).stroke();
      y += 10;

      // === TABLEAU LIGNES ===
      const cols = { pos: 28, code: 80, desc: 230, sens: 45, cote: 50, qte: 80 };
      const startX = 40;
      const colX = {
        pos: startX,
        code: startX + cols.pos,
        desc: startX + cols.pos + cols.code,
        sens: startX + cols.pos + cols.code + cols.desc,
        cote: startX + cols.pos + cols.code + cols.desc + cols.sens,
        qte:  startX + cols.pos + cols.code + cols.desc + cols.sens + cols.cote,
      };
      // Header tableau
      doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica-Bold');
      doc.text('Pos', colX.pos, y, { width: cols.pos });
      doc.text('Code & description', colX.code, y, { width: cols.code + cols.desc });
      doc.text('Sens', colX.sens, y, { width: cols.sens, align: 'center' });
      doc.text('Coté visible', colX.cote, y, { width: cols.cote, align: 'center' });
      doc.text('Quantité', colX.qte, y, { width: cols.qte, align: 'right' });
      y += 14;
      doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.dark).lineWidth(0.8).stroke();
      y += 4;

      // Body tableau
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.dark);
      const sortedLignes = lignes.slice().sort((a, b) =>
        String(a.pos || '').localeCompare(String(b.pos || ''), 'fr', { numeric: true })
      );
      for (const l of sortedLignes) {
        // Saut de page si nécessaire
        if (y > 760) {
          doc.addPage();
          y = 50;
        }
        const startY = y;
        // Pos
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.dark).text(safe(l.pos), colX.pos, y, { width: cols.pos });
        // Code (bold) + description sous le code
        doc.font('Helvetica-Bold').fontSize(9).text(safe(l.code), colX.code, y, { width: cols.code + cols.desc });
        let descY = doc.y + 2;
        if (l.description) {
          doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.dark)
            .text(safe(l.description), colX.code, descY, { width: cols.code + cols.desc - 10 });
          descY = doc.y;
        }
        // Dimensions sur leur propre ligne
        const dims = [];
        if (l.largeurMm)    dims.push(`L: ${l.largeurMm}`);
        if (l.hauteurMm)    dims.push(`H: ${l.hauteurMm}`);
        if (l.profondeurMm) dims.push(`P: ${l.profondeurMm}`);
        if (dims.length) {
          doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
            .text(dims.join(', '), colX.code, descY + 1, { width: cols.code + cols.desc - 10 });
          descY = doc.y;
        }
        if (l.notes) {
          doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLORS.accent)
            .text(safe(l.notes), colX.code, descY + 1, { width: cols.code + cols.desc - 10 });
          descY = doc.y;
        }
        // Sens / Cote / Qté (alignés en haut)
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.dark);
        doc.text(safe(l.sens), colX.sens, startY, { width: cols.sens, align: 'center' });
        doc.text(safe(l.coteVisible), colX.cote, startY, { width: cols.cote, align: 'center' });
        const qteTxt = l.quantite != null
          ? Number(l.quantite).toLocaleString('fr-FR', { minimumFractionDigits: 4 }) + (l.unite ? ' ' + l.unite : '')
          : '';
        doc.text(qteTxt, colX.qte, startY, { width: cols.qte, align: 'right' });

        // Avance au max(descY, startY+12)
        y = Math.max(descY + 4, startY + 14);
        doc.moveTo(40, y).lineTo(555, y).strokeColor(COLORS.line).lineWidth(0.4).stroke();
        y += 4;
      }

      // === FOOTER : livraison + signature ===
      if (y > 700) { doc.addPage(); y = 50; }
      y += 12;
      doc.fontSize(8).fillColor(COLORS.muted).font('Helvetica-Bold').text('LIVRAISON À', 40, y);
      y += 10;
      doc.fontSize(9).fillColor(COLORS.dark).font('Helvetica')
        .text('Tanguy Design, 4 Rue Louis Blériot, ZA Toul Garros, 56400 AURAY · Tél. 02 97 56 28 53', 40, y, { width: 515 });
      y = doc.y + 16;

      doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica-Oblique')
        .text(`Merci de confirmer cette commande. Cordialement, ${contact} — Tanguy Design.`, 40, y, { width: 515 });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateBcPdf };
