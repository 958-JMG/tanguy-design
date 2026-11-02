#!/usr/bin/env node
/**
 * Migration Airtable — table « Événements pose » (2026-11-02, demande Sébastien via JMG)
 *
 * POURQUOI. Le planning « Pose » ne savait planifier QUE des chantiers du
 * pipeline : « une pose = un projet daté », les dates/heures/équipe/note vivant
 * sur la fiche Projet. Impossible d'y poser ce qui n'est pas un projet (livraison,
 * réception marchandise, congé, intervention SAV ponctuelle…). Sébastien voulait
 * « écrire ce qu'il veut » sur son planning.
 *
 * NOUVEAU MODÈLE. Une table dédiée « Événements pose » tient ces entrées en
 * saisie libre, À CÔTÉ des poses-chantier, sans toucher aux projets (sinon une
 * « livraison » polluerait le pipeline, les devis, les relances, les marges…).
 * Le planning mélange les deux sources ; une entrée libre se déplace, s'étire et
 * se colore par équipe exactement comme une pose-chantier.
 *
 * Champs :
 *   - « Titre »        (singleLineText, primaire) : libellé libre affiché sur le bloc.
 *   - « Date début »   (date) : premier jour.
 *   - « Date fin »     (date) : dernier jour (vide = événement d'un jour).
 *   - « Heure début »  (singleLineText 'HH:MM') : comme « Heure début pose » des projets.
 *   - « Heure fin »    (singleLineText 'HH:MM').
 *   - « Équipe »       (singleLineText) : nom d'équipe (couleur par rapprochement
 *                       avec la liste « Équipes pose », pas de singleSelect à gérer).
 *   - « Note »         (multilineText) : consignes affichées sur le bloc.
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY (token scope schema.bases:write).
 *
 * Usage :
 *   node scripts/setup-evenements-pose-table.js          # dry-run
 *   node scripts/setup-evenements-pose-table.js --apply  # exécute
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

const TABLE_NAME = 'Événements pose';

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
async function createField(tableId, field) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(field)
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`create field « ${field.name} »: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}

// Définition des champs. « Titre » est le champ primaire, créé avec la table.
const CHAMP_PRIMAIRE = { name: 'Titre', type: 'singleLineText' };
const CHAMPS = [
  { name: 'Date début', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'Date fin', type: 'date', options: { dateFormat: { name: 'iso' } } },
  { name: 'Heure début', type: 'singleLineText' },
  { name: 'Heure fin', type: 'singleLineText' },
  { name: 'Équipe', type: 'singleLineText' },
  { name: 'Note', type: 'multilineText' },
];

(async () => {
  console.log(`[setup-evenements-pose-table] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  let table = schema.tables.find(t => t.name === TABLE_NAME);

  if (!table) {
    if (!APPLY) {
      console.log(`[DRY-RUN] créerait la table « ${TABLE_NAME} » : ${CHAMP_PRIMAIRE.name} (primaire) + ${CHAMPS.map(c => c.name).join(', ')}.`);
      console.log(`Pour exécuter : node scripts/setup-evenements-pose-table.js --apply`);
      return;
    }
    const created = await createTable({
      name: TABLE_NAME,
      description: 'Entrées de planning « Pose » en saisie libre (livraison, réception, congé, SAV ponctuel…), indépendantes des projets. Affichées à côté des poses-chantier dans l’onglet Pose du cockpit.',
      fields: [CHAMP_PRIMAIRE],
    });
    table = created;
    console.log(`✓ table « ${TABLE_NAME} » créée id=${table.id}`);
  } else {
    console.log(`« ${TABLE_NAME} » existe déjà id=${table.id}.`);
  }

  // Création idempotente des champs manquants (table fraîche : tous ; préexistante : complétion).
  const presents = new Set((table.fields || []).map(f => f.name));
  for (const champ of CHAMPS) {
    if (presents.has(champ.name)) {
      console.log(`✓ champ « ${champ.name} » déjà présent. Skip.`);
      continue;
    }
    if (!APPLY) {
      console.log(`[DRY-RUN] créerait le champ « ${champ.name} » (${champ.type}).`);
      continue;
    }
    const created = await createField(table.id, champ);
    console.log(`✓ champ « ${champ.name} » créé id=${created.id}.`);
  }

  if (!APPLY) console.log(`Pour exécuter : node scripts/setup-evenements-pose-table.js --apply`);
  else console.log('Terminé.');
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
