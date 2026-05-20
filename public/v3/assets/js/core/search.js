// Palette Cmd+K v3 — recherche transverse (Sprint 1 suite)
// Dispatcher pur, pas d'eval() (cf. ADR-002 + Sprint 0.7 P0-3).

import { state } from './state.js';
import { navigateTo } from './router.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const euros = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';

let modal = null;
let results = [];
let idx = 0;

export function openSearch() {
  if (modal) return;
  modal = document.createElement('div');
  modal.className = 'cmdk-bg';
  modal.innerHTML = `
    <div class="cmdk" role="dialog" aria-modal="true" aria-labelledby="cmdk-input">
      <input id="cmdk-input" type="search" placeholder="Rechercher dans tout le cockpit…" aria-label="Recherche globale" autocomplete="off">
      <div id="cmdk-results" class="cmdk-results"></div>
      <div class="cmdk-footer">
        <kbd>↑</kbd><kbd>↓</kbd> naviguer
        <kbd>↵</kbd> ouvrir
        <kbd>esc</kbd> fermer
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const input = document.getElementById('cmdk-input');
  setTimeout(() => input.focus(), 50);

  input.addEventListener('input', () => renderResults(input.value));
  document.addEventListener('keydown', onKeydown);
  modal.addEventListener('click', e => { if (e.target === modal) closeSearch(); });

  renderResults('');
}

function closeSearch() {
  if (!modal) return;
  document.removeEventListener('keydown', onKeydown);
  modal.remove();
  modal = null;
  results = [];
  idx = 0;
}

function onKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(idx + 1, results.length - 1)); }
  if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(Math.max(idx - 1, 0)); }
  if (e.key === 'Enter' && results[idx]) { e.preventDefault(); execute(results[idx]); }
}

function setIdx(n) {
  idx = n;
  document.querySelectorAll('.cmdk-item').forEach((el, i) => el.classList.toggle('on', i === idx));
  const active = document.querySelectorAll('.cmdk-item')[idx];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function renderResults(query) {
  const q = (query || '').trim().toLowerCase();
  const list = [];

  if (q.length >= 1) {
    const tokens = q.split(/\s+/).filter(Boolean);
    const match = txt => { const lo = (txt || '').toLowerCase(); return tokens.every(t => lo.includes(t)); };

    state.clients.forEach(c => {
      const blob = [c.Nom, c.Contact, c.Email, c.Téléphone, c.Adresse].filter(Boolean).join(' ');
      if (match(blob)) list.push({
        type: 'Client',
        label: c.Nom,
        sub: [c.Contact, c.Téléphone, c.Type].filter(Boolean).join(' · '),
        dest: 'client',
        id: c.id,
      });
    });

    state.projets.forEach(p => {
      const blob = [p.Référence, p.Description, p.Statut, p['Phase commerciale'], p['Statut chantier']].filter(Boolean).join(' ');
      if (match(blob)) list.push({
        type: 'Projet',
        label: p.Référence || '(sans référence)',
        sub: [p['Phase commerciale'] || p.Statut, euros(p['Budget HT'])].filter(Boolean).join(' · '),
        dest: 'projet',
        id: p.id,
        clientId: (p.Client || [])[0],
      });
    });
  }

  results = list.slice(0, 30);
  idx = 0;

  const el = document.getElementById('cmdk-results');
  if (!q) {
    el.innerHTML = '<div class="cmdk-empty">Tapez pour rechercher clients, projets, devis…</div>';
    return;
  }
  if (!results.length) {
    el.innerHTML = '<div class="cmdk-empty">Aucun résultat</div>';
    return;
  }
  el.innerHTML = results.map((r, i) => `
    <button class="cmdk-item${i === 0 ? ' on' : ''}" data-idx="${i}">
      <span class="cmdk-type">${r.type}</span>
      <span class="cmdk-label">${esc(r.label)}</span>
      <span class="cmdk-sub">${esc(r.sub || '')}</span>
    </button>
  `).join('');
  el.querySelectorAll('.cmdk-item').forEach(b => {
    b.addEventListener('mouseover', () => setIdx(Number(b.dataset.idx)));
    b.addEventListener('click', () => execute(results[Number(b.dataset.idx)]));
  });
}

// Dispatcher pur : objets structurés { dest, id }, pas de string-eval.
function execute(r) {
  closeSearch();
  switch (r.dest) {
    case 'client': navigateTo('clients', { id: r.id }); break;
    case 'projet': navigateTo('projet',  { id: r.id });  break;
    default: navigateTo('dashboard');
  }
}
