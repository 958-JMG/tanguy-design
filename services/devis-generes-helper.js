/**
 * services/devis-generes-helper.js — Artefacts générés par la signature d'un devis
 *
 * Dossier MORALES (retour Virginie, 2026-08) : « certaines commandes apparaissent
 * en double ». Cause réelle : un devis a été SIGNÉ (→ POST /api/devis/:id/sign a
 * créé les 4 BC Meubles / Électroménager / Accessoires / Plan de travail + les
 * tâches de suivi), puis repassé à « Refusé ». Or changer le statut d'un devis
 * passe par le PATCH générique /api/data/devis/:id, qui n'a AUCUN effet de bord :
 * les BC et les tâches du devis refusé restent et se cumulent avec ceux du devis
 * réellement accepté.
 *
 * Ce helper retrouve ce qu'une signature donnée a généré, pour le proposer à la
 * suppression (à la coche — jamais automatiquement : un BC déjà confirmé par un
 * AR ou déjà envoyé au fournisseur ne doit pas disparaître sur un clic).
 *
 * RATTACHEMENT PAR LE NUMÉRO DE DEVIS — les BC ne portent pas de lien Airtable
 * vers leur devis d'origine. La signature laisse deux traces exploitables :
 *   - Notes  : « [Auto-généré depuis devis <numéro> signé le … ] »  → certain
 *   - Numéro : « MORALES · MEUBLES · <numéro>-1 »                   → probable
 * Les tâches portent le numéro dans leur titre / description.
 *
 * PIÈGE ÉVITÉ : une recherche de sous-chaîne naïve fait matcher « D-2026-10 »
 * dans « D-2026-101 » et proposerait la suppression de BC d'un AUTRE devis.
 * D'où le contrôle de frontière de mot dans matchNumero().
 *
 * Logique PURE, testable sans Airtable (ADR-004). Les routes normalisent les
 * records Airtable en objets simples avant d'appeler ici.
 */

// Statut d'un BC fraîchement créé par la signature. Tout autre statut = le BC a
// vécu (envoyé au fournisseur, AR reçu, livré) → suppression à risque.
const STATUT_BC_NEUF = 'Créée';

/**
 * Le texte contient-il ce numéro de devis, en tant que numéro entier ?
 * Frontière = début/fin de chaîne ou caractère non alphanumérique. « D-2026-101-1 »
 * matche « D-2026-101 » (suivi de « - ») mais PAS « D-2026-10 » (suivi de « 1 »).
 */
function matchNumero(texte, numero) {
  const n = String(numero || '').trim();
  const t = String(texte || '');
  if (!n || !t) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \p{L}\p{N} plutôt que \w : un numéro peut être suivi d'un accent ou d'un « · ».
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, 'u').test(t);
}

/** Signature textuelle laissée dans les Notes d'un BC auto-généré. */
function estAutoGenerePar(notes, numero) {
  const t = String(notes || '');
  if (!matchNumero(t, numero)) return false;
  return /auto-g[ée]n[ée]r[ée]\s+depuis\s+devis/i.test(t);
}

/**
 * Pourquoi la suppression d'un BC est risquée (null = sans risque connu).
 * Un BC avec AR reçu a été confirmé par le fournisseur : la commande existe pour
 * de vrai, même si le devis client a été refusé. Idem facture reçue.
 */
function risqueCommande(c) {
  if (Number(c.montantAR) > 0) return `AR reçu (${Number(c.montantAR)} €) — commande confirmée par le fournisseur`;
  if (c.factureRecue) return 'Facture fournisseur déjà reçue';
  const statut = String(c.statut || '').trim();
  if (statut && statut !== STATUT_BC_NEUF) return `Statut « ${statut} » — le BC a déjà avancé`;
  return null;
}

/**
 * Commandes (BC) générées par la signature du devis `numero`.
 * @param {Array} commandes - BC DU PROJET, normalisés :
 *        { id, numero, statut, montantHT, montantAR, factureRecue, notes, type }
 * @param {string} numero - numéro du devis (ex. « D-2026-101 »)
 * @returns {Array} { id, numero, type, montantHT, montantAR, statut, source,
 *                    risque, suggere }  — `suggere` = coché par défaut dans l'UI
 */
