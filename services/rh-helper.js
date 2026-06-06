/**
 * services/rh-helper.js — Suivi RH : congés, heures, éléments de paie (Sprint v5 Virginie)
 *
 * Logique pure, testable sans Airtable (ADR-004).
 * Les routes /api/rh/* normalisent les records Airtable avant d'appeler ici.
 */

/** Nombre de jours ouvrés (lun-ven) entre deux dates YYYY-MM-DD incluses. 0 si invalide. */
function joursOuvres(debut, fin) {
  if (!debut || !fin) return 0;
  const d0 = new Date(debut + 'T00:00:00Z');
  const d1 = new Date(fin + 'T00:00:00Z');
  if (isNaN(d0.getTime()) || isNaN(d1.getTime()) || d1 < d0) return 0;
  let count = 0;
  const cur = new Date(d0);
  while (cur <= d1) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** Bornes [premier jour, dernier jour] d'un mois 'YYYY-MM'. Null si invalide. */
function boundsMois(mois) {
  if (!/^\d{4}-\d{2}$/.test(mois || '')) return null;
  const [y, m] = mois.split('-').map(Number);
  if (m < 1 || m > 12) return null;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${mois}-01`, `${mois}-${String(lastDay).padStart(2, '0')}`];
}

/**
 * Jours ouvrés d'une absence comptés dans un mois donné (intersection des plages).
 * Si l'absence est entièrement dans le mois et porte déjà un nombre de jours
 * (demi-journées saisies à la main), ce nombre est conservé.
 */
function joursAbsenceDansMois(absence, mois) {
  const bounds = boundsMois(mois);
  if (!bounds || !absence.dateDebut) return 0;
  const fin = absence.dateFin || absence.dateDebut;
  const interDebut = absence.dateDebut > bounds[0] ? absence.dateDebut : bounds[0];
  const interFin = fin < bounds[1] ? fin : bounds[1];
  if (interDebut > interFin) return 0;
  const entierementDansMois = absence.dateDebut >= bounds[0] && fin <= bounds[1];
  if (entierementDansMois && typeof absence.jours === 'number' && absence.jours > 0) return absence.jours;
  return joursOuvres(interDebut, interFin);
}

/**
 * Récapitulatif mensuel des éléments de paie par salarié.
 * Les heures hebdo sont rattachées au mois de leur lundi (champ "Semaine du").
 * Seules les absences Validées sont comptées.
 *
 * @param {object} opts
 * @param {Array<{id, nom, poste, typeContrat, soldeConges}>} opts.salaries
 * @param {Array<{salarieId, semaine, heuresNormales, heuresSupp}>} opts.heures
 * @param {Array<{salarieId, type, dateDebut, dateFin, jours, statut}>} opts.absences
 * @param {string} opts.mois 'YYYY-MM'
 * @returns {Array<object>} une ligne par salarié
 */
function recapPaieMois({ salaries = [], heures = [], absences = [], mois }) {
  if (!boundsMois(mois)) throw new Error(`recapPaieMois: mois invalide "${mois}" (attendu YYYY-MM)`);
  return salaries.map(sal => {
    const heuresSal = heures.filter(h => h.salarieId === sal.id && (h.semaine || '').slice(0, 7) === mois);
    const absSal = absences.filter(a => a.salarieId === sal.id && a.statut === 'Validée');
    const congesPris = absSal.filter(a => a.type === 'Congés payés' || a.type === 'RTT')
      .reduce((s, a) => s + joursAbsenceDansMois(a, mois), 0);
    const maladie = absSal.filter(a => a.type === 'Maladie')
      .reduce((s, a) => s + joursAbsenceDansMois(a, mois), 0);
    const autresAbsences = absSal.filter(a => !['Congés payés', 'RTT', 'Maladie'].includes(a.type))
      .reduce((s, a) => s + joursAbsenceDansMois(a, mois), 0);
    return {
      salarieId: sal.id,
      nom: sal.nom,
      poste: sal.poste || '',
      typeContrat: sal.typeContrat || '',
      heuresNormales: heuresSal.reduce((s, h) => s + (Number(h.heuresNormales) || 0), 0),
      heuresSupp: heuresSal.reduce((s, h) => s + (Number(h.heuresSupp) || 0), 0),
      congesPris,
      maladie,
      autresAbsences,
      soldeConges: typeof sal.soldeConges === 'number' ? sal.soldeConges : null,
    };
  });
}

/**
 * Alertes visites médicales : dépassées ou à planifier sous `seuilJours`.
 * @param {Array<{id, nom, prochaineVisite}>} salaries
 * @param {string} today YYYY-MM-DD
 * @param {number} [seuilJours=60]
 */
function alertesVisitesMedicales(salaries, today, seuilJours = 60) {
  const out = [];
  for (const s of salaries || []) {
    if (!s.prochaineVisite) continue;
    const diffJours = Math.round((new Date(s.prochaineVisite + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
    if (isNaN(diffJours)) continue;
    if (diffJours < 0) out.push({ salarieId: s.id, nom: s.nom, date: s.prochaineVisite, joursRestants: diffJours, statut: 'Dépassée' });
    else if (diffJours <= seuilJours) out.push({ salarieId: s.id, nom: s.nom, date: s.prochaineVisite, joursRestants: diffJours, statut: 'À planifier' });
  }
  return out.sort((a, b) => a.joursRestants - b.joursRestants);
}

module.exports = { joursOuvres, boundsMois, joursAbsenceDansMois, recapPaieMois, alertesVisitesMedicales };
