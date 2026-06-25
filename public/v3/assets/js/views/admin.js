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
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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

    <!-- Sprint v4 — Gestion des accès utilisateurs -->
    <div class="section-header" style="margin-top:32px">
      <h2 class="section-title">Utilisateurs (${icon('user', 14)} accès cockpit)</h2>
      <button class="btn btn-primary btn-sm" id="btn-new-user">${icon('plus', 14)} Nouveau compte</button>
    </div>
    <div id="users-output">
      <div class="card"><p class="muted">${icon('clock', 14)} Chargement…</p></div>
    </div>

    <!-- Devis express (P-H1) — grille éco-participation éditable -->
    <div class="section-header" style="margin-top:32px">
      <h2 class="section-title">Grille éco-participation</h2>
      <button class="btn btn-primary btn-sm" id="btn-add-ecopart">${icon('plus', 14)} Ajouter une catégorie</button>
    </div>
    <div id="ecopart-output">
      <div class="card"><p class="muted">${icon('clock', 14)} Chargement…</p></div>
    </div>

    <!-- Devis express (P-H3) — grille des coefficients de marge par fournisseur -->
    <div class="section-header" style="margin-top:32px">
      <h2 class="section-title">Marges fournisseurs (Devis express)</h2>
      <button class="btn btn-primary btn-sm" id="btn-add-marge">${icon('plus', 14)} Ajouter un fournisseur</button>
    </div>
    <div id="marges-output">
      <div class="card"><p class="muted">${icon('clock', 14)} Chargement…</p></div>
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
  document.getElementById('btn-new-user').addEventListener('click', () => openModalNouveauUser());
  document.getElementById('btn-add-ecopart').addEventListener('click', addEcopart);
  document.getElementById('btn-add-marge').addEventListener('click', addMarge);
  loadUsers();
  loadEcopart();
  loadMargesFournisseurs();
}

