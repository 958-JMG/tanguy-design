// Dashboard v3 — KPI + funnel cliquable + alertes + prochains jalons
// Sprint 1 : version statique avec les données chargées (state.clients).
// Sprint 2 enrichira avec /api/pipeline pour les taux de conversion.

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';

const PHASES = [
  { key: 'Découverte',          icon: '👋', pct: 0 },
  { key: 'Dessin',              icon: '📐', pct: 25 },
  { key: 'Présentation devis',  icon: '📄', pct: 50 },
  { key: 'En attente décision', icon: '⏳', pct: 75 },
  { key: 'Signé',               icon: '✅', pct: 100 },
];

export function renderDashboard(app) {
  const clients = state.clients || [];
  const total = clients.length;
  const actifs = clients.filter(c => c['Statut'] !== 'Archivé').length;

  app.innerHTML = `
    <h1 class="page-title">Dashboard</h1>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-value">${actifs}</div>
        <div class="kpi-label">Clients actifs</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">—</div>
        <div class="kpi-label">Projets en cours</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">—</div>
        <div class="kpi-label">CA prévi 2026</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">—</div>
        <div class="kpi-label">Marge moyenne</div>
      </div>
    </div>

    <h2 class="section-title">📊 Pipeline commercial</h2>
    <div class="funnel">
      ${PHASES.map(p => `
        <button class="funnel-step" data-phase="${p.key}" onclick="window.navigateTo('pipeline')">
          <div class="funnel-icon">${p.icon}</div>
          <div class="funnel-count">—</div>
          <div class="funnel-name">${p.key}</div>
          <div class="funnel-pct">${p.pct}%</div>
        </button>
      `).join('')}
    </div>
    <p class="muted" style="margin-top:8px">Compteurs réels après migration v3 (Sprint 1 — appliquer le script setup-fields-v3.js).</p>

    <h2 class="section-title">⚠️ Alertes</h2>
    <div class="card"><p class="muted">Pas d'alertes prioritaires aujourd'hui (data fictive).</p></div>

    <h2 class="section-title">📅 Prochains jalons</h2>
    <div class="card"><p class="muted">À venir — Sprint 3 (intégration calendar drag-drop).</p></div>
  `;
}
