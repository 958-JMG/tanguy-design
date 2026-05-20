// Pipeline commercial v3 (Sprint 2) — tableau de suivi prospects + taux conversion
// Décomposition par Phase commerciale (fallback Statut legacy si migration v3 non appliquée).

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';

const PHASES = [
  { key: 'Découverte',          icon: 'compass', pct: 0   },
  { key: 'Dessin',              icon: 'pencil',  pct: 25  },
  { key: 'Présentation devis',  icon: 'file',    pct: 50  },
  { key: 'En attente décision', icon: 'clock',   pct: 75  },
  { key: 'Signé',               icon: 'check',   pct: 100 },
];

const ALERT_DAYS_THRESHOLD = 30; // au-delà : projet "bloqué" en attente

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}
function ageJours(p) {
  const start = p['Date découverte'] || p['Date contact'] || null;
  if (!start) return null;
  const d = new Date(start);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// Fallback mapping pour les projets sans Phase commerciale
function projetPhase(p) {
  if (p['Phase commerciale']) return p['Phase commerciale'];
  const s = (p.Statut || '').toLowerCase();
  if (!s || /découverte|decouverte/.test(s))       return 'Découverte';
  if (/dessin|présentation projet/.test(s))         return 'Dessin';
  if (/devis|présentation devis|presentation/.test(s)) return 'Présentation devis';
  if (/attente/.test(s))                            return 'En attente décision';
  return 'Signé';
}

export function renderPipeline(app, filterPhase = null) {
  const projets = state.projets || [];
  const clients = state.clients || [];
  const clientById = new Map(clients.map(c => [c.id, c]));

  // Agrégat par phase
  const byPhase = {};
  for (const p of projets) {
    const ph = projetPhase(p);
    if (!byPhase[ph]) byPhase[ph] = [];
    byPhase[ph].push(p);
  }

  // Taux de conversion : Découverte → Dessin, Dessin → Présentation, etc.
  const totalEnAmont = (phaseKey) => {
    const idx = PHASES.findIndex(p => p.key === phaseKey);
    let total = 0;
    for (let i = idx; i < PHASES.length; i++) total += (byPhase[PHASES[i].key] || []).length;
    return total;
  };
  const conversionRate = (from, to) => {
    const fromTotal = totalEnAmont(from);
    const toTotal = totalEnAmont(to);
    if (!fromTotal) return null;
    return (toTotal / fromTotal) * 100;
  };

  app.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Pipeline commercial</h1>
      <span class="muted">${projets.length} projet${projets.length > 1 ? 's' : ''} en base</span>
    </div>

    <p class="muted muted-with-icon" style="margin:-8px 0 20px">${icon('alert', 14)}
      ${projets.some(p => p['Phase commerciale']) ? '' :
        'Compteurs basés sur le Statut legacy. Lance <code>node scripts/setup-fields-v3.js --apply</code> pour activer Phase commerciale.'}
    </p>

    <h2 class="section-title">Conversion entre phases</h2>
    <div class="conversion-row">
      ${PHASES.slice(0, -1).map((p, i) => {
        const next = PHASES[i + 1];
        const rate = conversionRate(p.key, next.key);
        return `
        <div class="conv-step">
          <div class="conv-from">${icon(p.icon, 16)} ${p.key}</div>
          <div class="conv-arrow">→ <strong>${rate != null ? rate.toFixed(0) + '%' : '—'}</strong></div>
          <div class="conv-to">${next.key} ${icon(next.icon, 16)}</div>
        </div>`;
      }).join('')}
    </div>

    <h2 class="section-title">Détail par phase</h2>
    <table class="pipeline-table">
      <thead>
        <tr>
          <th></th>
          <th>Phase</th>
          <th class="num">Nb</th>
          <th class="num">CA estim.</th>
          <th class="num">Âge moyen</th>
          <th>État</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${PHASES.map(ph => {
          const list = byPhase[ph.key] || [];
          const ca = list.reduce((s, p) => s + (p['Budget HT'] || 0), 0);
          const ages = list.map(ageJours).filter(a => a != null);
          const ageMoy = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null;
          const stuckCount = list.filter(p => {
            const a = ageJours(p);
            return a != null && a > ALERT_DAYS_THRESHOLD && ph.key !== 'Signé';
          }).length;
          return `
          <tr class="${filterPhase === ph.key ? 'is-active' : ''}">
            <td>${icon(ph.icon, 18)}</td>
            <td><strong>${ph.key}</strong> <span class="muted">${ph.pct}%</span></td>
            <td class="num">${list.length}</td>
            <td class="num">${euros(ca)}</td>
            <td class="num">${ageMoy != null ? ageMoy + ' j' : '—'}</td>
            <td>${stuckCount > 0 ? `<span class="badge phase-en-attente-decision">${stuckCount} bloqué${stuckCount > 1 ? 's' : ''} > ${ALERT_DAYS_THRESHOLD}j</span>` : '<span class="muted">OK</span>'}</td>
            <td><button class="btn btn-ghost btn-sm" data-phase="${esc(ph.key)}">Voir ${list.length > 0 ? '→' : ''}</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    ${filterPhase ? renderProjetsList(filterPhase, byPhase[filterPhase] || [], clientById) : ''}

    <h2 class="section-title">Alertes pipeline</h2>
    <div class="card">
      ${(() => {
        const alerts = [];
        for (const p of projets) {
          const ph = projetPhase(p);
          if (ph === 'Signé') continue;
          const a = ageJours(p);
          if (a != null && a > ALERT_DAYS_THRESHOLD) {
            const cId = (p.Client || [])[0];
            const cNom = cId ? (clientById.get(cId)?.Nom || '?') : '?';
            alerts.push({ p, age: a, ph, cNom });
          }
        }
        if (alerts.length === 0) return `<p class="muted">Pas d'alertes pipeline aujourd'hui.</p>`;
        alerts.sort((x, y) => y.age - x.age);
        return `<ul class="alerts-list">${alerts.slice(0, 10).map(a => `<li>${icon('alert', 14)} <strong>${esc(a.cNom)}</strong> — ${esc(a.p.Référence || '')} bloqué ${a.age} j en <em>${esc(a.ph)}</em></li>`).join('')}</ul>`;
      })()}
    </div>
  `;

  // Listeners boutons "Voir N →"
  app.querySelectorAll('.btn[data-phase]').forEach(b => {
    b.addEventListener('click', () => {
      const phase = b.dataset.phase;
      navigateTo('pipeline', { id: phase });
    });
  });

  hydrateIcons(app);
}

function renderProjetsList(phase, projets, clientById) {
  if (!projets.length) {
    return `<h2 class="section-title">Projets — ${esc(phase)}</h2><div class="card"><p class="muted">Aucun projet dans cette phase.</p></div>`;
  }
  return `
    <h2 class="section-title">Projets — ${esc(phase)} (${projets.length})</h2>
    <div class="projets-list">
      ${projets.map(p => {
        const cId = (p.Client || [])[0];
        const c = cId ? clientById.get(cId) : null;
        return `
        <button class="projet-card" onclick="window.navigateTo('clients', { id: '${cId || ''}' })">
          <div class="projet-ref">${icon('folder', 16)} ${esc(p.Référence || '(sans référence)')}</div>
          <div class="projet-meta">
            ${c ? `<span><strong>${esc(c.Nom)}</strong></span>` : '<span class="muted">Sans client</span>'}
            ${p['Budget HT'] ? `<span>${euros(p['Budget HT'])}</span>` : ''}
            ${p['Date découverte'] ? `<span>Découvert le ${esc(p['Date découverte'])}</span>` : ''}
          </div>
        </button>`;
      }).join('')}
    </div>
  `;
}
