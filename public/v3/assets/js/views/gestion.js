// Gestion v5 — Automatisation Virginie (2026-06)
// 4 onglets : Facturation clients · Achats fournisseurs · Trésorerie · RH.
// Admin only (même garde que admin.js) — les routes API sont elles-mêmes requireAdmin.

import { state } from '../core/state.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';
import { navigateTo } from '../core/router.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function euros(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function eurosCents(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, j] = String(d).slice(0, 10).split('-');
  return `${j}/${m}/${y}`;
}
function moisCourant() {
  return new Date().toISOString().slice(0, 7);
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

function modalShell(title, bodyHtml) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${bodyHtml}</div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  return { modal, close };
}

const TABS = [
  { key: 'facturation', label: 'Facturation', icon: 'file' },
  { key: 'achats', label: 'Achats', icon: 'building' },
  { key: 'tresorerie', label: 'Trésorerie', icon: 'landmark' },
  { key: 'rh', label: 'RH', icon: 'users' },
];

export function renderGestion(app, tab = 'facturation') {
  if (!state.isAdmin) {
    app.innerHTML = `<div class="card"><h2>Accès réservé</h2><p class="muted">La gestion (facturation, achats, trésorerie, RH) est réservée aux administrateurs.</p></div>`;
    return;
  }
  if (!TABS.some(t => t.key === tab)) tab = 'facturation';

  app.innerHTML = `
    <h1 class="page-title">Gestion</h1>
    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
      ${TABS.map(t => `
        <button class="btn ${t.key === tab ? 'btn-primary' : 'btn-ghost'} btn-sm" data-gtab="${t.key}">
          ${icon(t.icon, 14)} ${t.label}
        </button>`).join('')}
    </div>
    <div id="gestion-body"><div class="loading">Chargement…</div></div>
  `;
  hydrateIcons(app);
  app.querySelectorAll('[data-gtab]').forEach(b => {
    b.addEventListener('click', () => navigateTo(`gestion/${b.dataset.gtab}`));
  });

  const body = document.getElementById('gestion-body');
  if (tab === 'facturation') return renderFacturation(body);
  if (tab === 'achats') return renderAchats(body);
  if (tab === 'tresorerie') return renderTresorerie(body);
  if (tab === 'rh') return renderRH(body);
}

// ════════════════════════════════════════════════════════════════════════════
// Onglet Facturation — impayés + relances, échéances à facturer, encaissements
// ════════════════════════════════════════════════════════════════════════════

