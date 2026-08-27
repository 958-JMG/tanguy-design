/**
 * services/nom-client-helper.js — Découpage « prénom / nom » d'un client particulier
 *
 * Retour Virginie/JMG (27/08/2026) : dans les brouillons Pennylane, « le système
 * ne reprend que le nom et il le met dans le champ prénom ».
 *
 * Cause : l'ancien découpage prenait le PREMIER mot comme prénom et le reste
 * comme nom. Or dans la base Tanguy, le champ « Nom » d'un client contient le
 * plus souvent le seul patronyme, en capitales : « DUPUY » devenait donc
 * prénom = DUPUY, nom = « - ».
 *
 * Formes réellement présentes dans la base (60 clients particuliers relevés) :
 *   16  « DUPUY »          — patronyme seul, en capitales
 *    6  « DUPUY MARTIN »   — tout en capitales, découpage impossible
 *    3  « Jean DUPUY »     — convention française : prénom capitalisé + NOM capitales
 *    3  « Jean Pierre DUPUY »
 *    3  « Jean et Marie DUPUY » — couple
 *
 * RÈGLE : les mots ENTIÈREMENT EN CAPITALES situés en fin de chaîne forment le
 * patronyme ; ce qui précède est le prénom. À défaut de capitales, on retombe
 * sur la convention française (dernier mot = patronyme).
 *
 * PRINCIPE DIRECTEUR : dans le doute, tout part dans le NOM, jamais dans le
 * prénom. Une facture au nom de « DUPUY » sans prénom reste juste ; une facture
 * au prénom de « DUPUY » est fausse et se voit immédiatement.
 *
 * Logique PURE, testable sans réseau (ADR-004).
 */

// Un mot est « en capitales » s'il n'a aucune minuscule et contient au moins une
// lettre. Les particules (de, du, van…) sont en minuscules et donc exclues.
function estCapitales(mot) {
  const m = String(mot || '');
  if (!/\p{L}/u.test(m)) return false;
  return !/\p{Ll}/u.test(m);
}

// Liants d'un nom de couple ou d'une particule : ne peuvent pas être le début du
// patronyme à eux seuls (« Jean et Marie DUPUY », « Jean de LA TOUR »).
const LIANTS = new Set(['et', '&', 'de', 'du', 'des', 'le', 'la', 'les', 'van', 'von', 'da', 'di']);

/**
 * @param {string} nom      - champ « Nom » du client Airtable
 * @param {string} [contact]- champ « Contact » (souvent vide ou hétérogène :
 *                            jamais utilisé pour deviner un patronyme, seulement
 *                            comme prénom d'appoint si `nom` n'en fournit aucun
 *                            ET que `contact` tient en un seul mot capitalisé)
 * @returns {{ firstName:string, lastName:string, source:string, incertain:boolean }}
 */
function splitNomClient(nom, contact = '') {
  const brut = String(nom || '').replace(/\s+/g, ' ').trim();
  if (!brut) {
    return { firstName: '', lastName: '', source: 'vide', incertain: true };
  }

  const mots = brut.split(' ');

  // 1. Patronyme = bloc final en CAPITALES (« Jean DUPUY », « Jean de LA TOUR »).
  let debutPatronyme = mots.length;
  for (let i = mots.length - 1; i >= 0; i--) {
    if (estCapitales(mots[i])) { debutPatronyme = i; continue; }
    // Une particule minuscule accolée au bloc capitales en fait partie.
    if (debutPatronyme < mots.length && LIANTS.has(mots[i].toLowerCase()) && i > 0) { debutPatronyme = i; continue; }
    break;
  }

  const toutEnCapitales = debutPatronyme === 0;

  if (!toutEnCapitales && debutPatronyme < mots.length) {
    const prenom = mots.slice(0, debutPatronyme).join(' ').trim();
    const patronyme = mots.slice(debutPatronyme).join(' ').trim();
    return { firstName: prenom, lastName: patronyme, source: 'capitales', incertain: false };
  }

  // 2. Tout en capitales (« DUPUY », « DUPUY MARTIN ») : impossible de distinguer
  //    un prénom d'un patronyme. TOUT va dans le nom — jamais dans le prénom.
  if (toutEnCapitales) {
    const prenomAppoint = prenomDepuisContact(contact);
    return {
      firstName: prenomAppoint,
      lastName: brut,
      source: prenomAppoint ? 'capitales-tout + prénom du contact' : 'capitales-tout',
      incertain: !prenomAppoint,
    };
  }

  // 3. Aucune capitale (« Jean Dupuy ») : convention française, dernier mot =
  //    patronyme. Un mot unique (« Dupuy ») est un patronyme, pas un prénom.
  if (mots.length === 1) {
    const prenomAppoint = prenomDepuisContact(contact);
    return {
      firstName: prenomAppoint,
      lastName: brut,
      source: prenomAppoint ? 'mot unique + prénom du contact' : 'mot unique',
      incertain: !prenomAppoint,
    };
  }
  return {
    firstName: mots.slice(0, -1).join(' '),
    lastName: mots[mots.length - 1],
    source: 'convention-francaise',
    incertain: false,
  };
}

/**
 * Prénom d'appoint tiré du champ « Contact », uniquement s'il est sans ambiguïté :
 * un seul mot, capitalisé, qui n'est pas en capitales (donc pas un patronyme).
 * Le champ Contact contient dans les faits tout et n'importe quoi (téléphones,
 * mails, phrases) : au moindre doute on n'en tire rien.
 */
function prenomDepuisContact(contact) {
  const c = String(contact || '').replace(/\s+/g, ' ').trim();
  if (!c) return '';
  if (/[@\d]/.test(c)) return '';            // mail ou téléphone → pas un prénom
  const mots = c.split(' ');
  if (mots.length !== 1) return '';
  if (estCapitales(mots[0])) return '';      // « DUPUY » : patronyme, pas prénom
  if (!/^\p{Lu}\p{Ll}+$/u.test(mots[0])) return '';
  return mots[0];
}

/**
 * Payload prêt pour Pennylane /individual_customers.
 * Pennylane exige un last_name non vide ; first_name peut rester vide, et c'est
 * exactement ce qu'on veut quand le prénom est inconnu — mieux vaut pas de
 * prénom qu'un patronyme rangé dans la mauvaise case.
 */
function payloadIndividuPennylane(nom, contact = '') {
  const r = splitNomClient(nom, contact);
  return {
    first_name: r.firstName,
    last_name: r.lastName || String(nom || '').trim() || 'Client',
    _diagnostic: { source: r.source, incertain: r.incertain },
  };
}

module.exports = { estCapitales, splitNomClient, prenomDepuisContact, payloadIndividuPennylane };
