// Vue Commande v3 (Sprint v3.1) — BC complet imprimable + édition lignes structurées.
// Format calé sur les BC PDF type Tanguy (cf. /Type de bon de commande/Attachments-BONS COMMANDES MORALES.zip).

import { navigateTo, router } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';
import { toast, confirmModal } from '../core/ui.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function eurosHT(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' € HT';
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
          ${cf['Montant AR'] != null
            ? ` · AR : <strong>${eurosHT(cf['Montant AR'])}</strong>${cf['Montant HT'] != null ? ` <span class="muted">(estimé ${eurosHT(cf['Montant HT'])})</span>` : ''}`
            : (cf['Montant HT'] != null ? ` · <span class="muted">estimé ${eurosHT(cf['Montant HT'])} — AR non reçu</span>` : '')}
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" id="btn-edit-meta">${icon('edit', 14)} Méta</button>
        <button class="btn btn-ghost" id="btn-edit-lignes">${icon('edit', 14)} Lignes</button>
        <button class="btn btn-primary" id="btn-pdf">${icon('file', 14)} Télécharger PDF</button>
        <button class="btn btn-ghost" id="btn-mail">${icon('mail', 14)} Préparer mail</button>
        <button class="btn btn-ghost" id="btn-print">${icon('file', 14)} Aperçu</button>
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
  document.getElementById('btn-pdf').addEventListener('click', () => doDownloadPdf(cmdId, cf));
  document.getElementById('btn-print').addEventListener('click', () => doPrint(html));
  document.getElementById('btn-mail').addEventListener('click', () => openModalRecapEnvoi(commande, fournisseur));
  document.getElementById('btn-delete').addEventListener('click', () => deleteCommande(cmdId, cf, projetId));
}

