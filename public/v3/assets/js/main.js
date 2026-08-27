// Tanguy Design v3 — entry point (Sprint 1, démo isolée sous /v3/)
//
// Pattern : ES modules natifs (cf. ADR-003), routing hash-based pour rester
// simple, fetch direct vers l'API existante /api/* (déjà conforme ACL Sprint 0.7).

import { router, navigateTo } from './core/router.js';
import { state, loadMe } from './core/state.js';
import { fetchClients, fetchProjets } from './core/api.js';
import { openSearch } from './core/search.js';
import { hydrateIcons } from './core/lucide.js';
import { openSupport } from './core/support.js';
import { openHelp, closeHelp } from './core/help.js';
import { installerGardeModales } from './core/modal-guard.js';

// Hydrater les icônes de la coquille HTML (data-icon) dès chargement du module
hydrateIcons(document);

// Un clic à côté d'une fenêtre ne doit pas effacer une saisie en cours
// (retour JMG 27/08 : « la fenêtre se referme d'un coup sans que les infos
// soient enregistrées »). Garde global : couvre les 24 modales d'un coup.
installerGardeModales();

// Bouton flottant support
document.getElementById('support-btn')?.addEventListener('click', openSupport);

// Bouton aide contextuelle « ? » (topbar) — ferme le panneau au changement de page
document.getElementById('help-btn')?.addEventListener('click', openHelp);
window.addEventListener('hashchange', closeHelp);

// Exposés en global pour les onclick="" inline du HTML squelette
window.navigateTo = navigateTo;
window.logout = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
};
window.openSearch = openSearch;

// Feuille « Plus » (bottom nav mobile) — ouvre/ferme les items secondaires + admin
window.toggleMoreNav = () => {
  const sheet = document.getElementById('nav-sheet');
  const backdrop = document.getElementById('nav-sheet-backdrop');
  if (!sheet || !backdrop) return;
  const open = sheet.classList.toggle('is-open');
  backdrop.classList.toggle('is-open', open);
  sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
};
// Fermer la feuille au changement de route
window.addEventListener('hashchange', () => {
  document.getElementById('nav-sheet')?.classList.remove('is-open');
  document.getElementById('nav-sheet-backdrop')?.classList.remove('is-open');
});

// Cmd+K shortcut
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    window.openSearch();
  }
});

// Helper pour afficher un statut visible (sans F12)
function showStatus(msg, isError) {
  const app = document.getElementById('app');
  if (!app) return;
  const title = isError ? 'Erreur bootstrap' : 'Statut';
  const titleColor = isError ? '#C84B26' : '#1B1A18';
  app.innerHTML = `<div class="card" style="margin-top:24px"><h2 style="color:${titleColor}">${title}</h2><pre style="white-space:pre-wrap;font-family:'DM Mono',monospace;font-size:12px;color:#3D3935;margin-top:8px">${msg}</pre></div>`;
}

// Capture globale des erreurs non gérées (sinon elles disparaissent silencieusement)
window.addEventListener('error', e => showStatus('Erreur JS : ' + (e.error?.stack || e.message || e), true));
window.addEventListener('unhandledrejection', e => showStatus('Promise rejetée : ' + (e.reason?.stack || e.reason?.message || e.reason), true));

// Bootstrap : charge user + clients, puis route initial
(async () => {
  try {
    showStatus('Authentification…', false);
    await loadMe();
    document.getElementById('user-name').textContent = state.user || '?';
    if (!state.isAdmin) {
      document.documentElement.style.setProperty('--admin-display', 'none');
      document.querySelectorAll('.nav-admin-only').forEach(el => el.style.display = 'none');
    }
    showStatus(`Connecté en tant que ${state.user}. Chargement clients + projets…`, false);
    const [clients, projets] = await Promise.all([fetchClients(), fetchProjets()]);
    showStatus(`Données chargées : ${clients.length} clients, ${projets.length} projets. Rendu…`, false);
    router(); // démarre sur le hash courant ou par défaut
  } catch (e) {
    if (e.message === 'unauthenticated') {
      location.href = '/login';
      return;
    }
    showStatus('Bootstrap échec : ' + (e.stack || e.message || e), true);
  }
})();

window.addEventListener('hashchange', router);
