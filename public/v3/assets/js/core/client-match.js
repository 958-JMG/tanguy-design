/**
 * core/client-match.js — Retrouver un client à partir du nom saisi
 *
 * Retour JMG (27/08/2026) : « Alglave Philippe est bien dans la liste, mais
 * quand tu le sélectionnes il est dit comme non existant » — sur l'écran comme
 * sur mobile.
 *
 * CAUSE RÉELLE, reproduite sur les 599 clients de la base : le nom porte un
 * ESPACE FINAL dans Airtable (« Alglave Philippe »). La saisie était nettoyée
 * par trim(), le nom en base ne l'était pas, et la comparaison stricte échouait.
 * Trois clients sont dans ce cas (Alglave Philippe, LE MENTEC, LAMOTTE) — assez
 * pour que ça « marche pour certains et pas pour d'autres ».
 *
 * La comparaison normalise donc les DEUX côtés : espaces de bord, espaces
 * multiples, espaces insécables, casse et accents. Et quand rien ne
 * correspond, on ne renvoie pas un cul-de-sac : les noms proches sont proposés,
 * ce qui rattrape aussi les fautes de frappe et les lettres inversées.
 */

/** Forme comparable d'un nom : sans accents, sans casse, espaces normalisés. */
export function normaliserNom(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // accents
    .replace(/ /g, ' ')                            // espace insécable
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Distance de Levenshtein, bornée pour rester rapide sur 600 clients. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  const m = a.length, n = b.length;
  let prec = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cour = [i];
    for (let j = 1; j <= n; j++) {
      cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prec = cour;
  }
  return prec[n];
}

/**
 * Résout un nom saisi en client.
 * @param {string} saisie
 * @param {Array} clients - objets { id, Nom, Ville }
 * @returns {{ client:object|null, ambigu:Array, suggestions:Array }}
 *          `ambigu` : plusieurs clients portent exactement ce nom — c'est à
 *          l'utilisateur de trancher, jamais au code de prendre le premier.
 */
export function resoudreClient(saisie, clients) {
  const cible = normaliserNom(saisie);
  const liste = clients || [];
  if (!cible) return { client: null, ambigu: [], suggestions: [] };

  const exacts = liste.filter(c => normaliserNom(c.Nom) === cible);
  if (exacts.length === 1) return { client: exacts[0], ambigu: [], suggestions: [] };
  if (exacts.length > 1) return { client: null, ambigu: exacts, suggestions: [] };

  // Rien d'exact : on propose les plus proches (fautes de frappe, inversions).
  const suggestions = liste
    .map(c => ({ c, d: distance(normaliserNom(c.Nom), cible) }))
    .filter(x => x.d <= 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(x => x.c);

  return { client: null, ambigu: [], suggestions };
}

/** Message d'erreur utile : il nomme les pistes au lieu de dire « introuvable ». */
export function messageClientIntrouvable({ ambigu, suggestions }, saisie) {
  if (ambigu && ambigu.length) {
    return `Plusieurs clients portent le nom « ${saisie} » — précise lequel (${ambigu.map(c => c.Ville || 'sans ville').join(', ')}).`;
  }
  if (suggestions && suggestions.length) {
    return `Client « ${saisie} » introuvable. Vouliez-vous dire : ${suggestions.map(c => c.Nom).join(' · ')} ?`;
  }
  return `Client « ${saisie} » introuvable — choisis un nom dans la liste.`;
}
