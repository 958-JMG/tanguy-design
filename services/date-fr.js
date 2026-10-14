'use strict';
/**
 * services/date-fr.js — LE seul endroit où le serveur écrit une date ou une heure
 * pour un humain (texte de BC, PDF, journal, export, référence Pennylane).
 *
 * Le conteneur Scaleway tourne en UTC : sans fuseau explicite, une heure affichée
 * avait 2 h de retard sur Paris (1 h en hiver), et une date « du jour » était celle
 * de la veille entre 22 h/23 h et minuit à Paris. Tout passe donc par Europe/Paris.
 *
 * Une date Airtable SANS heure (champ date, '2026-10-14') n'est jamais convertie :
 * c'est un jour du calendrier, pas un instant. On la réécrit à partir de ses
 * chiffres, ce qui ne peut pas la décaler vers la veille, quel que soit le fuseau.
 */

const FUSEAU = 'Europe/Paris';
const JOUR_SEUL = /^(\d{4})-(\d{2})-(\d{2})$/;

const parties = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * Découpe une valeur en jour / mois / année / heure / minute / seconde à Paris.
 * Renvoie null si la valeur est vide ou illisible. `jourSeul` = date sans heure.
 */
function partiesParis(v) {
  if (v == null || v === '') return null;
  const s = typeof v === 'string' ? v.trim() : null;
  const m = s && JOUR_SEUL.exec(s);
  if (m) return { annee: m[1], mois: m[2], jour: m[3], heure: null, minute: null, seconde: null, jourSeul: true };
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return null;
  const p = {};
  for (const { type, value } of parties.formatToParts(d)) p[type] = value;
  return { annee: p.year, mois: p.month, jour: p.day, heure: p.hour, minute: p.minute, seconde: p.second, jourSeul: false };
}

/** Une valeur illisible est rendue telle quelle, jamais « Invalid Date » ni le vide. */
function illisible(v, siVide) {
  return (v == null || v === '') ? siVide : String(v);
}

/** « 14/10/2026 ». */
function dateFr(v, siVide = '') {
  const p = partiesParis(v);
  return p ? `${p.jour}/${p.mois}/${p.annee}` : illisible(v, siVide);
}

/** « 14/10/2026 18:15:38 » (même forme que toLocaleString('fr-FR')). Sans heure : la date seule. */
function dateHeureFr(v, siVide = '') {
  const p = partiesParis(v);
  if (!p) return illisible(v, siVide);
  if (p.jourSeul) return `${p.jour}/${p.mois}/${p.annee}`;
  return `${p.jour}/${p.mois}/${p.annee} ${p.heure}:${p.minute}:${p.seconde}`;
}

/** « 14/10 18:15:38 » — suffixe des références Pennylane régénérées. */
function jourMoisHeureFr(v = new Date()) {
  const p = partiesParis(v);
  return p && !p.jourSeul ? `${p.jour}/${p.mois} ${p.heure}:${p.minute}:${p.seconde}` : '';
}

/** « 2026-10-14 18:15 » — tampon du Journal chantier ([AAAA-MM-JJ HH:MM — Auteur]). */
function horodatageJournal(v = new Date()) {
  const p = partiesParis(v);
  return p && !p.jourSeul ? `${p.annee}-${p.mois}-${p.jour} ${p.heure}:${p.minute}` : '';
}

module.exports = { FUSEAU, partiesParis, dateFr, dateHeureFr, jourMoisHeureFr, horodatageJournal };
