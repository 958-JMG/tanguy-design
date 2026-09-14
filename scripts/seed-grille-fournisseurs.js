#!/usr/bin/env node
/**
 * Seed — Grille fournisseurs (liste réelle fournie par JMG, 2026-09-14)
 *
 * Renseigne le champ "Catégories" des fournisseurs. Upsert par nom NORMALISÉ
 * (sans accents/espaces) pour ne pas dupliquer un fournisseur déjà présent sous
 * une orthographe voisine (ex. « Nova Mobili » ↔ « Novamobili »).
 *
 * Prérequis : le champ "Catégories" existe (scripts/setup-grille-fournisseurs-fields.js).
 *
 * Usage :
 *   node scripts/seed-grille-fournisseurs.js          # dry-run
 *   node scripts/seed-grille-fournisseurs.js --apply  # exécute
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY.
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
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
if (!BASE_ID || !AT_KEY) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const FOURNISSEURS_TABLE = 'tblz1AZIKkn9VCbkR';

// Grille JMG (refonte 2026-09-14) : 4 familles. « Plan de travail & crédence »
// regroupe plan de travail + évier + robinetterie + crédence. Luminaire reste
// vide (aucun fournisseur fourni) → Virginie la remplira.
const GRILLE = {
  'Mobilier': ['Modulnova', 'Nova Mobili', 'Nova Cuisina', 'Binova', 'Lago', 'Cinquante 3', 'ADL'],
  'Électroménager': ['Findis', 'Bora'],
  'Plan de travail & crédence': ['Fidelem', 'Granit Evolution', 'La Morlésienne', 'Bradano', 'Franke', 'Gessi', 'Goode Glass'],
};

// Clé de rapprochement : minuscule, sans accents, sans espaces/ponctuation.
const key = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Alias : orthographes DÉJÀ en base pour un fournisseur de la grille (constaté en
// prod le 14/09). On tague la fiche existante plutôt que d'en créer un doublon.
const ALIASES = {
  'Nova Cuisina': ['Nova Cuccina'],
  'Cinquante 3': ['Cinquanta3'],
};
const candidateKeys = nom => [key(nom), ...((ALIASES[nom] || []).map(key))];

// fournisseur → set de catégories (inverse de GRILLE)
const parFournisseur = new Map();
for (const [cat, noms] of Object.entries(GRILLE)) {
  for (const nom of noms) {
    if (!parFournisseur.has(nom)) parFournisseur.set(nom, new Set());
    parFournisseur.get(nom).add(cat);
  }
}

async function fetchAll(tableId) {
  let records = [], offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) throw new Error(`fetchAll: ${r.status} ${(await r.json().catch(() => ({}))).error?.message || ''}`);
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}
async function createRecord(tableId, fields) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw new Error(`create: ${r.status} ${(await r.json().catch(() => ({}))).error?.message || ''}`);
  return r.json();
}
async function patchRecord(tableId, id, fields) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${AT_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw new Error(`patch ${id}: ${r.status} ${(await r.json().catch(() => ({}))).error?.message || ''}`);
  return r.json();
}

(async () => {
  console.log(APPLY ? '🚀 APPLY — écritures réelles' : '🔍 DRY-RUN — relance avec --apply');
  const existants = await fetchAll(FOURNISSEURS_TABLE);
  const parCle = new Map(existants.map(r => [key(r.fields?.Nom), r]));

  let crees = 0, maj = 0, inchanges = 0;
  for (const [nom, cats] of parFournisseur) {
    const voulues = [...cats];
    // Rapprochement par nom normalisé OU par alias connu (évite les doublons prod).
    let found = null;
    for (const k of candidateKeys(nom)) { if (parCle.has(k)) { found = parCle.get(k); break; } }
    if (found) {
      // REMPLACEMENT (refonte 2026-09-14) : on POSE exactement les familles voulues,
      // ce qui fait tomber les anciennes (Plan de travail / Évier / Robinetterie /
      // Crédence) au profit de « Plan de travail & crédence ». Idempotent.
      const actuelles = Array.isArray(found.fields?.['Catégories']) ? found.fields['Catégories'] : [];
      const sameSet = actuelles.length === voulues.length && voulues.every(c => actuelles.includes(c));
      if (sameSet) { console.log(`  ✓ ${found.fields.Nom} — déjà ${JSON.stringify(actuelles)}`); inchanges++; continue; }
      console.log(`  ~ ${found.fields.Nom} : ${JSON.stringify(actuelles)} → ${JSON.stringify(voulues)}`);
      if (APPLY) await patchRecord(FOURNISSEURS_TABLE, found.id, { 'Catégories': voulues });
      maj++;
    } else {
      console.log(`  + ${nom} (nouveau) → ${JSON.stringify(voulues)}`);
      if (APPLY) await createRecord(FOURNISSEURS_TABLE, { 'Nom': nom, 'Catégories': voulues });
      crees++;
    }
  }
  console.log(`\nBilan : ${crees} créé(s), ${maj} mis à jour, ${inchanges} inchangé(s).`);
  console.log(APPLY ? '✅ Terminé' : '(dry-run terminé — rien écrit)');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
