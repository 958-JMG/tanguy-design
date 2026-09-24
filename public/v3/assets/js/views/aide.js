// Guide complet (#aide) — Sprint v5.1. Mode d'emploi du cockpit :
// les bases, le fil d'un projet de A à Z, puis l'aide page par page.
// Contenu chargé depuis la table Airtable « Aide » (cf. core/help.js),
// éditable par les admins directement ici (crayons + boutons d'ajout).
// Sections admin (Gestion/Admin) masquées aux membres.

import { icon } from '../core/lucide.js';
import { state } from '../core/state.js';
import { PAGE_META, loadAide, getPageContent, bindAideAdmin } from '../core/help.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function fmt(s) {
  return esc(s).replace(/« ([^»]+) »/g, '« <strong>$1</strong> »');
}

// Icônes des cartes « Les bases » (par ordre d'affichage — le contenu, lui, est éditable).
const BASE_ICONS = ['compass', 'search', 'helpCircle', 'alert'];

// Pages listées dans « L'aide, page par page » (les sections du guide en sont exclues).
const PAGE_KEYS = ['dashboard', 'clients', 'pipeline', 'calendar', 'projet', 'devis', 'commande', 'gestion', 'admin'];

function adminAddBtn(page, label = 'Ajouter un bloc') {
  if (!state.isAdmin) return '';
  return `<button type="button" class="btn btn-ghost btn-sm" data-aide-add="${esc(page)}">${icon('plus', 14)} ${esc(label)}</button>`;
}

function adminEditBtn(item, page) {
  if (!state.isAdmin || !item.id) return '';
  return `<button type="button" class="aide-edit-btn" data-aide-edit="${esc(item.id)}" data-aide-page="${esc(page)}" title="Modifier" aria-label="Modifier">${icon('pencil', 13)}</button>`;
}

export async function renderAide(app) {
  await loadAide();

  const bases = getPageContent('guide-bases');
  const parcours = getPageContent('guide-parcours');

  const basesHtml = bases.items.map((b, i) => `
    <div class="card guide-base-card ${b.visible === false ? 'is-hidden-item' : ''}">
      <span class="guide-base-icon" aria-hidden="true">${icon(BASE_ICONS[i % BASE_ICONS.length], 20)}</span>
      <div>
        <h3>${esc(b.q)}${b.visible === false ? ' <span class="badge">masqué</span>' : ''} ${adminEditBtn(b, 'guide-bases')}</h3>
        <p>${b.steps.map(fmt).join('<br>')}</p>
      </div>
    </div>
  `).join('');

  const parcoursHtml = parcours.items.map((e, i) => `
    <li class="guide-step ${e.visible === false ? 'is-hidden-item' : ''}">
      <span class="guide-step-num" aria-hidden="true">${i + 1}</span>
      <div>
        <h3>${esc(e.q)}${e.visible === false ? ' <span class="badge">masqué</span>' : ''} ${adminEditBtn(e, 'guide-parcours')}</h3>
        <p>${e.steps.map(fmt).join('<br>')}</p>
      </div>
    </li>
  `).join('');

  const pagesHtml = PAGE_KEYS
    .filter(key => !PAGE_META[key].adminOnly || state.isAdmin)
    .map(key => {
      const p = getPageContent(key);
      const meta = PAGE_META[key];
      return `
      <details class="help-item guide-page-item" id="guide-${esc(key)}">
        <summary><span aria-hidden="true">${icon(meta.icon, 16)}</span> ${esc(meta.title)}${meta.adminOnly ? ' <span class="badge">Admin</span>' : ''}</summary>
        <p class="help-intro">${esc(p.intro)} ${state.isAdmin ? `<button type="button" class="aide-edit-btn" data-aide-edit-intro="${esc(key)}" title="Modifier l’introduction" aria-label="Modifier l’introduction">${icon('pencil', 13)}</button>` : ''}</p>
        ${p.items.map(item => `
          <div class="guide-page-action ${item.visible === false ? 'is-hidden-item' : ''}">
            <h4>${esc(item.q)}${item.visible === false ? ' <span class="badge">masqué</span>' : ''} ${adminEditBtn(item, key)}</h4>
            <ol class="help-steps">${item.steps.map(s => `<li>${fmt(s)}</li>`).join('')}</ol>
          </div>
        `).join('')}
        ${state.isAdmin ? `<div class="guide-page-add">${adminAddBtn(key)}</div>` : ''}
      </details>
    `;
    }).join('');

  app.innerHTML = `
    <div class="guide-wrap">
      <header class="page-header">
        <div>
          <h1 class="page-title">Guide d’utilisation</h1>
          <p class="muted">Tout ce qu’il faut savoir pour utiliser le cockpit au quotidien. Et à tout moment, le bouton « ? » en haut à droite explique la page en cours.</p>
          ${state.isAdmin ? '<p class="muted guide-admin-hint">Mode admin : le crayon modifie un bloc (contenu, ordre, visibilité), « + Ajouter un bloc » en crée un nouveau. L’équipe voit le résultat immédiatement.</p>' : ''}
        </div>
      </header>

      <section aria-labelledby="guide-bases-title">
        <h2 class="section-title" id="guide-bases-title">Les bases ${adminAddBtn('guide-bases', 'Ajouter')}</h2>
        <div class="guide-bases">${basesHtml}</div>
      </section>

      <section aria-labelledby="guide-parcours-title">
        <h2 class="section-title" id="guide-parcours-title">Le fil d’un projet, de A à Z ${adminAddBtn('guide-parcours', 'Ajouter une étape')}</h2>
        <ol class="guide-parcours">${parcoursHtml}</ol>
      </section>

      <section aria-labelledby="guide-pages-title">
        <h2 class="section-title" id="guide-pages-title">L’aide, page par page</h2>
        <div class="guide-pages">${pagesHtml}</div>
      </section>

      ${state.isAdmin ? `
      <section aria-labelledby="guide-export-title" style="margin-top:32px">
        <h2 class="section-title" id="guide-export-title">${icon('download', 18)} Exporter mes données <span class="badge">Réversibilité</span></h2>
        <div class="card">
          <p class="muted">Vos données vous appartiennent. Créez un ZIP complet du cockpit (toutes les tables en JSON + CSV) avec votre document de réversibilité. Le lien de téléchargement est sécurisé et valable 24 h, chaque export est tracé.</p>
          <p><button type="button" class="btn btn-primary" id="export-run">${icon('download', 15)} Exporter tout le cockpit</button></p>
          <p class="muted" id="export-msg" style="display:none"></p>
          <div id="export-list"></div>
        </div>
      </section>` : ''}
    </div>
  `;

  // Édition admin : après sauvegarde, on re-rend le guide en conservant le scroll.
  bindAideAdmin(app, async () => {
    const scrollY = window.scrollY;
    await renderAide(app);
    window.scrollTo(0, scrollY);
  });

  if (state.isAdmin) bindExport(app);
}

