'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const ExcelJS = require('exceljs');
const JSZip = createRequire(require.resolve('exceljs'))('jszip');
const { lireExcel } = require('./devis-excel');
const entetes = ['Section', 'Référence', 'Désignation', 'Quantité', 'PU HT', 'Remise HT', 'Remise %', 'Éco HT', 'Net HT', 'TVA', 'Catégorie', 'Type', 'Sans référence'];
const rows = [
  ['Total HT document', 900], ['Total TTC document', 1080], ['Montant TVA', 180], ['Taux TVA', 20], ['Total eco HT', 12], ['Eco incluse', 'oui'], ['Remise globale HT', 112], entetes,
  ['Appareils', 'APP-TEST', 'Appareil fictif', 1, 800, 200, 25, 0, 600, 20, 'Électroménager', 'article'],
  ['Meubles', '0000123 + TEST-02', 'Meuble fictif\nDescription complète', 2, 200, 0, null, 0, 400, 20, 'Mobilier', 'article'],
  ['', '', 'Éco-participation', 1, 12, 0, null, 12, 12, 20, '', 'eco'],
];
async function workbook(modifier = () => {}) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Devis'); ws.addRows(rows); await modifier(wb, ws); return Buffer.from(await wb.xlsx.writeBuffer());
}
test('Excel et CSV : mêmes références, descriptions multilignes, remises et totaux', async () => {
  const csv = '\ufeff' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const { controlerDetail } = await import('../public/v3/assets/js/core/devis-detail.mjs');
  for (const [b, ext] of [[Buffer.from(csv), '.csv'], [await workbook(), '.xlsx']]) {
    const d = await lireExcel(b, ext), c = controlerDetail(d);
    assert.equal(c.ok, true, c.erreurs.join()); assert.equal(c.totaux.total_ttc, 1080);
    assert.equal(c.lignes[1].code_produit, '0000123 + TEST-02'); assert.match(c.lignes[1].designation, /\nDescription complète$/);
  }
});
test('format Excel explicitement porteur des zéros et des pourcentages', async () => {
  const b = await workbook((wb, ws) => { ws.getCell('B10').value = 123; ws.getCell('B10').numFmt = '0000000'; ws.getCell('G9').value = 0.25; ws.getCell('G9').numFmt = '0%'; });
  const d = await lireExcel(b, '.xlsx'); assert.equal(d.lignes_detail[1].code_produit, '0000123'); assert.equal(d.lignes_detail[0].remise_pct, 25);
});
test('référence numérique sans format exact refusée, aucun zéro supposé', async () => {
  await assert.rejects(lireExcel(await workbook((wb, ws) => { ws.getCell('B10').value = 123; }), '.xlsx'), /référence numérique/);
});
test('résultat de formule enregistré lu ; formule sans résultat refusée, aucun recalcul externe', async () => {
  const b = await workbook((wb, ws) => { ws.getCell('B2').value = { formula: '900*1.2', result: 1080 }; });
  assert.equal((await lireExcel(b, '.xlsx')).totaux.total_ttc, 1080);
  await assert.rejects(lireExcel(await workbook((wb, ws) => { ws.getCell('B2').value = { formula: '900*1.2' }; }), '.xlsx'), /sans résultat/);
});
test('données non reconnues jamais supprimées en silence, y compris feuille cachée', async () => {
  await assert.rejects(lireExcel(await workbook((wb, ws) => { ws.getCell('N8').value = 'Option particulière'; ws.getCell('N10').value = 'Indispensable'; }), '.xlsx'), /colonne renseignée/);
  await assert.rejects(lireExcel(await workbook(wb => { const ws = wb.addWorksheet('Infos', { state: 'hidden' }); ws.addRow(['Un complément indispensable']); }), '.xlsx'), /données non reprises/);
  await assert.rejects(lireExcel(await workbook((wb, ws) => ws.addRow(['Total HT document', 900])), '.xlsx'), /plusieurs fois/);
});
test('fichier endommagé, format ancien, dépassement de taille : refus lisible', async () => {
  await assert.rejects(lireExcel(Buffer.from('pas un zip'), '.xlsx'));
  await assert.rejects(lireExcel(Buffer.from(''), '.xls'), /xlsx/);
  await assert.rejects(lireExcel(Buffer.alloc(6 * 1024 * 1024), '.xlsx'), /moins de 5 Mo/);
});
test('lecture Excel : les annotations non reconnues par ExcelJS ne bloquent pas le devis', async () => {
  const original = await workbook((wb, ws) => { ws.getCell('B5').note = 'Annotation fictive'; });
  const archive = await JSZip.loadAsync(original);
  const chemin = 'xl/worksheets/_rels/sheet1.xml.rels';
  const liens = await archive.file(chemin).async('string');
  assert.match(liens, /Target="\.\.\/comments1\.xml"/);
  // Un autre exporteur utilise une cible absolue dans le paquet XLSX.
  archive.file(chemin, liens.replace('../comments1.xml', '/xl/comments1.xml'));
  const tampon = await archive.generateAsync({ type: 'nodebuffer' });
  const attendu = await lireExcel(await workbook(), '.xlsx');
  assert.deepEqual(await lireExcel(original, '.xlsx'), attendu);
  assert.deepEqual(await lireExcel(tampon, '.xlsx'), attendu);
});
