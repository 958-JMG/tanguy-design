// Vue Commande v3 (Sprint v3.1) — BC complet imprimable + édition lignes structurées.
// Format calé sur les BC PDF type Tanguy (cf. /Type de bon de commande/Attachments-BONS COMMANDES MORALES.zip).

import { navigateTo, router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `${r.status}`);
  }
  return r.json();
}

export async function renderCommande(app, cmdId) {
  app.innerHTML = `<div class="loading">Chargement du bon de commande…</div>`;
  try {
    const [detail, render] = await Promise.all([
      api(`/api/commandes/${cmdId}`),
      api(`/api/commandes/${cmdId}/render`),
    ]);
    drawCommande(app, detail, render.html, cmdId);
  } catch (e) {
    app.innerHTML = `<div class="card"><h2>Erreur</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

function drawCommande(app, detail, html, cmdId) {
  const { commande, projet, client, fournisseur, lignes } = detail;
  const cf = commande.fields || {};
  const projetId = (cf.Projet || [])[0];
  const clientName = client?.fields?.Nom || cf.Contremarque || '';

  app.innerHTML = `
    <nav class="breadcrumb">
      <a href="#clients">Clients</a> &rsaquo;
      ${client ? `<a href="#clients/${encodeURIComponent(client.id)}">${esc(clientName)}</a> &rsaquo;` : ''}
      ${projetId ? `<a href="#projet/${encodeURIComponent(projetId)}">${esc(projet?.fields?.Référence || 'Projet')}</a> &rsaquo;` : ''}
      <strong>${esc(cf.Numéro || '(sans numéro)')}</strong>
    </nav>

    <div class="page-header">
      <div>
        <h1 class="page-title" style="margin-bottom:4px">${esc(cf.Numéro || '(sans numéro)')}</h1>
        <div class="muted">
          ${esc(cf['Référence courte'] || '?')}
          ${fournisseur ? ` · Fournisseur : <strong>${esc(fournisseur.fields?.Nom || '?')}</strong>` : ' · <em>Fournisseur non rattaché</em>'}
          · ${esc(cf.Type || 'Type inconnu')}
          · Statut : <strong>${esc(cf.Statut || '?')}</strong>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" id="btn-edit-meta">${icon('edit', 14)} Méta</button>
        <button class="btn btn-ghost" id="btn-edit-lignes">${icon('edit', 14)} Lignes</button>
        <button class="btn btn-ghost" id="btn-print">${icon('file', 14)} Imprimer</button>
        <button class="btn btn-primary" id="btn-mail">${icon('mail', 14)} Envoyer mail</button>
        <button class="btn btn-ghost" id="btn-delete" style="color:var(--accent)" aria-label="Supprimer la commande">${icon('trash', 14)} Supprimer</button>
      </div>
    </div>

    <div class="bc-render-frame">
      ${html}
    </div>
  `;

  hydrateIcons(app);

  document.getElementById('btn-edit-meta').addEventListener('click', () => openMetaEditor(commande, fournisseur, () => renderCommande(app, cmdId)));
  document.getElementById('btn-edit-lignes').addEventListener('click', () => openLignesEditor(cmdId, lignes, () => renderCommande(app, cmdId)));
  document.getElementById('btn-print').addEventListener('click', () => doPrint(html));
  document.getElementById('btn-mail').addEventListener('click', () => doMail(commande, fournisseur, lignes));
  document.getElementById('btn-delete').addEventListener('click', () => deleteCommande(cmdId, cf, projetId));
}

// Sprint v3.4 — suppression d'une commande (admin only via ACL).
// Cas d'usage : JMG signale 2026-05-21 qu'il doit pouvoir annuler les BC générés
// à une signature erronée pour pouvoir re-signer proprement.
async function deleteCommande(cmdId, cf, projetId) {
  const num = cf['Numéro'] || cmdId;
  const ok = await confirmModal(
    `Supprimer définitivement la commande "${num}" ?\n\nCette action est irréversible. Les lignes BC stockées dans le record sont perdues. Le devis lié n'est pas affecté.`,
    { okLabel: 'Supprimer', danger: true }
  );
  if (!ok) return;
  try {
    const r = await fetch(`/api/data/commandes/${cmdId}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || r.statusText);
    }
    toast(`Commande ${num} supprimée`, 'success');
    if (projetId) location.hash = '#projet/' + projetId;
    else location.hash = '#dashboard';
  } catch (err) {
    toast('Erreur suppression : ' + err.message, 'error', 7000);
  }
}

function doPrint(html) {
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) { toast('Bloqueur de popups empêche l\'impression. Autorise les popups pour /v3/', 'error', 5000); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>Bon de commande</title></head><body>${html}<script>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

function doMail(commande, fournisseur, lignes) {
  const cf = commande.fields || {};
  const email = fournisseur?.fields?.Email || '';
  const subject = `Commande ${cf.Numéro || ''} — ${cf.Contremarque || ''}`.trim();

  const lines = [];
  lines.push(`Bonjour,`);
  lines.push('');
  lines.push(`Veuillez trouver ci-dessous notre commande ${cf.Numéro} pour le chantier ${cf.Contremarque || ''}.`);
  if (cf['Livraison semaine']) lines.push(`Livraison souhaitée : ${cf['Livraison semaine']}.`);
  lines.push('');
  if (cf['Modèle choisi']) {
    lines.push(`Choix du modèle :`);
    lines.push(cf['Modèle choisi']);
    lines.push('');
  }
  if (cf['Détails modèle']) {
    lines.push(`Détail :`);
    lines.push(cf['Détails modèle']);
    lines.push('');
  }
  if (Array.isArray(lignes) && lignes.length) {
    const widths = {
      pos: Math.max(3, ...lignes.map(l => String(l.pos || '').length)),
      code: Math.max(4, ...lignes.map(l => String(l.code || '').length)),
      desc: Math.min(50, Math.max(11, ...lignes.map(l => String(l.description || '').length))),
      sens: 4,
      cote: 5,
      qte: 7,
    };
    const pad = (s, n) => String(s).padEnd(n).slice(0, n);
    lines.push(`${pad('Pos', widths.pos)} | ${pad('Code', widths.code)} | ${pad('Description', widths.desc)} | ${pad('SENS', widths.sens)} | ${pad('Cote', widths.cote)} | Qté`);
    lines.push(`${'-'.repeat(widths.pos)}-+-${'-'.repeat(widths.code)}-+-${'-'.repeat(widths.desc)}-+-${'-'.repeat(widths.sens)}-+-${'-'.repeat(widths.cote)}-+-----`);
    for (const l of lignes) {
      const qte = (l.quantite != null ? l.quantite : '') + (l.unite ? ' ' + l.unite : '');
      lines.push(`${pad(l.pos || '', widths.pos)} | ${pad(l.code || '', widths.code)} | ${pad((l.description || '').replace(/\s+/g, ' ').slice(0, 80), widths.desc)} | ${pad(l.sens || '', widths.sens)} | ${pad(l.coteVisible || '', widths.cote)} | ${qte}`);
    }
    lines.push('');
  }
  lines.push(`Livraison à : Tanguy Design, 4 Rue Louis Blériot, ZA Toul Garros, 56400 AURAY (Tél. 02 97 56 28 53).`);
  lines.push('');
  lines.push(`Merci de votre retour.`);
  lines.push(`Cordialement,`);
  lines.push(`${cf['Contact Tanguy'] || 'Solène LORHO'}`);
  lines.push(`Tanguy Design`);

  const body = lines.join('\n');
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  if (mailto.length > 8000) {
    navigator.clipboard.writeText(body).then(() => {
      toast('Mailto trop long, contenu copié dans le presse-papier — colle-le dans ton mail', 'info', 6000);
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;
    });
    return;
  }
  window.location.href = mailto;
}

function openMetaEditor(commande, fournisseur, refresh) {
  const cf = commande.fields || {};
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Méta commande</h2>
      <form id="form-meta">
        <label>Référence courte (code fournisseur sur BC)
          <input name="Référence courte" value="${esc(cf['Référence courte'] || '')}" placeholder="ex : NOVA_CUC, BORA">
        </label>
        <label>Contremarque (nom client visible sur BC)
          <input name="Contremarque" value="${esc(cf.Contremarque || '')}" placeholder="ex : MORALES (M. & Mme MORALES)">
        </label>
        <label>Contact Tanguy
          <select name="Contact Tanguy">
            ${['Solène','Virginie','Sébastien','Marine'].map(v => `<option ${cf['Contact Tanguy'] === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Livraison souhaitée (texte libre)
          <input name="Livraison semaine" value="${esc(cf['Livraison semaine'] || '')}" placeholder="ex : Semaine 04/2025, Avant le 15 juin…">
        </label>
        <label>Statut
          <select name="Statut">
            ${['Créée','Envoyée','Confirmée','Reçue','Annulée'].map(v => `<option ${cf.Statut === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Date livraison prévue
          <input name="Date livraison prévue" type="date" value="${esc(cf['Date livraison prévue'] || '')}">
        </label>
        <label>Modèle choisi (uniquement pour BC meubles)
          <textarea name="Modèle choisi" rows="2" placeholder="Smart (NOVA CUCINA Cuisines) / Porte épaisseur 22 mm">${esc(cf['Modèle choisi'] || '')}</textarea>
        </label>
        <label>Détails modèle (liste finitions, 1 par ligne au format « Clé : Valeur »)
          <textarea name="Détails modèle" rows="8" placeholder="Modularité : Gorge sur socle H.6 cm">${esc(cf['Détails modèle'] || '')}</textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-meta">Annuler</button>
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  document.getElementById('cancel-meta').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function k(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); }
  });
  document.getElementById('form-meta').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) fields[k] = v;
    try {
      await api(`/api/data/commandes/${commande.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields }),
      });
      close();
      toast('Méta enregistrées', 'success');
      refresh();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}

function openLignesEditor(cmdId, lignes, refresh) {
  const current = JSON.parse(JSON.stringify(lignes || []));
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.style.padding = '20px';
  modal.innerHTML = `
    <div class="modal modal-wide" role="dialog" aria-modal="true">
      <h2>Lignes du BC</h2>
      <p class="muted" style="margin-bottom:8px">Modifie les lignes. Enregistre pour persister.</p>
      <div id="lignes-editor"></div>
      <div style="margin-top:12px">
        <button type="button" class="btn btn-ghost btn-sm" id="add-ligne">${icon('plus', 12)} Ajouter une ligne</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-lignes">Annuler</button>
        <button type="button" class="btn btn-primary" id="save-lignes">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  function drawList() {
    const root = document.getElementById('lignes-editor');
    root.innerHTML = `
      <table class="lignes-edit-table">
        <thead>
          <tr>
            <th style="width:60px">Pos</th>
            <th style="width:120px">Code</th>
            <th>Description</th>
            <th style="width:50px">Sens</th>
            <th style="width:50px">Coté</th>
            <th style="width:80px">Qté</th>
            <th style="width:60px">Unité</th>
            <th style="width:36px"></th>
          </tr>
        </thead>
        <tbody>
          ${current.map((l, i) => `
            <tr data-idx="${i}">
              <td><input data-field="pos" value="${esc(l.pos || '')}"></td>
              <td><input data-field="code" value="${esc(l.code || '')}"></td>
              <td><textarea data-field="description" rows="2">${esc(l.description || '')}</textarea></td>
              <td><input data-field="sens" value="${esc(l.sens || '')}" maxlength="2"></td>
              <td><input data-field="coteVisible" value="${esc(l.coteVisible || '')}" maxlength="2"></td>
              <td><input data-field="quantite" type="number" step="0.0001" value="${l.quantite != null ? l.quantite : ''}"></td>
              <td><input data-field="unite" value="${esc(l.unite || '')}" maxlength="5"></td>
              <td><button class="tache-delete" data-action="del">${icon('trash', 12)}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    hydrateIcons(root);
    root.querySelectorAll('tr[data-idx]').forEach(tr => {
      const i = Number(tr.dataset.idx);
      tr.querySelectorAll('[data-field]').forEach(input => {
        input.addEventListener('change', () => {
          const f = input.dataset.field;
          let v = input.value;
          if (f === 'quantite') v = v === '' ? null : Number(v);
          current[i][f] = v;
        });
      });
      tr.querySelector('[data-action="del"]').addEventListener('click', () => {
        current.splice(i, 1);
        drawList();
      });
    });
  }
  drawList();

  document.getElementById('add-ligne').addEventListener('click', () => {
    current.push({ pos: String(current.length + 1), code: '', description: '', sens: '', coteVisible: '', quantite: 1, unite: 'pce' });
    drawList();
  });

  const close = () => modal.remove();
  document.getElementById('cancel-lignes').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.getElementById('save-lignes').addEventListener('click', async () => {
    try {
      await api(`/api/commandes/${cmdId}/lignes`, {
        method: 'PATCH',
        body: JSON.stringify({ lignes: current }),
      });
      close();
      toast(`${current.length} ligne(s) enregistrée(s)`, 'success');
      refresh();
    } catch (err) {
      toast('Erreur : ' + err.message, 'error', 5000);
    }
  });
}