// === Devis express (P-H1) — grille éco-participation =========================
async function loadEcopart() {
  const out = document.getElementById('ecopart-output');
  if (!out) return;
  try {
    const r = await fetch('/api/data/eco-participation', { credentials: 'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    renderEcopart(out, d.records || []);
  } catch (e) {
    out.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(e.message)}</p></div>`;
  }
}

function renderEcopart(out, records) {
  const rows = records.slice().sort((a, b) =>
    String(a.fields?.['Catégorie'] || '').localeCompare(String(b.fields?.['Catégorie'] || '')));
  out.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-bottom:10px">Montant éco-participation HT appliqué par défaut dans le Devis express, par catégorie de produit. Modifie un montant puis « Enregistrer ».</p>
      <table class="pipeline-table">
        <thead><tr><th>Catégorie</th><th class="num">Montant HT</th><th>Actif</th><th></th></tr></thead>
        <tbody>
          ${rows.length === 0 ? '<tr><td colspan="4" class="muted">Aucune catégorie. Ajoute-en une.</td></tr>' : rows.map(rec => {
            const f = rec.fields || {};
            return `
            <tr data-id="${esc(rec.id)}">
              <td><input class="eco-cat" value="${esc(f['Catégorie'] || '')}" style="width:100%"></td>
              <td class="num"><input class="eco-montant" type="number" step="0.01" min="0" value="${f['Montant HT'] ?? 0}" style="width:90px;text-align:right"> €</td>
              <td><input class="eco-actif" type="checkbox" ${f['Actif'] ? 'checked' : ''}></td>
              <td style="display:flex;gap:4px">
                <button class="btn btn-ghost btn-sm" data-action="eco-save" data-id="${esc(rec.id)}">${icon('check', 12)} Enregistrer</button>
                <button class="btn btn-ghost btn-sm" data-action="eco-del" data-id="${esc(rec.id)}" style="color:var(--accent)">${icon('trash', 12)}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  hydrateIcons(out);
  out.querySelectorAll('[data-action="eco-save"]').forEach(b => b.addEventListener('click', () => saveEcopart(b.dataset.id)));
  out.querySelectorAll('[data-action="eco-del"]').forEach(b => b.addEventListener('click', () => delEcopart(b.dataset.id)));
}

async function saveEcopart(id) {
  const tr = document.querySelector(`#ecopart-output tr[data-id="${id}"]`);
  if (!tr) return;
  const fields = {
    'Catégorie': tr.querySelector('.eco-cat').value.trim(),
    'Montant HT': Number(tr.querySelector('.eco-montant').value) || 0,
    'Actif': tr.querySelector('.eco-actif').checked,
  };
  try {
    const r = await fetch(`/api/data/eco-participation/${encodeURIComponent(id)}`, {
      method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    toast('Éco-participation enregistrée', 'success');
  } catch (e) { toast('Erreur : ' + e.message, 'error', 5000); }
}

async function delEcopart(id) {
  if (!confirm('Supprimer cette ligne de la grille éco-participation ?')) return;
  try {
    const r = await fetch(`/api/data/eco-participation/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    toast('Ligne supprimée', 'success');
    loadEcopart();
  } catch (e) { toast('Erreur : ' + e.message, 'error', 5000); }
}

async function addEcopart() {
  try {
    const r = await fetch('/api/data/eco-participation', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'Catégorie': 'Nouvelle catégorie', 'Montant HT': 0, 'Actif': true } }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    loadEcopart();
  } catch (e) { toast('Erreur : ' + e.message, 'error', 5000); }
}

// === Devis express (P-H3) — grille des coefficients de marge par fournisseur ==
async function loadMargesFournisseurs() {
  const out = document.getElementById('marges-output');
  if (!out) return;
  try {
    const r = await fetch('/api/data/marges-fournisseurs', { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const d = await r.json();
    renderMarges(out, d.records || []);
  } catch (e) {
    out.innerHTML = `<div class="card"><p class="muted">Grille indisponible (${esc(e.message)}). La table « Marges fournisseurs » n'est peut-être pas encore créée.</p></div>`;
  }
}

function renderMarges(out, records) {
  const rows = records.slice().sort((a, b) =>
    String(a.fields?.['Fournisseur'] || '').localeCompare(String(b.fields?.['Fournisseur'] || '')));
  out.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-bottom:10px">Coefficient appliqué au <strong>total net du devis fournisseur</strong> pour obtenir le prix client HT (ex. ×2). Le devis express associe le coefficient au fournisseur détecté. Modifie une valeur puis « Enregistrer ».</p>
      <table class="pipeline-table">
        <thead><tr><th>Fournisseur</th><th class="num">Coefficient (×)</th><th>Actif</th><th></th></tr></thead>
        <tbody>
          ${rows.length === 0 ? '<tr><td colspan="4" class="muted">Aucun fournisseur. Ajoutes-en un.</td></tr>' : rows.map(rec => {
            const f = rec.fields || {};
            return `
            <tr data-id="${esc(rec.id)}">
              <td><input class="marge-four" value="${esc(f['Fournisseur'] || '')}" style="width:100%"></td>
              <td class="num"><input class="marge-coef" type="number" step="0.01" min="0" value="${f['Coefficient'] ?? ''}" placeholder="ex. 2" style="width:90px;text-align:right"></td>
              <td><input class="marge-actif" type="checkbox" ${f['Actif'] ? 'checked' : ''}></td>
              <td style="display:flex;gap:4px">
                <button class="btn btn-ghost btn-sm" data-action="marge-save" data-id="${esc(rec.id)}">${icon('check', 12)} Enregistrer</button>
                <button class="btn btn-ghost btn-sm" data-action="marge-del" data-id="${esc(rec.id)}" style="color:var(--accent)">${icon('trash', 12)}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  hydrateIcons(out);
  out.querySelectorAll('[data-action="marge-save"]').forEach(b => b.addEventListener('click', () => saveMarge(b.dataset.id)));
  out.querySelectorAll('[data-action="marge-del"]').forEach(b => b.addEventListener('click', () => delMarge(b.dataset.id)));
}

async function saveMarge(id) {
  const tr = document.querySelector(`#marges-output tr[data-id="${id}"]`);
  if (!tr) return;
  const coefRaw = tr.querySelector('.marge-coef').value;
  const fields = {
    'Fournisseur': tr.querySelector('.marge-four').value.trim(),
    'Coefficient': coefRaw === '' ? null : (Number(coefRaw) || 0),
    'Actif': tr.querySelector('.marge-actif').checked,
  };
  try {
    const r = await fetch(`/api/data/marges-fournisseurs/${encodeURIComponent(id)}`, {
      method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    toast('Marge fournisseur enregistrée', 'success');
  } catch (e) { toast('Erreur : ' + e.message, 'error', 5000); }
}

async function delMarge(id) {
  if (!confirm('Supprimer ce fournisseur de la grille des marges ?')) return;
  try {
    const r = await fetch(`/api/data/marges-fournisseurs/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    toast('Fournisseur supprimé', 'success');
    loadMargesFournisseurs();
  } catch (e) { toast('Erreur : ' + e.message, 'error', 5000); }
}

async function addMarge() {
  try {
    const r = await fetch('/api/data/marges-fournisseurs', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'Fournisseur': 'Nouveau fournisseur', 'Coefficient': null, 'Actif': true } }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    loadMargesFournisseurs();
  } catch (e) { toast('Erreur : ' + e.message, 'error', 5000); }
}

// === Sprint v4 — Gestion des accès utilisateurs ============================
async function loadUsers() {
  const out = document.getElementById('users-output');
  try {
    const r = await fetch('/api/admin/users', { credentials: 'same-origin' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || r.statusText);
    }
    const { users } = await r.json();
    renderUsers(out, users);
  } catch (err) {
    out.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`;
  }
}

function renderUsers(container, users) {
  if (!users.length) {
    container.innerHTML = `<div class="card"><p class="muted">Aucun utilisateur. Crée le premier via « Nouveau compte ».</p></div>`;
    return;
  }
  // Tri : admin d'abord, puis actifs alphabétiques, puis désactivés
  users.sort((a, b) => {
    if (a.admin !== b.admin) return a.admin ? -1 : 1;
    if (a.actif !== b.actif) return a.actif ? -1 : 1;
    return a.login.localeCompare(b.login);
  });
  container.innerHTML = `
    <table class="pipeline-table">
      <thead>
        <tr>
          <th>Login</th>
          <th>Display name</th>
          <th>Email</th>
          <th>Rôle</th>
          <th>Statut</th>
          <th>Source</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
        <tr data-id="${esc(u.id || '')}" data-login="${esc(u.login)}">
          <td><strong>${esc(u.login)}</strong></td>
          <td>${esc(u.displayName || '—')}</td>
          <td>${esc(u.email || '—')}</td>
          <td>${u.admin ? `<span class="badge phase-signe">${icon('star', 11)} Admin</span>` : '<span class="muted">Membre</span>'}</td>
          <td>${u.actif ? '<span class="badge phase-signe">Actif</span>' : '<span class="badge" style="background:var(--accent-lo);color:var(--accent)">Désactivé</span>'}</td>
          <td class="muted" style="font-size:11px">${esc(u.source)}</td>
          <td>
            ${u.source === 'airtable' ? `
              <button class="btn btn-ghost btn-sm" data-action="edit-user" data-id="${esc(u.id)}">${icon('edit', 12)}</button>
              <button class="btn btn-ghost btn-sm" data-action="reset-user" data-id="${esc(u.id)}" title="Reset mot de passe">${icon('mail', 12)}</button>
              ${u.actif ? `<button class="btn btn-ghost btn-sm" data-action="disable-user" data-id="${esc(u.id)}" data-login="${esc(u.login)}" style="color:var(--accent)" title="Désactiver">${icon('trash', 12)}</button>` : ''}
            ` : '<span class="muted" style="font-size:11px">via env</span>'}
          </td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  hydrateIcons(container);
  container.querySelectorAll('[data-action="edit-user"]').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const u = users.find(x => x.id === b.dataset.id);
      if (u) openModalEditUser(u);
    });
  });
  container.querySelectorAll('[data-action="reset-user"]').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const u = users.find(x => x.id === b.dataset.id);
      if (u) openModalResetPassword(u);
    });
  });
  container.querySelectorAll('[data-action="disable-user"]').forEach(b => {
    b.addEventListener('click', async e => {
      e.stopPropagation();
      const login = b.dataset.login;
      if (!confirm(`Désactiver le compte ${login} ? Il ne pourra plus se connecter.`)) return;
      try {
        const r = await fetch(`/api/admin/users/${encodeURIComponent(b.dataset.id)}/disable`, {
          method: 'POST', credentials: 'same-origin',
        });
        if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || r.statusText); }
        toast(`Compte ${login} désactivé`, 'success');
        loadUsers();
      } catch (err) {
        toast('Erreur : ' + err.message, 'error', 5000);
      }
    });
  });
}

function openModalNouveauUser() {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-user-title">
      <h2 id="new-user-title">Nouveau compte utilisateur</h2>
      <p class="muted" style="margin-bottom:12px">Crée un accès au cockpit pour un nouveau collaborateur.</p>
      <form id="form-new-user">
        <label>Login (court, lowercase, sans espace)
          <input name="login" required pattern="[a-z0-9._-]{3,32}" placeholder="ex : marie, jean.dupont">
        </label>
        <label>Display name (affiché dans le cockpit)
          <input name="displayName" required placeholder="ex : Marie Dupont">
        </label>
        <label>Email professionnel
          <input name="email" type="email" required placeholder="ex : marie@tanguydesign.com">
        </label>
        <label>Mot de passe initial (min 8 caractères, à communiquer au user)
          <input name="password" type="text" required minlength="8" placeholder="Génère un mot de passe fort">
          <small class="muted">Le user pourra changer son mot de passe à la 1re connexion (TODO).</small>
        </label>
        <label style="display:flex;align-items:center;gap:8px;flex-direction:row">
          <input name="admin" type="checkbox">
          <span>Admin (accès Marges, Stock, Gestion users)</span>
        </label>
        <label>Notes (optionnel)
          <textarea name="notes" rows="2" placeholder="ex : Pose chantier, arrive en mars"></textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-new-user">Annuler</button>
          <button type="submit" class="btn btn-primary">Créer le compte</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('cancel-new-user').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.getElementById('form-new-user').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      login: fd.get('login'),
      displayName: fd.get('displayName'),
      email: fd.get('email'),
      password: fd.get('password'),
      admin: fd.get('admin') === 'on',
      notes: fd.get('notes') || '',
    };
    try {
      const r = await fetch('/api/admin/users', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const er = await r.json().catch(()=>({})); throw new Error(er.error || r.statusText); }
      toast(`Compte ${payload.login} créé`, 'success');
      close();
      loadUsers();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}

function openModalEditUser(u) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Éditer ${esc(u.login)}</h2>
      <form id="form-edit-user">
        <label>Display name <input name="displayName" value="${esc(u.displayName || '')}" required></label>
        <label>Email <input name="email" type="email" value="${esc(u.email || '')}"></label>
        <label style="display:flex;align-items:center;gap:8px;flex-direction:row">
          <input name="admin" type="checkbox" ${u.admin ? 'checked' : ''}>
          <span>Admin (accès Marges, Stock, Gestion users)</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;flex-direction:row">
          <input name="actif" type="checkbox" ${u.actif ? 'checked' : ''}>
          <span>Compte actif</span>
        </label>
        <label>Notes <textarea name="notes" rows="2"></textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-edit-user">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('cancel-edit-user').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.getElementById('form-edit-user').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      displayName: fd.get('displayName'),
      email: fd.get('email'),
      admin: fd.get('admin') === 'on',
      actif: fd.get('actif') === 'on',
      notes: fd.get('notes') || '',
    };
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const er = await r.json().catch(()=>({})); throw new Error(er.error || r.statusText); }
      toast(`${u.login} mis à jour`, 'success');
      close();
      loadUsers();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}

function openModalResetPassword(u) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Reset mot de passe ${esc(u.login)}</h2>
      <p class="muted" style="margin-bottom:12px">Le nouveau mot de passe sera affiché ici. Communique-le au user en privé (chat sécurisé, papier remis en main propre).</p>
      <form id="form-reset-pwd">
        <label>Nouveau mot de passe (≥ 8 caractères)
          <input name="newPassword" type="text" required minlength="8" autofocus>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-reset">Annuler</button>
          <button type="submit" class="btn btn-primary">Reset</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('cancel-reset').onclick = close;
  document.getElementById('form-reset-pwd').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}/reset-password`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: fd.get('newPassword') }),
      });
      if (!r.ok) { const er = await r.json().catch(()=>({})); throw new Error(er.error || r.statusText); }
      toast(`Mot de passe reset pour ${u.login}`, 'success', 6000);
      close();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
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