// Sprint v3.9 — Téléchargement du PDF propre du BC (généré côté serveur via pdfkit).
async function doDownloadPdf(cmdId, cf) {
  const btn = document.getElementById('btn-pdf');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Génération PDF…';
  try {
    const r = await fetch(`/api/commandes/${encodeURIComponent(cmdId)}/pdf`, { credentials: 'same-origin' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || r.statusText);
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BC_${(cf['Numéro'] || cmdId).replace(/[^a-zA-Z0-9-_.]/g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('PDF téléchargé', 'success');
  } catch (err) {
    toast('Erreur PDF : ' + err.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
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

// Sprint v3.9 — Mail simplifié : juste un corps court d'accompagnement.
// Le détail (tableau lignes, dimensions, modèle) est dans le PDF que JMG joint
// manuellement à son client mail. Plus de tableau ASCII aplati par Gmail.
// #8 — Récap à valider avant l'envoi fournisseur : alertes d'écart + confirmation que
// la commande correspond bien au bon de commande (le BC rendu est visible juste derrière).
function openModalRecapEnvoi(commande, fournisseur) {
  const cf = commande.fields || {};
  const montant = cf['Montant HT'];
  const fournNom = fournisseur?.fields?.Nom || '';
  const fournEmail = fournisseur?.fields?.Email || '';
  const eur = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const alertes = [];
  if (!fournNom) alertes.push("Aucun fournisseur rattaché — vérifie à qui envoyer.");
  if (fournNom && !fournEmail) alertes.push("Le fournisseur n'a pas d'email — l'envoi ne sera pas pré-rempli.");
  if (montant == null || isNaN(montant) || Number(montant) === 0) alertes.push("Montant HT vide ou à 0 — confirme qu'il correspond au BC.");
  if (!cf['Référence courte']) alertes.push("Pas de référence courte (code fournisseur) — souvent attendue sur le BC.");

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Vérifier avant d'envoyer au fournisseur</h2>
      <p class="muted" style="margin-top:0">Compare ce récap au bon de commande (affiché derrière) avant l'envoi.</p>
      <div style="display:flex;flex-direction:column;gap:6px;margin:12px 0;font-size:14px">
        <div><span class="muted">Commande&nbsp;:</span> <strong>${esc(cf.Numéro || '?')}</strong></div>
        <div><span class="muted">Fournisseur&nbsp;:</span> <strong>${esc(fournNom || '— non rattaché —')}</strong></div>
        <div><span class="muted">Référence courte&nbsp;:</span> <strong>${esc(cf['Référence courte'] || '—')}</strong></div>
        <div><span class="muted">Montant HT&nbsp;:</span> <strong>${eur(montant)}</strong></div>
        ${cf['Modèle choisi'] ? `<div><span class="muted">Modèle&nbsp;:</span> ${esc(String(cf['Modèle choisi']).split('\n')[0])}</div>` : ''}
        ${cf['Livraison semaine'] ? `<div><span class="muted">Livraison&nbsp;:</span> ${esc(cf['Livraison semaine'])}</div>` : ''}
      </div>
      ${alertes.length
        ? `<div style="border:1px solid var(--accent);border-radius:8px;padding:10px 12px;background:rgba(200,50,50,.06)">
            <strong style="color:var(--accent)">${icon('alert', 14)} ${alertes.length} point(s) à vérifier</strong>
            <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${alertes.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
          </div>`
        : `<div class="muted" style="font-size:13px">${icon('check', 14)} Aucun écart évident détecté.</div>`}
      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;cursor:pointer">
        <input type="checkbox" id="recap-ok"> <span>J'ai vérifié que cette commande correspond au bon de commande.</span>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="recap-cancel">Annuler</button>
        <button type="button" class="btn btn-primary" id="recap-send" disabled>Préparer le mail</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  hydrateIcons(modal);
  const close = () => modal.remove();
  modal.querySelector('#recap-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  const send = modal.querySelector('#recap-send');
  modal.querySelector('#recap-ok').addEventListener('change', e => { send.disabled = !e.target.checked; });
  send.addEventListener('click', () => { close(); doMailSend(commande, fournisseur); });
}

function doMailSend(commande, fournisseur) {
  const cf = commande.fields || {};
  const email = fournisseur?.fields?.Email || '';
  const subject = `Commande ${cf.Numéro || ''}${cf.Contremarque ? ' — ' + cf.Contremarque : ''}`.trim();

  const lines = [];
  lines.push(`Bonjour${fournisseur?.fields?.Contact ? ' ' + fournisseur.fields.Contact : ''},`);
  lines.push('');
  lines.push(`Veuillez trouver ci-joint notre bon de commande ${cf.Numéro || ''}${cf.Contremarque ? ' pour le chantier ' + cf.Contremarque : ''}.`);
  if (cf['Livraison semaine']) {
    lines.push('');
    lines.push(`Livraison souhaitée : ${cf['Livraison semaine']}`);
  }
  lines.push('');
  lines.push(`Livraison à : Tanguy Design, 4 Rue Louis Blériot, ZA Toul Garros, 56400 AURAY (Tél. 02 97 56 28 53).`);
  lines.push('');
  lines.push(`Merci de votre confirmation.`);
  lines.push(`Cordialement,`);
  lines.push(`${cf['Contact Tanguy'] || 'Solène'}`);
  lines.push(`Tanguy Design`);

  const body = lines.join('\n');
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // Le body est court (<800 chars), pas de risque de dépasser la limite mailto

  // Rappel à JMG : il faut joindre le PDF manuellement (mailto: ne supporte
  // pas les pièces jointes pour des raisons de sécurité du navigateur).
  toast('Mail prêt — n\'oublie pas de joindre le PDF téléchargé', 'info', 6000);

  // Si le mailto dépasse exceptionnellement la limite, fallback presse-papier
  if (mailto.length > 8000) {
    navigator.clipboard.writeText(body).then(() => {
      toast('Mailto trop long, contenu copié dans le presse-papier', 'info', 6000);
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;
    });
    return;
  }
  window.location.href = mailto;
}

// Paquet 3A — petite modale de création de fournisseur (superposée à la modale méta).
function openNewFournisseurModal(onCreated) {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.style.zIndex = '1000'; // au-dessus de la modale méta
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="nf-title">
      <h2 id="nf-title">Nouveau fournisseur</h2>
      <form id="form-new-fourn">
        <label>Nom <input name="Nom" required placeholder="Ex : Transports Le Goff"></label>
        <label>Famille <input name="Famille" placeholder="Ex : Transport, Électroménager, Plan de travail…"></label>
        <label>Email <input name="Email" type="email" placeholder="contact@…"></label>
        <label>Téléphone <input name="Téléphone" placeholder="02 …"></label>
        <label>Adresse <input name="Adresse"></label>
        <label>Notes <textarea name="Notes" rows="2"></textarea></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="nf-cancel">Annuler</button>
          <button type="submit" class="btn btn-primary">Créer</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('#nf-cancel').onclick = close;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('#form-new-fourn').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) { const val = String(v || '').trim(); if (val) fields[k] = val; }
    if (!fields['Nom']) { toast('Le nom est obligatoire', 'error'); return; }
    try {
      const r = await api('/api/data/fournisseurs', { method: 'POST', body: JSON.stringify({ fields }) });
      const rec = r.record || r;
      close();
      toast('Fournisseur créé', 'success');
      onCreated && onCreated({ id: rec.id, nom: (rec.fields && rec.fields.Nom) || fields['Nom'] });
    } catch (err) {
      toast('Erreur : ' + (err.message || err), 'error', 5000);
    }
  });
}

async function openMetaEditor(commande, fournisseur, refresh) {
  const cf = commande.fields || {};
  const currentFournId = (cf.Fournisseur || [])[0] || '';
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="meta-title">
      <h2 id="meta-title">Méta commande</h2>
      <form id="form-meta">
        <label>Fournisseur (à qui envoyer ce BC)
          <select name="Fournisseur" id="meta-fournisseur">
            ${currentFournId
              ? `<option value="${esc(currentFournId)}" selected>${esc(fournisseur?.fields?.Nom || fournisseur?.Nom || 'Fournisseur actuel')}</option>`
              : '<option value="" selected>— Aucun (à rattacher) —</option>'}
            <option disabled>Chargement de la liste…</option>
          </select>
        </label>
        <div style="margin:-4px 0 10px"><button type="button" class="btn btn-ghost btn-sm" id="btn-new-fourn">${icon('plus', 14)} Nouveau fournisseur</button></div>
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
            ${['Créée','Envoyée','Confirmée','Livrée','Posée'].map(v => `<option ${cf.Statut === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Montant AR — HT confirmé par le fournisseur (accusé de réception)
          <input name="Montant AR" type="number" step="0.01" min="0" value="${cf['Montant AR'] != null ? cf['Montant AR'] : ''}" placeholder="estimé devis : ${cf['Montant HT'] != null ? cf['Montant HT'] : '—'}">
        </label>
        <label>Date AR (réception de l'accusé)
          <input name="Date AR" type="date" value="${esc(cf['Date AR'] || '')}">
        </label>
        <label>Date envoi (auto = date pose − 105 j, modifiable)
          <input name="Date envoi" type="date" value="${esc(cf['Date envoi'] || '')}">
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

  // Sprint v3.8 — Charger les fournisseurs et peupler le select
  try {
    const r = await fetch('/api/data/fournisseurs', { credentials: 'same-origin' });
    if (r.ok) {
      const d = await r.json();
      const fournisseurs = (d.records || [])
        .map(f => ({ id: f.id, nom: f.fields?.Nom || '?', famille: f.fields?.Famille || '' }))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
      const sel = document.getElementById('meta-fournisseur');
      sel.innerHTML = `
        <option value="">— Aucun (à rattacher) —</option>
        ${fournisseurs.map(f => `<option value="${esc(f.id)}" ${f.id === currentFournId ? 'selected' : ''}>${esc(f.nom)}${f.famille ? ' · ' + esc(f.famille) : ''}</option>`).join('')}
      `;
    }
  } catch (e) { /* fallback : le select reste vide, le user peut quand même sauver les autres champs */ }

  // Paquet 3A — création d'un fournisseur à la volée (ex. transporteur), puis
  // sélection immédiate dans le BC. La création elle-même est réservée admin (ACL
  // serveur) : un non-admin verra une erreur claire.
  document.getElementById('btn-new-fourn')?.addEventListener('click', () => openNewFournisseurModal(newF => {
    const sel = document.getElementById('meta-fournisseur');
    if (!sel) return;
    const opt = document.createElement('option');
    opt.value = newF.id; opt.textContent = newF.nom; opt.selected = true;
    sel.appendChild(opt);
  }));

  document.getElementById('form-meta').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = {};
    for (const [k, v] of fd.entries()) {
      if (k === 'Fournisseur') {
        // Champ linked : on envoie un array de 1 id (ou [] pour détacher)
        fields[k] = v ? [v] : [];
      } else if (k === 'Montant AR') {
        // Devise Airtable : nombre attendu. Vide → null (efface / pas d'AR reçu).
        fields[k] = v === '' ? null : Number(v);
      } else if (k === 'Date AR') {
        // Date Airtable : vide → null pour effacer proprement.
        fields[k] = v || null;
      } else {
        fields[k] = v;
      }
    }
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
      <div class="table-scroll">
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
      </div>
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
