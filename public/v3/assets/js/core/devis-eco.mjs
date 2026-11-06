// Le calcul des panneaux alimente le devis dès qu'il est complet. Un montant
// explicite du document ou saisi à la main garde la priorité jusqu'au report demandé.
export function creerSuiviEco({ source = 'panneaux', calculer, changer = () => {}, reporter = () => {} }) {
  let revision = 0, detruit = false;
  const etat = { source, statut: 'attente', resultat: null, erreur: '' };
  const notifier = () => changer({ ...etat, bloque: etat.source === 'panneaux' && etat.statut !== 'complet' });
  const invalider = () => {
    revision++;
    etat.statut = 'attente'; etat.resultat = null; etat.erreur = '';
    if (!detruit) notifier();
  };
  return {
    invalider,
    manuel() { etat.source = 'manuel'; if (!detruit) notifier(); },
    utiliserPanneaux() { etat.source = 'panneaux'; invalider(); },
    detruire() { detruit = true; revision++; },
    async actualiser(pieces) {
      const tour = ++revision;
      etat.statut = 'calcul'; etat.resultat = null; etat.erreur = ''; notifier();
      try {
        const res = await calculer(pieces);
        if (detruit || tour !== revision) return null;
        const complet = res.piecesCalculees > 0 && res.piecesIncalculables === 0
          && res.lignes?.length === pieces.length
          && res.lignes.every(l => l.ecoHtUnitaire != null && Number.isFinite(l.totalHt))
          && Number.isFinite(res.totalHt) && res.totalHt >= 0;
        etat.resultat = res; etat.statut = complet ? 'complet' : 'incomplet';
        if (complet && etat.source === 'panneaux') reporter(res.totalHt);
        notifier();
        return res;
      } catch (e) {
        if (detruit || tour !== revision) return null;
        etat.statut = 'erreur'; etat.erreur = e.message || 'Calcul indisponible'; notifier();
        return null;
      }
    },
  };
}
