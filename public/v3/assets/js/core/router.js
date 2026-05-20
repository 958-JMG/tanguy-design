// Routing hash-based v3 (Sprint 1)
// Simple, pas de lib, suffisant pour le pivot client-centric.

import { renderDashboard } from '../views/dashboard.js';
import { renderClientsList, renderClientDetail } from '../views/clients.js';
import { renderPipeline } from '../views/pipeline.js';
import { renderCalendar } from '../views/calendar.js';
import { renderAdmin } from '../views/admin.js';

export function navigateTo(route, params = {}) {
  let hash = '#' + route;
  if (params.id) hash += '/' + params.id;
  if (location.hash !== hash) location.hash = hash;
  else router(); // forcer re-render si même route
}

export function router() {
  const hash = location.hash.slice(1) || 'dashboard';
  const [route, ...rest] = hash.split('/');

  // Mise à jour visuelle des items de nav
  document.querySelectorAll('[data-route]').forEach(el => {
    el.classList.toggle('is-active', el.dataset.route === route);
  });

  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Chargement…</div>';

  try {
    switch (route) {
      case 'dashboard':        return renderDashboard(app);
      case 'clients':          return rest.length ? renderClientDetail(app, rest[0]) : renderClientsList(app);
      case 'pipeline':         return renderPipeline(app);
      case 'calendar':         return renderCalendar(app);
      case 'admin':            return renderAdmin(app);
      default:                 return renderDashboard(app);
    }
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Erreur de rendu</h2><p class="muted">${e.message}</p></div>`;
  }
}
