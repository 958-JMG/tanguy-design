// Admin v3 — IA suggestions cockpit + stubs sous-sections (Sprint 4 P2)

import { state } from '../core/state.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast } from '../core/ui.js';
import { navigateTo } from '../core/router.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

export function renderAdmin(app) {
  if (!state.isAdmin) {
    app.innerHTML = `<div class="card"><h2>Accès réservé</h2><p class="muted">Cette section est réservée aux administrateurs (typiquement Virginie).</p></div>`;
    return;
  }

  app.innerHTML = `
    <h1 class="page-title">Admin</h1>

    <div class="section-header">
      <h2 class="section-title">Briefing IA</h2>
      <button class="btn btn-primary btn-sm" id="btn-gen-ai">${icon('compass', 14)} Générer le briefing</button>
    </div>
    <div id="ai-output">
      <div class="card">
        <p class="muted">Claude (Sonnet 4.5) analyse l'état du cockpit (projets, tâches, alertes) et propose un briefing + 5 suggestions actionnables pour la semaine. Cible : 30 secondes de lecture.</p>
      </div>
    </div>

    <div class="section-header" style="margin-top:32px">
      <h2 class="section-title">Marges par projet</h2>
      <button class="btn btn-primary btn-sm" id="btn-load-marges">${icon('chart', 14)} Charger</button>
    </div>
    <div id="marges-output">
      <div class="card">
        <p class="muted">Calcul : CA HT − fournisseurs − artisans + 5 % rétro (artisans contractuels). Cliquez « Charger » pour générer le tableau (1-2 s).</p>
      </div>
    </div>

    <h2 class="section-title" style="margin-top:32px">Sous-sections à venir</h2>
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Stock</div><div class="muted">Sprint 6+</div></div>
      <div class="kpi-card"><div class="kpi-label">Artisans + rétro 5 %</div><div class="muted">Sprint 6+</div></div>
      <div class="kpi-card"><div class="kpi-label">Fournisseurs / familles</div><div class="muted">Sprint 6+</div></div>
      <div class="kpi-card"><div class="kpi-label">Templates tâches par étape</div><div class="muted">Sprint 6+</div></div>
    </div>
  `;

  hydrateIcons(app);
  document.getElementById('btn-gen-ai').addEventListener('click', generateBriefing);
  document.getElementById('btn-load-marges').addEventListener('click', loadMarges);
}

