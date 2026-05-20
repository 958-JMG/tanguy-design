// Admin v3 — Sprint 2+ (stub Sprint 1)

import { icon, hydrateIcons } from '../core/lucide.js';

export function renderAdmin(app) {
  app.innerHTML = `
    <h1 class="page-title">Admin</h1>
    <div class="card">
      <p class="muted muted-with-icon">${icon('construction', 14)}
        Sous-écrans : marges, stock, artisans, fournisseurs, templates tâches, coûts
        — à venir <strong>Sprint 2+</strong>.
      </p>
    </div>
  `;
  hydrateIcons(app);
}
