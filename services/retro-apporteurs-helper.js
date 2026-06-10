/**
 * services/retro-apporteurs-helper.js — Rétrocession apporteur d'affaires (2026-06-09)
 *
 * Logique pure, testable sans Airtable (ADR-004).
 *
 * Périmètre du calcul (cf. PR « Rétro apporteur 3 % », précisé par JMG 2026-06-10) :
 *  - Un client porte un champ singleSelect "Apporteur" (qui l'a apporté).
 *  - La rétro 3 % ne s'applique QU'AUX apporteurs éligibles (par défaut : Solène) —
 *    l'assiette est donc filtrée sur Apporteur = Solène, PAS sur tout le CA signé.
 *  - On agrège les projets SIGNÉS (Phase commerciale === 'Signé') rattachés à un
 *    client porté par un apporteur éligible.
 *  - CA HT apporté = Σ Budget HT de ces projets signés.
 *  - Rétro 3 % = TAUX_RETRO × CA HT apporté.
 *
 * ⚠️ Décisions à valider (FLAG PR) :
 *  - assiette = CA HT (Budget HT), PAS la marge.
 *  - périmètre = projets SIGNÉS uniquement (pas les phases amont).
 *  - apporteurs éligibles à la rétro = ['Solène'] par défaut (paramétrable via apporteursRetro).
 *
 * Code défensif : si le champ "Apporteur" est absent (script schéma non encore
 * exécuté), aucun client n'a d'apporteur → on retourne une liste vide, pas d'erreur.
 */

const TAUX_RETRO = 0.03;
const PHASE_SIGNE = 'Signé';
// Apporteurs ouvrant droit à la rétrocession (précision JMG : uniquement Solène).
const APPORTEURS_RETRO = ['Solène'];

/**
 * Agrège les rétrocessions apporteurs.
 *
 * @param {object} opts
 * @param {Array<{id: string, Apporteur?: string}>} opts.clients
 *   Clients normalisés ({ id, Apporteur }). Apporteur absent/null → ignoré.
 * @param {Array<{clientIds: string[], budgetHT: number, phase: string}>} opts.projets
 *   Projets normalisés ({ clientIds: string[], budgetHT, phase }).
 * @param {number} [opts.taux=TAUX_RETRO] Taux de rétrocession (0.03 = 3 %).
 * @param {string[]} [opts.apporteursRetro=APPORTEURS_RETRO] Apporteurs éligibles à la rétro.
 *   Par défaut ['Solène']. Un tableau vide désactive le filtre (tous les apporteurs).
 * @returns {{ rows: Array<{apporteur, nbDossiers, caHT, retro}>, totaux: {nbDossiers, caHT, retro} }}
 *   rows triées par CA HT décroissant.
 */
function buildRetroApporteurs({ clients = [], projets = [], taux = TAUX_RETRO, apporteursRetro = APPORTEURS_RETRO } = {}) {
  // Map clientId → apporteur (uniquement les clients qui ont un apporteur renseigné).
  const apporteurByClient = new Map();
  for (const c of clients) {
    const a = c && typeof c.Apporteur === 'string' ? c.Apporteur.trim() : '';
    if (c && c.id && a) apporteurByClient.set(c.id, a);
  }

  // Filtre d'éligibilité à la rétro (assiette = uniquement ces apporteurs ; vide = aucun filtre).
  const eligibles = new Set((apporteursRetro || []).map(a => String(a).trim()).filter(Boolean));

  // Accumulateur par apporteur.
  const acc = new Map(); // apporteur → { nbDossiers, caHT }
  for (const p of projets) {
    if (!p || p.phase !== PHASE_SIGNE) continue;
    const budget = Number(p.budgetHT) || 0;
    // Un projet peut (théoriquement) lier plusieurs clients ; on prend le 1er
    // qui porte un apporteur ÉLIGIBLE, pour ne compter le CA qu'une seule fois.
    const clientId = (p.clientIds || []).find(id => {
      const ap = apporteurByClient.get(id);
      return ap && (!eligibles.size || eligibles.has(ap));
    });
    if (!clientId) continue;
    const apporteur = apporteurByClient.get(clientId);
    const cur = acc.get(apporteur) || { nbDossiers: 0, caHT: 0 };
    cur.nbDossiers += 1;
    cur.caHT += budget;
    acc.set(apporteur, cur);
  }

  const rows = [...acc.entries()]
    .map(([apporteur, v]) => ({
      apporteur,
      nbDossiers: v.nbDossiers,
      caHT: v.caHT,
      retro: v.caHT * taux,
    }))
    .sort((a, b) => b.caHT - a.caHT || a.apporteur.localeCompare(b.apporteur));

  const totaux = rows.reduce(
    (t, r) => ({ nbDossiers: t.nbDossiers + r.nbDossiers, caHT: t.caHT + r.caHT, retro: t.retro + r.retro }),
    { nbDossiers: 0, caHT: 0, retro: 0 }
  );

  return { rows, totaux };
}

module.exports = { buildRetroApporteurs, TAUX_RETRO, PHASE_SIGNE, APPORTEURS_RETRO };
