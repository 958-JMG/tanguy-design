// Regroupement de la facturation client PAR devis signé.
//
// P-E (2026-09-18) — Un projet peut avoir PLUSIEURS devis signés : le Principal
// + un ou N Additifs (ex. « RAULT Compléments »). Chaque devis signé porte ses
// propres échéances (acomptes). Avant, la fiche projet faisait
// `devis.find(Statut === 'Signé')` et n'en gardait qu'UN : les acomptes des
// additifs disparaissaient de l'écran en silence. On regroupe désormais par
// devis signé pour que TOUS les acomptes s'affichent (un bloc chacun).
//
// Fonction PURE (aucune dépendance DOM) → testée dans facturation-groups.test.mjs.
export function buildFacturationGroups(devis, allEch) {
  const all = allEch || [];
  const signes = (devis || []).filter(d => d.fields?.Statut === 'Signé')
    // Principal d'abord, additifs ensuite (ordre de la base pour le reste).
    .sort((a, b) => ((a.fields?.['Type devis'] === 'Additif') ? 1 : 0)
                  - ((b.fields?.['Type devis'] === 'Additif') ? 1 : 0));

  // Aucun devis signé : un seul bloc avec les échéances telles quelles (comportement historique).
  if (signes.length === 0) return [{ devis: null, echeances: all }];

  const echOf = d => {
    const ids = new Set(d.fields?.['Échéances devis'] || []);
    return all.filter(e => ids.has(e.id));
  };

  // Fallback historique : un seul devis signé SANS échéance liée → on montre
  // toutes les échéances du projet (import qui n'aurait pas relié les échéances).
  if (signes.length === 1 && echOf(signes[0]).length === 0) {
    return [{ devis: signes[0], echeances: all }];
  }

  return signes.map(d => ({ devis: d, echeances: echOf(d) }));
}
