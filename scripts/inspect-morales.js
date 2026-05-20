#!/usr/bin/env node
/**
 * Inspection du projet MORALES — investigation bug échéanciers incorrects (PDF 20/05/2026)
 *
 * Lecture seule. Affiche le détail du / des projets MORALES + devis + zones + lignes + échéances + commandes.
 *
 * Usage :
 *   node scripts/inspect-morales.js
 */
const fs = require('fs');
const path = require('path');
if (!process.env.AIRTABLE_KEY) {
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
const fetchFn = globalThis.fetch || require('node-fetch');
const B = process.env.AIRTABLE_BASE_ID, K = process.env.AIRTABLE_KEY;

const TABLES = {
  clients:        'tbl2zmxpWWzbY1wT0',
  projets:        'tbl9y74Gakhfwt6i1',
  devis:          'tblWklGEKMiBStXCs',
  'zones-devis':  'tbl6FmEIIR15NMsgZ',
  'lignes-devis': 'tblCxDvzQAqBzpCx2',
  echeances:      'tblML7D7MXeWnMcxy',
  commandes:      'tblDynhnhLXb4Ibs2',
  taches:         'tblDwUHL16LBVMSaz',
};

async function fetchAll(tid, filter = '') {
  let r = [], o = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (filter) q.set('filterByFormula', filter);
    if (o) q.set('offset', o);
    const res = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}?${q}`, { headers: { Authorization: 'Bearer ' + K } });
    const d = await res.json(); r = r.concat(d.records || []); o = d.offset || null;
  } while (o);
  return r;
}

const dump = (label, obj) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, null, 2));
};

(async () => {
  // Chercher tous les projets Morales (par référence ou par client)
  const allProjets = await fetchAll(TABLES.projets);
  const moralesProjets = allProjets.filter(p => /morales/i.test(p.fields['Référence'] || ''));
  console.log(`\n🔍 ${moralesProjets.length} projet(s) MORALES trouvé(s)\n`);

  for (const p of moralesProjets) {
    console.log('━'.repeat(80));
    console.log(`Projet ${p.id} — ${p.fields['Référence']}`);
    console.log('━'.repeat(80));
    dump('Champs projet', p.fields);

    // Récupérer devis liés
    const devisIds = p.fields['Devis'] || [];
    if (devisIds.length) {
      const devis = await fetchAll(TABLES.devis, `OR(${devisIds.map(id => `RECORD_ID()='${id}'`).join(',')})`);
      for (const d of devis) {
        dump(`Devis ${d.id}`, d.fields);

        // Zones
        const zoneIds = d.fields['Zones'] || [];
        if (zoneIds.length) {
          const zones = await fetchAll(TABLES['zones-devis'], `OR(${zoneIds.map(id => `RECORD_ID()='${id}'`).join(',')})`);
          dump(`Zones devis ${d.id} (${zones.length})`, zones.map(z => ({ id: z.id, ...z.fields })));
        }

        // Lignes
        const ligneIds = d.fields['Lignes'] || [];
        if (ligneIds.length) {
          console.log(`\nLignes devis ${d.id} : ${ligneIds.length}`);
          // Affichage condensé : ne pas dump 100 lignes
          const lignes = await fetchAll(TABLES['lignes-devis'], `OR(${ligneIds.slice(0, 10).map(id => `RECORD_ID()='${id}'`).join(',')})`);
          for (const l of lignes) {
            console.log(`  - [${l.id}] Pos ${l.fields['Position']||'?'} | ${l.fields['Code']||'-'} | ${l.fields['Désignation']||l.fields['Description']||'-'} | Qté ${l.fields['Quantité']||'?'} | PU ${l.fields['Prix unitaire']||l.fields['PU HT']||'?'}€`);
          }
          if (ligneIds.length > 10) console.log(`  ... (${ligneIds.length - 10} de plus)`);
        }

        // Échéances (nom champ Airtable réel : "Échéances devis")
        const echIds = d.fields['Échéances devis'] || d.fields['Échéances'] || d.fields['Echeances'] || [];
        if (echIds.length) {
          const ech = await fetchAll(TABLES.echeances, `OR(${echIds.map(id => `RECORD_ID()='${id}'`).join(',')})`);
          dump(`Échéances devis ${d.id} (${ech.length})`, ech.map(e => ({
            id: e.id,
            ordre: e.fields['Ordre'],
            phase: e.fields['Phase'] || e.fields['Type'],
            pct: e.fields['Pourcentage'],
            montant: e.fields['Montant'] || e.fields['Montant HT'],
            date: e.fields['Date prévue'] || e.fields['Date'],
            statut: e.fields['Statut paiement'] || e.fields['Statut'],
            notes: e.fields['Notes'],
          })));
        }
      }
    }

    // Commandes liées
    const cmdIds = p.fields['Commandes'] || [];
    if (cmdIds.length) {
      const cmds = await fetchAll(TABLES.commandes, `OR(${cmdIds.map(id => `RECORD_ID()='${id}'`).join(',')})`);
      console.log(`\nCommandes liées : ${cmds.length}`);
      for (const c of cmds) {
        console.log(`  - [${c.id}] ${c.fields['Numéro']||c.fields['numéro']||'?'} | ${(c.fields['Notes']||'').slice(0, 100)}`);
      }
    }
  }
})().catch(e => { console.error('❌', e); process.exit(1); });