async function loadMarges() {
  const out = document.getElementById('marges-output');
  out.innerHTML = `<div class="card"><p class="muted">${icon('clock', 14)} Calcul en cours…</p></div>`;
  try {
    const r = await fetch('/api/admin/marges', { credentials: 'same-origin' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || r.statusText);
    }
    const { rows } = await r.json();
    renderMarges(out, rows);
    toast(`${rows.length} projets calculés`, 'success');
  } catch (err) {
    out.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`;
    toast('Erreur chargement marges : ' + err.message, 'error', 5000);
  }
}

function renderMarges(container, rows) {
  // Stats globales
  const caTotal = rows.reduce((s, r) => s + r.caHT, 0);
  const margeTotal = rows.reduce((s, r) => s + r.margeAbs, 0);
  const margeAvgPct = caTotal > 0 ? (margeTotal / caTotal) * 100 : 0;
  const negatifs = rows.filter(r => r.margeAbs < 0).length;

  rows.sort((a, b) => (b.caHT || 0) - (a.caHT || 0));

  container.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-value">${euros(caTotal)}</div><div class="kpi-label">CA cumul</div></div>
      <div class="kpi-card"><div class="kpi-value">${euros(margeTotal)}</div><div class="kpi-label">Marge cumul</div></div>
      <div class="kpi-card"><div class="kpi-value">${margeAvgPct.toFixed(1)} %</div><div class="kpi-label">Marge moyenne</div></div>
      <div class="kpi-card"${negatifs > 0 ? ' style="background:var(--accent-lo)"' : ''}>
        <div class="kpi-value">${negatifs}</div>
        <div class="kpi-label">Projet${negatifs > 1 ? 's' : ''} en perte</div>
      </div>
    </div>

    <table class="pipeline-table">
      <thead>
        <tr>
          <th>Projet</th>
          <th>Client</th>
          <th>Phase</th>
          <th class="num">CA HT</th>
          <th class="num">Fourn.</th>
          <th class="num">Artis.</th>
          <th class="num">Rétro</th>
          <th class="num">Marge</th>
          <th class="num">%</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
        <tr data-id="${esc(r.id)}" style="cursor:pointer">
          <td><strong>${esc(r.reference || '?')}</strong></td>
          <td>${esc(r.client)}</td>
          <td><span class="badge phase-${esc((r.phase || '')).toLowerCase().replace(/[^a-z]+/g, '-')}">${esc(r.phase || '—')}</span></td>
          <td class="num">${euros(r.caHT)}</td>
          <td class="num">${euros(r.coutFourn)}</td>
          <td class="num">${euros(r.coutArtisans)}</td>
          <td class="num" style="color:var(--green)">+${euros(r.retro)}</td>
          <td class="num"${r.margeAbs < 0 ? ' style="color:var(--accent);font-weight:600"' : ''}>${euros(r.margeAbs)}</td>
          <td class="num"${r.margeAbs < 0 ? ' style="color:var(--accent);font-weight:600"' : ''}>${r.margePct != null ? r.margePct.toFixed(1) + ' %' : '—'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => navigateTo('projet', { id: tr.dataset.id }));
  });
}

async function generateBriefing() {
  const out = document.getElementById('ai-output');
  out.innerHTML = `<div class="card"><p class="muted">${icon('clock', 14)} Claude analyse le cockpit… (10-30 s)</p></div>`;
  try {
    const r = await fetch('/api/admin/ai-suggestions', { credentials: 'same-origin' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || r.statusText);
    }
    const data = await r.json();
    renderAnalysis(out, data);
    toast('Briefing généré', 'success');
  } catch (err) {
    out.innerHTML = `<div class="card"><h2>Erreur</h2><p class="muted">${esc(err.message)}</p></div>`;
    toast('Erreur génération briefing : ' + err.message, 'error', 5000);
  }
}

function renderAnalysis(container, data) {
  const a = data.analysis || {};
  const s = data.snapshot || {};
  const ts = new Date(data.generatedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  container.innerHTML = `
    ${a.alerte_critique ? `
    <div class="card" style="background:var(--accent-lo);border-color:var(--accent);margin-bottom:12px">
      <h3 class="card-title" style="color:var(--accent)">Alerte critique</h3>
      <p><strong>${esc(a.alerte_critique)}</strong></p>
    </div>
    ` : ''}

    <div class="card">
      <h3 class="card-title">Synthèse · ${esc(ts)}</h3>
      <p style="font-size:15px;line-height:1.6">${esc(a.synthese || '—')}</p>
    </div>

    ${Array.isArray(a.points_attention) && a.points_attention.length ? `
    <h2 class="section-title">Points d'attention</h2>
    <div class="card">
      <ol style="padding-left:24px;line-height:1.7">
        ${a.points_attention.map(p => `<li>${esc(p)}</li>`).join('')}
      </ol>
    </div>
    ` : ''}

    ${Array.isArray(a.suggestions) && a.suggestions.length ? `
    <h2 class="section-title">Suggestions de la semaine</h2>
    <div class="card">
      <ul style="padding-left:24px;line-height:1.7;list-style:none">
        ${a.suggestions.map(sg => `<li style="padding:6px 0;display:flex;gap:10px"><span style="color:var(--green)">${icon('check', 14)}</span> ${esc(sg)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    <h2 class="section-title">Métriques snapshot</h2>
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-value">${s.nb_clients}</div><div class="kpi-label">Clients</div></div>
      <div class="kpi-card"><div class="kpi-value">${s.nb_projets_en_cours}</div><div class="kpi-label">Projets en cours</div></div>
      <div class="kpi-card"><div class="kpi-value">${s.nb_taches_en_retard}</div><div class="kpi-label">Tâches en retard</div></div>
      <div class="kpi-card"${s.nb_projets_bloques_30j > 0 ? ' style="background:var(--accent-lo)"' : ''}>
        <div class="kpi-value">${s.nb_projets_bloques_30j}</div>
        <div class="kpi-label">Projets bloqués > 30 j</div>
      </div>
    </div>
  `;
  hydrateIcons(container);
}
