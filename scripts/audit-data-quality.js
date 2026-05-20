#!/usr/bin/env node
/**
 * Audit data quality Airtable — Sprint 0.5 refonte v3 (2026-05-20)
 *
 * Lecture seule. Sort un rapport markdown.
 *
 * Détecte :
 *  - Doublons clients (par nom, par email, par téléphone normalisé)
 *  - Projets orphelins (sans client lié)
 *  - Statuts incohérents projet (ex : "Pose en cours" mais date pose dans le futur)
 *  - Clients sans projet rattaché
 *  - Commandes en famille "Divers" qui ressemblent à des plans de travail
 *  - Stats globales : répartition projets par statut, projets par client, etc.
 *
 * Usage :
 *   node scripts/audit-data-quality.js
 *
 * Sortie : docs/refonte-v3-2026-05-20/data-audit-YYYY-MM-DD.md
 *
 * Nécessite AIRTABLE_BASE_ID + AIRTABLE_KEY (token avec scope data.records:read).
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

const fetchFn = globalThis.fetch || require('node-fetch');
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const AT_KEY = process.env.AIRTABLE_KEY;
if (!BASE_ID || !AT_KEY) {
  console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis dans .env');
  process.exit(1);
}

const TABLES = {
  clients:      'tbl2zmxpWWzbY1wT0',
  projets:      'tbl9y74Gakhfwt6i1',
  commandes:    'tblDynhnhLXb4Ibs2',
  taches:       'tblDwUHL16LBVMSaz',
  fournisseurs: 'tblz1AZIKkn9VCbkR',
};

async function fetchAll(tableId, params = '') {
  let records = [], offset = null;
  do {
    const q = new URLSearchParams(params);
    q.set('pageSize', '100');
    if (offset) q.set('offset', offset);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?${q.toString()}`;
    const r = await fetchFn(url, { headers: { Authorization: `Bearer ${AT_KEY}` } });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(`fetch ${tableId}: ${r.status} ${e.error?.message || ''}`);
    }
    const d = await r.json();
    records = records.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return records;
}

// --- Normalisation pour matching doublons ---
const normName  = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,;]/g, '');
const normEmail = s => (s || '').toLowerCase().trim();
const normPhone = s => (s || '').replace(/[\s.\-()+]/g, '').replace(/^0/, '33');

function groupBy(records, keyFn) {
  const groups = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
}

function duplicates(groups) {
  const out = [];
  for (const [k, recs] of groups) {
    if (recs.length > 1) out.push({ key: k, count: recs.length, records: recs });
  }
  return out.sort((a, b) => b.count - a.count);
}

// --- Détection statut incohérent ---
function isStatutIncoherent(projet) {
  const f = projet.fields;
  const statut = (f['Statut'] || '').toLowerCase();
  const datePose = f['Date pose prévue'] || f['Date pose'] || null;
  if (!datePose) return null;
  const now = new Date();
  const pose = new Date(datePose);
  if (isNaN(pose)) return null;
  const futur = pose > now;
  const passe = pose < now;

  // Pose en cours / Terminé mais date pose future
  if (futur && (statut.includes('pose') || statut.includes('terminé') || statut.includes('termine'))) {
    return { type: 'pose_future_mais_statut_avance', detail: `Statut "${f['Statut']}" mais date pose ${datePose} (futur)` };
  }
  // Date pose passée mais statut en amont
  if (passe && (statut.includes('découverte') || statut.includes('decouverte') || statut.includes('dessin') || statut.includes('présentation') || statut.includes('presentation') || statut.includes('attente'))) {
    return { type: 'pose_passee_mais_statut_amont', detail: `Statut "${f['Statut']}" mais date pose ${datePose} (passé)` };
  }
  return null;
}

// --- Heuristique plan de travail mal classé ---
const PLAN_TRAVAIL_KEYWORDS = /plan(?:s)? de travail|chant ?travail|granit|quartz|dekton|hi[-\s]?macs|silestone|corian|stratifié plan|céramique plan/i;

function looksLikePlanDeTravail(commande) {
  const text = `${commande.fields['Notes'] || ''} ${commande.fields['Description'] || ''} ${commande.fields['numero'] || ''}`;
  return PLAN_TRAVAIL_KEYWORDS.test(text);
}

// --- Génération rapport markdown ---
function fmtRecord(r, fields) {
  const f = r.fields;
  return fields.map(k => `${k}: \`${f[k] || '—'}\``).join(' · ');
}

async function main() {
  console.log('🔍 Audit data quality — démarrage…\n');

  console.log('  Chargement Clients…');
  const clients = await fetchAll(TABLES.clients);
  console.log(`    → ${clients.length} clients`);

  console.log('  Chargement Projets…');
  const projets = await fetchAll(TABLES.projets);
  console.log(`    → ${projets.length} projets`);

  console.log('  Chargement Commandes…');
  const commandes = await fetchAll(TABLES.commandes);
  console.log(`    → ${commandes.length} commandes`);

  console.log('  Chargement Fournisseurs…');
  const fournisseurs = await fetchAll(TABLES.fournisseurs);
  console.log(`    → ${fournisseurs.length} fournisseurs`);

  const fournById = new Map(fournisseurs.map(f => [f.id, f]));

  // --- 1. Doublons clients ---
  console.log('\n  Détection doublons clients…');
  const dupNom   = duplicates(groupBy(clients, c => normName(c.fields['Nom'])));
  const dupEmail = duplicates(groupBy(clients, c => normEmail(c.fields['Email'])));
  const dupTel   = duplicates(groupBy(clients, c => normPhone(c.fields['Téléphone'])));
  console.log(`    → ${dupNom.length} groupes même nom, ${dupEmail.length} même email, ${dupTel.length} même tél`);

  // --- 2. Projets orphelins ---
  console.log('  Détection projets orphelins…');
  const orphelins = projets.filter(p => {
    const c = p.fields['Client'];
    return !c || (Array.isArray(c) && c.length === 0);
  });
  console.log(`    → ${orphelins.length} projets sans client`);

  // --- 3. Statuts incohérents ---
  console.log('  Détection statuts incohérents…');
  const incoherents = projets.map(p => ({ projet: p, issue: isStatutIncoherent(p) })).filter(x => x.issue);
  console.log(`    → ${incoherents.length} projets avec statut incohérent`);

  // --- 4. Clients sans projet ---
  console.log('  Détection clients sans projet…');
  const clientIdsAvecProjet = new Set();
  for (const p of projets) {
    const c = p.fields['Client'];
    if (Array.isArray(c)) c.forEach(id => clientIdsAvecProjet.add(id));
  }
  const sansProjet = clients.filter(c => !clientIdsAvecProjet.has(c.id));
  console.log(`    → ${sansProjet.length} clients sans projet`);

  // --- 5. Plans de travail en famille Divers ---
  console.log('  Détection plans de travail mal classés…');
  const planTravailDivers = [];
  for (const cmd of commandes) {
    const f = cmd.fields;
    const fournIds = Array.isArray(f['Fournisseur']) ? f['Fournisseur'] : [];
    const fournIsDivers = fournIds.some(id => {
      const fr = fournById.get(id);
      const famille = (fr?.fields['Famille'] || '').toLowerCase();
      const nom = (fr?.fields['Nom'] || '').toLowerCase();
      return famille.includes('divers') || famille === '' || nom.includes('divers');
    });
    if (fournIsDivers && looksLikePlanDeTravail(cmd)) {
      planTravailDivers.push(cmd);
    }
  }
  console.log(`    → ${planTravailDivers.length} commandes ressemblant à plan de travail en "Divers"`);

  // --- 6. Stats répartition ---
  console.log('  Calcul stats répartition…');
  const projetsParStatut = {};
  for (const p of projets) {
    const s = p.fields['Statut'] || '(vide)';
    projetsParStatut[s] = (projetsParStatut[s] || 0) + 1;
  }
  const projetsParClient = {};
  for (const p of projets) {
    const c = p.fields['Client'];
    if (Array.isArray(c)) c.forEach(id => { projetsParClient[id] = (projetsParClient[id] || 0) + 1; });
  }
  const topClients = Array.from(Object.entries(projetsParClient))
    .sort(([, a], [, b]) => b - a).slice(0, 10);
  const clientNom = id => {
    const c = clients.find(x => x.id === id);
    return c?.fields['Nom'] || id;
  };

  // --- 7. Build markdown report ---
  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(__dirname, '..', 'docs', 'refonte-v3-2026-05-20', `data-audit-${today}.md`);

  const lines = [];
  lines.push(`# Audit data quality Airtable — ${today}`);
  lines.push('');
  lines.push('Lecture seule. Sortie automatique de `scripts/audit-data-quality.js`.');
  lines.push('');
  lines.push('## Vue d\'ensemble');
  lines.push('');
  lines.push(`- **${clients.length}** clients · **${projets.length}** projets · **${commandes.length}** commandes · **${fournisseurs.length}** fournisseurs`);
  lines.push(`- Date du snapshot : ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## 1. Doublons clients');
  lines.push('');
  lines.push(`### Par nom normalisé — ${dupNom.length} groupes`);
  if (dupNom.length === 0) lines.push('✅ Aucun doublon par nom.');
  else {
    lines.push('');
    lines.push('| Nom normalisé | Nb | Records ID |');
    lines.push('|---------------|----|-----------|');
    for (const g of dupNom.slice(0, 50)) {
      lines.push(`| \`${g.key}\` | ${g.count} | ${g.records.map(r => `\`${r.id}\``).join(' · ')} |`);
    }
    if (dupNom.length > 50) lines.push(`| … | … | (${dupNom.length - 50} groupes supplémentaires non affichés) |`);
  }
  lines.push('');

  lines.push(`### Par email — ${dupEmail.length} groupes`);
  if (dupEmail.length === 0) lines.push('✅ Aucun doublon par email.');
  else {
    lines.push('');
    lines.push('| Email | Nb | Records ID |');
    lines.push('|-------|----|-----------|');
    for (const g of dupEmail.slice(0, 30)) {
      lines.push(`| \`${g.key}\` | ${g.count} | ${g.records.map(r => `\`${r.id}\``).join(' · ')} |`);
    }
  }
  lines.push('');

  lines.push(`### Par téléphone normalisé — ${dupTel.length} groupes`);
  if (dupTel.length === 0) lines.push('✅ Aucun doublon par téléphone.');
  else {
    lines.push('');
    lines.push('| Téléphone (norm.) | Nb | Records ID |');
    lines.push('|-------------------|----|-----------|');
    for (const g of dupTel.slice(0, 30)) {
      lines.push(`| \`${g.key}\` | ${g.count} | ${g.records.map(r => `\`${r.id}\``).join(' · ')} |`);
    }
  }
  lines.push('');

  lines.push('## 2. Projets orphelins (sans client lié)');
  lines.push('');
  if (orphelins.length === 0) lines.push('✅ Tous les projets ont un client lié.');
  else {
    lines.push(`🔴 **${orphelins.length} projets sans client lié.**`);
    lines.push('');
    lines.push('| ID projet | Référence | Statut | Date découverte |');
    lines.push('|-----------|-----------|--------|-----------------|');
    for (const p of orphelins.slice(0, 50)) {
      const f = p.fields;
      lines.push(`| \`${p.id}\` | ${f['Référence'] || '—'} | ${f['Statut'] || '—'} | ${f['Date découverte'] || '—'} |`);
    }
  }
  lines.push('');

  lines.push('## 3. Statuts projet incohérents');
  lines.push('');
  if (incoherents.length === 0) lines.push('✅ Aucune incohérence statut/date détectée.');
  else {
    lines.push(`🟠 **${incoherents.length} projets avec incohérence statut/date pose.**`);
    lines.push('');
    lines.push('| ID projet | Référence | Type incohérence | Détail |');
    lines.push('|-----------|-----------|------------------|--------|');
    for (const { projet, issue } of incoherents.slice(0, 50)) {
      lines.push(`| \`${projet.id}\` | ${projet.fields['Référence'] || '—'} | ${issue.type} | ${issue.detail} |`);
    }
  }
  lines.push('');

  lines.push('## 4. Clients sans projet rattaché');
  lines.push('');
  if (sansProjet.length === 0) lines.push('✅ Tous les clients ont au moins un projet.');
  else {
    lines.push(`ℹ️ **${sansProjet.length} clients sans projet** (candidats archivage ou nettoyage).`);
    lines.push('');
    lines.push('| ID | Nom | Type | Source | Date contact |');
    lines.push('|----|-----|------|--------|--------------|');
    for (const c of sansProjet.slice(0, 50)) {
      const f = c.fields;
      lines.push(`| \`${c.id}\` | ${f['Nom'] || '—'} | ${f['Type'] || '—'} | ${f['Source'] || '—'} | ${f['Date contact'] || '—'} |`);
    }
    if (sansProjet.length > 50) lines.push(`| … | … | … | … | (${sansProjet.length - 50} de plus) |`);
  }
  lines.push('');

  lines.push('## 5. Commandes "plan de travail" mal classées (famille Divers)');
  lines.push('');
  if (planTravailDivers.length === 0) lines.push('✅ Aucune commande "plan de travail" en famille Divers.');
  else {
    lines.push(`🟠 **${planTravailDivers.length} commandes** ressemblent à des plans de travail mais sont en famille "Divers".`);
    lines.push('');
    lines.push('| ID commande | Notes (extrait) | Fournisseur |');
    lines.push('|-------------|------------------|--------------|');
    for (const cmd of planTravailDivers.slice(0, 30)) {
      const notes = (cmd.fields['Notes'] || '').slice(0, 80).replace(/\n/g, ' ');
      const fournIds = cmd.fields['Fournisseur'] || [];
      const fournNoms = fournIds.map(id => fournById.get(id)?.fields['Nom'] || id).join(', ');
      lines.push(`| \`${cmd.id}\` | ${notes} | ${fournNoms} |`);
    }
  }
  lines.push('');

  lines.push('## 6. Stats globales');
  lines.push('');
  lines.push('### Répartition projets par statut');
  lines.push('');
  lines.push('| Statut | Nb |');
  lines.push('|--------|----|');
  for (const [s, n] of Object.entries(projetsParStatut).sort(([, a], [, b]) => b - a)) {
    lines.push(`| ${s} | ${n} |`);
  }
  lines.push('');

  lines.push('### Top 10 clients par nombre de projets');
  lines.push('');
  lines.push('| Client | Nb projets |');
  lines.push('|--------|-----------|');
  for (const [id, n] of topClients) {
    lines.push(`| ${clientNom(id)} | ${n} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Actions recommandées (Sprint 0.5)');
  lines.push('');
  const actions = [];
  if (dupNom.length > 0)         actions.push(`- 🔴 **Fusionner ${dupNom.length} groupes de clients en doublon par nom** avant le pivot client-centric (sinon les projets seront répartis sur des fiches dupliquées).`);
  if (dupEmail.length > 0)       actions.push(`- 🔴 **Fusionner ${dupEmail.length} doublons par email** (probablement les mêmes que les doublons nom).`);
  if (dupTel.length > 0)         actions.push(`- 🟠 **Vérifier ${dupTel.length} doublons par téléphone** (peut être conjoints partageant un numéro).`);
  if (orphelins.length > 0)      actions.push(`- 🔴 **Rattacher ou supprimer ${orphelins.length} projets orphelins.** Sans client, ils disparaîtront de la nav v3.`);
  if (incoherents.length > 0)    actions.push(`- 🟠 **Corriger ${incoherents.length} statuts incohérents** (typiquement projets "Pose en cours" avec date pose dans le futur — probablement statut figé après import).`);
  if (sansProjet.length > 0)     actions.push(`- ℹ️ **${sansProjet.length} clients sans projet** : décider avec Tanguy si on archive ou si on conserve (prospects).`);
  if (planTravailDivers.length > 0) actions.push(`- 🟠 **Reclasser ${planTravailDivers.length} commandes plan de travail** vers famille fournisseur correcte (impact marge).`);
  if (actions.length === 0) actions.push('✅ Aucune action data quality bloquante détectée. La base est propre, on peut attaquer Sprint 1 sans nettoyage préalable.');
  lines.push(...actions);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('_Rapport généré automatiquement. Pour relancer : `node scripts/audit-data-quality.js`._');

  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(`\n✅ Rapport écrit : ${reportPath}`);
  console.log(`\nRésumé :`);
  console.log(`  - Doublons clients : ${dupNom.length} par nom · ${dupEmail.length} par email · ${dupTel.length} par tél`);
  console.log(`  - Projets orphelins : ${orphelins.length}`);
  console.log(`  - Statuts incohérents : ${incoherents.length}`);
  console.log(`  - Clients sans projet : ${sansProjet.length}`);
  console.log(`  - Plans travail Divers : ${planTravailDivers.length}`);
}

main().catch(err => {
  console.error('\n❌ Erreur :', err.message);
  process.exit(1);
});
