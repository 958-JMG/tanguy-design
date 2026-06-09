// Routing hash-based v3 (Sprint 1)
// Simple, pas de lib, suffisant pour le pivot client-centric.

import { renderDashboard } from '../views/dashboard.js';
import { renderClientsList, renderClientDetail } from '../views/clients.js';
import { renderProjet } from '../views/projet.js';
import { renderCommande } from '../views/commande.js';
import { renderDevis } from '../views/devis.js';
import { renderPipeline } from '../views/pipeline.js';
import { renderCalendar } from '../views/calendar.js';
import { renderAdmin } from '../views/admin.js';
import { renderGestion } from '../views/gestion.js';
import { renderSav } from '../views/sav.js';
import { renderAide } from '../views/aide.js';

export function navigateTo(route, params = {}) {
  let hash = '#' + route;
  if (params.id) hash += '/' + encodeURIComponent(params.id);
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
      case 'clients':          return rest.length ? renderClientDetail(app, decodeURIComponent(rest[0])) : renderClientsList(app);
      case 'projet':           return rest.length ? renderProjet(app, decodeURIComponent(rest[0])) : renderDashboard(app);
      case 'commande':         return rest.length ? renderCommande(app, decodeURIComponent(rest[0])) : renderDashboard(app);
      case 'devis':            return rest.length ? renderDevis(app, decodeURIComponent(rest[0])) : renderDashboard(app);
      case 'pipeline':         return renderPipeline(app, rest.length ? decodeURIComponent(rest.join('/')) : null);
      case 'calendar':         return renderCalendar(app);
      case 'gestion':          return renderGestion(app, rest.length ? decodeURIComponent(rest[0]) : 'facturation');
      case 'sav':              return renderSav(app);
      case 'admin':            return renderAdmin(app);
      case 'aide':             return renderAide(app);
      default:                 return renderDashboard(app);
    }
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Erreur de rendu</h2><p class="muted">${e.message}</p></div>`;
  }
}
