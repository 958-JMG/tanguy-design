// Calendar v3 — Sprint 3 (stub Sprint 1)

import { icon, hydrateIcons } from '../core/lucide.js';

export function renderCalendar(app) {
  app.innerHTML = `
    <h1 class="page-title">Calendar</h1>
    <div class="card">
      <p class="muted muted-with-icon">${icon('construction', 14)}
        Calendar interactif avec drag-and-drop sur les périodes de pose
        à venir <strong>Sprint 3</strong>. Intégration FullCalendar.js + rétro-planning
        auto (J-3,5 mois commandes, J-1,5 mois rappel planif chantier).
      </p>
    </div>
  `;
  hydrateIcons(app);
}
