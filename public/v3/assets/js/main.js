// Tanguy Design v3 — entry point (Sprint 1, démo isolée sous /v3/)
//
// Pattern : ES modules natifs (cf. ADR-003), routing hash-based pour rester
// simple, fetch direct vers l'API existante /api/* (déjà conforme ACL Sprint 0.7).

import { router, navigateTo } from './core/router.js';
import { state, loadMe } from './core/state.js';
import { fetchClients, fetchProjets } from './core/api.js';
import { openSearch } from './core/search.js';

// Exposés en global pour les onclick="" inline du HTML squelette
window.navigateTo = navigateTo;
window.logout = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
};
window.openSearch = openSearch;

// Cmd+K shortcut
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    window.openSearch();
  }
});

// Bootstrap : charge user + clients, puis route initial
(async () => {
  try {
    await loadMe();
    document.getElementById('user-name').textContent = state.user || '?';
    if (!state.isAdmin) {
      document.documentElement.style.setProperty('--admin-display', 'none');
      document.querySelectorAll('.nav-admin-only').forEach(el => el.style.display = 'none');
    }
    await Promise.all([fetchClients(), fetchProjets()]);
    router(); // démarre sur le hash courant ou par défaut
  } catch (e) {
    console.error('Bootstrap échec', e);
    if (e.message === 'unauthenticated') {
      location.href = '/login';
    } else {
      document.getElementById('app').innerHTML = `<div class="card"><h2>Erreur</h2><p class="muted">${e.message}</p></div>`;
    }
  }
})();

window.addEventListener('hashchange', router);
