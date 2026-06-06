/**
 * services/relances-helper.js — Relances impayés clients + relances fournisseurs (Sprint v5 Virginie)
 *
 * Logique pure, testable sans Airtable (ADR-004).
 * Convention cockpit : emails souverains via mailto: (pas de SMTP), cf. Sprint v3.17.
 */

/** Jours de retard d'une échéance par rapport à today. ≤ 0 si pas en retard. */
function joursRetard(dateEcheance, today) {
  if (!dateEcheance || !today) return 0;
  const diff = Math.round((new Date(today + 'T00:00:00Z') - new Date(dateEcheance + 'T00:00:00Z')) / 86400000);
  return isNaN(diff) ? 0 : diff;
}

// Cadence standard : R1 courtoise à 7 j, R2 ferme à 21 j, R3 mise en demeure à 35 j.
const RELANCE_SEUILS = [
  { niveau: 1, jours: 7 },
  { niveau: 2, jours: 21 },
  { niveau: 3, jours: 35 },
];

/**
 * Niveau de relance suggéré pour une facture en retard.
 * Retourne 0 si pas de relance à faire (pas assez de retard, ou niveau déjà atteint).
 * @param {{joursRetard: number, niveauRelance: number}} f
 */
function niveauRelanceSuggere(f) {
  const retard = Number(f.joursRetard) || 0;
  const actuel = Number(f.niveauRelance) || 0;
  let suggere = 0;
  for (const s of RELANCE_SEUILS) {
    if (retard >= s.jours) suggere = s.niveau;
  }
  return suggere > actuel ? suggere : 0;
}

/** Formate un montant en euros FR pour les corps d'email. */
function fmtEuros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** Formate une date YYYY-MM-DD en JJ/MM/AAAA. */
function fmtDateFr(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return '—';
  const [y, m, j] = d.slice(0, 10).split('-');
  return `${j}/${m}/${y}`;
}

/**
 * Construit sujet + corps de l'email de relance client selon le niveau.
 * @param {object} opts
 * @param {string} opts.numero numéro de facture
 * @param {string} opts.clientNom
 * @param {number} opts.montantRestant
 * @param {string} opts.dateEcheance YYYY-MM-DD
 * @param {1|2|3} opts.niveau
 * @param {string} [opts.projetRef]
 * @returns {{sujet: string, corps: string}}
 */
function buildEmailRelance({ numero, clientNom, montantRestant, dateEcheance, niveau, projetRef }) {
  const ref = projetRef ? ` (projet ${projetRef})` : '';
  const montant = fmtEuros(montantRestant);
  const echeance = fmtDateFr(dateEcheance);

  if (niveau >= 3) {
    return {
      sujet: `MISE EN DEMEURE — Facture ${numero} impayée`,
      corps: `Bonjour,\n\nMalgré nos relances précédentes, la facture ${numero}${ref} d'un montant de ${montant}, échue le ${echeance}, demeure impayée à ce jour.\n\nSans règlement sous 8 jours à compter de la présente, nous nous verrons contraints d'engager une procédure de recouvrement, conformément aux articles L441-10 et suivants du Code de commerce (pénalités de retard et indemnité forfaitaire de 40 € pour frais de recouvrement).\n\nNous restons disponibles pour tout échange.\n\nCordialement,\nTanguy Design`,
    };
  }
  if (niveau === 2) {
    return {
      sujet: `Relance — Facture ${numero} échue le ${echeance}`,
      corps: `Bonjour ${clientNom},\n\nSauf erreur de notre part, la facture ${numero}${ref} d'un montant de ${montant}, échue le ${echeance}, reste à ce jour impayée malgré notre première relance.\n\nNous vous remercions de procéder à son règlement sous 7 jours, ou de nous contacter si vous rencontrez une difficulté.\n\nCordialement,\nTanguy Design`,
    };
  }
  return {
    sujet: `Rappel — Facture ${numero}`,
    corps: `Bonjour ${clientNom},\n\nSauf erreur de notre part, la facture ${numero}${ref} d'un montant de ${montant}, arrivée à échéance le ${echeance}, ne nous est pas encore parvenue.\n\nIl s'agit probablement d'un simple oubli — nous vous remercions de bien vouloir procéder au règlement à réception de ce message.\n\nN'hésitez pas à nous contacter pour toute question.\n\nBien cordialement,\nTanguy Design`,
  };
}

/**
 * Email de relance fournisseur pour une commande en retard de livraison.
 * @param {object} opts
 * @param {string} opts.numero numéro de commande / BC
 * @param {string} [opts.contremarque]
 * @param {string} [opts.dateLivraisonPrevue] YYYY-MM-DD
 * @param {string} [opts.fournisseurNom]
 * @returns {{sujet: string, corps: string}}
 */
function buildEmailRelanceFournisseur({ numero, contremarque, dateLivraisonPrevue, fournisseurNom }) {
  const cm = contremarque ? ` — contremarque ${contremarque}` : '';
  return {
    sujet: `Suivi commande ${numero}${cm} — délai de livraison`,
    corps: `Bonjour,\n\nNotre commande ${numero}${cm} était attendue pour le ${fmtDateFr(dateLivraisonPrevue)} et nous est toujours en attente de livraison.\n\nPourriez-vous nous confirmer au plus vite la date de livraison actualisée ? Nos plannings de pose en dépendent directement.\n\nMerci d'avance${fournisseurNom ? ` à l'équipe ${fournisseurNom}` : ''},\n\nCordialement,\nTanguy Design — Vannes`,
  };
}

/** Construit un lien mailto: encodé. email peut être vide (lien sans destinataire). */
function buildMailto(email, sujet, corps) {
  return `mailto:${email || ''}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

module.exports = {
  joursRetard, RELANCE_SEUILS, niveauRelanceSuggere,
  buildEmailRelance, buildEmailRelanceFournisseur, buildMailto,
  fmtEuros, fmtDateFr,
};