function commandesGenereesPar(commandes, numero) {
  if (!numero) return [];
  return (commandes || []).reduce((acc, c) => {
    const parNotes = estAutoGenerePar(c.notes, numero);
    const parNumero = matchNumero(c.numero, numero);
    if (!parNotes && !parNumero) return acc;
    const risque = risqueCommande(c);
    acc.push({
      id: c.id,
      numero: c.numero || '',
      type: c.type || '',
      montantHT: Number(c.montantHT) || 0,
      montantAR: Number(c.montantAR) || 0,
      statut: c.statut || '',
      source: parNotes ? 'notes' : 'numero',
      risque,
      // Décoché d'office dès qu'il y a un risque : c'est à l'humain de trancher.
      suggere: !risque,
    });
    return acc;
  }, []);
}

/**
 * Tâches de suivi générées par la signature du devis `numero`.
 * Une tâche déjà terminée est proposée DÉCOCHÉE : elle est de l'historique, la
 * supprimer efface une trace de ce qui a réellement été fait.
 * @param {Array} taches - tâches DU PROJET, normalisées :
 *        { id, titre, statut, assigneeA, echeance, description }
 */
function tachesGenereesPar(taches, numero) {
  if (!numero) return [];
  return (taches || []).reduce((acc, t) => {
    const parTitre = matchNumero(t.titre, numero);
    const parDescription = matchNumero(t.description, numero);
    if (!parTitre && !parDescription) return acc;
    const terminee = String(t.statut || '').trim().toLowerCase() === 'terminée';
    acc.push({
      id: t.id,
      titre: t.titre || '',
      statut: t.statut || '',
      assigneeA: t.assigneeA || '',
      echeance: t.echeance || '',
      source: parTitre ? 'titre' : 'description',
      risque: terminee ? 'Tâche déjà terminée — trace de ce qui a été fait' : null,
      suggere: !terminee,
    });
    return acc;
  }, []);
}

/**
 * Échéances du devis ayant produit une facture (Pennylane ou facture client).
 * On ne les supprime JAMAIS d'ici : une facture émise se traite en compta, pas
 * dans le cockpit. On les REMONTE pour que l'écran le dise au lieu de se taire.
 * @param {Array} echeances - échéances liées au devis, normalisées :
 *        { id, libelle, montantPrevu, facturePennylaneId, numeroFacture }
 */
function echeancesFactureesAlerte(echeances) {
  return (echeances || [])
    .filter(e => e.facturePennylaneId || e.numeroFacture)
    .map(e => ({
      id: e.id,
      libelle: e.libelle || '',
      montantPrevu: Number(e.montantPrevu) || 0,
      reference: e.numeroFacture || e.facturePennylaneId || '',
    }));
}

/**
 * Vue d'ensemble prête pour l'UI.
 * `rien` = il n'y a rien à nettoyer (le devis n'a jamais été signé, ou tout a
 * déjà été nettoyé) → l'appelant n'affiche AUCUNE modale.
 */
function resumeGeneres({ commandes, taches, echeances, numero }) {
  const cmd = commandesGenereesPar(commandes, numero);
  const tch = tachesGenereesPar(taches, numero);
  const facturees = echeancesFactureesAlerte(echeances);
  return {
    numero: numero || '',
    commandes: cmd,
    taches: tch,
    echeancesFacturees: facturees,
    totalSupprimables: cmd.length + tch.length,
    totalSuggere: cmd.filter(c => c.suggere).length + tch.filter(t => t.suggere).length,
    aRisque: cmd.filter(c => c.risque).length + tch.filter(t => t.risque).length,
    rien: cmd.length === 0 && tch.length === 0,
  };
}

/**
 * Garde-fou serveur : n'accepte de supprimer que des ids RÉELLEMENT détectés
 * comme générés par ce devis. Empêche qu'un id arbitraire envoyé par le client
 * fasse supprimer un BC d'un autre projet.
 */
function filtrerIdsAutorises(idsDemandes, detectes) {
  const connus = new Set((detectes || []).map(d => d.id));
  const demandes = [...new Set(idsDemandes || [])];
  return {
    autorises: demandes.filter(id => connus.has(id)),
    rejetes: demandes.filter(id => !connus.has(id)),
  };
}

module.exports = {
  STATUT_BC_NEUF,
  matchNumero,
  estAutoGenerePar,
  risqueCommande,
  commandesGenereesPar,
  tachesGenereesPar,
  echeancesFactureesAlerte,
  resumeGeneres,
  filtrerIdsAutorises,
};