// --- Export / réversibilité (admin) --------------------------------------
function fdate(s) { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('fr-FR'); }
function fdatetime(s) { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? '—' : d.toLocaleString('fr-FR'); }

async function bindExport(app) {
  const runBtn = app.querySelector('#export-run');
  const msg = app.querySelector('#export-msg');
  const list = app.querySelector('#export-list');
  if (!runBtn) return;

  function say(t) { msg.style.display = 'block'; msg.textContent = t; }

  async function refresh() {
    let j;
    try { j = await (await fetch('/api/export')).json(); } catch { return; }
    const items = (j && j.exports) || [];
    if (!items.length) { list.innerHTML = ''; return; }
    list.innerHTML = items.map(e => {
      const etat = e.revoque ? 'Révoqué' : (e.expire ? 'Lien expiré' : `Valable jusqu’au ${fdatetime(e.expire_le)}`);
      const dl = e.telecharge_le ? ` · téléchargé le ${fdate(e.telecharge_le)}` : '';
      const ko = Math.max(1, Math.round((e.taille || 0) / 1024));
      const actions = e.expire ? '' :
        `<a class="btn btn-ghost btn-sm" href="/export/${encodeURIComponent(e.token)}/telecharger">${icon('download', 13)} Télécharger</a> ` +
        `<button type="button" class="btn btn-ghost btn-sm" data-export-revoke="${esc(e.token)}">${icon('trash', 13)} Révoquer</button>`;
      return `<div style="padding:11px 0;border-top:1px solid var(--border,#eee)">
        <div><strong>Export du ${fdate(e.cree_le)}</strong></div>
        <div class="muted" style="font-size:13px;margin:2px 0 8px">${e.nb_tables} tables · ${e.nb_lignes} lignes · ${ko} Ko · ${esc(etat)}${dl}</div>
        <div>${actions}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-export-revoke]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Révoquer ce lien ? Il ne sera plus téléchargeable.')) return;
      await fetch(`/api/export/${b.dataset.exportRevoke}/revoquer`, { method: 'POST' });
      refresh();
    }));
  }

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true; const t0 = runBtn.textContent; runBtn.textContent = 'Création…';
    try {
      // La route POST /api/export répond via withKeepAlive (espaces + JSON) → on parse le texte.
      const txt = await (await fetch('/api/export', { method: 'POST' })).text();
      const j = JSON.parse(txt);
      if (j.ok) say(`Export prêt : ${j.stats.tables} tables, ${j.stats.lignes} lignes. Le lien est valable 24 h.`);
      else say(`Échec : ${j.error || 'inconnu'}`);
    } catch (e) { say(`Échec : ${e.message}`); }
    runBtn.disabled = false; runBtn.textContent = t0; refresh();
  });

  refresh();
}
