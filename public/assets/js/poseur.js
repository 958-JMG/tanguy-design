// Espace poseur (mobile) — documents chantier + ajout/suppression de photos.
// Externalisé (CSP script-src 'self'). Aucun accès aux données financières.
(function () {
  const view = document.getElementById('view');
  const titleEl = document.getElementById('title');
  const backBtn = document.getElementById('back');
  const toastEl = document.getElementById('toast');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  let current = null; // id du chantier ouvert

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  let toastT;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.className = 'toast'; }, isErr ? 4500 : 2500);
  }
  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
    if (r.status === 401) { location.href = '/login'; throw new Error('non authentifié'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('Erreur ' + r.status));
    return data;
  }
  function isImg(att) { return /^image\//.test(att.type || '') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(att.filename || ''); }
  function ext(fn) { const m = String(fn || '').match(/\.([a-z0-9]{1,5})$/i); return m ? m[1] : 'fichier'; }
  function openLightbox(url) { lightboxImg.src = url; lightbox.classList.add('show'); }
  lightbox.addEventListener('click', () => { lightbox.classList.remove('show'); lightboxImg.src = ''; });

  // --- Liste des chantiers ------------------------------------------------------
  async function renderList() {
    current = null;
    backBtn.style.display = 'none';
    titleEl.textContent = 'Chantiers';
    view.innerHTML = '<div class="loading">Chargement des chantiers…</div>';
    try {
      const { chantiers } = await api('/api/poseur/chantiers');
      if (!chantiers.length) { view.innerHTML = '<div class="msg">Aucun chantier.</div>'; return; }
      view.innerHTML = chantiers.map(c => `
        <div class="chantier" data-id="${esc(c.id)}">
          <div style="min-width:0">
            <div class="nom">${esc(c.nom)}</div>
            <div class="sub">${esc([c.client, c.ville || c.adresse].filter(Boolean).join(' · ') || c.phase || '')}</div>
          </div>
          <div class="chev">›</div>
        </div>`).join('');
      view.querySelectorAll('.chantier').forEach(el =>
        el.addEventListener('click', () => openChantier(el.dataset.id)));
    } catch (e) { view.innerHTML = `<div class="msg">${esc(e.message)}</div>`; }
  }

  // --- Détail chantier ----------------------------------------------------------
  async function openChantier(id) {
    current = id;
    backBtn.style.display = '';
    titleEl.textContent = 'Chargement…';
    view.innerHTML = '<div class="loading">Chargement du chantier…</div>';
    window.scrollTo(0, 0);
    try {
      const d = await api('/api/poseur/chantiers/' + encodeURIComponent(id));
      titleEl.textContent = d.nom || 'Chantier';
      render(d);
    } catch (e) { view.innerHTML = `<div class="msg">${esc(e.message)}</div>`; }
  }

  function docSection(label, items) {
    const body = !items.length
      ? '<div class="empty">Aucun document.</div>'
      : (items.some(isImg)
          ? `<div class="grid">${items.map(a => a.thumb && isImg(a)
              ? `<a class="thumb" data-full="${esc(a.url)}"><img loading="lazy" src="${esc(a.thumb)}" alt="${esc(a.filename)}"></a>`
              : fileRow(a)).join('')}</div>`
          : items.map(fileRow).join(''));
    return `<div class="section-title">${esc(label)} <span class="count">(${items.length})</span></div>${body}`;
  }
  function fileRow(a) {
    return `<a class="file" href="${esc(a.url)}" target="_blank" rel="noopener">
      <span class="ext">${esc(ext(a.filename))}</span>
      <span class="nm">${esc(cleanName(a.filename))}</span><span style="color:var(--gold)">↗</span></a>`;
  }
  function cleanName(fn) { return String(fn || '').replace(/^p-[^_]*__\d+__/, ''); } // retire le tag poseur

  function photoGrid(items) {
    if (!items.length) return '<div class="empty">Aucune photo pour l\'instant.</div>';
    return `<div class="grid">${items.map(a => `
      <div class="thumb">
        <img loading="lazy" src="${esc(a.thumb || a.url)}" data-full="${esc(a.url)}" alt="photo">
        ${a.mine ? `<button class="del" data-del="${esc(a.id)}" aria-label="Supprimer">✕</button>` : ''}
      </div>`).join('')}</div>`;
  }

  function render(d) {
    const p = d.docs || {};
    view.innerHTML = `
      ${d.adresse ? `<div class="sub" style="color:var(--muted);font-size:13px;margin:0 2px 14px">${esc(d.adresse)}</div>` : ''}
      <div class="section-title">Photos chantier <span class="count">(${(p['Images']||[]).length})</span></div>
      <label class="add-photo">📷 Ajouter une photo
        <input id="photo-input" type="file" accept="image/*" multiple>
      </label>
      <div id="photos">${photoGrid(p['Images'] || [])}</div>
      ${docSection('Plan technique', p['Plan technique'] || [])}
      ${docSection('Plan 3D', p['Plan 3D'] || [])}
      ${docSection('Documents projet', p['Documents projet'] || [])}
    `;
    view.querySelectorAll('[data-full]').forEach(el =>
      el.addEventListener('click', () => openLightbox(el.dataset.full)));
    view.querySelectorAll('[data-del]').forEach(el =>
      el.addEventListener('click', () => delPhoto(el.dataset.del)));
    const input = document.getElementById('photo-input');
    input.addEventListener('change', () => uploadPhotos(input.files));
  }

  async function uploadPhotos(files) {
    if (!files || !files.length) return;
    const list = Array.from(files);
    toast(list.length > 1 ? `Envoi de ${list.length} photos…` : 'Envoi de la photo…');
    let ok = 0;
    for (const file of list) {
      try {
        const fd = new FormData();
        fd.append('photo', file, file.name || 'photo.jpg');
        await api('/api/poseur/chantiers/' + encodeURIComponent(current) + '/photos', { method: 'POST', body: fd });
        ok++;
      } catch (e) { toast(e.message, true); }
    }
    if (ok) toast(ok > 1 ? `${ok} photos ajoutées` : 'Photo ajoutée');
    openChantier(current);
  }

  async function delPhoto(attId) {
    if (!confirm('Supprimer cette photo ?')) return;
    try {
      await api('/api/poseur/chantiers/' + encodeURIComponent(current) + '/photos/' + encodeURIComponent(attId), { method: 'DELETE' });
      toast('Photo supprimée');
      openChantier(current);
    } catch (e) { toast(e.message, true); }
  }

  backBtn.addEventListener('click', renderList);
  document.getElementById('logout').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
    location.href = '/login';
  });

  renderList();
})();
