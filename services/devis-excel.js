'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIAS = {
  designation: ['designation', 'descriptif', 'description', 'libelle'], code_produit: ['reference', 'references', 'code', 'code produit', 'ref'],
  quantite: ['quantite', 'qte', 'qty'], pu_ht: ['pu ht', 'prix unitaire ht', 'prix unitaire brut ht'],
  total_ht: ['net ht', 'total ht', 'montant ht', 'total net ht'], remise_ht: ['remise ht', 'remise eur', 'remise montant ht'],
  remise_pct: ['remise', 'remise pct', 'remise pourcentage'], eco_ht: ['eco ht', 'eco participation ht'],
  tva_taux: ['tva', 'tva taux', 'tva pct'], section: ['section', 'lot'], categorie: ['categorie', 'famille'],
  type: ['type'], sans_reference_confirme: ['sans reference', 'sans reference confirme'],
};
const META = {
  total_ht: ['total ht document', 'total ht final'], total_ttc: ['total ttc', 'total ttc document'],
  tva_montant: ['montant tva', 'tva totale'], tva_taux: ['taux tva', 'tva par defaut'],
  eco_ht: ['total eco ht'], eco_incluse: ['eco incluse'],
  remise_globale_ht: ['remise globale ht', 'remise commerciale ht'], remise_globale_pct: ['remise globale', 'remise globale pct'],
};
function lireCsv(buffer) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\ufeff/, '');
  const delim = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows = []; let row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quote && text[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (!quote && (c === delim || c === '\n')) { row.push(cell); cell = ''; if (c === '\n') { rows.push(row); row = []; } }
    else if (c !== '\r' || quote) cell += c;
  }
  if (quote) throw new Error('Guillemets non fermés dans le CSV.');
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}
function cellule(cell) {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(x => x.text).join('');
    if ('formula' in v || 'sharedFormula' in v) {
      if (v.result === undefined || v.result?.error) throw new Error(`Cellule ${cell.address} : formule sans résultat enregistré. Recalcule le fichier dans Excel puis enregistre-le.`);
      return v.result;
    }
    if ('hyperlink' in v) return v.text || '';
    throw new Error(`Cellule ${cell.address} : valeur non prise en charge.`);
  }
  // Les références numériques ne sont acceptées que si Excel fournit le
  // format exact. Aucun remplissage de zéros fondé sur une longueur supposée.
  if (typeof v === 'number' && /^0{2,}$/.test(cell.numFmt || '') && Number.isSafeInteger(v)) return String(v).padStart(cell.numFmt.length, '0');
  if (typeof v === 'number' && /%/.test(cell.numFmt || '')) return v * 100;
  return v;
}
function depuisFeuilles(feuilles) {
  const lignes = [], totaux = {}, nonLues = [];
  for (const { nom, rows } of feuilles) {
    if (rows.length > 1000) throw new Error('Le tableau dépasse 1 000 lignes. Scinde le fichier.');
    let cols = null, section = '';
    rows.forEach((row, index) => {
      if (!row.some(v => v !== null && v !== undefined && v !== '')) return;
      const premier = norm(row[0]);
      const meta = Object.keys(META).find(k => META[k].includes(premier));
      if (meta) {
        const v = row.slice(1).find(v => v !== null && v !== undefined && v !== '');
        if (Object.hasOwn(totaux, meta)) throw new Error(`Total « ${row[0]} » présent plusieurs fois. Garde un seul récapitulatif.`);
        totaux[meta] = meta === 'eco_incluse' ? /^(oui|true|vrai|1)$/i.test(String(v)) ? true : /^(non|false|faux|0)$/i.test(String(v)) ? false : null : v;
        return;
      }
      const entetes = row.map(v => Object.keys(ALIAS).find(k => ALIAS[k].includes(norm(v))) || null);
      if (entetes.includes('designation') && entetes.includes('quantite')) {
        if (entetes.filter(Boolean).some((k, i, a) => a.indexOf(k) !== i)) throw new Error(`En-tête ambigu dans ${nom} : plusieurs colonnes portent le même sens.`);
        cols = entetes; return;
      }
      if (!cols) { nonLues.push(`${nom}, ligne ${index + 1} : ${String(row[0] || '').slice(0, 100)}`); return; }
      const l = {};
      cols.forEach((k, i) => { if (k) l[k] = row[i] ?? null; });
      if (!l.designation || (l.quantite == null && l.total_ht == null && l.pu_ht == null)) {
        if (row.filter(v => v !== null && v !== undefined && v !== '').length === 1 && l.designation) { section = String(l.designation); return; }
        nonLues.push(`${nom}, ligne ${index + 1} : ${String(l.designation || row[0] || '').slice(0, 100)}`); return;
      }
      const inconnues = row.some((v, i) => v !== null && v !== undefined && v !== '' && !cols[i]);
      if (inconnues) nonLues.push(`${nom}, ligne ${index + 1} : une colonne renseignée n’a pas été reconnue.`);
      if (typeof l.code_produit === 'number') throw new Error(`${nom}, ligne ${index + 1} : référence numérique. Enregistre les références comme texte (avec leurs zéros initiaux), puis réimporte le fichier.`);
      l.type = /^eco(?: participation)?$/.test(norm(l.type)) ? 'eco' : 'article';
      l.sans_reference_confirme = /^(oui|true|vrai|1)$/i.test(String(l.sans_reference_confirme));
      l.section = l.section || section;
      lignes.push(l);
    });
  }
  if (!lignes.length) throw new Error('Aucun tableau reconnu. Utilise le modèle Excel : une ligne par article, avec Désignation, Référence, Quantité et Net HT.');
  if (nonLues.length) throw new Error(`Le fichier contient des données non reprises : ${nonLues.slice(0, 6).join(' ; ')}. Utilise les colonnes du modèle pour ne rien perdre.`);
  return { document: {}, produit_resume: 'Devis détaillé', descriptif_complet: '', prix_par_ligne_disponible: true, lignes_detail: lignes, totaux, pieces_eco_contribution: [], alertes_parsing: '' };
}
async function lireInterne(buffer, extension) {
  if (extension === '.csv') return depuisFeuilles([{ nom: 'CSV', rows: lireCsv(buffer) }]);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer, { ignoreNodes: ['drawing', 'picture', 'conditionalFormatting', 'dataValidations', 'sheetProtection'] });
  if (wb.worksheets.length > 12) throw new Error('Le fichier comporte trop de feuilles. Garde uniquement le devis à importer.');
  const feuilles = wb.worksheets.map(s => {
    const rows = [];
    if (s.rowCount > 1000 || s.columnCount > 40) throw new Error(`Feuille ${s.name} trop volumineuse : garde uniquement le devis.`);
    s.eachRow({ includeEmpty: true }, r => { const row = []; r.eachCell({ includeEmpty: true }, (c, i) => { row[i - 1] = cellule(c); }); rows.push(row); });
    return { nom: s.name, rows };
  });
  return depuisFeuilles(feuilles);
}
function lireExcel(buffer, extension) {
  if (!['.xlsx', '.csv'].includes(extension)) return Promise.reject(new Error('Choisis un fichier .xlsx ou .csv UTF-8.'));
  if (buffer.length > 5 * 1024 * 1024) return Promise.reject(new Error('Le tableau doit faire moins de 5 Mo.'));
  // Lecture isolée : ni macro, ni formule exécutée, ni accès aux liens externes.
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { buffer, extension }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('Le fichier est trop complexe à lire. Enregistre une copie ne contenant que le devis.')); }, 8000);
    w.once('message', r => { clearTimeout(timer); r.error ? reject(new Error(r.error)) : resolve(r.parsed); });
    w.once('error', () => { clearTimeout(timer); reject(new Error('Lecture Excel interrompue : fichier trop volumineux ou endommagé.')); });
    w.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Lecture Excel interrompue.')); });
  });
}
if (!isMainThread && workerData?.buffer) lireInterne(Buffer.from(workerData.buffer), workerData.extension).then(parsed => parentPort.postMessage({ parsed }), e => parentPort.postMessage({ error: e.message }));
module.exports = { lireExcel, lireCsv, depuisFeuilles };
