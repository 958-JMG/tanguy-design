export function libelleProjet(p, clients) {
  const nom = clients.find(c => c.id === p.Client?.[0])?.Nom || '';
  return [nom, p['Référence']].filter(Boolean).join(' · ') || '(sans référence)';
}
export function filtrerProjets(projets, clients, recherche) {
  const normaliser = v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mots = normaliser(recherche).trim().split(/\s+/).filter(Boolean);
  return projets.filter(p => mots.every(m => normaliser(libelleProjet(p, clients)).includes(m)));
}
