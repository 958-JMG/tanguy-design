// Pipeline commercial v3 (Sprint 2 / v3.19) — Kanban board par phase + édition rapide
// JMG 2026-05-21 : refonte en Kanban, fix calcul "bloqué" (basé sur activité réelle).

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';

const PHASES = [
  { key: 'Découverte',          icon: 'compass', pct: 0,   short: 'Découverte' },
  { key: 'Dessin',              icon: 'pencil',  pct: 25,  short: 'Dessin' },
  { key: 'Présentation devis',  icon: 'file',    pct: 50,  short: 'Devis présenté' },
  { key: 'En attente décision', icon: 'clock',   pct: 75,  short: 'En attente' },
  { key: 'Signé',               icon: 'check',   pct: 100, short: 'Signé' },
];

// P-C (2026-06-24) — refus commercial : statut hors pipeline actif, avec motif + note + date.
const REFUS_PHASE = 'Refus';
const REFUS_MOTIFS = ['Prix trop élevé', 'Délai', 'Parti chez un concurrent', 'Projet abandonné', 'Reporté', 'Autre'];
let pipelineView = 'board'; // 'board' | 'refus' — vue courante du pipeline

const STUCK_THRESHOLD = 30; // jours sans activité

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
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
  const clients = state.clients || [];
  const clientById = new Map(clients.map(c => [c.id, c]));

  // P-C — les projets refusés sortent du pipeline actif (comme les archivés) et
  // sont regroupés dans la vue « Refus » (relances commerciales).
  const refusList = (state.projets || []).filter(p => projetPhase(p) === REFUS_PHASE);
  if (pipelineView === 'refus') return renderRefusView(app, refusList, clientById);

  const projets = (state.projets || []).filter(p =>
    (p['Statut chantier'] || '') !== 'Archivé' && projetPhase(p) !== REFUS_PHASE
  );

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
    <div class="page-header" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <h1 class="page-title">Pipeline commercial</h1>
      <span class="muted">${totalProjets} projet${totalProjets > 1 ? 's' : ''} actif${totalProjets > 1 ? 's' : ''}</span>
      <button class="btn btn-ghost btn-sm" id="btn-voir-refus" style="margin-left:auto">${icon('archive', 14)} Refus${refusList.length ? ` (${refusList.length})` : ''}</button>
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

  // P-C — bascule vers la vue Refus
  const btnRefus = app.querySelector('#btn-voir-refus');
  if (btnRefus) btnRefus.addEventListener('click', () => { pipelineView = 'refus'; renderPipeline(app); });

  hydrateIcons(app);
}

