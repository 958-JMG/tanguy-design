#!/usr/bin/env node
/**
 * Backfill BC types (v3.1) — récupère les commandes existantes sans `Lignes BC`,
 * retrouve le devis Winner parent + ses lignes, et populate :
 *   - Lignes BC (JSON structuré filtré par catégorie matchant le Type de commande)
 *   - Contremarque (nom client extrait du projet)
 *   - Contact Tanguy ("Solène" par défaut)
 *   - Référence courte (mapping Type)
 *   - Modèle choisi + Détails modèle (pour Type Meubles, extrait de la 1re zone devis)
 *
 * Idempotent : ignore les commandes ayant déjà Lignes BC non vide.
 *
 * Usage :
 *   node scripts/backfill-bc-from-devis.js              # dry-run
 *   node scripts/backfill-bc-from-devis.js --apply      # live
 */
const fs = require('fs');
const path = require('path');
if (!process.env.AIRTABLE_KEY) {
  const p = path.join(__dirname, '..', '.env');
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
const fetchFn = globalThis.fetch;
const B = process.env.AIRTABLE_BASE_ID, K = process.env.AIRTABLE_KEY;
if (!B || !K) { console.error('AIRTABLE_BASE_ID + AIRTABLE_KEY requis'); process.exit(1); }

const APPLY = process.argv.includes('--apply');

const TABLES = {
  commandes:     'tblDynhnhLXb4Ibs2',
  devis:         'tblWklGEKMiBStXCs',
  'lignes-devis':'tblCxDvzQAqBzpCx2',
  'zones-devis': 'tbl6FmEIIR15NMsgZ',
  projets:       'tbl9y74Gakhfwt6i1',
  clients:       'tbl2zmxpWWzbY1wT0',
};

const TYPE_TO_REF = {
  'Meubles': 'NOVA_CUC',
  'Cuisine': 'NOVA_CUC',
  'Électroménager': 'ELECTRO',
  'Electromenager': 'ELECTRO',
  'Sanitaire': 'SANIT',
  'Accessoires': 'ACCESS',
  'Plan de travail': 'PLAN_TRAV',
};

// Pour matcher Type de commande → catégories de lignes devis :
// le Type stocké sur la commande peut être "Cuisine" (legacy) ou "Meubles" (nouveau).
// On accepte les deux et on map vers les catégories de lignes correspondantes.
const TYPE_TO_CATEGORIES = {
  'Meubles': ['Meubles', 'Panneaux de recouvrement'],
  'Cuisine': ['Meubles', 'Panneaux de recouvrement'],
  'Électroménager': ['Electroménager'],
  'Electromenager': ['Electroménager'],
  'Sanitaire': ['Eviers et robinetterie', 'Sanitaires'],
  'Accessoires': ['Produits de vente'],
  'Plan de travail': ['Plan de travail', 'Plans de travail'],
};

async function fetchAll(tid, filter = '') {
  let r = [], o = null;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (filter) q.set('filterByFormula', filter);
    if (o) q.set('offset', o);
    const res = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}?${q}`, { headers: { Authorization: 'Bearer ' + K } });
    if (!res.ok) throw new Error(`fetch ${tid}: ${res.status}`);
    const d = await res.json();
    r = r.concat(d.records || []);
    o = d.offset || null;
  } while (o);
  return r;
}

async function fetchOne(tid, id) {
  const r = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}/${id}`, { headers: { Authorization: 'Bearer ' + K } });
  if (!r.ok) return null;
  return r.json();
}

