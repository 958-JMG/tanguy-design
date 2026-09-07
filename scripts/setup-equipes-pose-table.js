#!/usr/bin/env node
/**
 * Migration Airtable — table « Équipes pose » (2026-09-07, demande JMG)
 *
 * POURQUOI. Le cockpit permettait de « Nommer les équipes » en modifiant les
 * OPTIONS du singleSelect « Équipe pose » via l'API meta d'Airtable. Or cet
 * endpoint n'accepte QUE `name`/`description` : dès qu'on lui envoie `options`,
 * il répond « Changing a field's type or number precision is not currently
 * supported ». Renommer/ajouter une équipe était donc IMPOSSIBLE par ce chemin.
 *
 * NOUVEAU MODÈLE. La liste des équipes (nom + ordre = couleur) vit désormais
 * dans une petite table « Équipes pose » (une ligne = une équipe). Le projet
 * continue de porter le NOM de son équipe dans son singleSelect « Équipe pose »
 * (rien à changer côté affichage) ; renommer une équipe met à jour sa ligne PUIS
 * cascade le nouveau nom sur les chantiers concernés (API records, `typecast`
 * crée l'option au passage). Aucune écriture d'options de champ.
 *
 * Ce script CRÉE la table et la remplit à partir des options actuelles de
 * « Équipe pose » (dans l'ordre), pour que les affectations existantes gardent
 * leur couleur. Idempotent : si la table existe déjà, il complète seulement les
 * équipes manquantes.
 *
 * Champs :
 *   - « Nom »   (singleLineText, champ primaire) : le nom affiché, éditable.
 *   - « Ordre » (number, précision 0) : position → couleur dans le planning.
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY (token scope schema.bases:write).
 *
 * Usage :
 *   node scripts/setup-equipes-pose-table.js          # dry-run
 *   node scripts/setup-equipes-pose-table.js --apply  # exécute
 */
const fs = require('fs');
const path = require('path');

if (!process.env.AIRTABLE_KEY) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  }
}
const fetchFn = globalThis.fetch;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
if (!BASE_ID || !AT_KEY) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

// Doit rester synchronisé avec TABLES.projets dans server.js.
const PROJETS_TABLE_ID = 'tbl9y74Gakhfwt6i1';
const TABLE_NAME = 'Équipes pose';
// Si « Équipe pose » n'existe pas encore (option), on part de ces 3 équipes.
const EQUIPES_DEFAUT = ['Équipe 1', 'Équipe 2', 'Équipe 3'];

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`schema fetch: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}
async function createTable(body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`create table: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}
async function listRecords(tableId) {
  let records = [], offset = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}?${q}`, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`list: ${r.status} ${e.error?.message || ''}`); }
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}
async function createRecords(tableId, rows) {
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    const r = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch.map(fields => ({ fields })), typecast: true })
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`create records: ${r.status} ${e.error?.message || ''}`); }
  }
}

(async () => {
  console.log(`[setup-equipes-pose-table] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();

  // Ordre de départ = options actuelles de « Équipe pose » (pour garder les couleurs).
  const projets = schema.tables.find(t => t.id === PROJETS_TABLE_ID);
  const champEquipe = projets?.fields.find(f => f.name === 'Équipe pose');
  let equipesSource = EQUIPES_DEFAUT;
  if (champEquipe && champEquipe.type === 'singleSelect') {
    const choices = (champEquipe.options?.choices || []).map(c => c.name).filter(Boolean);
    if (choices.length) equipesSource = choices;
  }
  console.log(`Équipes de départ (ordre) : ${equipesSource.join(', ')}`);

  let table = schema.tables.find(t => t.name === TABLE_NAME);

  if (!table) {
    if (!APPLY) {
      console.log(`[DRY-RUN] créerait la table « ${TABLE_NAME} » (Nom singleLineText + Ordre number) et ${equipesSource.length} lignes.`);
      console.log(`Pour exécuter : node scripts/setup-equipes-pose-table.js --apply`);
      return;
    }
    const created = await createTable({
      name: TABLE_NAME,
      description: 'Équipes de pose du cockpit (nom + ordre). Le nom est éditable depuis l’onglet Pose (bouton « Nommer les équipes »). L’ordre donne la couleur dans le planning. Le projet référence l’équipe par son nom (champ « Équipe pose »).',
      fields: [
        { name: 'Nom', type: 'singleLineText' },
        { name: 'Ordre', type: 'number', options: { precision: 0 } },
      ],
    });
    table = created;
    console.log(`✓ table « ${TABLE_NAME} » créée id=${table.id}`);
  } else {
    console.log(`« ${TABLE_NAME} » existe déjà id=${table.id}.`);
  }

  // Semis / complétion idempotente : n'ajoute que les équipes absentes.
  // (table fraîchement créée = 0 ligne ; table préexistante = on lit ses lignes.)
  const existants = await listRecords(table.id).catch(() => []);
  const presents = new Set(existants.map(r => String(r.fields?.Nom || '').trim().toLowerCase()).filter(Boolean));
  const aAjouter = equipesSource
    .map((name, i) => ({ Nom: name, Ordre: i }))
    .filter(row => !presents.has(row.Nom.trim().toLowerCase()));

  if (!aAjouter.length) {
    console.log(`✓ rien à semer (${presents.size} équipe(s) déjà en place).`);
  } else if (!APPLY) {
    console.log(`[DRY-RUN] ajouterait ${aAjouter.length} ligne(s) : ${aAjouter.map(r => r.Nom).join(', ')}.`);
  } else {
    await createRecords(table.id, aAjouter);
    console.log(`✓ ${aAjouter.length} équipe(s) ajoutée(s) : ${aAjouter.map(r => r.Nom).join(', ')}.`);
  }

  if (!APPLY) console.log(`Pour exécuter : node scripts/setup-equipes-pose-table.js --apply`);
  else console.log('Terminé.');
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