// P-C — vue dédiée aux projets refusés : motif, note, date + actions relancer / rouvrir.
function renderRefusView(app, refusList, clientById) {
  const rows = refusList
    .slice()
    .sort((a, b) => new Date(b['Date refus'] || 0) - new Date(a['Date refus'] || 0));
  app.innerHTML = `
    <div class="page-header" style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="btn-retour-pipeline">${icon('arrowLeft', 14)} Pipeline</button>
      <h1 class="page-title">Refus commerciaux</h1>
      <span class="muted">${rows.length} projet${rows.length > 1 ? 's' : ''} refusé${rows.length > 1 ? 's' : ''}</span>
    </div>
    ${rows.length === 0
      ? '<div class="card"><p class="muted">Aucun projet refusé. 👌</p></div>'
      : `<div class="pipeline-refus-list" style="display:flex;flex-direction:column;gap:10px">
          ${rows.map(p => {
            const c = clientById.get((p.Client || [])[0]);
            const motif = p['Motif refus'] || '—';
            const note = p['Note refus'] || '';
            const dRefus = p['Date refus'] ? new Date(p['Date refus']).toLocaleDateString('fr-FR') : '—';
            return `
            <article class="card" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
              <div style="min-width:0">
                <a href="#projet/${esc(p.id)}" style="font-weight:600">${esc(p['Référence'] || '(sans référence)')}</a>
                <div class="muted" style="font-size:13px">${esc(c?.Nom || '— Sans client —')} · ${euros(p['Budget HT'])}</div>
                <div style="margin-top:6px;font-size:13px"><span class="badge" style="background:var(--red-lo,#fde8e8)">${esc(motif)}</span> <span class="muted">refusé le ${esc(dRefus)}</span></div>
                ${note ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(note)}</div>` : ''}
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-ghost btn-sm" data-action="relancer" data-id="${esc(p.id)}">${icon('phone', 13)} Relancer</button>
              </div>
            </article>`;
          }).join('')}
        </div>`}
  `;
  app.querySelector('#btn-retour-pipeline').addEventListener('click', () => { pipelineView = 'board'; renderPipeline(app); });
  app.querySelectorAll('[data-action="relancer"]').forEach(btn => {
    btn.addEventListener('click', () => relancerProjet(btn.dataset.id, app));
  });
  hydrateIcons(app);
}

// P-C — rouvrir un projet refusé : revient en pipeline (« En attente décision »),
// vide le motif/date de refus et le désarchive si besoin.
async function relancerProjet(projetId, app) {
  const ok = await confirmModal('Relancer ce projet ? Il repart dans le pipeline en « En attente décision ».', { okLabel: 'Relancer' });
  if (!ok) return;
  try {
    const r = await fetch(`/api/data/projets/${encodeURIComponent(projetId)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'Phase commerciale': 'En attente décision', 'Statut chantier': '', 'Motif refus': '', 'Note refus': '', 'Date refus': null } }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    const proj = (state.projets || []).find(p => p.id === projetId);
    if (proj) { proj['Phase commerciale'] = 'En attente décision'; proj['Statut chantier'] = ''; delete proj['Motif refus']; delete proj['Note refus']; delete proj['Date refus']; }
    toast('Projet relancé → En attente décision', 'success');
    renderPipeline(app);
  } catch (err) {
    toast('Erreur : ' + err.message, 'error', 5000);
  }
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
        <div class="pipeline-card-client">${esc(cNom)}</div>
        <div class="pipeline-card-ref">${esc(p['Référence'] || '(sans référence)')}</div>
        <div class="pipeline-card-foot">
          ${budget ? `<span class="pipeline-card-budget">${euros(budget)}</span>` : '<span class="pipeline-card-budget pipeline-card-budget--todo">à chiffrer</span>'}
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
    <div class="pipeline-phase-menu-sep" style="border-top:1px solid var(--border,#eee);margin:4px 0"></div>
    <button class="pipeline-phase-option" data-phase="${REFUS_PHASE}" style="color:var(--red,#c0392b)">
      ${icon('x', 12)} Refus / perdu
    </button>
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
      // P-C — passage en Refus : on demande le motif (+ note) avant d'enregistrer.
      if (newPhase === REFUS_PHASE) { openRefusModal(projetId); return; }
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

// P-C — modale de refus : motif obligatoire (liste) + note libre, puis proposition d'archivage.
function openRefusModal(projetId) {
  const { modal, close } = modalShell('Refus du projet', `
    <form id="form-refus">
      <label>Motif du refus
        <select name="motif" required>
          <option value="" disabled selected>— choisir —</option>
          ${REFUS_MOTIFS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
        </select>
      </label>
      <label>Précision (optionnel)
        <textarea name="note" rows="3" placeholder="ex : a trouvé moins cher chez X, budget repoussé à l'an prochain…"></textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer le refus</button>
      </div>
    </form>
  `);
  modal.querySelector('[data-cancel]').onclick = close;
  modal.querySelector('#form-refus').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const motif = fd.get('motif');
    const note = (fd.get('note') || '').toString().trim();
    const today = new Date().toISOString().slice(0, 10);
    try {
      const r = await fetch(`/api/data/projets/${encodeURIComponent(projetId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Phase commerciale': REFUS_PHASE, 'Motif refus': motif, 'Note refus': note, 'Date refus': today } }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
      const proj = (state.projets || []).find(p => p.id === projetId);
      if (proj) { proj['Phase commerciale'] = REFUS_PHASE; proj['Motif refus'] = motif; proj['Note refus'] = note; proj['Date refus'] = today; }
      close();
      toast('Refus enregistré', 'success');
      // Archivage proposé (choix JMG : pas automatique)
      const archiver = await confirmModal('Archiver ce projet maintenant ? (il sortira du pipeline ; tu le retrouveras dans « Refus »)', { okLabel: 'Archiver', cancelLabel: 'Garder visible' });
      const app = document.getElementById('app');
      if (archiver) {
        try {
          await fetch(`/api/data/projets/${encodeURIComponent(projetId)}`, {
            method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { 'Statut chantier': 'Archivé' } }),
          });
          if (proj) proj['Statut chantier'] = 'Archivé';
          toast('Projet archivé', 'success');
        } catch (err) { toast('Refus OK mais archivage échoué : ' + err.message, 'error', 5000); }
      }
      renderPipeline(app);
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}

// modalShell local (même pattern que projet.js / gestion.js — helper non exporté du repo).
function modalShell(title, content) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${content}</div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function k(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); }
  });
  return { modal, close };
}
