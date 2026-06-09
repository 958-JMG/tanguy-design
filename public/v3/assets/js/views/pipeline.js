// Pipeline commercial v3 (Sprint 2 / v3.19) — Kanban board par phase + édition rapide
// JMG 2026-05-21 : refonte en Kanban, fix calcul "bloqué" (basé sur activité réelle).

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast } from '../core/ui.js';

const PHASES = [
  { key: 'Découverte',          icon: 'compass', pct: 0,   short: 'Découverte' },
  { key: 'Dessin',              icon: 'pencil',  pct: 25,  short: 'Dessin' },
  { key: 'Présentation devis',  icon: 'file',    pct: 50,  short: 'Devis présenté' },
  { key: 'En attente décision', icon: 'clock',   pct: 75,  short: 'En attente' },
  { key: 'Signé',               icon: 'check',   pct: 100, short: 'Signé' },
];

const STUCK_THRESHOLD = 30; // jours sans activité

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Sprint v3.19 — Âge "depuis dernière activité" (R1/R2 le plus récent, dernière
// tâche créée, dernier devis importé) plutôt que juste "Date découverte".
// Si on vient d'ajouter un R1, le projet n'est plus "bloqué" même si la
// date de découverte est ancienne.
function daysSinceActivity(p) {
  const candidates = [
    p['Date découverte'],
    p['Date contact'],
    p['Date pose prévue'], // si > today, ça indique un projet actif
    // Note : on n'a pas accès aux Plaud/tâches/devis ici depuis state, ce serait
    // un fetch lourd. À défaut, on utilise au moins les dates du projet.
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  const mostRecent = candidates
    .map(d => new Date(d))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => b - a)[0];
  if (!mostRecent) return null;
  return Math.floor((Date.now() - mostRecent.getTime()) / 86400000);
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
  const projets = (state.projets || []).filter(p =>
    (p['Statut chantier'] || '') !== 'Archivé'
  );
  const clients = state.clients || [];
  const clientById = new Map(clients.map(c => [c.id, c]));

  // Agrégat par phase
  const byPhase = {};
  for (const ph of PHASES) byPhase[ph.key] = [];
  for (const p of projets) {
    const ph = projetPhase(p);
    if (!byPhase[ph]) byPhase[ph] = [];
    byPhase[ph].push(p);
  }

  // Stats globales
  const totalProjets = projets.length;
  const caPipeline = projets
    .filter(p => projetPhase(p) !== 'Signé')
    .reduce((s, p) => s + (p['Budget HT'] || 0), 0);
  const caPondere = projets
    .filter(p => projetPhase(p) !== 'Signé')
    .reduce((s, p) => {
      const ph = PHASES.find(x => x.key === projetPhase(p));
      return s + (p['Budget HT'] || 0) * (ph?.pct || 0) / 100;
    }, 0);
  const stuckCount = projets.filter(p => {
    const a = daysSinceActivity(p);
    const ph = projetPhase(p);
    return a != null && a > STUCK_THRESHOLD && ph !== 'Signé';
  }).length;

  app.innerHTML = `
    <div class="page-header" style="margin-bottom:16px">
      <h1 class="page-title">Pipeline commercial</h1>
      <span class="muted">${totalProjets} projet${totalProjets > 1 ? 's' : ''} actif${totalProjets > 1 ? 's' : ''}</span>
    </div>

    <!-- KPIs pipeline -->
    <div class="kpi-row" style="margin-bottom:24px">
      <div class="kpi-card"><div class="kpi-value">${totalProjets}</div><div class="kpi-label">Projets actifs</div></div>
      <div class="kpi-card"><div class="kpi-value">${euros(caPipeline)}</div><div class="kpi-label">CA pipeline brut</div></div>
      <div class="kpi-card"><div class="kpi-value">${euros(caPondere)}</div><div class="kpi-label">CA pondéré par phase</div></div>
      <div class="kpi-card${stuckCount > 0 ? ' is-warning' : ''}"><div class="kpi-value">${stuckCount}</div><div class="kpi-label">À relancer (> ${STUCK_THRESHOLD} j)</div></div>
    </div>

    <!-- Kanban board : 5 colonnes par phase -->
    <div class="pipeline-board" role="list" aria-label="Pipeline commercial Kanban">
      ${PHASES.map(ph => {
        const list = byPhase[ph.key] || [];
        const ca = list.reduce((s, p) => s + (p['Budget HT'] || 0), 0);
        return `
        <section class="pipeline-col" data-phase="${esc(ph.key)}" role="listitem">
          <header class="pipeline-col-head">
            <div class="pipeline-col-title">
              <span class="pipeline-col-icon" aria-hidden="true">${icon(ph.icon, 14)}</span>
              <span>${esc(ph.short)}</span>
              <span class="pipeline-col-count">${list.length}</span>
            </div>
            <div class="pipeline-col-ca muted">${ca > 0 ? euros(ca) : ''}</div>
          </header>
          <div class="pipeline-col-body">
            ${list.length === 0
              ? '<div class="pipeline-col-empty muted">Aucun projet</div>'
              : list
                  .sort((a, b) => (daysSinceActivity(b) || 0) - (daysSinceActivity(a) || 0))
                  .map(p => renderProjetCard(p, ph.key, clientById))
                  .join('')}
          </div>
        </section>`;
      }).join('')}
    </div>
  `;

  // Click card → fiche projet
  app.querySelectorAll('.pipeline-card-main').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const id = el.dataset.id;
      if (id) location.hash = '#projet/' + id;
    });
  });

  // Click "Changer phase" → menu select
  app.querySelectorAll('[data-action="change-phase"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const projetId = btn.dataset.id;
      const currentPhase = btn.dataset.phase;
      openChangePhaseMenu(btn, projetId, currentPhase);
    });
  });

  hydrateIcons(app);
}