async function patch(tid, rid, fields) {
  const r = await fetchFn(`https://api.airtable.com/v0/${B}/${tid}/${rid}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) {
    const e = await r.text();
    throw new Error(`patch ${rid}: ${r.status} ${e.slice(0, 200)}`);
  }
  return r.json();
}

function buildModeleHeaderFromZone(z) {
  if (!z) return '';
  return [z.fields?.Marque, z.fields?.Modèle].filter(Boolean).join(' — ') +
    (z.fields?.['Porte épaisseur'] ? `\nPorte épaisseur ${z.fields['Porte épaisseur']}` : '');
}

function buildDetailsFromZone(z) {
  if (!z) return '';
  const f = z.fields || {};
  const lines = [];
  const KEYS = [
    ['Modularité', 'Modularité'],
    ['Exécution façade', 'Exécution façade'],
    ['Coloris façade', 'Coloris façade'],
    ['Chant façade', 'Chant façade'],
    ['Coloris caisson', 'Coloris caisson'],
    ['Exécution côté finition', 'Exécution côté finition'],
    ['Coloris côté finition', 'Coloris côté finition'],
    ['Type de gorge', 'Type de gorge'],
    ['Exécution gorges', 'Exécution gorges'],
    ['Finition gorges', 'Finition gorges'],
    ['Profondeur', 'Profondeur'],
    ['Option ouverture', 'Option ouverture'],
    ['Finition socle', 'Finition socle'],
  ];
  for (const [labelLong, field] of KEYS) {
    if (f[field]) lines.push(`${labelLong} : ${f[field]}`);
  }
  return lines.join('\n');
}

(async () => {
  console.log(`Mode : ${APPLY ? '🚀 APPLY' : '🧪 DRY-RUN'}\n`);

  console.log('Chargement commandes…');
  const commandes = await fetchAll(TABLES.commandes);
  console.log(`  ${commandes.length} commandes`);
  console.log('Chargement devis + lignes + zones…');
  const [devis, lignes, zones, projets, clients] = await Promise.all([
    fetchAll(TABLES.devis),
    fetchAll(TABLES['lignes-devis']),
    fetchAll(TABLES['zones-devis']),
    fetchAll(TABLES.projets),
    fetchAll(TABLES.clients),
  ]);
  console.log(`  ${devis.length} devis, ${lignes.length} lignes, ${zones.length} zones, ${projets.length} projets, ${clients.length} clients\n`);

  const devisByNum = new Map(devis.map(d => [d.fields['Numéro devis'], d]));
  const lignesByDevisId = new Map();
  for (const l of lignes) {
    const did = (l.fields.Devis || [])[0];
    if (!did) continue;
    if (!lignesByDevisId.has(did)) lignesByDevisId.set(did, []);
    lignesByDevisId.get(did).push(l);
  }
  const zonesByDevisId = new Map();
  for (const z of zones) {
    const did = (z.fields.Devis || [])[0];
    if (!did) continue;
    if (!zonesByDevisId.has(did)) zonesByDevisId.set(did, []);
    zonesByDevisId.get(did).push(z);
  }
  const projetById = new Map(projets.map(p => [p.id, p]));
  const clientById = new Map(clients.map(c => [c.id, c]));

  // Sélectionne les commandes à backfiller : sans Lignes BC OU sans Contremarque
  const aBackfiller = commandes.filter(c => !c.fields['Lignes BC']);
  console.log(`Commandes à backfiller : ${aBackfiller.length}\n`);

  let okCount = 0, skipCount = 0;
  for (const cmd of aBackfiller) {
    const cf = cmd.fields;
    const numero = cf.Numéro || '';
    // Extraire le numéro de devis depuis le Numéro de commande (format : "CLIENT · TYPE · 563/1/12-N")
    const m = numero.match(/(\d+\/\d+\/\d+)/);
    const numDevis = m ? m[1] : null;
    if (!numDevis) {
      console.log(`  ⚠️ [${cmd.id}] ${numero} — pas de numéro devis détecté, skip`);
      skipCount++;
      continue;
    }
    const d = devisByNum.get(numDevis);
    if (!d) {
      console.log(`  ⚠️ [${cmd.id}] ${numero} — devis ${numDevis} introuvable, skip`);
      skipCount++;
      continue;
    }

    // Type de la commande
    const type = cf.Type || '';
    if (!type) {
      console.log(`  ⚠️ [${cmd.id}] ${numero} — Type manquant, skip`);
      skipCount++;
      continue;
    }

    // Filtrer les lignes du devis par catégorie matchant le Type
    const acceptedCategories = TYPE_TO_CATEGORIES[type] || [];
    const allLignes = lignesByDevisId.get(d.id) || [];
    const lignesType = allLignes.filter(l => acceptedCategories.includes(l.fields.Catégorie));

    // Lignes BC structurées
    const lignesStructured = lignesType.map(l => {
      const f = l.fields;
      return {
        pos: String(f.Position || ''),
        code: String(f['Code produit'] || ''),
        description: String(f.Désignation || ''),
        sens: String(f.Sens || ''),
        coteVisible: String(f['Côté visible'] || ''),
        quantite: f.Quantité != null ? Number(f.Quantité) : null,
        unite: String(f.Unité || ''),
        largeurMm: f['Largeur mm'] || null,
        hauteurMm: f['Hauteur mm'] || null,
        profondeurMm: f['Profondeur mm'] || null,
        notes: String(f.Notes || ''),
      };
    });

    // Contremarque : client depuis le projet
    let contremarque = '';
    const projetIds = cf.Projet || [];
    if (projetIds.length) {
      const p = projetById.get(projetIds[0]);
      if (p) {
        const clientIds = p.fields.Client || [];
        if (clientIds.length) {
          const c = clientById.get(clientIds[0]);
          if (c) contremarque = (c.fields.Nom || '').toUpperCase();
        }
      }
    }

    // Modèle + détails (uniquement Type Meubles ou Cuisine, depuis la 1re zone)
    let modeleChoisi = '', detailsModele = '';
    if (type === 'Meubles' || type === 'Cuisine') {
      const zonesDevis = zonesByDevisId.get(d.id) || [];
      const z0 = zonesDevis[0];
      if (z0) {
        modeleChoisi = buildModeleHeaderFromZone(z0);
        detailsModele = buildDetailsFromZone(z0);
      }
    }

    const fields = {
      'Lignes BC': JSON.stringify(lignesStructured, null, 2),
      'Référence courte': TYPE_TO_REF[type] || type.toUpperCase().slice(0, 12),
    };
    if (contremarque && !cf.Contremarque) fields.Contremarque = contremarque;
    if (!cf['Contact Tanguy']) fields['Contact Tanguy'] = 'Solène';
    if (modeleChoisi && !cf['Modèle choisi']) fields['Modèle choisi'] = modeleChoisi;
    if (detailsModele && !cf['Détails modèle']) fields['Détails modèle'] = detailsModele;

    console.log(`  [${cmd.id}] ${numero}`);
    console.log(`    Type=${type} · ${lignesStructured.length} lignes · Contremarque=${contremarque} · RefCourte=${fields['Référence courte']}`);
    if (modeleChoisi) console.log(`    Modèle : ${modeleChoisi.replace(/\n/g, ' / ')}`);

    if (APPLY) {
      try {
        await patch(TABLES.commandes, cmd.id, fields);
        okCount++;
      } catch (e) {
        console.error(`    ✗ ${e.message}`);
      }
    } else {
      okCount++;
    }
  }

  console.log(`\n${APPLY ? '✅' : '🧪'} ${okCount} commande(s) ${APPLY ? 'updatées' : 'préparées'}, ${skipCount} skip${APPLY ? '' : ' (relance avec --apply)'}`);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
