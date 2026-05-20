// State global v3 (Sprint 1)
// Volontairement simple — pas de framework, pas de store complexe.

export const state = {
  user: null,
  isAdmin: false,
  clients: [],
  projets: [],         // tous les projets (pour Dashboard / Pipeline / Cmd+K)
  client: null,        // client courant (fiche détaillée)
  clientProjets: [],   // projets du client courant
};

export async function loadMe() {
  const r = await fetch('/api/me');
  if (!r.ok) throw new Error('unauthenticated');
  const d = await r.json();
  state.user = d.user;
  state.isAdmin = !!d.isAdmin;
}