function renderProjetCard(p, phaseKey, clientById) {
  const cId = (p.Client || [])[0];
  const c = cId ? clientById.get(cId) : null;
  const cNom = c?.Nom || '— Sans client —';
  const days = daysSinceActivity(p);
  const isStuck = days != null && days > STUCK_THRESHOLD && phaseKey !== 'Signé';
  const budget = p['Budget HT'];
  return `
    <article class="pipeline-card ${isStuck ? 'is-stuck' : ''}">
      <a href="#projet/${esc(p.id)}" class="pipeline-card-main" data-id="${esc(p.id)}">
        <div class="pipeline-card-ref">${esc(p['Référence'] || '(sans référence)')}</div>
        <div class="pipeline-card-client">${esc(cNom)}</div>
        <div class="pipeline-card-foot">
          ${budget ? `<span class="pipeline-card-budget">${euros(budget)}</span>` : '<span class="muted">— € —</span>'}
          ${days != null
            ? `<span class="pipeline-card-age ${isStuck ? 'is-stuck' : ''}" title="${days} jours depuis la dernière activité enregistrée">${days} j</span>`
            : ''}
        </div>
      </a>
      <button class="pipeline-card-action" data-action="change-phase" data-id="${esc(p.id)}" data-phase="${esc(phaseKey)}" aria-label="Changer la phase">
        ${icon('arrowLeft', 12)}
      </button>
    </article>`;
}

// Sprint v3.19 — Menu de changement de phase : popover avec les 5 phases.
// Patch /api/data/projets/:id { Phase commerciale: newPhase } + refresh.
function openChangePhaseMenu(anchor, projetId, currentPhase) {
  // Ferme tout menu existant
  document.querySelectorAll('.pipeline-phase-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'pipeline-phase-menu';
  menu.innerHTML = `
    <div class="pipeline-phase-menu-title">Changer la phase</div>
    ${PHASES.map(p => `
      <button class="pipeline-phase-option ${p.key === currentPhase ? 'is-current' : ''}" data-phase="${esc(p.key)}">
        ${icon(p.icon, 12)} ${esc(p.key)}
        ${p.key === currentPhase ? '<span class="muted">(actuel)</span>' : ''}
      </button>
    `).join('')}
  `;
  document.body.appendChild(menu);
  hydrateIcons(menu);

  // Position près du bouton
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'absolute';
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.max(8, rect.right + window.scrollX - 200)}px`;

  // Ferme au clic extérieur
  const onClickOutside = (ev) => {
    if (!menu.contains(ev.target) && ev.target !== anchor) {
      menu.remove();
      document.removeEventListener('click', onClickOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', onClickOutside), 0);

  // Bind options
  menu.querySelectorAll('[data-phase]').forEach(opt => {
    opt.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newPhase = opt.dataset.phase;
      if (newPhase === currentPhase) { menu.remove(); return; }
      menu.remove();
      try {
        const r = await fetch(`/api/data/projets/${encodeURIComponent(projetId)}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { 'Phase commerciale': newPhase } }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || r.statusText);
        }
        // Update state local pour re-render sans refetch complet
        const proj = (state.projets || []).find(p => p.id === projetId);
        if (proj) proj['Phase commerciale'] = newPhase;
        toast(`Phase → ${newPhase}`, 'success');
        // Re-render pipeline
        const app = document.getElementById('app');
        renderPipeline(app);
      } catch (err) {
        toast('Erreur : ' + err.message, 'error', 5000);
      }
    });
  });
}
