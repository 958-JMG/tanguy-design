// Dashboard v3 — KPI + funnel cliquable + alertes + prochains jalons
// Compteurs branchés sur state.clients + state.projets.

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';

const PHASES = [
  { key: 'Découverte',          icon: 'compass', pct: 0 },
  { key: 'Dessin',              icon: 'pencil',  pct: 25 },
  { key: 'Présentation devis',  icon: 'file',    pct: 50 },
  { key: 'En attente décision', icon: 'clock',   pct: 75 },
  { key: 'Signé',               icon: 'check',   pct: 100 },
];

const euros = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';

export function renderDashboard(app) {
  const clients = state.clients || [];
  const projets = state.projets || [];

  // Stats projets
  const enCours = projets.filter(p => {
    const chantier = p['Statut chantier'];
    return chantier && chantier !== 'Archivé' && chantier !== 'Terminé';
  });
  const enCoursNb = enCours.length || projets.filter(p => p['Phase commerciale'] === 'Signé').length;

  const caTotal = projets.reduce((sum, p) => sum + (p['Budget HT'] || 0), 0);

  // Marge prévisionnelle peut être stockée en décimal (0.25) ou pourcent entier (25)
  // selon comment elle est saisie côté Airtable. On normalise sur 0-1 avant de multiplier par 100.
  const margesValides = projets.map(p => p['Marge prévisionnelle']).filter(m => m != null && !isNaN(m));
  const margeAvgRaw = margesValides.length
    ? margesValides.reduce((sum, m) => sum + m, 0) / margesValides.length
    : 0;
  // Si la moyenne brute > 1, c'est qu'on est en notation pourcent entier → ne pas re-multiplier
  const margeAvgPct = margeAvgRaw > 1 ? margeAvgRaw : margeAvgRaw * 100;

  // Compteurs par phase (fallback Statut legacy si Phase commerciale absente)
  const countByPhase = {};
  for (const p of projets) {
    const phase = p['Phase commerciale'] || mapLegacyStatut(p.Statut);
    countByPhase[phase] = (countByPhase[phase] || 0) + 1;
  }

  // Alertes simples
  const alertes = [];
  const now = new Date();
  for (const p of projets) {
    if (p['Date pose prévue']) {
      const pose = new Date(p['Date pose prévue']);
      const diffJours = Math.round((pose - now) / (1000 * 60 * 60 * 24));
      if (diffJours > 0 && diffJours <= 30) {
        alertes.push({ severity: 'warn', text: `Pose ${p['Référence']} dans ${diffJours} j` });
      }
    }
  }

  app.innerHTML = `
    <h1 class="page-title">Dashboard</h1>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-value">${clients.length}</div>
        <div class="kpi-label">Clients</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${enCoursNb}</div>
        <div class="kpi-label">Projets en cours</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${euros(caTotal)}</div>
        <div class="kpi-label">CA cumul prévi</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${margesValides.length ? margeAvgPct.toFixed(1) + ' %' : '—'}</div>
        <div class="kpi-label">Marge prévi moyenne</div>
      </div>
    </div>

    <h2 class="section-title">Pipeline commercial</h2>
    <div class="funnel">
      ${PHASES.map(p => `
        <button class="funnel-step" data-phase="${p.key}" onclick="window.navigateTo('pipeline')">
          <div class="funnel-icon">${icon(p.icon, 24)}</div>
          <div class="funnel-count">${countByPhase[p.key] || 0}</div>
          <div class="funnel-name">${p.key}</div>
          <div class="funnel-pct">${p.pct}%</div>
        </button>
      `).join('')}
    </div>
    ${!Object.keys(countByPhase).some(k => k && PHASES.find(p => p.key === k))
      ? `<p class="muted muted-with-icon" style="margin-top:8px">${icon('alert', 14)} Migration Airtable v3 non appliquée : compteurs basés sur Statut legacy. Lance <code>node scripts/setup-fields-v3.js --apply</code> pour activer Phase commerciale.</p>`
      : ''}

    <h2 class="section-title">Alertes</h2>
    <div class="card">
      ${alertes.length === 0
        ? `<p class="muted">Pas d'alertes prioritaires.</p>`
        : `<ul class="alerts-list">${alertes.map(a => `<li>${icon('alert', 14)} ${a.text}</li>`).join('')}</ul>`}
    </div>

    <h2 class="section-title">Prochains jalons</h2>
    <div class="card"><p class="muted">À venir — Sprint 3 (intégration calendar drag-drop).</p></div>
  `;

  hydrateIcons(app);
}

// Mapping legacy fallback pour les projets sans Phase commerciale (avant migration v3)
function mapLegacyStatut(s) {
  const lo = (s || '').toLowerCase();
  if (!lo || lo.includes('découverte') || lo.includes('decouverte')) return 'Découverte';
  if (lo.includes('dessin')) return 'Dessin';
  if (lo === 'devis' || lo.includes('présentation devis')) return 'Présentation devis';
  if (lo.includes('attente')) return 'En attente décision';
  return 'Signé';
}
