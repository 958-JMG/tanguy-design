#!/usr/bin/env node
'use strict';
// Additif, sans données client. Aucune lecture automatique de .env.
const requis = [{ name: 'Détail import', type: 'multilineText', description: 'Snapshot versionné de l’import détaillé relu. Géré par le cockpit, ne pas modifier.' },
  { name: 'Empreinte import', type: 'singleLineText', description: 'Empreinte de reprise sans doublon.' }];
function plan(schema) {
  const table = schema.tables?.find(t => t.id === 'tblWklGEKMiBStXCs');
  if (!table) throw new Error('Table Devis introuvable.');
  return requis.filter(r => {
    const f = table.fields.find(f => f.name === r.name);
    if (f && f.type !== r.type) throw new Error(`Le champ ${r.name} existe avec un type différent : arrêt.`);
    return !f;
  }).map(f => ({ ...f }));
}
async function main() {
  const base = process.env.AIRTABLE_BASE_ID, key = process.env.AIRTABLE_KEY;
  if (!base || !key) throw new Error('AIRTABLE_BASE_ID et AIRTABLE_KEY requis.');
  const apply = process.argv.includes('--apply');
  if (apply && process.argv[process.argv.indexOf('--base') + 1] !== base) throw new Error('Pour appliquer, indique --base avec la base attendue.');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const url = `https://api.airtable.com/v0/meta/bases/${base}/tables`;
  const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`Schéma indisponible (${r.status}).`);
  const manquants = plan(await r.json());
  for (const field of manquants) {
    if (apply) { const c = await fetch(`${url}/tblWklGEKMiBStXCs/fields`, { method: 'POST', headers, body: JSON.stringify(field) }); if (!c.ok) throw new Error(`Création ${field.name} refusée (${c.status}).`); }
    console.log(`${apply ? 'Créé' : 'À créer (simulation)'} : ${field.name}`);
  }
  if (!manquants.length) console.log('Champs présents et types conformes.');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { plan };