async function renderFacturation(body) {
  try {
    const [imp, all] = await Promise.all([
      api('/api/factures-clients/impayes'),
      api('/api/data/factures-clients'),
    ]);
    const factures = (all.records || []).map(r => ({ id: r.id, ...r.fields }))
      .sort((a, b) => String(b['Date émission'] || '').localeCompare(String(a['Date émission'] || '')));
    const totalImpaye = imp.impayes.reduce((s, f) => s + f.montantRestant, 0);

    body.innerHTML = `
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card"${imp.impayes.length ? ' style="background:var(--accent-lo)"' : ''}>
          <div class="kpi-value">${imp.impayes.length}</div><div class="kpi-label">Factures en retard</div>
        </div>
        <div class="kpi-card"><div class="kpi-value">${euros(totalImpaye)}</div><div class="kpi-label">Montant impayé</div></div>
        <div class="kpi-card"><div class="kpi-value">${imp.echeancesAFacturer.length}</div><div class="kpi-label">Échéances à facturer</div></div>
        <div class="kpi-card"><div class="kpi-value">${factures.length}</div><div class="kpi-label">Factures émises</div></div>
      </div>

      ${imp.impayes.length ? `
      <div class="section-header"><h2 class="section-title">Impayés — relances</h2></div>
      <table class="pipeline-table" style="margin-bottom:24px">
        <thead><tr><th>Facture</th><th>Client</th><th>Échéance</th><th class="num">Restant dû</th><th class="num">Retard</th><th>Relances</th><th></th></tr></thead>
        <tbody>
          ${imp.impayes.map(f => `
          <tr>
            <td><strong>${esc(f.numero)}</strong></td>
            <td>${esc(f.clientNom)}</td>
            <td>${fmtDate(f.dateEcheance)}</td>
            <td class="num" style="color:var(--accent);font-weight:600">${eurosCents(f.montantRestant)}</td>
            <td class="num">${f.joursRetard} j</td>
            <td>${f.niveauRelance ? `R${f.niveauRelance} le ${fmtDate(f.dateDerniereRelance)}` : '<span class="muted">aucune</span>'}</td>
            <td style="display:flex;gap:4px">
              <button class="btn btn-primary btn-sm" data-action="relancer" data-id="${esc(f.id)}" data-niveau="${f.relance.niveau}">${icon('mail', 12)} Relancer (R${f.relance.niveau})</button>
              <button class="btn btn-ghost btn-sm" data-action="encaisser" data-id="${esc(f.id)}" data-restant="${f.montantRestant}" title="Enregistrer un règlement">${icon('check', 12)}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div class="card" style="margin-bottom:24px"><p class="muted">${icon('check', 14)} Aucune facture en retard de paiement.</p></div>`}

      ${imp.echeancesAFacturer.length ? `
      <div class="section-header"><h2 class="section-title">Échéances en retard à facturer</h2></div>
      <table class="pipeline-table" style="margin-bottom:24px">
        <thead><tr><th>Échéance</th><th>Date prévue</th><th class="num">Montant</th><th class="num">Retard</th><th></th></tr></thead>
        <tbody>
          ${imp.echeancesAFacturer.map(e => `
          <tr>
            <td>${esc(e.libelle)}</td>
            <td>${fmtDate(e.datePrevue)}</td>
            <td class="num">${eurosCents(e.montant)}</td>
            <td class="num">${e.joursRetard} j</td>
            <td><button class="btn btn-primary btn-sm" data-action="facturer-echeance" data-id="${esc(e.id)}">${icon('plus', 12)} Créer la facture</button></td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}

      <div class="section-header"><h2 class="section-title">Toutes les factures clients</h2></div>
      ${factures.length ? `
      <table class="pipeline-table">
        <thead><tr><th>Numéro</th><th>Client</th><th>Type</th><th>Émise le</th><th>Échéance</th><th class="num">TTC</th><th class="num">Réglé</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${factures.map(f => {
            const restant = Math.max(0, (Number(f['Montant TTC']) || 0) - (Number(f['Montant réglé']) || 0));
            // P-G — nom du client en clair (« pour quel client ») résolu depuis le lien Airtable.
            const clientNom = (state.clients || []).find(c => c.id === (f['Client'] || [])[0])?.Nom || '—';
            return `
          <tr>
            <td><strong>${esc(f['Numéro'] || '?')}</strong></td>
            <td>${esc(clientNom)}</td>
            <td>${esc(f['Type'] || '—')}</td>
            <td>${fmtDate(f['Date émission'])}</td>
            <td>${fmtDate(f['Date échéance'])}</td>
            <td class="num">${eurosCents(f['Montant TTC'])}</td>
            <td class="num">${eurosCents(f['Montant réglé'] || 0)}</td>
            <td><span class="badge">${esc(f['Statut'] || '?')}</span></td>
            <td style="display:flex;gap:4px">
              ${f['Statut'] === 'Brouillon' ? `<button class="btn btn-ghost btn-sm" data-action="marquer-envoyee" data-id="${esc(f.id)}">${icon('mail', 12)} Envoyée</button>` : ''}
              ${!['Payée', 'Annulée'].includes(f['Statut']) && restant > 0 ? `<button class="btn btn-ghost btn-sm" data-action="encaisser" data-id="${esc(f.id)}" data-restant="${restant}">${icon('check', 12)} Encaisser</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-action="supprimer-fc" data-id="${esc(f.id)}" data-num="${esc(f['Numéro'] || '?')}" style="color:var(--accent)" title="Supprimer la facture">${icon('trash', 12)}</button>
            </td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="card"><p class="muted">Aucune facture émise. Les factures se créent depuis les échéances de devis (fiche projet ou liste ci-dessus).</p></div>`}
    `;
    hydrateIcons(body);

    body.querySelectorAll('[data-action="relancer"]').forEach(b => b.addEventListener('click', async () => {
      try {
        const j = await api(`/api/factures-clients/${encodeURIComponent(b.dataset.id)}/relance`, { method: 'POST', body: JSON.stringify({ niveau: Number(b.dataset.niveau) }) });
        toast(`Relance R${j.niveau} enregistrée — email prêt`, 'success');
        location.href = j.mailto; // ouvre le client mail (souverain, pas de SMTP)
        setTimeout(() => renderFacturation(body), 1200);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    body.querySelectorAll('[data-action="facturer-echeance"]').forEach(b => b.addEventListener('click', async () => {
      try {
        const j = await api('/api/factures-clients/from-echeance', { method: 'POST', body: JSON.stringify({ echeanceId: b.dataset.id }) });
        toast(`Facture ${j.facture['Numéro']} créée (brouillon)`, 'success');
        renderFacturation(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    body.querySelectorAll('[data-action="marquer-envoyee"]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api(`/api/data/factures-clients/${encodeURIComponent(b.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'Statut': 'Envoyée' } }) });
        toast('Facture marquée envoyée', 'success');
        renderFacturation(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    body.querySelectorAll('[data-action="encaisser"]').forEach(b => b.addEventListener('click', () => openModalEncaissement(b.dataset.id, Number(b.dataset.restant), () => renderFacturation(body))));
    body.querySelectorAll('[data-action="supprimer-fc"]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmModal(`Supprimer définitivement la facture ${b.dataset.num} ? Cette action est irréversible.`, { okLabel: 'Supprimer', danger: true });
      if (!ok) return;
      try {
        await api(`/api/data/factures-clients/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' });
        toast('Facture supprimée', 'success');
        renderFacturation(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
  } catch (err) {
    body.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`;
  }
}

function openModalEncaissement(factureId, restant, onDone) {
  const { close } = modalShell('Enregistrer un règlement', `
    <form id="form-encaissement">
      <label>Montant reçu (€) <input name="montant" type="number" step="0.01" min="0.01" value="${restant.toFixed(2)}" required></label>
      <label>Mode de règlement
        <select name="mode">
          <option>Virement</option><option>Chèque</option><option>CB</option><option>Espèces</option><option>Financement</option>
        </select>
      </label>
      <label>Date <input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Encaisser</button>
      </div>
    </form>
  `);
  document.querySelector('#form-encaissement [data-cancel]').onclick = close;
  document.getElementById('form-encaissement').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const j = await api(`/api/factures-clients/${encodeURIComponent(factureId)}/reglement`, {
        method: 'POST',
        body: JSON.stringify({ montant: Number(fd.get('montant')), mode: fd.get('mode'), date: fd.get('date') }),
      });
      toast(`Règlement enregistré — ${j.statut}`, 'success');
      close();
      onDone();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Onglet Achats — import facture IA, contrôle, règlements, litiges, retards
// ════════════════════════════════════════════════════════════════════════════

const FF_WORKFLOW = { 'À contrôler': 'Validée', 'Validée': 'À payer' };

async function renderAchats(body) {
  try {
    const [all, regl, retards] = await Promise.all([
      api('/api/data/factures-fournisseurs'),
      api('/api/reglements/a-preparer'),
      api('/api/commandes-retards'),
    ]);
    const factures = (all.records || []).map(r => ({ id: r.id, ...r.fields }))
      .sort((a, b) => String(b['Date facture'] || '').localeCompare(String(a['Date facture'] || '')));
    const litiges = factures.filter(f => ['Litige', 'Avoir demandé'].includes(f['Statut']));
    const semaines = Object.keys(regl.parSemaine || {}).sort();

    body.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Factures fournisseurs</h2>
        <button class="btn btn-primary btn-sm" id="btn-import-ff">${icon('plus', 14)} Importer une facture (PDF)</button>
      </div>
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card"><div class="kpi-value">${factures.filter(f => f['Statut'] === 'À contrôler').length}</div><div class="kpi-label">À contrôler</div></div>
        <div class="kpi-card"><div class="kpi-value">${euros(regl.total)}</div><div class="kpi-label">À régler</div></div>
        <div class="kpi-card"${litiges.length ? ' style="background:var(--accent-lo)"' : ''}><div class="kpi-value">${litiges.length}</div><div class="kpi-label">Litiges / avoirs</div></div>
        <div class="kpi-card"${retards.retards.length ? ' style="background:var(--accent-lo)"' : ''}><div class="kpi-value">${retards.retards.length}</div><div class="kpi-label">Livraisons en retard</div></div>
      </div>
      <div id="import-ff-output"></div>

      ${semaines.length ? `
      <div class="section-header"><h2 class="section-title">Règlements à préparer (par semaine d'échéance)</h2></div>
      ${semaines.map(sem => {
        const g = regl.parSemaine[sem];
        return `
        <div class="card" style="margin-bottom:12px">
          <h3 class="card-title">${sem === 'sans-date' ? 'Sans date d\'échéance' : 'Semaine du ' + fmtDate(sem)} — <strong>${eurosCents(g.total)}</strong></h3>
          <table class="pipeline-table">
            <thead><tr><th>Facture</th><th>Fournisseur</th><th>Échéance</th><th class="num">TTC</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              ${g.factures.map(f => `
              <tr${f.enRetard ? ' style="background:var(--accent-lo)"' : ''}>
                <td><strong>${esc(f.numero)}</strong></td>
                <td>${esc(f.fournisseur)}</td>
                <td>${fmtDate(f.dateEcheance)}${f.enRetard ? ' ⟵ échue' : ''}</td>
                <td class="num">${eurosCents(f.montantTTC)}</td>
                <td><span class="badge">${esc(f.statut)}</span></td>
                <td><button class="btn btn-primary btn-sm" data-action="payer-ff" data-id="${esc(f.id)}">${icon('check', 12)} Payée</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      }).join('')}` : `<div class="card" style="margin-bottom:16px"><p class="muted">${icon('check', 14)} Aucun règlement fournisseur en attente.</p></div>`}

      ${retards.retards.length ? `
      <div class="section-header"><h2 class="section-title">Commandes en retard de livraison</h2></div>
      <table class="pipeline-table" style="margin-bottom:24px">
        <thead><tr><th>Commande</th><th>Fournisseur</th><th>Projet</th><th>Livraison prévue</th><th class="num">Retard</th><th></th></tr></thead>
        <tbody>
          ${retards.retards.map(c => `
          <tr>
            <td><strong>${esc(c.numero)}</strong> ${c.type ? `<span class="muted">${esc(c.type)}</span>` : ''}</td>
            <td>${esc(c.fournisseur)}</td>
            <td>${esc(c.projetRef || '—')}</td>
            <td>${fmtDate(c.dateLivraisonPrevue)}</td>
            <td class="num" style="color:var(--accent);font-weight:600">${c.joursRetard} j</td>
            <td><a class="btn btn-primary btn-sm" href="${esc(c.relance.mailto)}">${icon('mail', 12)} Relancer</a></td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}

      <div class="section-header"><h2 class="section-title">Toutes les factures fournisseurs</h2></div>
      ${factures.length ? `
      <table class="pipeline-table">
        <thead><tr><th>Numéro</th><th>Date</th><th>Échéance</th><th class="num">HT</th><th class="num">TTC</th><th class="num">Écart</th><th>Pointée</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${factures.map(f => `
          <tr>
            <td><strong>${esc(f['Numéro'] || '?')}</strong>${f['Contrôle'] ? ` <span title="${esc(f['Contrôle'])}">${icon('search', 12)}</span>` : ''}</td>
            <td>${fmtDate(f['Date facture'])}</td>
            <td>${fmtDate(f['Date échéance'])}</td>
            <td class="num">${eurosCents(f['Montant HT'])}</td>
            <td class="num">${eurosCents(f['Montant TTC'])}</td>
            <td class="num"${Math.abs(Number(f['Écart']) || 0) >= 1 ? ' style="color:var(--accent);font-weight:600"' : ''}>${f['Écart'] != null ? eurosCents(f['Écart']) : '—'}</td>
            <td><input type="checkbox" data-action="pointer-ff" data-id="${esc(f.id)}" ${f['Pointée relevé'] ? 'checked' : ''} title="Pointée sur le relevé"></td>
            <td><span class="badge">${esc(f['Statut'] || '?')}</span></td>
            <td style="display:flex;gap:4px">
              ${FF_WORKFLOW[f['Statut']] ? `<button class="btn btn-ghost btn-sm" data-action="avancer-ff" data-id="${esc(f.id)}" data-next="${esc(FF_WORKFLOW[f['Statut']])}">${icon('arrowRight', 12)} ${esc(FF_WORKFLOW[f['Statut']])}</button>` : ''}
              ${!['Payée', 'Litige', 'Avoir demandé', 'Avoir reçu'].includes(f['Statut']) ? `<button class="btn btn-ghost btn-sm" data-action="litige-ff" data-id="${esc(f.id)}" style="color:var(--accent)" title="Déclarer un litige / demander un avoir">${icon('alert', 12)}</button>` : ''}
              ${f['Statut'] === 'Avoir demandé' ? `<button class="btn btn-ghost btn-sm" data-action="avoir-recu-ff" data-id="${esc(f.id)}">${icon('check', 12)} Avoir reçu</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-action="supprimer-ff" data-id="${esc(f.id)}" data-num="${esc(f['Numéro'] || '?')}" style="color:var(--accent)" title="Supprimer la facture">${icon('trash', 12)}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div class="card"><p class="muted">Aucune facture fournisseur saisie. Utilise « Importer une facture (PDF) » : Claude lit le PDF, rapproche la commande et contrôle les montants.</p></div>`}
    `;
    hydrateIcons(body);

    document.getElementById('btn-import-ff').addEventListener('click', () => openModalImportFF(() => renderAchats(body)));
    body.querySelectorAll('[data-action="payer-ff"]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmModal('Marquer cette facture comme payée ?', { okLabel: 'Payée' });
      if (!ok) return;
      try {
        await api(`/api/factures-fournisseurs/${encodeURIComponent(b.dataset.id)}/payer`, { method: 'POST', body: JSON.stringify({}) });
        toast('Facture marquée payée', 'success');
        renderAchats(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    body.querySelectorAll('[data-action="avancer-ff"]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api(`/api/data/factures-fournisseurs/${encodeURIComponent(b.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'Statut': b.dataset.next } }) });
        toast(`Statut → ${b.dataset.next}`, 'success');
        renderAchats(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    body.querySelectorAll('[data-action="litige-ff"]').forEach(b => b.addEventListener('click', () => openModalLitige(b.dataset.id, () => renderAchats(body))));
    body.querySelectorAll('[data-action="avoir-recu-ff"]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api(`/api/data/factures-fournisseurs/${encodeURIComponent(b.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'Statut': 'Avoir reçu' } }) });
        toast('Avoir reçu enregistré', 'success');
        renderAchats(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    body.querySelectorAll('[data-action="pointer-ff"]').forEach(cb => cb.addEventListener('change', async () => {
      try {
        await api(`/api/data/factures-fournisseurs/${encodeURIComponent(cb.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'Pointée relevé': cb.checked } }) });
        toast(cb.checked ? 'Facture pointée' : 'Pointage retiré', 'success', 1500);
      } catch (err) {
        cb.checked = !cb.checked;
        toast('Erreur : ' + err.message, 'error', 5000);
      }
    }));
    body.querySelectorAll('[data-action="supprimer-ff"]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmModal(`Supprimer définitivement la facture fournisseur ${b.dataset.num} ? Cette action est irréversible.`, { okLabel: 'Supprimer', danger: true });
      if (!ok) return;
      try {
        await api(`/api/data/factures-fournisseurs/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' });
        toast('Facture supprimée', 'success');
        renderAchats(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
  } catch (err) {
    body.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`;
  }
}

function openModalImportFF(onDone) {
  const { close } = modalShell('Importer une facture fournisseur', `
    <p class="muted" style="margin-bottom:12px">Claude lit le PDF (30-90 s), rapproche automatiquement le fournisseur et la commande (référence BC / contremarque) et contrôle les montants.</p>
    <form id="form-import-ff">
      <label>Facture PDF <input name="pdf" type="file" accept="application/pdf" required></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Importer et contrôler</button>
      </div>
    </form>
  `);
  document.querySelector('#form-import-ff [data-cancel]').onclick = close;
  document.getElementById('form-import-ff').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Analyse en cours… (30-90 s)';
    const fd = new FormData();
    fd.append('pdf', e.target.pdf.files[0]);
    try {
      // withKeepAlive côté serveur : toujours HTTP 200, check j.error (cf. importDevisClient)
      const r = await fetch('/api/factures-fournisseurs/import', { method: 'POST', credentials: 'same-origin', body: fd });
      if (!r.ok) { const er = await r.json().catch(() => ({})); throw new Error(er.error || r.statusText); }
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      toast(`Facture ${j.facture['Numéro']} importée`, 'success');
      const out = document.getElementById('import-ff-output');
      if (out) {
        out.innerHTML = `<div class="card" style="margin-bottom:16px"><h3 class="card-title">Contrôle automatique — ${esc(j.facture['Numéro'])}</h3>
          <ul style="padding-left:20px;line-height:1.7">${(j.controles || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          ${j.alertes ? `<p style="color:var(--accent)"><strong>Alertes parsing :</strong> ${esc(j.alertes)}</p>` : ''}</div>`;
      }
      close();
      onDone();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Importer et contrôler';
      toast('Erreur : ' + err.message, 'error', 6000);
    }
  });
}

function openModalLitige(factureId, onDone) {
  const { close } = modalShell('Litige / demande d\'avoir', `
    <form id="form-litige">
      <label>Type
        <select name="statut"><option value="Litige">Litige (montant ou marchandise contesté)</option><option value="Avoir demandé">Avoir demandé</option></select>
      </label>
      <label>Motif (ajouté aux notes) <textarea name="motif" rows="3" required placeholder="ex : 2 façades rayées à la réception, avoir demandé le …"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);
  document.querySelector('#form-litige [data-cancel]').onclick = close;
  document.getElementById('form-litige').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const cur = await api(`/api/data/factures-fournisseurs`);
      const rec = (cur.records || []).find(r => r.id === factureId);
      const notes = (rec?.fields?.['Notes'] ? rec.fields['Notes'] + '\n' : '') + `[${new Date().toISOString().slice(0, 10)}] ${fd.get('statut')} : ${fd.get('motif')}`;
      await api(`/api/data/factures-fournisseurs/${encodeURIComponent(factureId)}`, {
        method: 'PATCH', body: JSON.stringify({ fields: { 'Statut': fd.get('statut'), 'Notes': notes } }),
      });
      toast('Litige enregistré', 'success');
      close();
      onDone();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Onglet Trésorerie — plan hebdo + export expert-comptable
// ════════════════════════════════════════════════════════════════════════════

async function renderTresorerie(body) {
  try {
    const [plan, retro] = await Promise.all([
      api('/api/tresorerie/plan'),
      api('/api/retro-apporteurs').catch(() => ({ rows: [], totaux: { nbDossiers: 0, caHT: 0, retro: 0 }, taux: 0.03 })),
    ]);
    const retardIn = plan.enRetard.encaissements;
    const retardOut = plan.enRetard.decaissements;
    const tauxPct = ((retro.taux ?? 0.03) * 100).toLocaleString('fr-FR');

    body.innerHTML = `
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card"><div class="kpi-value" style="color:var(--green)">${euros(plan.totaux.encaissements)}</div><div class="kpi-label">Encaissements prévus (12 sem.)</div></div>
        <div class="kpi-card"><div class="kpi-value" style="color:var(--accent)">${euros(plan.totaux.decaissements)}</div><div class="kpi-label">Décaissements prévus</div></div>
        <div class="kpi-card"><div class="kpi-value"${plan.totaux.solde < 0 ? ' style="color:var(--accent)"' : ''}>${euros(plan.totaux.solde)}</div><div class="kpi-label">Solde prévisionnel</div></div>
        <div class="kpi-card"${retardIn ? ' style="background:var(--accent-lo)"' : ''}><div class="kpi-value">${euros(retardIn)}</div><div class="kpi-label">Encaissements en retard</div></div>
      </div>

      <div class="section-header"><h2 class="section-title">Plan de trésorerie — 12 semaines</h2></div>
      <table class="pipeline-table" style="margin-bottom:8px">
        <thead><tr><th>Semaine du</th><th class="num">Encaissements</th><th class="num">Décaissements</th><th class="num">Solde</th><th class="num">Cumul</th><th>Détail</th></tr></thead>
        <tbody>
          ${plan.semaines.map((s, i) => `
          <tr${s.soldeCumule < 0 ? ' style="background:var(--accent-lo)"' : ''}>
            <td><strong>${fmtDate(s.semaine)}</strong>${i === 0 ? ' <span class="muted">(courante)</span>' : ''}</td>
            <td class="num" style="color:var(--green)">${s.encaissements ? '+' + euros(s.encaissements) : '—'}</td>
            <td class="num" style="color:var(--accent)">${s.decaissements ? '−' + euros(s.decaissements) : '—'}</td>
            <td class="num">${euros(s.solde)}</td>
            <td class="num" style="font-weight:600${s.soldeCumule < 0 ? ';color:var(--accent)' : ''}">${euros(s.soldeCumule)}</td>
            <td>${[...s.entrees, ...s.sorties].length ? `<details><summary class="muted" style="cursor:pointer">${s.entrees.length + s.sorties.length} mouvement${s.entrees.length + s.sorties.length > 1 ? 's' : ''}</summary>
              <ul style="padding-left:18px;font-size:12px;line-height:1.6">
                ${s.entrees.map(e => `<li style="color:var(--green)">+ ${eurosCents(e.montant)} — ${esc(e.label)}</li>`).join('')}
                ${s.sorties.map(o => `<li style="color:var(--accent)">− ${eurosCents(o.montant)} — ${esc(o.label)}</li>`).join('')}
              </ul></details>` : '<span class="muted">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted" style="font-size:12px;margin-bottom:24px">
        ${retardIn || retardOut ? `En retard (avant cette semaine) : +${euros(retardIn)} à encaisser / −${euros(retardOut)} à payer — inclus dans les totaux. ` : ''}
        ${plan.sansDate.encaissements || plan.sansDate.decaissements ? `Sans date : +${euros(plan.sansDate.encaissements)} / −${euros(plan.sansDate.decaissements)} (hors plan). ` : ''}
        ${plan.plusTard.encaissements || plan.plusTard.decaissements ? `Au-delà de 12 sem. : +${euros(plan.plusTard.encaissements)} / −${euros(plan.plusTard.decaissements)}.` : ''}
      </p>

      <div class="section-header"><h2 class="section-title">Rétrocession apporteur — Solène (${tauxPct} %)</h2></div>
      <p class="muted" style="margin-top:-8px;margin-bottom:12px">Assiette = CA HT des projets signés des clients dont l'apporteur est Solène.</p>
      ${retro.rows.length ? `
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card"><div class="kpi-value">${retro.totaux.nbDossiers}</div><div class="kpi-label">Dossiers signés apportés</div></div>
        <div class="kpi-card"><div class="kpi-value">${euros(retro.totaux.caHT)}</div><div class="kpi-label">CA HT apporté</div></div>
        <div class="kpi-card"><div class="kpi-value" style="color:var(--accent)">${euros(retro.totaux.retro)}</div><div class="kpi-label">Rétro ${tauxPct} % à reverser</div></div>
      </div>
      <table class="pipeline-table" style="margin-bottom:8px">
        <thead><tr><th>Apporteur</th><th class="num">Dossiers signés</th><th class="num">CA HT apporté</th><th class="num">Rétro ${tauxPct} %</th></tr></thead>
        <tbody>
          ${retro.rows.map(r => `
          <tr>
            <td><strong>${esc(r.apporteur)}</strong></td>
            <td class="num">${r.nbDossiers}</td>
            <td class="num">${euros(r.caHT)}</td>
            <td class="num" style="font-weight:600;color:var(--accent)">${euros(r.retro)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted" style="font-size:12px;margin-bottom:24px">Périmètre : projets signés uniquement, ${tauxPct} % du CA HT (Σ Budget HT) des dossiers dont le client a cet apporteur.</p>
      ` : `<div class="card" style="margin-bottom:24px"><p class="muted">Aucun dossier signé rattaché à un apporteur d'affaires pour le moment. Renseignez l'apporteur sur la fiche client.</p></div>`}

      <div class="section-header"><h2 class="section-title">Export expert-comptable</h2></div>
      <div class="card">
        <p class="muted" style="margin-bottom:12px">Exporte les pièces du mois (factures clients + fournisseurs) en CSV Excel : numéro, tiers, dates, HT/TVA/TTC, règlements.</p>
        <form id="form-export-compta" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input name="mois" type="month" value="${moisCourant()}" required>
          <button type="submit" class="btn btn-primary btn-sm">${icon('file', 14)} Télécharger le CSV</button>
        </form>
      </div>
    `;
    hydrateIcons(body);
    document.getElementById('form-export-compta').addEventListener('submit', e => {
      e.preventDefault();
      const mois = new FormData(e.target).get('mois');
      location.href = `/api/tresorerie/export-compta?mois=${encodeURIComponent(mois)}`;
      toast('Export en cours de téléchargement', 'success');
    });
  } catch (err) {
    body.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Onglet RH — salariés, absences, heures, paie
// ════════════════════════════════════════════════════════════════════════════

// D'où viennent les droits RTT d'un salarié : un droit annuel, des heures
// supplémentaires converties, ou les deux. Sans ça, « 2 j / 2 » ne dit pas si
// ces jours sont acquis d'office ou payés par des heures faites.
function origineRtt(cg) {
  const bouts = [];
  if (cg.rttAnnuel) bouts.push(`${cg.rttAnnuel} j acquis`);
  if (cg.rttConverti) bouts.push(`${cg.rttConverti} j depuis ${cg.heuresSuppValidees} h supp`);
  const attente = cg.heuresSuppEnAttente
    ? ` · ${cg.heuresSuppEnAttente} h en attente de validation` : '';
  if (!bouts.length && !attente) return '';
  const acquis = bouts.join(' + ');
  const enAttente = attente
    ? `<span class="rtt-attente" title="Heures supplémentaires saisies mais pas encore validées : elles ne comptent pas tant qu'elles ne le sont pas.">${cg.heuresSuppEnAttente} h à valider</span>`
    : '';
  // Sans droits acquis, on n'affiche pas de tiret devant les heures en attente :
  // « 0 j / 0 — 10 h à valider » se lit mal.
  const texte = [acquis ? esc(acquis) : '', enAttente].filter(Boolean).join(' · ');
  return `<div class="muted rtt-origine">${texte}</div>`;
}

async function renderRH(body) {
  try {
    const [sal, alertes, conges] = await Promise.all([
      api('/api/data/salaries'),
      api('/api/rh/alertes'),
      api('/api/rh/conges'),
    ]);
    // Compteurs de congés RECALCULÉS (acquis − posés distincts) — cf. services/conges-helper.
    // Le champ Airtable « Solde congés » n'est plus affiché nulle part : il ne
    // faisait que descendre et affichait des valeurs négatives sans signification.
    const parSalarie = new Map((conges.compteurs || []).map(c => [c.salarieId, c]));
    const limites = [...new Set((conges.compteurs || []).flatMap(c => c.limites || []))];
    const salaries = (sal.records || []).map(r => ({ id: r.id, ...r.fields }))
      .sort((a, b) => String(a['Nom'] || '').localeCompare(String(b['Nom'] || '')));
    const actifs = salaries.filter(s => s['Actif']);

    body.innerHTML = `
      ${alertes.visites.length || alertes.absencesAValider.length || (alertes.heuresAValider || []).length ? `
      <div class="card" style="background:var(--accent-lo);margin-bottom:16px">
        <h3 class="card-title">Alertes RH</h3>
        <ul style="padding-left:20px;line-height:1.8">
          ${alertes.visites.map(v => `<li><strong>${esc(v.nom)}</strong> — visite médicale ${v.statut === 'Dépassée' ? `<strong style="color:var(--accent)">dépassée</strong> depuis le` : 'à planifier avant le'} ${fmtDate(v.date)}</li>`).join('')}
          ${alertes.absencesAValider.map(a => `<li><strong>${esc(a.libelle)}</strong> (${a.jours || '?'} j) —
            <button class="btn btn-primary btn-sm" data-action="decider-absence" data-id="${esc(a.id)}" data-decision="Validée">Valider</button>
            <button class="btn btn-ghost btn-sm" data-action="decider-absence" data-id="${esc(a.id)}" data-decision="Refusée">Refuser</button></li>`).join('')}
          ${(alertes.heuresAValider || []).map(h => `<li><strong>${esc(h.libelle)}</strong> — ${h.heuresSupp} h supp à valider
            <button class="btn btn-primary btn-sm" data-action="valider-heures" data-id="${esc(h.id)}">Valider</button>
            <span class="muted" title="Une fois validées, ces heures se convertissent en RTT sur la fiche du salarié (si « Heures pour 1 RTT » est réglé)">→ RTT</span></li>`).join('')}
        </ul>
      </div>` : ''}

      <div class="section-header">
        <h2 class="section-title">Salariés (${actifs.length} actif${actifs.length > 1 ? 's' : ''})</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="btn-new-absence">${icon('calendar', 14)} Déclarer une absence</button>
          <button class="btn btn-ghost btn-sm" id="btn-new-heures">${icon('clock', 14)} Saisir des heures</button>
          <button class="btn btn-primary btn-sm" id="btn-new-salarie">${icon('plus', 14)} Nouveau salarié</button>
        </div>
      </div>
      ${salaries.length ? `
      <div class="table-scroll" style="margin-bottom:24px">
      <table class="pipeline-table">
        <thead><tr><th>Nom</th><th>Poste</th><th>Contrat</th>
          <th class="num" title="Droits ouverts : congés acquis sur l'année de référence précédente, donc disponibles aujourd'hui">Droits</th>
          <th class="num" title="Jours ouvrables posés depuis le 1er juin, comptés une seule fois même si deux absences se recouvrent">Posés</th>
          <th class="num" title="Droits ouverts moins jours posés">Solde</th>
          <th class="num" title="Se constitue pour l'année prochaine — disponible au 1er juin suivant">En cours</th>
          <th class="num" title="Solde RTT. Vide si le salarié n'a pas de RTT — se règle sur sa fiche.">RTT</th>
          <th>Visite médicale</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          ${salaries.map(s => { const cg = parSalarie.get(s.id); return `
          <tr>
            <td><strong>${esc(s['Nom'] || '?')}</strong></td>
            <td>${esc(s['Poste'] || '—')}</td>
            <td>${esc(s['Type contrat'] || '—')}</td>
            <td class="num">${cg ? cg.droitsOuverts + ' j' : '—'}${cg && cg.entreeInconnue ? ' <span class="muted" title="Date d\'entrée inconnue : année pleine supposée">?</span>' : ''}</td>
            <td class="num">${cg ? cg.poses + ' j' : '—'}${cg && cg.aVenir ? ` <span class="muted" title="dont ${cg.aVenir} j encore à venir">(dont ${cg.aVenir} à venir)</span>` : ''}</td>
            <td class="num">${cg ? `<strong${cg.depassement ? ' style="color:var(--accent)"' : ''}>${cg.solde} j</strong>` : '—'}</td>
            <td class="num muted">+${cg ? cg.enAcquisition : 0} j</td>
            <td class="num">${!cg ? '—'
              : cg.rttDroits !== null
                ? `<strong${cg.rttDepassement ? ' style="color:var(--accent)"' : ''}>${cg.rttSolde} j</strong>
                   <span class="muted">/ ${cg.rttDroits}</span>${origineRtt(cg)}`
                : (cg.rttPoses
                    ? `<span class="muted" title="${cg.rttPoses} jour(s) posés, mais aucun droit RTT n'est réglé sur la fiche">${cg.rttPoses} j posés ?</span>`
                    : '<span class="muted" title="Pas de RTT pour ce salarié. Se règle sur sa fiche.">—</span>')}</td>
            <td>${fmtDate(s['Prochaine visite médicale'])}</td>
            <td>${s['Actif'] ? '<span class="badge phase-signe">Actif</span>' : '<span class="muted">Sorti</span>'}</td>
            <td><button class="btn btn-ghost btn-sm" data-action="edit-salarie" data-id="${esc(s.id)}">${icon('edit', 12)}</button></td>
          </tr>`; }).join('')}
        </tbody>
      </table>
      </div>
      <div class="card" style="margin-bottom:24px">
        <p class="muted" style="margin:0 0 6px">
          <strong>Congés payés — période ${esc(conges.periode ? conges.periode.libelle : '')}.</strong>
          Compteur recalculé à chaque affichage, plus jamais stocké.
          Les <strong>droits</strong> sont ceux acquis sur l'année précédente
          (${esc(conges.compteurs && conges.compteurs[0] ? conges.compteurs[0].periodePrecedente.libelle : '')}) :
          ce sont eux qu'on consomme aujourd'hui, à raison de 2,5 jours <em>ouvrables</em> par mois
          travaillé, samedi compris, plafond 30. Les <strong>posés</strong> sont les jours ouvrables
          d'absence depuis le 1<sup>er</sup> juin, hors jours fériés — un même jour couvert par deux
          absences ne compte qu'une fois. La colonne <strong>en cours</strong> est ce qui se constitue
          pour l'an prochain.
          <strong>Les droits de chacun se règlent sur sa fiche</strong> (crayon en bout de ligne) :
          jours de congés par an, jours de RTT, et report de l'an dernier.
        </p>
        ${limites.length ? `<ul class="muted" style="margin:6px 0 0;padding-left:18px;line-height:1.7">
          ${limites.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        <p class="muted" style="margin:8px 0 0;font-size:12px">
          Le calcul compte des mois calendaires complets et ne modélise pas l'effet des arrêts
          maladie sur l'acquisition, ni une convention collective plus favorable — à valider en paie.
        </p>
      </div>` : `<div class="card" style="margin-bottom:24px"><p class="muted">Aucun salarié. Crée les dossiers du personnel via « Nouveau salarié ».</p></div>`}

      <div class="section-header"><h2 class="section-title">Éléments de paie</h2></div>
      <div class="card">
        <p class="muted" style="margin-bottom:12px">Récapitulatif mensuel par salarié : heures normales / supp (relevés hebdo), congés, maladie. Export CSV à transmettre pour la paie.</p>
        <form id="form-paie" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input name="mois" type="month" value="${moisCourant()}" required>
          <button type="submit" class="btn btn-ghost btn-sm">${icon('search', 14)} Afficher</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-paie-csv">${icon('file', 14)} Export CSV</button>
        </form>
        <div id="paie-output" style="margin-top:12px"></div>
      </div>
    `;
    hydrateIcons(body);

    body.querySelectorAll('[data-action="decider-absence"]').forEach(b => b.addEventListener('click', async () => {
      try {
        const j = await api(`/api/rh/absences/${encodeURIComponent(b.dataset.id)}/decision`, { method: 'POST', body: JSON.stringify({ decision: b.dataset.decision }) });
        toast(`Absence ${j.decision.toLowerCase()} — compteurs de congés remis à jour`, 'success');
        renderRH(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    body.querySelectorAll('[data-action="valider-heures"]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api(`/api/rh/heures/${encodeURIComponent(b.dataset.id)}/valider`, { method: 'POST', body: JSON.stringify({ valide: true }) });
        toast('Heures validées — RTT du salarié remis à jour', 'success');
        renderRH(body);
      } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
    }));
    document.getElementById('btn-new-salarie').addEventListener('click', () => openModalSalarie(null, () => renderRH(body)));
    body.querySelectorAll('[data-action="edit-salarie"]').forEach(b => b.addEventListener('click', () => {
      const s = salaries.find(x => x.id === b.dataset.id);
      if (s) openModalSalarie(s, () => renderRH(body));
    }));
    document.getElementById('btn-new-absence').addEventListener('click', () => openModalAbsence(actifs, () => renderRH(body)));
    document.getElementById('btn-new-heures').addEventListener('click', () => openModalHeures(actifs, state.projets || [], () => renderRH(body)));

    const formPaie = document.getElementById('form-paie');
    formPaie.addEventListener('submit', async e => {
      e.preventDefault();
      const mois = new FormData(formPaie).get('mois');
      const out = document.getElementById('paie-output');
      out.innerHTML = '<p class="muted">Calcul…</p>';
      try {
        const j = await api(`/api/rh/paie?mois=${encodeURIComponent(mois)}`);
        out.innerHTML = j.recap.length ? `
          <div class="table-scroll"><table class="pipeline-table">
            <thead><tr><th>Salarié</th><th class="num">H. normales</th><th class="num">H. supp</th><th class="num">Congés/RTT (j)</th><th class="num">Maladie (j)</th><th class="num">Autres (j)</th></tr></thead>
            <tbody>${j.recap.map(r => `
              <tr><td><strong>${esc(r.nom)}</strong> <span class="muted">${esc(r.poste)}</span></td>
              <td class="num">${r.heuresNormales}</td><td class="num">${r.heuresSupp}</td>
              <td class="num">${r.congesPris}</td><td class="num">${r.maladie}</td><td class="num">${r.autresAbsences}</td></tr>`).join('')}
            </tbody>
          </table></div>` : '<p class="muted">Aucun salarié actif.</p>';
      } catch (err) { out.innerHTML = `<p class="muted">Erreur : ${esc(err.message)}</p>`; }
    });
    document.getElementById('btn-paie-csv').addEventListener('click', () => {
      const mois = new FormData(formPaie).get('mois');
      location.href = `/api/rh/paie?mois=${encodeURIComponent(mois)}&format=csv`;
      toast('Export paie en cours de téléchargement', 'success');
    });
  } catch (err) {
    body.innerHTML = `<div class="card"><p class="muted">Erreur : ${esc(err.message)}</p></div>`;
  }
}

function openModalSalarie(s, onDone) {
  const isNew = !s;
  const { close } = modalShell(isNew ? 'Nouveau salarié' : `Éditer ${s['Nom']}`, `
    <form id="form-salarie">
      <label>Nom complet <input name="Nom" value="${esc(s?.['Nom'] || '')}" required></label>
      <label>Poste <input name="Poste" value="${esc(s?.['Poste'] || '')}"></label>
      <label>Email <input name="Email" type="email" value="${esc(s?.['Email'] || '')}"></label>
      <label>Téléphone <input name="Téléphone" value="${esc(s?.['Téléphone'] || '')}"></label>
      <label>Type de contrat
        <select name="Type contrat">${['CDI', 'CDD', 'Alternance', 'Stage', 'Indépendant'].map(t => `<option${(s?.['Type contrat'] || 'CDI') === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
      </label>
      <label>Date d'entrée <input name="Date entrée" type="date" value="${esc(s?.['Date entrée'] || '')}"></label>

      <fieldset class="fs-conges">
        <legend>Congés de ce salarié</legend>
        <p class="muted" style="margin:0 0 10px;font-size:12px">
          Le solde ne se saisit plus : il se calcule à partir de ces réglages, de la date
          d'entrée et des absences validées. <strong>Tout laisser vide donne le minimum
          légal</strong> : 30 jours ouvrables de congés payés, et pas de RTT.
        </p>
        <label>Jours de congés payés par an
          <input name="Jours CP par an" type="text" inputmode="decimal" autocomplete="off" placeholder="30 par défaut"
                 value="${s?.['Jours CP par an'] ?? ''}">
          <span class="muted">En jours <strong>ouvrables</strong> (samedi compris). 30 = minimum légal ;
            mettre plus si la convention collective est plus favorable.</span>
        </label>
        <label>Jours de RTT par an
          <input name="Jours RTT par an" type="text" inputmode="decimal" autocomplete="off" placeholder="aucun"
                 value="${s?.['Jours RTT par an'] ?? ''}">
          <span class="muted">En jours <strong>ouvrés</strong> (du lundi au vendredi).
            <strong>Laisser vide si ce salarié n'a pas de RTT</strong> — son compteur RTT n'apparaîtra pas.</span>
        </label>
        <label>Heures supplémentaires pour 1 RTT
          <input name="Heures pour 1 RTT" type="text" inputmode="decimal" autocomplete="off" placeholder="aucune conversion"
                 value="${s?.['Heures pour 1 RTT'] ?? ''}">
          <span class="muted">Pour un salarié qui <strong>cumule des heures supplémentaires et les
            transforme en RTT</strong> (alternance, par exemple) : indiquer combien d'heures valent
            un jour, par exemple 7. Seules les heures <strong>validées</strong> sont converties.
            Vide = pas de conversion.</span>
        </label>
        <label>Congés reportés de l'an dernier
          <input name="Report CP" type="text" inputmode="decimal" autocomplete="off" placeholder="0"
                 value="${s?.['Report CP'] ?? ''}">
          <span class="muted">Le reliquat repris du bulletin de paie. S'ajoute aux droits ouverts.</span>
        </label>
      </fieldset>
      <label>Dernière visite médicale <input name="Dernière visite médicale" type="date" value="${esc(s?.['Dernière visite médicale'] || '')}"></label>
      <label>Prochaine visite médicale <input name="Prochaine visite médicale" type="date" value="${esc(s?.['Prochaine visite médicale'] || '')}"></label>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row">
        <input name="Actif" type="checkbox" ${isNew || s?.['Actif'] ? 'checked' : ''}><span>Salarié actif</span>
      </label>
      <label>Notes <textarea name="Notes" rows="2">${esc(s?.['Notes'] || '')}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Créer' : 'Enregistrer'}</button>
      </div>
    </form>
  `);
  document.querySelector('#form-salarie [data-cancel]').onclick = close;
  document.getElementById('form-salarie').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const k of ['Nom', 'Poste', 'Email', 'Téléphone', 'Type contrat', 'Date entrée', 'Dernière visite médicale', 'Prochaine visite médicale', 'Notes']) {
      const v = fd.get(k);
      if (v) fields[k] = v;
    }
    // Paramètres de congés : nombres, et un champ VIDÉ doit être effacé en base
    // (null) — sinon on ne pourrait jamais revenir au comportement par défaut.
    for (const k of ['Jours CP par an', 'Jours RTT par an', 'Report CP', 'Heures pour 1 RTT']) {
      const brut = String(fd.get(k) ?? '').trim();
      if (brut === '') { fields[k] = null; continue; }
      // La virgule décimale française est acceptée : « 32,5 » comme « 32.5 ».
      // (Un input type=number l'aurait rejetée en rendant une valeur vide, donc
      // en EFFAÇANT le réglage sans un mot.)
      const n = Number(brut.replace(',', '.'));
      if (!isFinite(n) || n < 0) {
        toast(`« ${k} » : indiquer un nombre de jours (ex. 30 ou 32,5), ou laisser vide.`, 'error', 6000);
        return;
      }
      fields[k] = n;
    }
    fields['Actif'] = fd.get('Actif') === 'on';
    try {
      if (isNew) await api('/api/data/salaries', { method: 'POST', body: JSON.stringify({ fields }) });
      else await api(`/api/data/salaries/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
      toast(isNew ? 'Salarié créé' : 'Salarié mis à jour', 'success');
      close();
      onDone();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

function openModalAbsence(salaries, onDone) {
  const { close } = modalShell('Déclarer une absence', `
    <form id="form-absence">
      <label>Salarié
        <select name="salarieId" required>${salaries.map(s => `<option value="${esc(s.id)}">${esc(s['Nom'])}</option>`).join('')}</select>
      </label>
      <label>Type
        <select name="type">${['Congés payés', 'RTT', 'Maladie', 'Sans solde', 'Événement familial', 'Autre'].map(t => `<option>${t}</option>`).join('')}</select>
      </label>
      <label>Du <input name="dateDebut" type="date" required></label>
      <label>Au (inclus) <input name="dateFin" type="date"></label>
      <label>Jours (laisser vide = calcul auto des jours ouvrés) <input name="jours" type="number" step="0.5" min="0.5" placeholder="auto"></label>
      <label>Notes <textarea name="notes" rows="2" placeholder="ex : arrêt reçu, certificat à classer"></textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Déclarer</button>
      </div>
    </form>
  `);
  document.querySelector('#form-absence [data-cancel]').onclick = close;
  document.getElementById('form-absence').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/rh/absences', {
        method: 'POST',
        body: JSON.stringify({
          salarieId: fd.get('salarieId'), type: fd.get('type'),
          dateDebut: fd.get('dateDebut'), dateFin: fd.get('dateFin') || null,
          jours: fd.get('jours') ? Number(fd.get('jours')) : null, notes: fd.get('notes') || '',
        }),
      });
      toast('Absence déclarée (à valider dans les alertes RH)', 'success');
      close();
      onDone();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}

function openModalHeures(salaries, projets, onDone) {
  const semaineDefaut = new Date().toISOString().slice(0, 10);
  const { close } = modalShell('Saisir les heures de la semaine', `
    <p class="muted" style="margin-bottom:12px">Un relevé par salarié et par semaine (la date est ramenée au lundi). Re-saisir écrase le relevé existant.</p>
    <form id="form-heures">
      <label>Salarié
        <select name="salarieId" required>${salaries.map(s => `<option value="${esc(s.id)}">${esc(s['Nom'])}</option>`).join('')}</select>
      </label>
      <label>Semaine (n'importe quel jour de la semaine) <input name="semaine" type="date" value="${semaineDefaut}" required></label>
      <label>Heures normales <input name="heuresNormales" type="number" step="0.5" min="0" value="35" required></label>
      <label>Heures supplémentaires <input name="heuresSupp" type="number" step="0.5" min="0" value="0"></label>
      <label>Chantier principal (optionnel)
        <select name="projetId"><option value="">—</option>${projets.map(p => `<option value="${esc(p.id)}">${esc(p['Référence'] || p.id)}</option>`).join('')}</select>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);
  document.querySelector('#form-heures [data-cancel]').onclick = close;
  document.getElementById('form-heures').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const j = await api('/api/rh/heures', {
        method: 'POST',
        body: JSON.stringify({
          salarieId: fd.get('salarieId'), semaine: fd.get('semaine'),
          heuresNormales: Number(fd.get('heuresNormales')) || 0, heuresSupp: Number(fd.get('heuresSupp')) || 0,
          projetId: fd.get('projetId') || null,
        }),
      });
      toast(j.updated ? 'Relevé de la semaine mis à jour' : 'Heures enregistrées', 'success');
      close();
      onDone();
    } catch (err) { toast('Erreur : ' + err.message, 'error', 5000); }
  });
}
