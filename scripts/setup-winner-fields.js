#!/usr/bin/env node
'use strict';
// Migration additive, à exécuter séparément AVANT le déploiement. Aucun secret
// lu sur disque, aucune modification sans --apply, aucune reprise des anciens PDF.
const { FIELDS_WINNER } = require('../services/winner-lignes');
const TABLE = 'tblCxDvzQAqBzpCx2';

async function migrer({ base, key, apply = false, fetchFn = fetch, log = console.log }) {
  if (!base || !key) throw new Error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis');
  const url = `https://api.airtable.com/v0/meta/bases/${base}/tables`;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const r = await fetchFn(url, { headers });
  if (!r.ok) throw new Error(`Lecture du schéma refusée (${r.status})`);
  const table = (await r.json()).tables.find(t => t.id === TABLE && t.name === 'Lignes devis');
  if (!table) throw new Error('Cible incorrecte : table Lignes devis introuvable');
  // Vérifier tous les champs existants AVANT la première écriture.
  for (const f of FIELDS_WINNER) {
    const existe = table.fields.find(e => e.name === f.name);
    if (existe && (existe.type !== f.type || (f.type === 'number' && existe.options?.precision !== 0))) {
      throw new Error(`Type incompatible pour ${f.name} ; aucune migration effectuée`);
    }
  }
  for (const f of FIELDS_WINNER) {
    if (table.fields.some(e => e.name === f.name)) { log(`${f.name} : déjà présent`); continue; }
    if (!apply) { log(`[SIMULATION] Créer ${f.name} (${f.type})`); continue; }
    const res = await fetchFn(`${url}/${TABLE}/fields`, { method: 'POST', headers, body: JSON.stringify(f) });
    if (!res.ok) throw new Error(`Création de ${f.name} refusée (${res.status})`);
    log(`${f.name} : créé`);
  }
}
if (require.main === module) migrer({ base: process.env.AIRTABLE_BASE_ID, key: process.env.AIRTABLE_KEY, apply: process.argv.includes('--apply') })
  .catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { migrer };
