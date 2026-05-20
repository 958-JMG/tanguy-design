/**
 * services/echeances-helper.js — Dérivation de dates d'échéance (fix bug Morales)
 *
 * Les PDF Winner ne contiennent pas de dates absolues sur les échéances
 * (juste des libellés sémantiques : "A la commande", "A la livraison",
 * "A la fin de la pose"). Cette couche dérive les dates à partir de la
 * sémantique des libellés, de la date du devis, et de la date de pose
 * prévue du projet.
 *
 * Voir docs/refonte-v3-2026-05-20/bug-morales-echeances.md pour le contexte.
 *
 * Sprint 0.7 — P0-3 / Task 17.
 */

/**
 * Ajoute (ou retire si négatif) un nombre de jours à une date YYYY-MM-DD.
 * Retourne null si dateStr est falsy ou non parsable.
 */
function offsetDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Dérive une date d'échéance prévue à partir du libellé Winner.
 *
 * Sémantique des libellés (vu en prod sur les devis Winner) :
 *  - "A la commande" / "Acompte X%" / "Acompte signature" → date du devis (signature ≈ J0)
 *  - "A la livraison" → date de pose − 7 jours (livraison juste avant)
 *  - "A la fin de la pose" / "Solde" / "Réception" → date de pose + 5 jours
 *  - Inconnu → date du devis (fallback prudent)
 *
 * @param {string} libelle - Libellé tel qu'extrait du PDF (ex: "A la commande")
 * @param {string|null} dateDevis - Date du devis YYYY-MM-DD
 * @param {string|null} datePose - Date de pose prévue YYYY-MM-DD
 * @returns {string|null} Date dérivée YYYY-MM-DD ou null si rien de calculable
 */
function deriveDateEcheance(libelle, dateDevis, datePose) {
  const lib = (libelle || '').toLowerCase();

  // "A la commande" / "Acompte" / "Signature" → date signature (≈ date devis)
  if (/(commande|acompte|signat)/.test(lib)) {
    return dateDevis || null;
  }

  // "A la livraison" → date pose − 7 j
  if (/livraison/.test(lib)) {
    return offsetDays(datePose, -7) || dateDevis || null;
  }

  // "A la fin de la pose" / "Solde" / "Réception" → date pose + 5 j
  if (/(fin de la pose|solde|r[ée]ception)/.test(lib)) {
    return offsetDays(datePose, +5) || dateDevis || null;
  }

  // Fallback : date devis
  return dateDevis || null;
}

/**
 * Applique deriveDateEcheance à un batch d'échéances.
 * Préserve `date_prevue` si déjà non null (= déjà calculée ou saisie manuellement).
 *
 * @param {Array<{libelle, date_prevue?}>} echeances
 * @param {string|null} dateDevis
 * @param {string|null} datePose
 * @returns {Array} mêmes échéances avec date_prevue éventuellement enrichie
 */
function enrichEcheancesAvecDates(echeances, dateDevis, datePose) {
  if (!Array.isArray(echeances)) return echeances;
  return echeances.map(e => {
    // Respecter une date déjà fournie (manuelle ou autre source)
    if (e.date_prevue) return e;
    return { ...e, date_prevue: deriveDateEcheance(e.libelle, dateDevis, datePose) };
  });
}

module.exports = { deriveDateEcheance, enrichEcheancesAvecDates, offsetDays };
