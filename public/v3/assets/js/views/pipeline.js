// Pipeline commercial v3 — Sprint 2 (stub Sprint 1)

import { icon, hydrateIcons } from '../core/lucide.js';

export function renderPipeline(app) {
  app.innerHTML = `
    <h1 class="page-title">Pipeline commercial</h1>
    <div class="card">
      <p class="muted muted-with-icon">${icon('construction', 14)}
        Tableau prospects + taux de conversion à venir <strong>Sprint 2</strong>.
        Nécessite la migration <code>setup-fields-v3.js --apply</code> pour activer
        <em>Phase commerciale</em> et <em>Statut chantier</em>.
      </p>
    </div>
  `;
  hydrateIcons(app);
}
