#!/usr/bin/env node
/**
 * Migration Airtable — équipe de pose + note de pose (2026-09-07, demande JMG)
 *
 * Contexte : l'onglet « Pose » planifie les chantiers dans la semaine. Sébastien
 * veut voir d'un coup d'œil QUELLE ÉQUIPE est sur QUEL chantier (une couleur par
 * équipe), et pouvoir écrire une NOTE courte sur chaque pose (accès, consignes…).
 *
 * Champs ajoutés sur Projets (saisis par l'équipe, pas techniques) :
 *   - « Équipe pose » (singleSelect) : Équipe 1 / Équipe 2 / Équipe 3.
 *       Les NOMS sont modifiables ensuite depuis le cockpit (bouton « Équipes »)
 *       ou ici dans Airtable ; renommer une option conserve son id, donc les
 *       chantiers déjà affectés suivent le nouveau nom et gardent leur couleur.
 *       La couleur à l'écran est calée sur l'ORDRE de l'option (1re = bleu, etc.),
 *       stable au renommage.
 *   - « Note pose » (multilineText) : texte libre affiché sur le bloc de pose et
 *       au survol, repris dans l'agenda global. Vide = rien affiché.
 *
 * Vide = pose sans équipe (bloc neutre) / sans note : les projets existants
 * restent valides sans reprise de données.
 *
 * Additif uniquement : ne change RIEN, ne supprime RIEN. Idempotent.
 *   - crée les champs manquants ;
 *   - si « Équipe pose » existe déjà en singleSelect, complète seulement les
 *     options manquantes parmi les 3 par défaut (ne renomme, ne supprime rien).
 *
 * Usage :
 *   node scripts/setup-pose-equipe-note.js          # dry-run
 *   node scripts/setup-pose-equipe-note.js --apply  # exécute
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY (token scope schema.bases:write).
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

// Options par défaut de « Équipe pose ». La couleur Airtable est cosmétique
// (vue Airtable) ; le cockpit recolore lui-même selon l'ordre.
const EQUIPES_DEFAUT = [
  { name: 'Équipe 1', color: 'blueBright' },
  { name: 'Équipe 2', color: 'orangeBright' },
  { name: 'Équipe 3', color: 'purpleBright' },
];

async function fetchSchema() {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: `Bearer ${AT_KEY}` } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`schema fetch: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}
async function createField(tableId, body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`create ${body.name}: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}
async function updateField(tableId, fieldId, body) {
  const r = await fetchFn(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields/${fieldId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`update field: ${r.status} ${e.error?.message || ''}`); }
  return r.json();
}

(async () => {
  console.log(`[setup-pose-equipe-note] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} base=${BASE_ID}`);
  const schema = await fetchSchema();
  const table = schema.tables.find(t => t.id === PROJETS_TABLE_ID);
  if (!table) { console.error(`✗ Table Projets (${PROJETS_TABLE_ID}) introuvable.`); process.exit(1); }

  // 1) Note pose (multilineText)
  const noteExisting = table.fields.find(f => f.name === 'Note pose');
  if (noteExisting) {
    console.log(`✓ « Note pose » existe déjà (id=${noteExisting.id}). Skip.`);
  } else if (!APPLY) {
    console.log(`[DRY-RUN] créerait « Note pose » (multilineText).`);
  } else {
    const created = await createField(PROJETS_TABLE_ID, {
      name: 'Note pose', type: 'multilineText',
      description: 'Note libre pour l’équipe de pose (accès, consignes, contact…). Affichée sur le bloc de pose et dans l’agenda. Saisie depuis l’onglet Pose du cockpit.'
    });
    console.log(`✓ créé « Note pose » id=${created.id}.`);
  }

  // 2) Équipe pose (singleSelect)
  const eqExisting = table.fields.find(f => f.name === 'Équipe pose');
  if (!eqExisting) {
    if (!APPLY) {
      console.log(`[DRY-RUN] créerait « Équipe pose » (singleSelect : ${EQUIPES_DEFAUT.map(e => e.name).join(', ')}).`);
    } else {
      const created = await createField(PROJETS_TABLE_ID, {
        name: 'Équipe pose', type: 'singleSelect',
        description: 'Équipe qui réalise la pose. Une couleur par équipe dans le planning. Noms modifiables depuis le cockpit (bouton Équipes).',
        options: { choices: EQUIPES_DEFAUT.map(e => ({ name: e.name, color: e.color })) }
      });
      console.log(`✓ créé « Équipe pose » id=${created.id} avec ${EQUIPES_DEFAUT.length} équipes.`);
    }
  } else if (eqExisting.type !== 'singleSelect') {
    console.log(`⚠ « Équipe pose » existe mais type=${eqExisting.type} (attendu singleSelect). Aucune action.`);
  } else {
    const choices = eqExisting.options?.choices || [];
    const present = new Set(choices.map(c => c.name));
    const aAjouter = EQUIPES_DEFAUT.filter(e => !present.has(e.name));
    if (!aAjouter.length) {
      console.log(`✓ « Équipe pose » existe déjà avec ses options (${choices.map(c => c.name).join(', ')}). Skip.`);
    } else if (!APPLY) {
      console.log(`[DRY-RUN] ajouterait à « Équipe pose » : ${aAjouter.map(e => e.name).join(', ')}.`);
    } else {
      const newChoices = [
        ...choices.map(c => ({ id: c.id, name: c.name, color: c.color })),
        ...aAjouter.map(e => ({ name: e.name, color: e.color })),
      ];
      await updateField(PROJETS_TABLE_ID, eqExisting.id, { options: { choices: newChoices } });
      console.log(`✓ ajouté à « Équipe pose » : ${aAjouter.map(e => e.name).join(', ')}.`);
    }
  }

  if (!APPLY) console.log(`Pour exécuter : node scripts/setup-pose-equipe-note.js --apply`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
