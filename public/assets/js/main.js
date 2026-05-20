// ============ STATE ============
const DATA = { clients:[], projets:[], artisans:[], fournisseurs:[], commandes:[], taches:[], sav:[], devis:[], 'fiches-decouverte':[], 'reunions-plaud':[], stock:[] };
const PIPE_STATUTS = ['Découverte','Dessin','Devis','Signé','Commandes','Pose','SAV','Terminé'];
let currentModalTable = null;

// ============ UTILS ============
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const euros = n => n==null ? '—' : new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
const pct = n => n==null ? '—' : (n*100).toFixed(0)+'%';
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setSync = (state, txt) => { $('#syncDot').className='sync-dot '+state; $('#syncTxt').textContent=txt; };
const showLoader = (txt) => { $('#loaderTxt').textContent=txt||'Chargement…'; $('#loaderOverlay').classList.add('on'); };
const hideLoader = () => $('#loaderOverlay').classList.remove('on');

function toggleCat(k){
  const b = document.getElementById(k+'-body');
  const t = document.getElementById(k+'-tog');
  if (!b) return;
  const open = b.style.display !== 'none';
  b.style.display = open ? 'none' : 'block';
  if (t) t.textContent = open ? '▸' : '▾';
}

// ============ TOAST ============
let TOAST_ID = 0;
function toast(msg, type='success'){
  const id = ++TOAST_ID;
  const el = document.createElement('div');
  el.className = 'toast toast-'+type;
  el.id = 'toast-'+id;
  const icons = {success:'✓',error:'⚠',info:'•'};
  el.innerHTML = `<span class="toast-icon">${icons[type]||'•'}</span><span class="toast-msg">${esc(msg)}</span>`;
  document.getElementById('toast-host').appendChild(el);
  requestAnimationFrame(()=>el.classList.add('on'));
  setTimeout(()=>{ el.classList.remove('on'); setTimeout(()=>el.remove(),300); }, type==='error'?5000:3000);
}
const toastSuccess = (m) => toast(m,'success');
const toastError = (m) => toast(m,'error');

// ============ A11Y MODAL HELPERS ============
// Esc global pour fermer le dernier modal ouvert.
// Focus auto sur le 1er élément focusable à l'ouverture (via observer DOM).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Cherche un modal visible (le dernier a la priorité)
  const candidates = [
    document.getElementById('cmd-detail-bg'),
    document.getElementById('task-edit-bg'),
    document.getElementById('marge-edit-bg'),
    document.getElementById('client-modal-host')?.querySelector('.modal-bg.on'),
    document.getElementById('fiche-ch-host'),
    document.getElementById('day-panel-bg'),
    document.getElementById('cmdk-bg'),
    document.getElementById('savModalBg')?.classList.contains('on') ? document.getElementById('savModalBg') : null,
    document.getElementById('modalBg')?.classList.contains('on') ? document.getElementById('modalBg') : null,
  ].filter(Boolean);
  if (!candidates.length) return;
  const top = candidates[candidates.length - 1];
  // Routes de fermeture connues
  if (top.id === 'cmd-detail-bg') closeCommandeDetail();
  else if (top.id === 'task-edit-bg') closeTaskEdit();
  else if (top.id === 'marge-edit-bg') closeMargeEdit();
  else if (top.id === 'fiche-ch-host') closeFicheChantier();
  else if (top.id === 'day-panel-bg') closeDayPanel();
  else if (top.id === 'cmdk-bg') closeSearch();
  else if (top.id === 'savModalBg') closeSavModal();
  else if (top.id === 'modalBg') closeModal();
  else if (top.classList?.contains('modal-bg')) top.classList.remove('on');
});

// Auto-focus du 1er élément focusable quand un modal s'ouvre + role/aria-modal.
// Subtree pour catcher les modales injectées dans des hosts (cmd-detail-host, etc.).
new MutationObserver(muts => {
  for (const m of muts) {
    for (const node of m.addedNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const modals = [];
      if (node.classList?.contains('modal-bg')) modals.push(node);
      node.querySelectorAll?.('.modal-bg').forEach(el => modals.push(el));
      for (const modal of modals) {
        if (!modal.getAttribute('role')) modal.setAttribute('role','dialog');
        if (!modal.getAttribute('aria-modal')) modal.setAttribute('aria-modal','true');
        setTimeout(() => {
          if (!modal.classList.contains('on') && !modal.id?.startsWith('cmd-')) return;
          const f = modal.querySelector('input:not([type="hidden"]),textarea,select,button.btn-primary,button.abtn.primary,button.mbtn.primary,button:not(.modal-close):not(.btn-danger)');
          if (f && document.contains(f)) f.focus();
        }, 80);
      }
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// Cards keyboard a11y : .card avec onclick → focusable au Tab + Enter/Space déclenche le clic.
// Délégation : on ne touche pas chaque renderXCard, on attribue les attrs après chaque render
// + on écoute Enter/Space au niveau document.
function makeCardsAccessible() {
  document.querySelectorAll('.card').forEach(card => {
    if (!card.hasAttribute('onclick')) return;
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex','0');
    if (!card.hasAttribute('role')) card.setAttribute('role','button');
  });
  // Pareil pour les .proj-row cliquables
  document.querySelectorAll('.proj-row[onclick]').forEach(row => {
    if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex','0');
    if (!row.hasAttribute('role')) row.setAttribute('role','button');
  });
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  // Évite de tirer dans un textarea/input
  if (['INPUT','TEXTAREA','SELECT'].includes(t.tagName)) return;
  if (t.matches('.card[role="button"], .proj-row[role="button"], [tabindex="0"][role="button"]')) {
    e.preventDefault();
    t.click();
  }
});

// ============ CMD+K SEARCH ============
let SEARCH_RESULTS = [], SEARCH_IDX = 0;
function openSearch(){
  document.getElementById('cmdk-bg').style.display='flex';
  const i = document.getElementById('cmdk-input');
  i.value=''; setTimeout(()=>i.focus(),50);
  renderSearchResults();
}
function closeSearch(){ document.getElementById('cmdk-bg').style.display='none'; }
function renderSearchResults(){
  const q = (document.getElementById('cmdk-input')?.value||'').trim().toLowerCase();
  const results = [];
  if (q.length>=1) {
    const tokens = q.split(/\s+/).filter(Boolean);
    const match = (txt) => { const lo=(txt||'').toLowerCase(); return tokens.every(t=>lo.includes(t)); };
    DATA.clients.forEach(c => {
      const blob = [c.Nom,c.Contact,c.Email,c.Téléphone,c.Adresse].filter(Boolean).join(' ');
      if (match(blob)) results.push({type:'Client',label:c.Nom,sub:[c.Contact,c.Téléphone].filter(Boolean).join(' · '),dest:'client',id:c.id});
    });
    DATA.projets.forEach(p => {
      if (match([p.Référence,p.Description,p.Statut].filter(Boolean).join(' '))) results.push({type:'Projet',label:p.Référence,sub:p.Statut+' · '+euros(p['Budget HT']),dest:'projet',id:p.id});
    });
    DATA.devis.forEach(d => {
      if (match([d['Numéro devis'],d.Milieu,d.Statut].filter(Boolean).join(' '))) results.push({type:'Devis',label:d['Numéro devis']||'—',sub:(d.Milieu||'')+' · '+euros(d['Total TTC']),dest:'devis',id:d.id});
    });
    DATA.taches.forEach(t => {
      if (match([t.Titre,t['Assignée à'],t.Statut].filter(Boolean).join(' '))) results.push({type:'Tâche',label:t.Titre,sub:[t['Assignée à'],t.Statut,t.Échéance].filter(Boolean).join(' · '),dest:'taches'});
    });
  }
  SEARCH_RESULTS = results.slice(0,30);
  SEARCH_IDX = 0;
  document.getElementById('cmdk-results').innerHTML = SEARCH_RESULTS.length
    ? SEARCH_RESULTS.map((r,i)=>`<div class="cmdk-item${i===0?' on':''}" onmouseover="setCmdIdx(${i})" onclick="executeSearchResult(${i})"><span class="cmdk-type">${r.type}</span><span class="cmdk-label">${esc(r.label)}</span><span class="cmdk-sub">${esc(r.sub||'')}</span></div>`).join('')
    : (q.length>=1 ? '<div class="cmdk-empty">Aucun résultat</div>' : '<div class="cmdk-empty">Tape pour rechercher dans tout le cockpit…</div>');
}

// Dispatcher pur : remplace l'ancien eval() (cf. ADR Sprint 0.7 P0-3).
// Les actions de recherche sont maintenant des objets { dest, id } structurés,
// pas des strings de code à interpréter.
function executeSearchResult(idx) {
  const r = SEARCH_RESULTS[idx];
  if (!r) return;
  closeSearch();
  switch (r.dest) {
    case 'client': openClientDetail(r.id); break;
    case 'projet': switchTab('projets'); openProjetDetail(r.id); break;
    case 'devis':  switchTab('devis');   openDevisDetail(r.id);  break;
    case 'taches': switchTab('taches'); break;
  }
}
function setCmdIdx(i){
  SEARCH_IDX = i;
  document.querySelectorAll('.cmdk-item').forEach((el,n)=>el.classList.toggle('on',n===i));
}
document.addEventListener('keydown', e => {
  // Cmd+K / Ctrl+K
  if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); openSearch(); return; }
  const open = document.getElementById('cmdk-bg')?.style.display==='flex';
  if (!open) return;
  if (e.key==='Escape') { closeSearch(); }
  if (e.key==='ArrowDown') { e.preventDefault(); setCmdIdx(Math.min(SEARCH_IDX+1,SEARCH_RESULTS.length-1)); }
  if (e.key==='ArrowUp') { e.preventDefault(); setCmdIdx(Math.max(SEARCH_IDX-1,0)); }
  if (e.key==='Enter' && SEARCH_RESULTS[SEARCH_IDX]) { e.preventDefault(); executeSearchResult(SEARCH_IDX); }
});

// ============ AUTH ============
async function logout(){ await fetch('/api/logout',{method:'POST'}); location.href='/login'; }

// === SAV : modal qualifié + envoi vers webhook 9·58 (proxy /api/sav/submit) ===
function openSavModal(){
  document.getElementById('sav-modal-bg').classList.add('on');
  setTimeout(() => document.getElementById('sav-titre').focus(), 100);
}
function closeSavModal(){
  document.getElementById('sav-modal-bg').classList.remove('on');
  document.getElementById('sav-titre').value = '';
  document.getElementById('sav-description').value = '';
  document.getElementById('sav-categorie').value = 'Bug';
  document.querySelector('input[name="sav-urg"][value="P3"]').checked = true;
}
async function submitSav(){
  const titre = document.getElementById('sav-titre').value.trim();
  const description = document.getElementById('sav-description').value.trim();
  const categorie = document.getElementById('sav-categorie').value;
  const urgence = document.querySelector('input[name="sav-urg"]:checked')?.value || 'P3';
  if (!titre || !description) {
    if (typeof toastError === 'function') toastError('Titre et description requis');
    else alert('Titre et description requis');
    return;
  }
  const btn = document.getElementById('sav-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
  try {
    const r = await fetch('/api/sav/submit', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ categorie, urgence, titre, description }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erreur webhook');
    closeSavModal();
    if (typeof toastSuccess === 'function') toastSuccess('✓ Ticket envoyé à 9·58 — réponse à venir');
    else alert('✓ Ticket SAV envoyé à 9·58');
  } catch(e) {
    if (typeof toastError === 'function') toastError('Erreur : ' + e.message);
    else alert('Erreur : ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Envoyer le ticket'; }
  }
}
fetch('/api/me').then(r=>r.json()).then(d=>{
  window.ME = d.user||'';
  window.ME_ADMIN = !!d.isAdmin;
  $('#headerUser').textContent = d.user||'';
  if (!window.ME_ADMIN) {
    document.querySelectorAll('[data-tab="admin"]').forEach(b => b.style.display = 'none');
  }
  if(typeof renderDashboard==='function') renderDashboard();
});

// ============ FETCH ============
async function loadAll(){
  setSync('loading','chargement');
  try {
    const tables = ['clients','projets','artisans','fournisseurs','commandes','taches','sav','devis','fiches-decouverte','reunions-plaud','stock','devis-artisans'];
    const results = await Promise.all(tables.map(t => fetch('/api/data/'+t).then(r=>r.json())));
    tables.forEach((t,i) => { DATA[t] = (results[i].records||[]).map(r=>({id:r.id, ...r.fields})); });
    renderAll();
    setSync('live','synchronisé ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}));
  } catch (e) {
    console.error(e);
    setSync('error','erreur');
  }
}

// ============ RENDER ============
function renderAll(){
  // Counts
  for (const t of Object.keys(DATA)) {
    const el = $('#cn-'+t); if (el) el.textContent = DATA[t].length;
  }
  renderDashboard();
  renderProjets();
  renderClients();
  renderArtisans();
  renderFournisseurs();
  renderCommandes();
  renderTaches();
  renderSAV();
  renderDevis();
  renderFichesDecouverte();
  renderPlaud();
  renderMarges();
  renderStock();
  // a11y : cards cliquables → focusables au clavier (tabindex + role + Enter/Space → click).
  if (typeof makeCardsAccessible === 'function') makeCardsAccessible();
}

// ============ NEW MENU ============
function toggleNewMenu(e){ e?.stopPropagation(); document.getElementById('new-pop').classList.toggle('on'); }
function closeNewMenu(){ document.getElementById('new-pop')?.classList.remove('on'); }
document.addEventListener('click', e=>{ if(!e.target.closest('.new-menu')) closeNewMenu(); });

// ============ TREND HELPER ============
function setTrend(elId, delta, suffix=''){
  const el = document.getElementById(elId); if(!el) return;
  if (delta === null || delta === undefined || isNaN(delta)) { el.className='kpi-trend flat'; el.textContent='—'; return; }
  if (delta > 0) { el.className='kpi-trend up'; el.textContent='▲ +'+delta+suffix; }
  else if (delta < 0) { el.className='kpi-trend down'; el.textContent='▼ '+delta+suffix; }
  else { el.className='kpi-trend flat'; el.textContent='= 0'+suffix; }
}

function renderDashboard(){
  const todayIso = new Date().toISOString().slice(0,10);
  const now = new Date();
  const moisFr=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const joursFr=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const me = (window.ME||'').toLowerCase();
  const meCap = me ? me[0].toUpperCase()+me.slice(1) : '';
  const hour = now.getHours();
  const greet = hour<12?'Bonjour':(hour<18?'Bon après-midi':'Bonsoir');
  $('#dh-greet').textContent = `${greet}${meCap?' '+meCap:''}`;
  $('#dh-date').textContent = `${joursFr[now.getDay()]} ${now.getDate()} ${moisFr[now.getMonth()]} ${now.getFullYear()}`;

  const actifs = DATA.projets.filter(p => p.Statut && p.Statut !== 'Terminé');
  const signesProjets = DATA.projets.filter(p => ['Signé','Commandes','Pose','SAV','Terminé'].includes(p.Statut));
  const caSigne = signesProjets.reduce((s,p) => s + (p['Budget HT']||0), 0);
  const tachesEnCours = DATA.taches.filter(t => t.Statut && t.Statut !== 'Terminée');
  const savOuverts = DATA.sav.filter(s => !s.Facturé);

  $('#kpi-projets-actifs').textContent = actifs.length;
  $('#kpi-ca-signe').textContent = euros(caSigne);
  $('#kpi-taches').textContent = tachesEnCours.length;
  $('#kpi-sav').textContent = savOuverts.length;

  // Tendances vs M-1 (signés ce mois vs mois dernier)
  const ymThis = now.toISOString().slice(0,7);
  const lastM = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const ymLast = lastM.toISOString().slice(0,7);
  const projThis = DATA.projets.filter(p=>(p['Date création']||'').startsWith(ymThis)).length;
  const projLast = DATA.projets.filter(p=>(p['Date création']||'').startsWith(ymLast)).length;
  setTrend('trend-projets', projThis-projLast);
  const caThis = DATA.devis.filter(d=>d.Statut==='Signé' && (d['Date devis']||'').startsWith(ymThis)).reduce((s,d)=>s+(d['Total HT']||0),0);
  const caLast = DATA.devis.filter(d=>d.Statut==='Signé' && (d['Date devis']||'').startsWith(ymLast)).reduce((s,d)=>s+(d['Total HT']||0),0);
  const caPct = caLast>0 ? Math.round((caThis-caLast)/caLast*100) : null;
  setTrend('trend-ca', caPct, '%');
  const tachesRetard = tachesEnCours.filter(t=>t.Échéance && t.Échéance < todayIso).length;
  $('#kpi-taches-sub').innerHTML = tachesRetard ? `<span style="color:#c25656">⚠ ${tachesRetard} en retard</span>` : 'toutes équipes';
  setTrend('trend-taches', null);
  setTrend('trend-sav', null);

  // ====== ALERT BAR ======
  const alerts = [];
  // Devis en attente client (envoyés non signés)
  const devisAttente = DATA.devis.filter(d=>d.Statut==='Envoyé').length;
  if (devisAttente) alerts.push({label:`<strong>${devisAttente}</strong> devis en attente client`, action:`switchTab('devis')`});
  // BC à signer
  const bcASigner = DATA.devis.filter(d=>d.Statut==='Validé interne'||d.Statut==='À signer').length;
  if (bcASigner) alerts.push({label:`<strong>${bcASigner}</strong> BC à signer`, action:`switchTab('devis')`});
  // Tâches en retard
  if (tachesRetard) alerts.push({label:`<strong>${tachesRetard}</strong> tâches en retard`, action:`switchTab('taches')`});
  // Commandes sans date livraison
  const cmdSansLiv = DATA.commandes.filter(c=>!c['Date livraison prévue'] && c.Statut!=='Livrée').length;
  if (cmdSansLiv) alerts.push({label:`<strong>${cmdSansLiv}</strong> commandes sans date livraison`, action:`switchTab('commandes')`});
  // SAV ouverts
  if (savOuverts.length) alerts.push({label:`<strong>${savOuverts.length}</strong> SAV ouverts`, action:`switchTab('sav')`});

  const alertHost = document.getElementById('alert-bar');
  if (alerts.length) {
    alertHost.innerHTML = `<div class="alert-bar">
      <div class="alert-bar-title">⚠ À traiter aujourd'hui</div>
      <div class="alert-items">${alerts.map(a=>`<span class="alert-chip" onclick="${a.action}">${a.label}</span>`).join('')}</div>
    </div>`;
  } else {
    alertHost.innerHTML = `<div class="alert-bar calm">
      <div class="alert-bar-title">✓ Tout est sous contrôle</div>
      <div class="alert-empty">Rien d'urgent à traiter — bonne journée !</div>
    </div>`;
  }

  // ====== MA JOURNÉE (7 prochains jours) ======
  const in7 = new Date(now.getTime()+7*86400000).toISOString().slice(0,10);
  const dayEvents = [];
  DATA.projets.forEach(p=>{
    if (p['Date pose prévue'] && p['Date pose prévue']>=todayIso && p['Date pose prévue']<=in7)
      dayEvents.push({date:p['Date pose prévue'],type:'pose',label:'Pose · '+(p.Référence||'—'),action:`switchTab('projets');openProjetDetail('${p.id}')`});
    if (p['Date découverte'] && p['Date découverte']>=todayIso && p['Date découverte']<=in7)
      dayEvents.push({date:p['Date découverte'],type:'decouverte',label:'Découverte · '+(p.Référence||'—'),action:`switchTab('projets');openProjetDetail('${p.id}')`});
  });
  DATA.commandes.forEach(c=>{
    if (c['Date livraison prévue'] && c['Date livraison prévue']>=todayIso && c['Date livraison prévue']<=in7) {
      const pid = Array.isArray(c.Projet)?c.Projet[0]:null;
      dayEvents.push({date:c['Date livraison prévue'],type:'livraison',label:'Livraison · '+(c.Numéro||'—'),action:pid?`switchTab('projets');openProjetDetail('${pid}')`:`switchTab('commandes')`});
    }
  });
  dayEvents.sort((a,b)=>a.date.localeCompare(b.date));
  const myDayHost = document.getElementById('my-day');
  if (dayEvents.length) {
    myDayHost.innerHTML = dayEvents.slice(0,8).map(e=>{
      const d = new Date(e.date);
      const lbl = d.getDate()+'/'+(d.getMonth()+1);
      return `<div class="dp-row" onclick="${e.action}">
        <span class="dp-time">${lbl}</span>
        <span class="dp-tag ${e.type}">${e.type}</span>
        <span style="flex:1">${esc(e.label.replace(/^[^·]+· /,''))}</span>
      </div>`;
    }).join('');
  } else {
    myDayHost.innerHTML = '<div class="dp-empty">Aucun événement prévu cette semaine</div>';
  }

  // ====== MES TÂCHES ======
  let myTasks = DATA.taches.filter(t=>t.Statut!=='Terminée');
  if (me) {
    const myTasksFiltered = myTasks.filter(t=>(t['Assignée à']||'').toLowerCase().includes(me));
    if (myTasksFiltered.length) myTasks = myTasksFiltered;
  }
  myTasks.sort((a,b)=>{
    const ar = (a.Échéance||'') < todayIso ? 0 : 1;
    const br = (b.Échéance||'') < todayIso ? 0 : 1;
    if (ar!==br) return ar-br;
    return (a.Échéance||'9999').localeCompare(b.Échéance||'9999');
  });
  const myTasksHost = document.getElementById('my-tasks');
  if (myTasks.length) {
    myTasksHost.innerHTML = myTasks.slice(0,7).map(t=>{
      const late = t.Échéance && t.Échéance<todayIso;
      const ech = t.Échéance ? new Date(t.Échéance).getDate()+'/'+(new Date(t.Échéance).getMonth()+1) : '—';
      return `<div class="dp-row" onclick="switchTab('taches')">
        <span class="dp-time" style="${late?'color:#c25656;font-weight:600':''}">${ech}</span>
        <span style="flex:1">${esc(t.Titre||'—')}</span>
        ${t['Assignée à']?`<span style="font-size:10px;color:var(--ink4);font-family:'DM Mono',monospace">${esc(t['Assignée à'])}</span>`:''}
      </div>`;
    }).join('');
  } else {
    myTasksHost.innerHTML = '<div class="dp-empty">Aucune tâche en cours 🎉</div>';
  }

  renderMonthCal();

  // ====== FUNNEL PIPELINE ======
  const funnelHost = $('#funnel');
  const stageData = PIPE_STATUTS.map(st => {
    const items = DATA.projets.filter(p => p.Statut === st);
    const montant = items.reduce((s,p)=>s+(p['Budget HT']||0),0);
    return {stage:st, count:items.length, montant};
  });
  const maxCount = Math.max(1, ...stageData.map(s=>s.count));
  funnelHost.innerHTML = stageData.map(s=>{
    const w = Math.max(2, Math.round(s.count/maxCount*100));
    return `<div class="funnel-row" data-stage="${s.stage}" onclick="switchTab('projets')">
      <div class="funnel-label">${s.stage}</div>
      <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${w}%"></div></div>
      <div class="funnel-meta"><strong>${euros(s.montant)}</strong><span class="fc-n">· ${s.count}</span></div>
    </div>`;
  }).join('');
}

// ============ DAY SIDE PANEL ============
function openDayPanel(iso){
  const events = collectCalEvents().filter(e=>e.date===iso);
  const d = new Date(iso);
  const joursFr=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const moisFr=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  document.getElementById('day-panel-date').textContent = `${d.getDate()} ${moisFr[d.getMonth()]}`;
  document.getElementById('day-panel-sub').textContent = `${joursFr[d.getDay()]} · ${events.length} événement${events.length>1?'s':''}`;
  const body = document.getElementById('day-panel-body');
  if (!events.length) {
    body.innerHTML = '<div class="dp-empty">Aucun événement ce jour</div>';
  } else {
    body.innerHTML = events.map(e=>{
      const action = e.projetId ? `closeDayPanel();switchTab('projets');openProjetDetail('${e.projetId}')` : `closeDayPanel()`;
      return `<div class="dp-event" onclick="${action}">
        <span class="dp-event-tag ${e.type}">${e.type}</span>
        <span style="flex:1;font-size:13px">${esc(e.label.replace(/^[^·]+· /,''))}</span>
      </div>`;
    }).join('');
  }
  document.getElementById('day-panel-bg').style.display='flex';
}
function closeDayPanel(){ document.getElementById('day-panel-bg').style.display='none'; }
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeDayPanel(); });

// ============ MONTH CALENDAR ============
let CAL_YEAR = null, CAL_MONTH = null; // 0-indexed
function calToday(){ const d=new Date(); CAL_YEAR=d.getFullYear(); CAL_MONTH=d.getMonth(); renderMonthCal(); }
function calNav(delta){
  if (CAL_YEAR===null) calToday();
  CAL_MONTH += delta;
  if (CAL_MONTH<0) { CAL_MONTH=11; CAL_YEAR--; }
  if (CAL_MONTH>11) { CAL_MONTH=0; CAL_YEAR++; }
  renderMonthCal();
}
function collectCalEvents(){
  const ev = [];
  DATA.projets.forEach(p => {
    if (p['Date pose prévue']) ev.push({date:p['Date pose prévue'],type:'pose',label:'Pose · '+(p.Référence||'—'),projetId:p.id});
    if (p['Date découverte']) ev.push({date:p['Date découverte'],type:'decouverte',label:'Découverte · '+(p.Référence||'—'),projetId:p.id});
  });
  DATA.commandes.forEach(c => {
    if (c['Date livraison prévue']) {
      const projetId = Array.isArray(c.Projet)?c.Projet[0]:null;
      ev.push({date:c['Date livraison prévue'],type:'livraison',label:'Livraison · '+(c.Numéro||'—'),projetId});
    }
  });
  DATA.devis.forEach(d => {
    if (d['Date devis']) {
      const projetId = Array.isArray(d.Projet)?d.Projet[0]:null;
      ev.push({date:d['Date devis'],type:'devis',label:'Devis · '+(d['Numéro devis']||'—'),projetId});
    }
  });
  return ev;
}
function renderMonthCal(){
  if (CAL_YEAR===null) calToday();
  const host = document.getElementById('month-cal');
  if (!host) return;
  const moisFr = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('cal-month-label').textContent = moisFr[CAL_MONTH]+' '+CAL_YEAR;

  const first = new Date(CAL_YEAR, CAL_MONTH, 1);
  const last = new Date(CAL_YEAR, CAL_MONTH+1, 0);
  // Lundi=0
  let startDow = (first.getDay()+6)%7;
  const totalDays = last.getDate();
  const today = new Date().toISOString().slice(0,10);

  const events = collectCalEvents();
  const byDay = {};
  events.forEach(e => { (byDay[e.date]=byDay[e.date]||[]).push(e); });

  const cells = [];
  for (let i=0;i<startDow;i++) cells.push({empty:true});
  for (let d=1;d<=totalDays;d++) {
    const iso = `${CAL_YEAR}-${String(CAL_MONTH+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({day:d,iso,events:byDay[iso]||[],isToday:iso===today});
  }
  while (cells.length%7!==0) cells.push({empty:true});

  const dows = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  const html = `
    <div class="cal-grid">
      ${dows.map(d=>`<div class="cal-dow">${d}</div>`).join('')}
      ${cells.map(c => c.empty
        ? '<div class="cal-cell empty"></div>'
        : `<div class="cal-cell${c.isToday?' today':''}" onclick="openDayPanel('${c.iso}')">
            <div class="cal-d">${c.day}</div>
            ${c.events.slice(0,3).map(e=>`<div class="cal-ev cal-ev-${e.type}" ${e.projetId?`onclick="switchTab('projets');openProjetDetail('${e.projetId}')"`:''} title="${esc(e.label)}">${esc(e.label)}</div>`).join('')}
            ${c.events.length>3?`<div class="cal-more">+${c.events.length-3}</div>`:''}
          </div>`
      ).join('')}
    </div>`;
  host.innerHTML = html;
}

function renderAgenda(){
  const events = [];
  const push = (date, type, label, ref) => { if (date) events.push({date, type, label, ref}); };
  DATA.projets.forEach(p => {
    push(p['Date pose prévue'], 'pose', 'Pose ' + (p.Référence||''), p.id);
    push(p['Date découverte'], 'decouverte', 'Découverte ' + (p.Référence||''), p.id);
  });
  DATA.commandes.forEach(c => {
    push(c['Date livraison prévue'], 'livraison', 'Livraison ' + (c.Numéro||''), c.id);
    push(c['Date création'], 'commande', 'Commande créée ' + (c.Numéro||''), c.id);
  });
  DATA.sav.forEach(s => {
    push(s['Date réalisation'], 'sav', 'SAV ' + (s.Référence||''), s.id);
    push(s['Date demande'], 'sav', 'Demande SAV ' + (s.Référence||''), s.id);
  });
  // Filtre 30 jours
  const today = new Date(); today.setHours(0,0,0,0);
  const horizon = new Date(today); horizon.setDate(horizon.getDate()+30);
  const past = new Date(today); past.setDate(past.getDate()-7);
  const inRange = events.filter(e => {
    const d = new Date(e.date);
    return d >= past && d <= horizon;
  }).sort((a,b) => new Date(a.date) - new Date(b.date));
  // Group par date
  const groups = {};
  inRange.forEach(e => { (groups[e.date] = groups[e.date]||[]).push(e); });
  const dates = Object.keys(groups).sort();
  if (!dates.length) {
    $('#agenda').innerHTML = '<div class="empty"><strong>Aucun événement</strong>Les poses, livraisons et commandes des 30 prochains jours apparaîtront ici</div>';
    return;
  }
  $('#agenda').innerHTML = dates.map(d => {
    const dt = new Date(d);
    const isToday = dt.getTime() === today.getTime();
    const isPast = dt < today;
    const cls = isToday ? 'today' : (isPast ? 'past' : '');
    const day = dt.toLocaleDateString('fr-FR', {day:'2-digit'});
    const month = dt.toLocaleDateString('fr-FR', {month:'short'}).replace('.','');
    const wd = dt.toLocaleDateString('fr-FR', {weekday:'short'}).replace('.','');
    return `<div class="agenda-day ${cls}">
      <div class="agenda-date">${esc(wd)}<strong>${day} ${esc(month)}</strong>${isToday?'aujourd\'hui':''}</div>
      <div class="agenda-events">
        ${groups[d].map(e => `<div class="agenda-event"><span class="ev-tag ev-${e.type}">${e.type}</span>${esc(e.label)}</div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function projetCard(p){
  const statutClass = {
    'Découverte':'b-gray','Dessin':'b-blue','Devis':'b-amber','Signé':'b-green',
    'Commandes':'b-blue','Pose':'b-amber','SAV':'b-red','Terminé':'b-gray'
  }[p.Statut] || 'b-gray';
  return `<div class="card" onclick="openProjetDetail('${p.id}')" style="cursor:pointer">
    <div class="card-top">
      <div class="card-nom">${esc(p.Référence||'—')} <span class="badge ${statutClass}">${esc(p.Statut||'—')}</span></div>
      <div class="card-amt">${euros(p['Budget HT'])}</div>
    </div>
    <div class="card-meta">
      <span>Marge prév. ${pct(p['Marge prévisionnelle'])}</span>
      <span>Pose ${esc(p['Date pose prévue']||'—')}</span>
    </div>
  </div>`;
}

// Statut client dérivé du pipeline projet (pas de champ Airtable à créer)
// Gagné = ≥1 projet Signé/Commandes/Pose/SAV/Terminé
// En cours = ≥1 projet Découverte/Dessin/Devis
// Perdu = a des projets mais aucun actif ni gagné
// Nouveau = pas encore de projet
const CLIENT_STATUT_WON  = new Set(['Signé','Commandes','Pose','SAV','Terminé']);
const CLIENT_STATUT_LIVE = new Set(['Découverte','Dessin','Devis']);
function clientStatus(c){
  const ps = (DATA.projets||[]).filter(p => Array.isArray(p.Client) && p.Client.includes(c.id));
  if (!ps.length) return { label:'Nouveau', cls:'b-gray' };
  if (ps.some(p => CLIENT_STATUT_WON.has(p.Statut))) return { label:'Gagné', cls:'b-green' };
  if (ps.some(p => CLIENT_STATUT_LIVE.has(p.Statut))) return { label:'En cours', cls:'b-amber' };
  return { label:'Perdu', cls:'b-red' };
}

function clientCard(c){
  const st = clientStatus(c);
  return `<div class="card" onclick="openClientDetail('${c.id}')" style="cursor:pointer">
    <div class="card-top">
      <div class="card-nom">${esc(c.Nom||'—')} <span class="badge b-gray">${esc(c.Type||'—')}</span> <span class="badge ${st.cls}">${st.label}</span></div>
      <div class="card-amt">${esc(c.Source||'')}</div>
    </div>
    <div class="card-meta">
      <span>${esc(c.Contact||'—')}</span>
      <span>${esc(c.Email||'')}</span>
      <span>${esc(c.Téléphone||'')}</span>
      ${c.Adresse?`<span>${esc(c.Adresse.split('\n').pop())}</span>`:''}
    </div>
  </div>`;
}

function artisanCard(a){
  const typeClass = a.Type === 'Contractuel' ? 'b-green' : 'b-gray';
  return `<div class="card" onclick="openModal('artisans','${a.id}')" style="cursor:pointer">
    <div class="card-top">
      <div class="card-nom">${esc(a.Nom||'—')} <span class="badge b-blue">${esc(a.Spécialité||'—')}</span> <span class="badge ${typeClass}">${esc(a.Type||'—')}</span></div>
      <div class="card-amt">${euros(a['CA cumulé'])}</div>
    </div>
    <div class="card-meta">
      <span>${esc(a['Contact principal']||'—')}</span>
      <span>${esc(a.Téléphone||'')}</span>
      <span>${esc(a.Email||'')}</span>
    </div>
  </div>`;
}

function fournisseurCard(f){
  return `<div class="card" onclick="openModal('fournisseurs','${f.id}')" style="cursor:pointer">
    <div class="card-top">
      <div class="card-nom">${esc(f.Nom||'—')} <span class="badge b-blue">${esc(f.Type||'—')}</span></div>
      <div class="card-amt">${esc(f.Plateforme||'')}</div>
    </div>
    <div class="card-meta">
      <span>${esc(f.Contact||'—')}</span>
      <span>${esc(f['Email commande']||'')}</span>
    </div>
  </div>`;
}

function commandeOrigin(c){
  const notes = c.Notes || '';
  const m = notes.match(/Importé depuis PDF\s*:\s*([^\n]+)/i);
  if (m) {
    const fourn = (notes.match(/Fournisseur détecté\s*:\s*([^\n]+)/i) || [])[1];
    return { type:'import', pdf: m[1].trim(), fournisseur: (fourn||'').trim() };
  }
  if (/auto|signature devis|bc signé/i.test(notes)) return { type:'auto', label:'Auto via signature devis' };
  return { type:'manual', label:'Saisie manuelle' };
}

function commandeCard(c){
  const statutClass = {'Créée':'b-gray','Envoyée':'b-amber','Confirmée':'b-blue','Livrée':'b-green','Posée':'b-ink'}[c.Statut]||'b-gray';
  const projetId = Array.isArray(c.Projet) ? c.Projet[0] : null;
  const projet = projetId ? DATA.projets.find(p => p.id === projetId) : null;
  const projetLabel = projet ? esc(projet.Référence || '—') : '<span style="color:var(--ink4)">Non lié</span>';
  const orig = commandeOrigin(c);
  let origBadge = '';
  if (orig.type === 'import') origBadge = `<span class="badge b-blue" title="${esc(orig.pdf)}">📎 Importée PDF</span>`;
  else if (orig.type === 'auto') origBadge = `<span class="badge b-amber">⚡ Auto devis</span>`;
  else origBadge = `<span class="badge b-gray">✍ Manuelle</span>`;
  const fournBadge = orig.fournisseur ? `<span class="badge b-gray">${esc(orig.fournisseur)}</span>` : '';
  const typeBadge = c.Type ? `<span class="badge b-blue">${esc(c.Type)}</span>` : '';
  const next = {'Créée':'Envoyée','Envoyée':'Confirmée','Confirmée':'Livrée','Livrée':'Posée'}[c.Statut];
  const urgBadges = commandeUrgencyBadges(c);

  return `<div class="card" onclick="openCommandeDetail('${c.id}')" style="cursor:pointer">
    <div class="card-top">
      <div class="card-nom">${esc(c.Numéro||'—')} <span class="badge ${statutClass}">${esc(c.Statut||'—')}</span> ${typeBadge} ${urgBadges} ${origBadge} ${fournBadge} ${c['Facture reçue']?'<span class="badge b-green">Facture ✓</span>':''}</div>
      <div class="card-amt">${euros(c['Montant HT'])}</div>
    </div>
    <div class="card-meta">
      <span>📁 ${projet ? `<a href="#" onclick="event.preventDefault();event.stopPropagation();switchTab('projets');openProjetDetail('${projetId}')" style="color:var(--gold)">${projetLabel}</a>` : projetLabel}</span>
      <span>Créée ${esc(c['Date création']||'—')}</span>
      <span>Livraison ${esc(c['Date livraison prévue']||'—')}</span>
      ${orig.type === 'import' && orig.pdf ? `<span style="color:var(--ink4);font-size:10px">Source : ${esc(orig.pdf)}</span>` : ''}
    </div>
    ${next ? `<div class="cmd-quick-actions"><button class="cmd-qa-btn" onclick="event.stopPropagation();commandeQuickAdvance('${c.id}','${next}')" title="Passer à ${next}">→ ${next}</button></div>` : ''}
  </div>`;
}

function openCommandeDetail(cmdId){
  const c = DATA.commandes.find(x => x.id === cmdId); if (!c) return;
  const orig = commandeOrigin(c);
  const projetId = Array.isArray(c.Projet) ? c.Projet[0] : null;
  const projet = projetId ? DATA.projets.find(p => p.id === projetId) : null;
  const STATUTS_CMD = ['Créée','Envoyée','Confirmée','Livrée','Posée'];
  const TYPES_CMD = ['Cuisine','Électroménager','Plan de travail','Sanitaire','Accessoires','Autre'];
  const next = {'Créée':'Envoyée','Envoyée':'Confirmée','Confirmée':'Livrée','Livrée':'Posée'}[c.Statut];
  const html = `
    <div class="modal-bg on" id="cmd-detail-bg" onclick="if(event.target===this)closeCommandeDetail()">
      <div class="modal-card" style="max-width:540px">
        <div class="modal-head">
          <div class="modal-title">Commande ${esc(c.Numéro||'—')}</div>
          <button class="modal-close" onclick="closeCommandeDetail()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-grid2">
            <div class="form-row"><label>Statut</label>
              <select id="cmd-edit-statut">${STATUTS_CMD.map(s=>`<option ${c.Statut===s?'selected':''}>${s}</option>`).join('')}</select>
            </div>
            <div class="form-row"><label>Type</label>
              <select id="cmd-edit-type">
                <option value="">— non typé —</option>
                ${TYPES_CMD.map(t=>`<option ${c.Type===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row"><label>Projet</label>${projet ? `<a href="#" onclick="event.preventDefault();closeCommandeDetail();switchTab('projets');openProjetDetail('${projetId}')" style="color:var(--gold)">${esc(projet.Référence||'—')}</a>` : '<em>Non lié</em>'}</div>
          <div class="form-row"><label>Montant HT</label><strong>${euros(c['Montant HT'])}</strong></div>
          <div class="form-grid2">
            <div class="form-row"><label>Date création</label><strong>${esc(c['Date création']||'—')}</strong></div>
            <div class="form-row"><label>Livraison prévue</label><input type="date" id="cmd-edit-livraison" value="${esc(c['Date livraison prévue']||'')}"></div>
          </div>
          <div class="form-row"><label>Origine</label>
            ${orig.type==='import' ? `<div><strong>Importée depuis PDF</strong><br><span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--ink3)">${esc(orig.pdf)}</span>${orig.fournisseur?`<br><span style="font-size:11px">Fournisseur : ${esc(orig.fournisseur)}</span>`:''}</div>` :
              orig.type==='auto' ? `<strong>Générée automatiquement</strong> à la signature d'un devis` :
              `<strong>Saisie manuelle</strong>`}
          </div>
          <div class="form-row">
            <label>Contenu / lignes détail <span style="color:var(--ink4);font-weight:400;text-transform:none;letter-spacing:0">— éditable, va au fournisseur</span></label>
            <textarea id="cmd-edit-notes" rows="8" style="font-family:'DM Mono',monospace;font-size:12px;line-height:1.5" placeholder="Liste des produits / références / quantités à commander…">${esc(c.Notes||'')}</textarea>
            <div style="font-size:10px;color:var(--ink4);margin-top:4px">Pré-rempli auto à la signature du devis. Édite ici ce qui sera réellement commandé au fournisseur.</div>
          </div>
          ${next ? `<div style="margin-top:6px"><button type="button" class="cmd-qa-btn active" onclick="commandeQuickAdvance('${c.id}','${next}',true)">⚡ Marquer « ${next} » en 1 clic</button></div>` : ''}
        </div>
        <div class="modal-foot" style="display:flex;justify-content:space-between;gap:8px;padding:14px 20px;border-top:1px solid var(--border)">
          <button type="button" class="abtn" style="color:#c25656;border-color:#e0a8a8" onclick="deleteCommande('${c.id}')">🗑 Supprimer la commande</button>
          <div style="display:flex;gap:8px">
            <button type="button" class="abtn" onclick="closeCommandeDetail()">Annuler</button>
            <button type="button" class="abtn primary" onclick="saveCommandeEdit('${c.id}')">Enregistrer</button>
          </div>
        </div>
      </div>
    </div>`;
  const host = document.createElement('div'); host.id = 'cmd-detail-host'; host.innerHTML = html;
  document.body.appendChild(host);
  // Auto-focus sur le textarea contenu (action principale attendue à l'ouverture)
  setTimeout(()=>{ const t = document.getElementById('cmd-edit-notes'); if(t){ t.focus(); t.setSelectionRange(t.value.length, t.value.length); }}, 100);
}
function closeCommandeDetail(){ document.getElementById('cmd-detail-host')?.remove(); }

async function saveCommandeEdit(cmdId){
  const fields = {};
  const statut = document.getElementById('cmd-edit-statut')?.value;
  const type = document.getElementById('cmd-edit-type')?.value;
  const livraison = document.getElementById('cmd-edit-livraison')?.value;
  const notes = document.getElementById('cmd-edit-notes')?.value;
  if (statut) fields['Statut'] = statut;
  if (type !== undefined) fields['Type'] = type || null;
  if (livraison !== undefined) fields['Date livraison prévue'] = livraison || null;
  if (notes !== undefined) fields['Notes'] = notes;
  try {
    const r = await fetch('/api/data/commandes/'+cmdId, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      if (/UNKNOWN_FIELD_NAME.*Type|"Type"/i.test(err.error?.message||err.error||'')) {
        toastError('Le champ « Type » n\'est pas encore créé sur Airtable. Demande à JMG de lancer la migration (scripts/setup-commande-type.js).');
        return;
      }
      throw new Error(err.error?.message||err.error||'erreur');
    }
    toastSuccess('Commande mise à jour');
    closeCommandeDetail();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}

async function deleteCommande(cmdId) {
  const c = DATA.commandes.find(x=>x.id===cmdId); if(!c) return;
  if (!confirm(`Supprimer définitivement la commande :\n\n${c.Numéro||cmdId}\n${euros(c['Montant HT'])} HT\n\nCette action est irréversible (mais les Lignes du devis d'origine restent intactes).`)) return;
  try {
    const r = await fetch('/api/data/commandes/'+cmdId, {method:'DELETE'});
    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      throw new Error(err.error?.message || err.error || 'erreur');
    }
    toastSuccess('Commande supprimée');
    closeCommandeDetail();
    await loadAll();
  } catch(e) { toastError('Erreur suppression : '+e.message); }
}

async function commandeQuickAdvance(cmdId, newStatut, closeAfter) {
  const c = DATA.commandes.find(x=>x.id===cmdId); if(!c) return;
  if (!confirm(`Marquer la commande comme « ${newStatut} » ?\n\n${c.Numéro||cmdId}\n${euros(c['Montant HT'])} HT`)) return;
  try {
    const r = await fetch('/api/data/commandes/'+cmdId, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{Statut:newStatut}})});
    if (!r.ok) {
      const err = await r.json().catch(()=>({}));
      throw new Error(err.error?.message || err.error || 'erreur');
    }
    toastSuccess(`${c.Numéro||'Commande'} marquée « ${newStatut} »`);
    if (closeAfter) closeCommandeDetail();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}

function taskCard(t){
  const prioClass = {'Haute':'b-red','Moyenne':'b-amber','Basse':'b-gray'}[t.Priorité]||'b-gray';
  const statutClass = {'À faire':'b-gray','En cours':'b-amber','Terminée':'b-green'}[t.Statut]||'b-gray';
  return `<div class="card">
    <div class="card-top">
      <div class="card-nom">${esc(t.Titre||'—')} <span class="badge ${prioClass}">${esc(t.Priorité||'—')}</span> <span class="badge ${statutClass}">${esc(t.Statut||'—')}</span></div>
      <div class="card-amt">${esc(t['Assignée à']||'—')}</div>
    </div>
    <div class="card-meta">
      <span>Échéance ${esc(t.Échéance||'—')}</span>
      ${t.Description?`<span>${esc(t.Description.slice(0,60))}${t.Description.length>60?'…':''}</span>`:''}
    </div>
  </div>`;
}

function savCard(s){
  return `<div class="card">
    <div class="card-top">
      <div class="card-nom">${esc(s.Référence||'—')} ${s.Facturé?'<span class="badge b-green">Facturé</span>':'<span class="badge b-amber">En cours</span>'}</div>
      <div class="card-amt">${esc(s['Réalisé par']||'')}</div>
    </div>
    <div class="card-meta">
      <span>Demande ${esc(s['Date demande']||'—')}</span>
      <span>Réception ${esc(s['Date réception']||'—')}</span>
      <span>Réalisation ${esc(s['Date réalisation']||'—')}</span>
    </div>
  </div>`;
}

function emptyState(title, sub, ctaLabel, ctaOnclick){
  const cta = ctaLabel ? `<button class="empty-cta-btn" type="button" style="margin-top:10px" onclick="${ctaOnclick}">${esc(ctaLabel)}</button>` : '';
  return `<div class="empty"><strong>${esc(title)}</strong>${esc(sub)}${cta}</div>`;
}

function renderProjets(){
  $('#list-projets').innerHTML = DATA.projets.length
    ? DATA.projets.map(projetCard).join('')
    : emptyState('Aucun projet pour l\'instant', ' Importe un PDF Winner pour créer le premier (auto-création client + projet + devis), ou démarre à blanc.', '📄 Importer un PDF Winner', `switchTab('devis');setTimeout(()=>document.getElementById('devis-pdf-input').click(),100)`);
}
function renderClients(){
  const q = (document.getElementById('clients-search')?.value||'').trim().toLowerCase();
  let list = DATA.clients;
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    list = list.filter(c => {
      const blob = [c.Nom,c.Contact,c.Email,c.Téléphone,c.Adresse,c.Notes,c.Type,c.Source].filter(Boolean).join(' ').toLowerCase();
      return tokens.every(t => blob.includes(t));
    });
  }
  list = list.slice().sort((a,b)=>(a.Nom||'').localeCompare(b.Nom||'','fr',{sensitivity:'base'}));
  document.getElementById('clients-count-badge').textContent = list.length + (q?' / '+DATA.clients.length:'');
  $('#list-clients').innerHTML = list.length ? list.slice(0,200).map(clientCard).join('') + (list.length>200?`<div class="muted" style="text-align:center;padding:14px;color:var(--ink4);font-size:11px">… ${list.length-200} autres résultats — affinez la recherche</div>`:'') : emptyState('Aucun résultat',q?'Essayez d\'autres mots-clés':'Ajoutez votre premier client');
}

// ============ PROJET DETAIL (page) ============
let PROJET_EDIT = false;
function openProjetDetail(projetId){
  const p = DATA.projets.find(x => x.id === projetId);
  if (!p) return;
  PROJET_EDIT = false;
  renderProjetDetail(p);
  document.getElementById('projets-list-view').style.display = 'none';
  document.getElementById('projet-detail-view').style.display = 'block';
}
function closeProjetDetail(){
  document.getElementById('projet-detail-view').style.display = 'none';
  document.getElementById('projets-list-view').style.display = 'block';
}
function toggleProjetEdit(on){ PROJET_EDIT = on; const p = DATA.projets.find(x=>x.id===CURRENT_PROJET_ID); if(p)renderProjetDetail(p); }
let CURRENT_PROJET_ID = null;

// ============ PARCOURS CHANTIER (stepper) ============
// Calcule l'état des 11 étapes du parcours idéal client à partir des données projet.
// Pas de nouveau champ Airtable requis : tout est dérivé des statuts/dates/tâches/commandes/devis existants.
function computeParcours(p, devisLies, commandesLiees, tachesLiees, devisArtisansLies) {
  const reunionsR1 = (DATA['reunions-plaud']||[]).filter(r => Array.isArray(r.Projet) && r.Projet.includes(p.id) && (r.Niveau||'R1')==='R1');
  const reunionsR2 = (DATA['reunions-plaud']||[]).filter(r => Array.isArray(r.Projet) && r.Projet.includes(p.id) && r.Niveau==='R2');
  const fichesDecouverte = (DATA['fiches-decouverte']||[]).filter(f => Array.isArray(f.Projet) && f.Projet.includes(p.id));
  const savLies = (DATA.sav||[]).filter(s => Array.isArray(s.Projet) && s.Projet.includes(p.id));

  const devisEnvoyes = devisLies.filter(d => ['Envoyé','Signé'].includes(d.Statut));
  const devisSignes = devisLies.filter(d => d.Statut === 'Signé');
  const tachesAcompte = tachesLiees.filter(t => /facture acompte|acompte/i.test(t.Titre || ''));
  const tachesAcompteDone = tachesAcompte.filter(t => t.Statut === 'Terminée');
  const tachesFactureSolde = tachesLiees.filter(t => /facture solde|facture client|facture finale|solde/i.test(t.Titre || ''));
  const tachesFactureSoldeDone = tachesFactureSolde.filter(t => t.Statut === 'Terminée');
  const planTechFiles = (p['Plan technique']||[]).length;
  const cmdsEnvoyees = commandesLiees.filter(c => ['Envoyée','Confirmée','Livrée','Posée'].includes(c.Statut));
  const cmdsLivrees = commandesLiees.filter(c => ['Livrée','Posée'].includes(c.Statut));
  const cmdsPosees = commandesLiees.filter(c => c.Statut === 'Posée');
  const datePoseSet = !!p['Date pose prévue'];
  const todayIso = new Date().toISOString().slice(0,10);
  const posePassed = datePoseSet && p['Date pose prévue'] < todayIso;
  const tachesPV = tachesLiees.filter(t => /pv|réception|reception/i.test(t.Titre || ''));
  const tachesPVDone = tachesPV.filter(t => t.Statut === 'Terminée');
  const tachesAvis = tachesLiees.filter(t => /avis|review|google/i.test(t.Titre || ''));
  const tachesAvisDone = tachesAvis.filter(t => t.Statut === 'Terminée');
  const isStatut = (s) => p.Statut === s;
  const inStatuts = (...arr) => arr.includes(p.Statut);

  const steps = [];

  // 1. Découverte
  steps.push({n:1, key:'decouverte', label:'Découverte', icon:'👋',
    state: (reunionsR1.length || fichesDecouverte.length || p['Date découverte']) ? 'done' :
           inStatuts('Découverte') ? 'cur' : 'pending',
    meta: p['Date découverte'] ? p['Date découverte'].slice(5).replace('-','/') : (reunionsR1.length ? `R1 ×${reunionsR1.length}` : '')
  });
  // 2. Devis présenté
  steps.push({n:2, key:'devis', label:'Devis présenté', icon:'📄',
    state: devisEnvoyes.length ? 'done' :
           devisLies.length ? 'partial' :
           inStatuts('Dessin','Devis') ? 'cur' : 'pending',
    meta: devisEnvoyes.length ? `${devisEnvoyes.length} env.` : (devisLies.length ? `${devisLies.length} brouillon` : '')
  });
  // 3. Signature BC
  steps.push({n:3, key:'signature', label:'Signature BC', icon:'✍️',
    state: devisSignes.length ? 'done' :
           devisEnvoyes.length ? 'cur' : 'pending',
    meta: devisSignes.length ? `${devisSignes.length} signé${devisSignes.length>1?'s':''}` : ''
  });
  // 4. Acompte facturé
  steps.push({n:4, key:'acompte', label:'Acompte 30%', icon:'💶',
    state: tachesAcompteDone.length ? 'done' :
           devisSignes.length && tachesAcompte.length ? 'cur' :
           devisSignes.length ? 'cur' : 'pending',
    meta: tachesAcompteDone.length ? '✓ envoyée' : (tachesAcompte.length ? 'à émettre' : '')
  });
  // 5. Plans techniques
  steps.push({n:5, key:'plans', label:'Plans techniques', icon:'📐',
    state: planTechFiles >= 1 ? 'done' :
           devisSignes.length ? 'cur' : 'pending',
    meta: planTechFiles ? `${planTechFiles} plan${planTechFiles>1?'s':''}` : ''
  });
  // 6. Commandes envoyées
  steps.push({n:6, key:'commandes', label:'Commandes', icon:'📦',
    state: commandesLiees.length>0 && cmdsEnvoyees.length === commandesLiees.length ? 'done' :
           cmdsEnvoyees.length > 0 ? 'partial' :
           commandesLiees.length > 0 || inStatuts('Commandes') ? 'cur' : 'pending',
    meta: commandesLiees.length ? `${cmdsEnvoyees.length}/${commandesLiees.length} env.` : ''
  });
  // 7. Réception
  steps.push({n:7, key:'reception', label:'Réception', icon:'🚚',
    state: commandesLiees.length>0 && cmdsLivrees.length === commandesLiees.length ? 'done' :
           cmdsLivrees.length > 0 ? 'partial' :
           cmdsEnvoyees.length > 0 ? 'cur' : 'pending',
    meta: commandesLiees.length ? `${cmdsLivrees.length}/${commandesLiees.length} livr.` : ''
  });
  // 8. Pose
  steps.push({n:8, key:'pose', label:'Pose', icon:'🔨',
    state: cmdsPosees.length > 0 || inStatuts('SAV','Terminé') ? 'done' :
           inStatuts('Pose') || (datePoseSet && posePassed) ? 'cur' :
           datePoseSet ? 'partial' : 'pending',
    meta: p['Date pose prévue'] ? p['Date pose prévue'].slice(5).replace('-','/') : ''
  });
  // 9. PV réception
  steps.push({n:9, key:'pv', label:'PV réception', icon:'📋',
    state: tachesPVDone.length > 0 || isStatut('Terminé') ? 'done' :
           inStatuts('SAV') ? 'cur' :
           cmdsPosees.length > 0 || isStatut('Pose') ? 'cur' : 'pending',
    meta: tachesPVDone.length ? '✓ signé' : ''
  });
  // 10. Facture solde
  steps.push({n:10, key:'facture-solde', label:'Facture solde', icon:'🧾',
    state: tachesFactureSoldeDone.length > 0 ? 'done' :
           inStatuts('SAV','Terminé') || cmdsPosees.length > 0 ? 'cur' : 'pending',
    meta: tachesFactureSoldeDone.length ? '✓ envoyée' : ''
  });
  // 11. Avis client
  steps.push({n:11, key:'avis', label:'Avis client', icon:'⭐',
    state: tachesAvisDone.length > 0 ? 'done' :
           tachesFactureSoldeDone.length > 0 ? 'cur' : 'pending',
    meta: tachesAvisDone.length ? '✓ reçu' : ''
  });
  // 12. SAV (affiché seulement si actif ou en cours)
  if (savLies.length > 0 || isStatut('SAV')) {
    steps.push({n:12, key:'sav', label:'SAV', icon:'🛠️',
      state: isStatut('Terminé') ? 'done' : 'cur',
      meta: savLies.length ? `${savLies.length} ticket${savLies.length>1?'s':''}` : ''
    });
  }

  return steps;
}

function parcoursStepperHTML(steps, p) {
  const total = steps.length;
  const done = steps.filter(s => s.state === 'done').length;
  const pct = total ? Math.round(done/total*100) : 0;
  const stateLabel = {done:'terminée', cur:'en cours', partial:'partielle', pending:'à venir'};
  const stepHtml = steps.map(s => {
    const ariaLabel = `Étape ${s.n} sur ${total} : ${s.label}, ${stateLabel[s.state]||s.state}${s.meta?' — '+s.meta:''}`;
    const ariaCurrent = s.state === 'cur' ? ' aria-current="step"' : '';
    return `<button type="button" class="ps-step ${s.state}" onclick="parcoursStepInfo('${esc(s.key)}','${p.id}')" aria-label="${esc(ariaLabel)}"${ariaCurrent}>
      <span class="ps-circle" aria-hidden="true">${s.icon}</span>
      <span class="ps-num" aria-hidden="true">${String(s.n).padStart(2,'0')}</span>
      <span class="ps-label">${esc(s.label)}</span>
      ${s.meta ? `<span class="ps-meta">${esc(s.meta)}</span>` : ''}
    </button>`;
  }).join('');
  return `<div class="parcours-wrap" role="region" aria-label="Parcours du chantier">
    <div class="parcours-head">
      <div class="ph-title">⛯ Parcours chantier</div>
      <div class="ph-progress"><strong>${done}/${total}</strong> étapes · <strong>${pct} %</strong></div>
    </div>
    <ol class="parcours-stepper" aria-label="Étapes du chantier" style="list-style:none;padding:0;margin:0;display:flex;gap:0;align-items:flex-start;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:8px 4px 14px;position:relative;scrollbar-width:thin">${stepHtml}</ol>
    ${parcoursActionsHTML(steps, p)}
  </div>`;
}

function parcoursActionsHTML(steps, p) {
  const actions = [];
  const cur = steps.filter(s => s.state === 'cur');
  const partial = steps.filter(s => s.state === 'partial');
  for (const s of [...cur, ...partial]) {
    if (s.key === 'decouverte') actions.push({icon:'📞', label:'Saisir RDV découverte', meta:'modifier projet', urgent:false, onclick:`toggleProjetEdit(true)`});
    if (s.key === 'devis') actions.push({icon:'📤', label:'Finaliser et envoyer le devis', meta:'onglet Devis', urgent:false, onclick:`switchTab('devis')`});
    if (s.key === 'signature') actions.push({icon:'✍️', label:'Signer le devis (côté client)', meta:'attendre BC', urgent:true, onclick:`switchTab('devis')`});
    if (s.key === 'acompte') actions.push({icon:'💶', label:'Émettre facture acompte (30%)', meta:'tâche → Pennylane', urgent:true, onclick:`creerTacheFacturation('${p.id}','acompte')`});
    if (s.key === 'plans') actions.push({icon:'📐', label:'Uploader le plan technique', meta:'fiche projet', urgent:false, onclick:`scrollToAttachments('Plan technique')`});
    if (s.key === 'commandes') actions.push({icon:'📦', label:'Envoyer les BC fournisseurs', meta:'à faire', urgent:true, onclick:`switchTab('commandes')`});
    if (s.key === 'reception') actions.push({icon:'🚚', label:'Confirmer commandes livrées', meta:'à valider', urgent:false, onclick:`switchTab('commandes')`});
    if (s.key === 'pose') {
      if (!p['Date pose prévue']) actions.push({icon:'📅', label:'Fixer la date de pose', meta:'modifier projet', urgent:true, onclick:`toggleProjetEdit(true)`});
      else actions.push({icon:'✉️', label:'Envoyer mail confirmation pose', meta:'au client', urgent:false, onclick:`mailtoConfirmationPose('${p.id}')`});
    }
    if (s.key === 'pv') actions.push({icon:'📋', label:'Préparer PV de réception', meta:'tâche pose', urgent:false, onclick:`creerTachePV('${p.id}')`});
    if (s.key === 'facture-solde') actions.push({icon:'🧾', label:'Émettre facture solde', meta:'tâche → Pennylane', urgent:true, onclick:`creerTacheFacturation('${p.id}','solde')`});
    if (s.key === 'avis') actions.push({icon:'⭐', label:'Demander avis client', meta:'mail / Google', urgent:false, onclick:`creerTacheAvis('${p.id}')`});
    if (s.key === 'sav') actions.push({icon:'🛠️', label:'Suivre les SAV ouverts', meta:'tickets', urgent:false, onclick:`switchTab('sav')`});
  }
  if (!actions.length) {
    return `<div class="parcours-actions"><div class="parcours-actions-title">Prochaines actions</div><div class="pa-empty">✓ Tout est à jour — bon chantier !</div></div>`;
  }
  return `<div class="parcours-actions">
    <div class="parcours-actions-title">Prochaines actions (${actions.length})</div>
    <div class="pa-list">
      ${actions.map(a=>`<button class="pa-chip${a.urgent?' urgent':''}" onclick="${a.onclick}">
        <span class="pa-chip-icon">${a.icon}</span>
        <span>${esc(a.label)}</span>
        <span class="pa-chip-meta">${esc(a.meta)}</span>
      </button>`).join('')}
    </div>
  </div>`;
}

function parcoursStepInfo(key, projetId) {
  const labels = {
    'decouverte': "Saisir la date du RDV découverte sur la fiche projet (Modifier) ou créer une R1 Plaud depuis cette fiche.",
    'devis': "Importer un PDF Winner depuis l'onglet Devis, ou créer un devis additif depuis cette fiche.",
    'signature': "Bouton « Signer » depuis la fiche du devis dans l'onglet Devis. Auto-crée 3 tâches (acompte, BC fournisseurs, planif pose).",
    'acompte': "Le bouton « Facture acompte » plus bas crée la tâche dans la liste de Virginie. La facture s'émet ensuite dans Pennylane.",
    'plans': "Uploader le PDF du plan technique dans la zone « Plan technique » plus bas (≤ 5 MB).",
    'commandes': "Marquer les commandes « Envoyée » dans l'onglet Commandes (Créée → Envoyée → Confirmée → Livrée → Posée).",
    'reception': "À la livraison, marquer la commande « Livrée » depuis l'onglet Commandes.",
    'pose': "Définir la date de pose dans Modifier puis envoyer la confirmation au client par mail.",
    'pv': "Crée une tâche « PV de réception » assignée à Sébastien (à signer en présence du client).",
    'facture-solde': "Le bouton « Facture solde » plus bas crée la tâche pour Virginie. À émettre dans Pennylane.",
    'avis': "Crée une tâche « Demander avis client » pour Marine (mail + lien Google review).",
    'sav': "Voir les tickets SAV depuis l'onglet SAV. Bouton SAV en haut pour créer un ticket centralisé 9·58."
  };
  if (labels[key]) toast(labels[key], 'success');
}

// Helper : créer une tâche structurée et recharger
async function _createTask(fields, successMsg) {
  try {
    const r = await fetch('/api/data/taches', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    if (!r.ok) throw new Error((await r.json()).error || 'erreur');
    toastSuccess(successMsg);
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}

async function creerTacheFacturation(projetId, type) {
  const p = DATA.projets.find(x=>x.id===projetId); if(!p) return;
  const devisSignes = DATA.devis.filter(d => Array.isArray(d.Projet) && d.Projet.includes(projetId) && d.Statut==='Signé');
  const totalHT = devisSignes.reduce((s,d)=>s+(d['Total HT final']||d['Total HT après remise']||d['Total HT articles']||0),0);
  const cfg = {
    'acompte':   {label:'Facture acompte 30 %', pct:0.30, prio:'Haute', desc:'Acompte versé à la signature du BC. À émettre dans Pennylane.'},
    'reception': {label:'Facture intermédiaire (réception meubles)', pct:0.40, prio:'Haute', desc:'À émettre dans Pennylane à la réception des meubles fournisseur.'},
    'solde':     {label:'Facture solde de fin de chantier', pct:0.30, prio:'Haute', desc:'Solde après PV de réception signé. À émettre dans Pennylane (déclencher la relance auto si besoin).'}
  }[type];
  if (!cfg) return;
  const montant = Math.round(totalHT * cfg.pct * 100) / 100;
  const titre = `[FACTURATION] ${cfg.label} — ${p.Référence||'projet'} — ${euros(montant)} HT`;
  if (!confirm(`Créer cette tâche pour Virginie ?\n\n• ${cfg.label}\n• Montant : ${euros(montant)} HT (${Math.round(cfg.pct*100)} % de ${euros(totalHT)} signé)\n• Projet : ${p.Référence||p.id}\n• Échéance : aujourd'hui · Priorité Haute\n\nLa facture s'émet ensuite manuellement dans Pennylane.`)) return;
  const today = new Date().toISOString().slice(0,10);
  await _createTask({
    'Titre': titre,
    'Description': `${cfg.desc}\n\nMontant calculé : ${euros(montant)} HT (${Math.round(cfg.pct*100)} % de ${euros(totalHT)} HT signé)\nProjet : ${p.Référence||p.id}`,
    'Assignée à': 'Virginie',
    'Priorité': cfg.prio,
    'Statut': 'À faire',
    'Échéance': today,
    'Projet': [projetId]
  }, `${cfg.label} à émettre — tâche créée pour Virginie (échéance aujourd'hui)`);
}

async function creerTachePV(projetId) {
  const p = DATA.projets.find(x=>x.id===projetId); if(!p) return;
  const today = new Date().toISOString().slice(0,10);
  await _createTask({
    'Titre': `PV de réception — ${p.Référence||'projet'}`,
    'Description': `Préparer et faire signer le PV de réception en présence du client. Sans réserve si possible — sinon noter les réserves dans le journal chantier.`,
    'Assignée à': 'Sébastien',
    'Priorité': 'Haute',
    'Statut': 'À faire',
    'Échéance': today,
    'Projet': [projetId]
  }, `PV de réception à préparer — tâche créée pour Sébastien`);
}

async function creerTacheAvis(projetId) {
  const p = DATA.projets.find(x=>x.id===projetId); if(!p) return;
  const today = new Date().toISOString().slice(0,10);
  await _createTask({
    'Titre': `Demander avis client — ${p.Référence||'projet'}`,
    'Description': `Envoyer un mail au client pour demander un avis Google. Lien Google review : https://g.page/r/...`,
    'Assignée à': 'Marine',
    'Priorité': 'Moyenne',
    'Statut': 'À faire',
    'Échéance': today,
    'Projet': [projetId]
  }, `Avis client à demander — tâche créée pour Marine`);
}

function mailtoConfirmationPose(projetId) {
  const p = DATA.projets.find(x=>x.id===projetId); if(!p) return;
  const cli = Array.isArray(p.Client) ? DATA.clients.find(c=>c.id===p.Client[0]) : null;
  const to = cli?.Email || '';
  const date = p['Date pose prévue'] ? new Date(p['Date pose prévue']).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '[DATE À DÉFINIR]';
  const subject = `Confirmation de la date de pose — ${p.Référence||'votre projet'}`;
  const body = `Bonjour ${cli?.Contact||cli?.Nom||''},

Nous avons le plaisir de confirmer la date de pose de votre cuisine :

📅 ${date}

Notre équipe sera présente sur place dès le matin. Merci de bien vouloir libérer la zone d'intervention la veille au soir.

Si vous avez la moindre question, n'hésitez pas.

Bien cordialement,
L'équipe Tanguy Design
Vannes`;
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
  toast('Mail de confirmation prêt — vérifie le destinataire et envoie', 'success');
}

function scrollToAttachments(fieldName) {
  const id = 'attach-section-' + fieldName.replace(/\s+/g,'-').toLowerCase();
  const el = document.getElementById(id);
  if (el) { el.scrollIntoView({behavior:'smooth', block:'center'}); el.style.animation = 'ps-pulse 1.5s ease-in-out 2'; setTimeout(()=>el.style.animation='', 3500); }
}

// ============ BILAN FINANCIER PRÉVISIONNEL ============
// CA = devis Envoyé/Signé · Coûts auto = commandes fournisseurs + devis artisans HT
// Rétro-commission 5% Tanguy = 5% du HT artisans (réduit le coût pour Tanguy)
function computeBilanFinancier(p, devisLies, commandesLiees, devisArtisansLies) {
  const devisSignes = devisLies.filter(d => d.Statut === 'Signé');
  const devisEnvoyes = devisLies.filter(d => ['Envoyé','Signé'].includes(d.Statut));
  // Total HT pris : signé en priorité, sinon envoyé, sinon brouillon
  const sumHT = (arr) => arr.reduce((s,d)=>s+(d['Total HT final']||d['Total HT après remise']||d['Total HT articles']||0),0);
  const caSigne = sumHT(devisSignes);
  const caPrevi = devisSignes.length ? caSigne : (devisEnvoyes.length ? sumHT(devisEnvoyes) : sumHT(devisLies));
  const mode = devisSignes.length ? 'Réalisé' : (devisEnvoyes.length ? 'Prévisionnel (envoyé)' : 'Prévisionnel (brouillon)');
  const coutsFournisseurs = commandesLiees.reduce((s,c)=>s+(c['Montant HT']||0),0);
  const coutsArtisans = devisArtisansLies.reduce((s,d)=>s+(d['Montant HT']||0),0);
  const retrocom5 = devisArtisansLies.reduce((s,d)=>s+(d['Rétro-commission HT']||(d['Montant HT']||0)*0.05),0);
  // Override coûts manuel (sur le projet)
  const override = p['Coûts réels override'];
  const coutsTotal = (override!=null && override!=='') ? Number(override) : (coutsFournisseurs + coutsArtisans - retrocom5);
  const marge = caPrevi - coutsTotal;
  const margePct = caPrevi > 0 ? (marge/caPrevi*100) : null;
  return {ca:caPrevi, caSigne, mode, coutsFournisseurs, coutsArtisans, retrocom5, coutsTotal, marge, margePct, isOverride: override!=null && override!=''};
}

function bilanFinancierHTML(p, devisLies, commandesLiees, devisArtisansLies) {
  const b = computeBilanFinancier(p, devisLies, commandesLiees, devisArtisansLies);
  if (!b.ca && !b.coutsTotal) return ''; // rien à afficher si projet vide
  const margeCls = b.marge < 0 ? 'bf-neg' : '';
  const pctTxt = b.margePct != null ? b.margePct.toFixed(1)+'%' : '—';
  return `<div class="bilan-fin">
    <div class="bilan-fin-head">
      <div class="bf-title">💰 Bilan financier ${b.isOverride?'(override)':''}</div>
      <div class="bf-mode">${esc(b.mode)}</div>
    </div>
    <div class="bf-grid">
      <div class="bf-cell">
        <div class="bf-lbl">CA HT</div>
        <div class="bf-val">${euros(b.ca)}</div>
        ${b.caSigne && b.ca !== b.caSigne ? `<div class="bf-sub">dont ${euros(b.caSigne)} signé</div>` : ''}
      </div>
      <div class="bf-cell bf-cost">
        <div class="bf-lbl">Coûts HT</div>
        <div class="bf-val">−${euros(b.coutsTotal)}</div>
        <div class="bf-sub">${b.isOverride ? 'manuel' : 'fourn. + artisans − 5%'}</div>
      </div>
      <div class="bf-cell bf-result ${margeCls}">
        <div class="bf-lbl">Marge HT</div>
        <div class="bf-val">${euros(b.marge)}</div>
        <div class="bf-sub">${b.marge>=0?'positif':'négatif'}</div>
      </div>
      <div class="bf-cell bf-result ${margeCls}">
        <div class="bf-lbl">Marge %</div>
        <div class="bf-val">${pctTxt}</div>
        <div class="bf-sub">sur CA HT</div>
      </div>
    </div>
    ${!b.isOverride ? `<div class="bf-breakdown">
      <span class="bf-bd-chip">Fournisseurs <strong>${euros(b.coutsFournisseurs)}</strong></span>
      <span class="bf-bd-chip">Artisans <strong>${euros(b.coutsArtisans)}</strong></span>
      <span class="bf-bd-chip">Rétro 5% <strong style="color:var(--gold-dark)">−${euros(b.retrocom5)}</strong></span>
    </div>` : ''}
  </div>`;
}

// ============ ZONE FACTURATION (Pennylane stub) ============
function facturationZoneHTML(p, devisLies, tachesLiees) {
  const devisSignes = devisLies.filter(d => d.Statut === 'Signé');
  if (!devisSignes.length) return ''; // rien à facturer tant que rien n'est signé
  const totalHT = devisSignes.reduce((s,d)=>s+(d['Total HT final']||d['Total HT après remise']||d['Total HT articles']||0),0);
  const acompteTask = tachesLiees.find(t => /^\[FACTURATION\].*acompte/i.test(t.Titre || ''));
  const interTask   = tachesLiees.find(t => /^\[FACTURATION\].*intermédiaire|réception meubles/i.test(t.Titre || ''));
  const soldeTask   = tachesLiees.find(t => /^\[FACTURATION\].*solde/i.test(t.Titre || ''));
  const isDone = (t) => t && t.Statut === 'Terminée';
  const btn = (type, lbl, pct, task) => {
    const montant = Math.round(totalHT * pct * 100) / 100;
    if (isDone(task)) {
      return `<button class="fz-btn done" disabled>
        <span class="fz-btn-lbl">✓ ${esc(lbl)}</span>
        <span class="fz-btn-amt">${euros(montant)} HT — émise</span>
      </button>`;
    }
    if (task) {
      return `<button class="fz-btn" onclick="switchTab('taches')">
        <span class="fz-btn-lbl">⏳ ${esc(lbl)}</span>
        <span class="fz-btn-amt">${euros(montant)} HT — en tâche</span>
      </button>`;
    }
    return `<button class="fz-btn" onclick="creerTacheFacturation('${p.id}','${type}')">
      <span class="fz-btn-lbl">📄 ${esc(lbl)}</span>
      <span class="fz-btn-amt">${euros(montant)} HT (${Math.round(pct*100)}%)</span>
    </button>`;
  };
  return `<div class="facturation-zone">
    <div class="fz-head">
      <div class="fz-title">💸 Facturation client</div>
      <div class="fz-status">CA signé HT : <strong style="color:var(--gold-dark)">${euros(totalHT)}</strong> · Pennylane stub</div>
    </div>
    <div class="fz-buttons">
      ${btn('acompte', 'Facture acompte', 0.30, acompteTask)}
      ${btn('reception', 'Facture réception', 0.40, interTask)}
      ${btn('solde', 'Facture solde', 0.30, soldeTask)}
    </div>
  </div>`;
}

function renderProjetDetail(p){
  CURRENT_PROJET_ID = p.id;
  const editing = PROJET_EDIT;
  const clientId = Array.isArray(p.Client) ? p.Client[0] : null;
  const client = clientId ? DATA.clients.find(c => c.id === clientId) : null;

  // Linked
  const devisLies = DATA.devis.filter(d => Array.isArray(d.Projet) && d.Projet.includes(p.id))
    .sort((a,b)=>(b['Date devis']||'').localeCompare(a['Date devis']||''));
  const commandesLiees = DATA.commandes.filter(c => Array.isArray(c.Projet) && c.Projet.includes(p.id));
  const tachesLiees = DATA.taches.filter(t => Array.isArray(t.Projet) && t.Projet.includes(p.id));
  const devisArtisansLies = (DATA['devis-artisans']||[]).filter(d => Array.isArray(d.Projet) && d.Projet.includes(p.id));
  const totalRetrocom = devisArtisansLies.reduce((s,d) => s + (d['Rétro-commission HT']||0), 0);
  const totalArtisansHT = devisArtisansLies.reduce((s,d) => s + (d['Montant HT']||0), 0);

  // Timeline events
  const events = [];
  if (p['Date découverte']) events.push({date:p['Date découverte'],label:'Découverte',type:'decouverte'});
  devisLies.forEach(d => { if (d['Date devis']) events.push({date:d['Date devis'],label:`Devis ${d['Numéro devis']||''} · ${euros(d['Total TTC'])}`,type:d.Statut==='Signé'?'signe':'devis'}); });
  commandesLiees.forEach(c => { if (c['Date création']) events.push({date:c['Date création'],label:`Commande ${c['Numéro']||''}`,type:'commande'}); if (c['Date livraison prévue']) events.push({date:c['Date livraison prévue'],label:`Livraison prévue ${c['Numéro']||''}`,type:'livraison'}); });
  if (p['Date pose prévue']) events.push({date:p['Date pose prévue'],label:'Pose prévue',type:'pose'});
  events.sort((a,b)=>(a.date||'').localeCompare(b.date||''));

  const statuts = ['Découverte','Dessin','Devis','Signé','Commandes','Pose','SAV','Terminé'];
  const statutClass = {'Découverte':'b-gray','Dessin':'b-blue','Devis':'b-amber','Signé':'b-green','Commandes':'b-blue','Pose':'b-amber','SAV':'b-red','Terminé':'b-gray'}[p.Statut]||'b-gray';

  const fld = (key, val, type='text') => editing
    ? `<input class="edit-inp" data-pf="${key}" value="${esc(val||'')}" ${type==='date'?'type="date"':''} ${type==='number'?'type="number" step="0.01"':''}>`
    : `<strong>${type==='euros'?euros(val):type==='pct'?pct(val):esc(val||'—')}</strong>`;

  const html = `
    <button class="devis-back" type="button" onclick="closeProjetDetail()">← Tous les projets</button>
    <div class="proj-layout">
      ${projetTOC(p, devisLies, commandesLiees, tachesLiees, devisArtisansLies)}
      <div class="proj-main">
        <div class="devis-detail">
          <div class="devis-header">
            <div>
              <h1 class="devis-title" style="font:inherit;font-size:20px;font-weight:500">${esc(p.Référence||'Projet')} <span class="badge ${statutClass}">${esc(p.Statut||'')}</span></h1>
              <div class="devis-sub">${client?`Client : <a href="#" onclick="event.preventDefault();openClientDetail('${client.id}')" style="color:var(--gold-dark)">${esc(client.Nom)}</a>`:'<em>Client non lié — sera créé à l\'import du prochain devis Winner</em>'}</div>
              ${p.Description ? `<div style="margin-top:6px;font-size:13px;color:var(--ink2);max-width:560px;line-height:1.4">${esc(p.Description.slice(0,180))}${p.Description.length>180?` <a href="#zone-info" onclick="event.preventDefault();document.getElementById('zone-info').scrollIntoView({behavior:'smooth'})" style="color:var(--gold-dark)">voir +</a>`:''}</div>` : ''}
            </div>
            <div style="display:flex;align-items:flex-start;gap:24px">
              <div>
                <div class="devis-total-lbl">Budget HT</div>
                <div class="devis-total">${euros(p['Budget HT'])}</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                ${editing
                  ? `<button class="btn-primary" type="button" onclick="saveProjet('${p.id}')">Enregistrer</button><button class="btn-ghost" type="button" onclick="toggleProjetEdit(false)">Annuler</button>`
                  : `<button class="btn-ghost" type="button" onclick="toggleProjetEdit(true)">Modifier</button><button class="btn-danger" type="button" onclick="deleteProjet('${p.id}')">Supprimer</button>`}
              </div>
            </div>
          </div>

          <div id="zone-stepper">${parcoursStepperHTML(computeParcours(p, devisLies, commandesLiees, tachesLiees, devisArtisansLies), p)}</div>

          <div id="zone-bilan">${bilanFinancierHTML(p, devisLies, commandesLiees, devisArtisansLies)}</div>

          <h2 id="zone-info" class="zone-title">Informations</h2>
          <div class="proj-grid">
            <div><span class="proj-lbl">Référence</span>${editing?fld('Référence',p.Référence):'<strong>'+esc(p.Référence||'—')+'</strong>'}</div>
            <div><span class="proj-lbl">Statut</span>${editing?`<select class="edit-inp" data-pf="Statut">${statuts.map(s=>`<option ${p.Statut===s?'selected':''}>${s}</option>`).join('')}</select>`:'<strong>'+esc(p.Statut||'—')+'</strong>'}</div>
            <div><span class="proj-lbl">Budget HT</span>${editing?fld('Budget HT',p['Budget HT'],'number'):'<strong>'+euros(p['Budget HT'])+'</strong>'}</div>
            <div><span class="proj-lbl">Marge prévisionnelle</span>${editing?fld('Marge prévisionnelle',p['Marge prévisionnelle'],'number'):'<strong>'+pct(p['Marge prévisionnelle'])+'</strong>'}</div>
            <div><span class="proj-lbl">Date découverte</span>${editing?fld('Date découverte',p['Date découverte'],'date'):'<strong>'+esc(p['Date découverte']||'—')+'</strong>'}</div>
            <div><span class="proj-lbl">Date pose prévue</span>${editing?fld('Date pose prévue',p['Date pose prévue'],'date'):'<strong>'+esc(p['Date pose prévue']||'—')+'</strong>'}</div>
          </div>
          <div class="form-row" style="margin-top:14px"><label class="proj-lbl">Description</label>${editing?`<textarea class="edit-inp" data-pf="Description" rows="3">${esc(p.Description||'')}</textarea>`:'<div style="font-size:13px;color:var(--ink2);white-space:pre-wrap">'+esc(p.Description||'—')+'</div>'}</div>

          ${events.length ? `
            <h2 class="zone-title" style="margin-top:24px">Timeline du chantier</h2>
            <div class="timeline">
              ${events.map(e=>`<div class="tl-item tl-${e.type}"><div class="tl-date">${esc(e.date)}</div><div class="tl-label">${esc(e.label)}</div></div>`).join('')}
            </div>` : ''}

          ${(() => {
            const principaux = devisLies.filter(d => (d['Type devis']||'Principal') === 'Principal');
            const additifs = devisLies.filter(d => d['Type devis'] === 'Additif');
            const totalAdditifs = additifs.reduce((s,d)=>s+(d['Total HT final']||d['Total HT après remise']||d['Total HT articles']||0),0);
            const totalPrincipal = principaux.reduce((s,d)=>s+(d['Total HT final']||d['Total HT après remise']||d['Total HT articles']||0),0);
            const totalCumule = totalPrincipal + totalAdditifs;
            const renderRow = (d) => {
              const sc = {'Brouillon':'b-gray','Envoyé':'b-amber','Signé':'b-green','Annulé':'b-red'}[d.Statut]||'b-gray';
              const tc = d['Type devis'] === 'Additif' ? 'b-amber' : 'b-blue';
              return `<div class="proj-row" onclick="switchTab('devis');openDevisDetail('${d.id}')">
                <div><strong>${esc(d['Numéro devis']||'—')}</strong> <span class="badge ${tc}">${esc(d['Type devis']||'Principal')}</span> <span class="badge ${sc}">${esc(d.Statut||'')}</span>${d.Milieu?` <span class="badge b-blue">${esc(d.Milieu)}</span>`:''}</div>
                <div style="font-family:'DM Mono',monospace">${euros(d['Total TTC'])}</div>
              </div>`;
            };
            return `
            <h2 id="zone-devis" class="zone-title" style="margin-top:24px;display:flex;align-items:center;justify-content:space-between">
              <span>Devis Tanguy Design (${devisLies.length})</span>
              <div style="display:flex;gap:6px;align-items:center">
                ${additifs.length ? `<span style="font-size:11px;color:var(--ink2);font-weight:400">Cumul HT : <strong>${euros(totalCumule)}</strong></span>` : ''}
                <button class="abtn" type="button" onclick="openDevisAdditifModal('${p.id}')" title="Ajouter un devis additif (augmentation de scope)">+ Devis additif</button>
              </div>
            </h2>
            ${principaux.length ? `<div class="proj-list">${principaux.map(renderRow).join('')}</div>` :
              emptyCTA('Pas encore de devis principal', 'Importe le PDF Winner pour générer le devis + ses zones/lignes/échéances en un seul clic.', '📄 Importer un PDF Winner', `closeProjetDetail();switchTab('devis');setTimeout(()=>document.getElementById('devis-pdf-input').click(),100)`)}
            ${additifs.length ? `<div style="margin-top:8px"><div style="font-size:11px;color:var(--ink2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Devis additifs · ${euros(totalAdditifs)} HT</div><div class="proj-list">${additifs.map(renderRow).join('')}</div></div>` : ''}`;
          })()}

          <div id="zone-fact">${facturationZoneHTML(p, devisLies, tachesLiees)}</div>

          <h2 id="zone-cmds" class="zone-title" style="margin-top:24px">Commandes fournisseurs (${commandesLiees.length})</h2>
          ${commandesLiees.length ? (() => {
            const TYPES = ['Cuisine','Électroménager','Plan de travail','Sanitaire','Plan technique','Accessoires','Autre'];
            const grouped = {};
            commandesLiees.forEach(c => {
              const t = c.Type || 'Non typé';
              (grouped[t] = grouped[t] || []).push(c);
            });
            const order = [...TYPES, 'Non typé'].filter(t => grouped[t]);
            const renderCmd = (c) => {
              const sc = {'Créée':'b-gray','Envoyée':'b-amber','Confirmée':'b-blue','Livrée':'b-green','Posée':'b-ink'}[c.Statut]||'b-gray';
              const next = {'Créée':'Envoyée','Envoyée':'Confirmée','Confirmée':'Livrée','Livrée':'Posée'}[c.Statut];
              const urg = commandeUrgencyBadges(c);
              return `<div class="proj-row" style="flex-wrap:wrap;gap:6px;cursor:pointer" onclick="openCommandeDetail('${c.id}')">
                <div style="flex:1;min-width:200px">
                  <strong>${esc(c['Numéro']||'—')}</strong>
                  <span class="badge ${sc}">${esc(c.Statut||'')}</span>
                  ${c.Type?`<span class="badge b-blue">${esc(c.Type)}</span>`:''}
                  ${urg}
                </div>
                <div style="font-family:'DM Mono',monospace">${euros(c['Montant HT'])}</div>
                ${next ? `<button type="button" class="cmd-qa-btn" onclick="event.stopPropagation();commandeQuickAdvance('${c.id}','${next}')" title="Passer à ${next}">→ ${next}</button>` : ''}
              </div>`;
            };
            return order.map(t => {
              const arr = grouped[t];
              const total = arr.reduce((s,c)=>s+(c['Montant HT']||0),0);
              return `<div style="margin-top:10px">
                <div style="font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink2);margin-bottom:4px">${esc(t)} · ${arr.length} cmd · ${euros(total)} HT</div>
                <div class="proj-list">${arr.map(renderCmd).join('')}</div>
              </div>`;
            }).join('');
          })() : emptyCTA('Pas encore de commande', 'Les commandes fournisseurs sont auto-créées à la signature d\'un devis. Tu peux aussi en ajouter manuellement.', '+ Nouvelle commande', `closeProjetDetail();switchTab('commandes');openModal('commandes')`)}

          ${(() => {
            const artisanIds = Array.isArray(p.Artisans) ? p.Artisans : [];
            const artisansProjet = artisanIds.map(id => DATA.artisans.find(a=>a.id===id)).filter(Boolean);
            const ficheByArtisan = {};
            (DATA['devis-artisans']||[]).forEach(da => {
              if (!Array.isArray(da.Projet) || !da.Projet.includes(p.id)) return;
              const aid = Array.isArray(da.Artisan) ? da.Artisan[0] : null;
              if (!aid) return;
              const fiche = (da['Fiche de mission PDF']||[])[0];
              if (fiche) ficheByArtisan[aid] = fiche.url;
            });
            return `
            <h2 id="zone-artisans" class="zone-title" style="margin-top:24px">Artisans du chantier (${artisansProjet.length})</h2>
            ${artisansProjet.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
              ${artisansProjet.map(a => {
                const ficheUrl = ficheByArtisan[a.id];
                return `<span class="art-chip" style="display:inline-flex;align-items:center;gap:4px;background:var(--paper);border:1px solid var(--border);border-radius:16px;padding:4px 4px 4px 10px;font-size:12px">
                  <span>${esc(a.Nom)}</span>
                  <span style="color:var(--ink2);font-size:10px">${esc(a['Spécialité']||'')}</span>
                  ${ficheUrl ? `<a href="${ficheUrl}" target="_blank" style="color:var(--green);text-decoration:none;font-size:12px;padding:0 4px" title="Voir la fiche PDF">📄</a>` : ''}
                  <button type="button" onclick="openFicheEditor('${p.id}','${a.id}')" style="background:none;border:none;color:var(--gold-dark);cursor:pointer;font-size:12px;padding:0 4px" title="${ficheUrl?'Modifier la fiche':'Créer la fiche'}">✏️</button>
                  <button type="button" onclick="removeArtisanFromProjet('${p.id}','${a.id}')" style="background:none;border:none;color:var(--ink2);cursor:pointer;font-size:14px;padding:0 4px" title="Retirer">×</button>
                </span>`;
              }).join('')}
              <button type="button" onclick="openArtisanPicker('${p.id}')" class="btn-ghost" style="padding:4px 10px;font-size:12px">+ Ajouter un artisan</button>
            </div>` : emptyCTA('Aucun artisan affecté', 'Ajoute les artisans du chantier pour générer leurs fiches de mission et calculer la rétro-commission 5 %.', '+ Affecter un artisan', `openArtisanPicker('${p.id}')`)}`;
          })()}

          <h2 id="zone-devis-art" class="zone-title" style="margin-top:24px">Devis artisans (${devisArtisansLies.length}) <span style="float:right;font-size:12px;color:var(--ink2);font-weight:400">Total HT : <strong>${euros(totalArtisansHT)}</strong> · Rétro 5 % : <strong style="color:var(--gold-dark)">${euros(totalRetrocom)}</strong></span></h2>
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <label class="btn-ghost" style="cursor:pointer">
              📎 Uploader un devis artisan
              <input type="file" accept="application/pdf" style="display:none" onchange="uploadArtisanDevis(event,'${p.id}')">
            </label>
            ${(Array.isArray(p.Artisans)&&p.Artisans.length) ? `<button class="btn-primary" type="button" onclick="sendAllFichesMission('${p.id}')">✉️ Générer & envoyer les fiches de mission (${p.Artisans.length})</button>` : ''}
          </div>
          ${devisArtisansLies.length ? `<div class="proj-list">${devisArtisansLies.map(d => {
            const artId = Array.isArray(d.Artisan) ? d.Artisan[0] : null;
            const art = artId ? DATA.artisans.find(a=>a.id===artId) : null;
            const sc = {'À valider':'b-amber','Validé':'b-blue','Fiche envoyée':'b-green','Annulé':'b-red'}[d.Statut]||'b-gray';
            const pdfUrl = (d['PDF devis original']||[])[0]?.url;
            const ficheUrl = (d['Fiche de mission PDF']||[])[0]?.url;
            return `<div class="proj-row">
              <div style="flex:1">
                <div><strong>${esc(d['Numéro devis']||'—')}</strong> <span class="badge ${sc}">${esc(d.Statut||'')}</span> ${art?`<span class="badge b-blue">${esc(art.Nom)}</span>`:'<span class="badge b-red">Artisan non lié</span>'}</div>
                <div style="font-size:11px;color:var(--ink2);margin-top:4px">${esc(d['Description travaux']||'').slice(0,120)}${(d['Description travaux']||'').length>120?'…':''}</div>
              </div>
              <div style="text-align:right;min-width:200px">
                <div style="font-family:'DM Mono',monospace">${euros(d['Montant HT'])} HT</div>
                <div style="font-size:11px;color:var(--gold-dark)">Rétro 5 % : ${euros(d['Rétro-commission HT'])}</div>
                <div style="margin-top:4px;display:flex;gap:6px;justify-content:flex-end">
                  ${pdfUrl?`<a href="${pdfUrl}" target="_blank" style="font-size:11px;color:var(--ink2)">📄 Devis</a>`:''}
                  ${ficheUrl?`<a href="${ficheUrl}" target="_blank" style="font-size:11px;color:var(--green)">📋 Fiche</a>`:''}
                  <button type="button" onclick="sendFicheMission('${d.id}')" style="font-size:11px;background:none;border:1px solid var(--ink2);color:var(--ink2);padding:2px 8px;border-radius:4px;cursor:pointer">✉️ Envoyer</button>
                  <button type="button" onclick="deleteArtisanDevis('${d.id}')" style="font-size:11px;background:none;border:1px solid #c44;color:#c44;padding:2px 8px;border-radius:4px;cursor:pointer">🗑</button>
                </div>
              </div>
            </div>`;
          }).join('')}</div>` : emptyCTA('Aucun devis artisan', 'Upload un PDF de devis artisan pour le rattacher au chantier et calculer la rétro-commission 5 %.', null, null)}

          <h2 id="zone-taches" class="zone-title" style="margin-top:24px">Tâches (${tachesLiees.length})</h2>
          ${tachesLiees.length ? `<div class="proj-list">${tachesLiees.map(t=>{
            const pc = {'Haute':'b-red','Moyenne':'b-amber','Basse':'b-gray'}[t.Priorité]||'b-gray';
            const sc = {'À faire':'b-gray','En cours':'b-amber','Terminée':'b-green'}[t.Statut]||'b-gray';
            return `<div class="proj-row">
              <div><strong>${esc(t.Titre||'—')}</strong> <span class="badge ${pc}">${esc(t.Priorité||'')}</span> <span class="badge ${sc}">${esc(t.Statut||'')}</span></div>
              <div style="font-size:11px;color:var(--ink2)">${esc(t['Assignée à']||'')} · ${esc(t.Échéance||'')}</div>
            </div>`;
          }).join('')}</div>` : emptyCTA('Aucune tâche sur ce chantier', 'Les tâches d\'orchestration (acompte, BC fournisseurs, planif pose) sont créées auto à la signature d\'un devis.', '+ Nouvelle tâche', `openTaskEdit(null)`)}

          <div id="zone-plaud">${projetReunionsSection(p)}</div>

          <div id="zone-journal">${projetJournalSection(p)}</div>

          ${projetAttachmentsTabs(p)}

        </div>
      </div>
    </div>`;
  document.getElementById('projet-detail-view').innerHTML = html;
  if (typeof makeCardsAccessible === 'function') makeCardsAccessible();
}

// ============ JOURNAL DE CHANTIER ============
function parseJournalEntries(raw) {
  return (raw || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    return m ? { meta: m[1], text: m[2] } : { meta: '', text: line };
  });
}
function projetJournalSection(p) {
  const entries = parseJournalEntries(p['Journal chantier']);
  return `
    <div class="zone-title" style="margin-top:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
      <span>Journal de chantier (${entries.length})</span>
      <div style="display:flex;gap:6px">
        <button class="abtn" onclick="openFicheChantier('${p.id}','tanguy')" title="Fiche complète avec budget et marge — usage interne Tanguy Design">📋 Fiche Tanguy</button>
        <button class="abtn" onclick="openFicheChantier('${p.id}','artisan')" title="Fiche sans budget, focalisée sur le plan technique — à transmettre aux artisans">🛠️ Fiche Artisan</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <input id="journal-input" placeholder="Nouvelle remarque datée (RDV, appel, décision…)" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:4px;font-family:inherit;font-size:13px" onkeydown="if(event.key==='Enter')addJournalEntry('${p.id}')">
      <button class="abtn primary" onclick="addJournalEntry('${p.id}')">+ Remarque</button>
    </div>
    ${entries.length ? `<div class="journal-list">${entries.map(e => `
      <div class="journal-entry">
        ${e.meta ? `<div class="journal-meta">${esc(e.meta)}</div>` : ''}
        <div class="journal-text">${esc(e.text)}</div>
      </div>`).join('')}</div>` : '<div class="muted" style="font-size:12px;color:var(--ink4);padding:8px">Aucune remarque — la première structure ton historique chantier.</div>'}`;
}
async function addJournalEntry(projetId) {
  const input = document.getElementById('journal-input');
  const text = (input?.value || '').trim();
  if (!text) { toastError('Écris une remarque'); return; }
  showLoader('Ajout…');
  try {
    const r = await fetch('/api/projets/'+projetId+'/journal', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'erreur');
    if (input) input.value = '';
    toastSuccess('Remarque ajoutée');
    await loadAll();
    const p = DATA.projets.find(x=>x.id===projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

// ============ RÉUNIONS PLAUD R1/R2 (intégrées dans la fiche projet) ============
// R1 = découverte / avant chantier · R2 = chantier / après pose
function projetReunionsSection(p) {
  const reunions = (DATA['reunions-plaud']||[]).filter(r => Array.isArray(r.Projet) && r.Projet.includes(p.id));
  const r1 = reunions.filter(r => (r.Niveau||'R1') === 'R1');
  const r2 = reunions.filter(r => r.Niveau === 'R2');
  const renderReunion = (r) => {
    const synth = (r.Synthèse||'').slice(0, 200);
    const date = r['Date heure'] ? new Date(r['Date heure']).toLocaleDateString('fr-FR') : '—';
    return `<div class="proj-row" style="flex-direction:column;align-items:flex-start;cursor:pointer" onclick="openReunionDetail('${r.id}')">
      <div style="display:flex;justify-content:space-between;width:100%">
        <div><strong>${esc(r.Titre||'Réunion')}</strong> <span class="badge b-blue">${esc(r['Type réunion']||'')}</span></div>
        <div style="font-size:11px;color:var(--ink3)">${esc(date)}</div>
      </div>
      ${synth ? `<div style="font-size:12px;color:var(--ink2);margin-top:4px">${esc(synth)}${(r.Synthèse||'').length>200?'…':''}</div>` : ''}
    </div>`;
  };
  return `
    <div class="zone-title" style="margin-top:24px;display:flex;align-items:center;justify-content:space-between">
      <span>R1 · Découverte (${r1.length})</span>
      <button class="abtn" onclick="openPlaudModalForProjet('${p.id}','R1')" title="Coller une transcription Plaud R1 (avant chantier)">+ Transcription R1</button>
    </div>
    ${r1.length ? `<div class="proj-list">${r1.map(renderReunion).join('')}</div>` : '<div class="muted" style="font-size:12px;color:var(--ink4);padding:8px">Aucune transcription R1. Colle une transcription Plaud du R1 (découverte/présentation devis) pour enrichir le projet.</div>'}

    <div class="zone-title" style="margin-top:18px;display:flex;align-items:center;justify-content:space-between">
      <span>R2 · Chantier (${r2.length})</span>
      <button class="abtn" onclick="openPlaudModalForProjet('${p.id}','R2')" title="Coller une transcription Plaud R2 (chantier en cours / réception)">+ Transcription R2</button>
    </div>
    ${r2.length ? `<div class="proj-list">${r2.map(renderReunion).join('')}</div>` : '<div class="muted" style="font-size:12px;color:var(--ink4);padding:8px">Aucune transcription R2. Colle une transcription chantier (réunion de pose, point client, etc.).</div>'}
  `;
}

function openReunionDetail(reunionId){
  const r = (DATA['reunions-plaud']||[]).find(x => x.id === reunionId);
  if (!r) return;
  $('#modalTitle').textContent = `${r.Titre||'Réunion'} · ${r['Type réunion']||''}`;
  $('#modalBody').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:12px;margin-bottom:14px">
      <div><span style="color:var(--ink3)">Niveau</span><br><strong>${esc(r.Niveau||'R1')}</strong></div>
      <div><span style="color:var(--ink3)">Date</span><br><strong>${esc(r['Date heure']||'—')}</strong></div>
      <div><span style="color:var(--ink3)">Lieu</span><br><strong>${esc(r.Lieu||'—')}</strong></div>
      <div><span style="color:var(--ink3)">Type</span><br><strong>${esc(r['Type réunion']||'—')}</strong></div>
    </div>
    ${r.Synthèse?`<div class="plaud-section"><span class="plaud-tag">Synthèse</span><div style="white-space:pre-wrap">${esc(r.Synthèse)}</div></div>`:''}
    ${r.Contexte?`<div class="plaud-section"><span class="plaud-tag">Contexte</span><div style="white-space:pre-wrap">${esc(r.Contexte)}</div></div>`:''}
    ${r.Attentes?`<div class="plaud-section"><span class="plaud-tag">Attentes</span><div style="white-space:pre-wrap">${esc(r.Attentes)}</div></div>`:''}
    ${r['Points de douleur']?`<div class="plaud-section"><span class="plaud-tag">Points de douleur</span><div style="white-space:pre-wrap">${esc(r['Points de douleur'])}</div></div>`:''}
    ${r['Tâches identifiées']?`<div class="plaud-section"><span class="plaud-tag">Tâches identifiées</span><div style="white-space:pre-wrap">${esc(r['Tâches identifiées'])}</div></div>`:''}
    ${r['Autres informations']?`<div class="plaud-section"><span class="plaud-tag">Autres</span><div style="white-space:pre-wrap">${esc(r['Autres informations'])}</div></div>`:''}
  `;
  $('#modalFoot').innerHTML = '';
  currentModalTable = null;
  currentModalRecordId = null;
  $('#modalBg').classList.add('on');
}

// Ouvre le modal Plaud pré-paramétré pour un projet et un niveau (R1/R2)
function openPlaudModalForProjet(projetId, niveau){
  const niv = niveau === 'R2' ? 'R2' : 'R1';
  const defaultType = niv === 'R1' ? 'Découverte' : 'Chantier';
  $('#modalTitle').textContent = `Nouvelle transcription Plaud · ${niv}`;
  $('#modalBody').innerHTML = `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:10px">Niveau <strong>${niv}</strong> · projet courant. La transcription sera analysée par Claude et liée au projet.</div>
    <label>Type de réunion</label>
    <select id="plaud-type">
      ${(niv==='R1'?['Découverte','Présentation devis','Autre']:['Chantier','SAV','Autre']).map(t=>`<option ${t===defaultType?'selected':''}>${t}</option>`).join('')}
    </select>
    <label>Transcription brute (coller le texte du Plaud)</label>
    <textarea id="plaud-transcript" style="min-height:180px" placeholder="Colle ici la transcription complète…"></textarea>
    <input type="hidden" id="plaud-projet-id" value="${esc(projetId)}">
    <input type="hidden" id="plaud-niveau" value="${niv}">
  `;
  $('#modalFoot').innerHTML = `<button class="btn-primary" onclick="submitPlaud()">Analyser & enregistrer</button>`;
  currentModalTable = '__plaud__';
  $('#modalBg').classList.add('on');
}

// Ouvre le modal d'import devis additif pour un projet existant.
// Le bouton "Enregistrer" du modal standard appelle submitModal() qui dispatche vers submitDevisAdditif()
// (cf. dispatch dans submitModal — pas besoin de footer custom, le modal n'a pas de #modalFoot).
function openDevisAdditifModal(projetId){
  $('#modalTitle').textContent = 'Devis additif · upload PDF';
  $('#modalBody').innerHTML = `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:10px">Le devis sera ajouté comme <strong>Additif</strong> au projet courant (augmentation de scope). Aucun nouveau client/projet n'est créé.</div>
    <label>PDF du devis additif</label>
    <input type="file" id="devis-additif-file" accept="application/pdf">
    <input type="hidden" id="devis-additif-projet-id" value="${esc(projetId)}">
    <div style="font-size:11px;color:var(--ink4);margin-top:8px">Claude analysera le PDF (Winner/Métron). Le record Devis créé aura Type=Additif et sera lié au projet courant. Clique « Enregistrer » pour lancer l'import.</div>
  `;
  currentModalTable = '__devis_additif__';
  // Cache le bouton Supprimer (pas pertinent en mode upload)
  const delBtn = document.getElementById('modalDeleteBtn');
  if (delBtn) delBtn.style.display = 'none';
  $('#modalBg').classList.add('on');
}

async function submitDevisAdditif(){
  const file = document.getElementById('devis-additif-file').files[0];
  const projetId = document.getElementById('devis-additif-projet-id').value;
  if (!file) { toastError('Sélectionne un PDF'); return; }
  if (!projetId) { toastError('Projet manquant'); return; }
  showLoader('Analyse du devis additif…');
  try {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('projetId', projetId);
    fd.append('type', 'Additif');
    const r = await fetch('/api/devis/import', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'erreur');
    toastSuccess(`Devis additif créé · ${d.parsed_summary?.lignes||0} lignes`);
    closeModal();
    await loadAll();
    const p = DATA.projets.find(x => x.id === projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

// ============ FICHE CHANTIER (récap imprimable + envoi) ============
// Mode = 'tanguy' (avec budget) ou 'artisan' (sans budget, focus plan technique).
let CURRENT_FICHE_MODE = 'tanguy';
function openFicheChantier(projetId, mode) {
  CURRENT_FICHE_MODE = (mode === 'artisan') ? 'artisan' : 'tanguy';
  return _renderFicheChantier(projetId);
}
function switchFicheMode(mode){
  CURRENT_FICHE_MODE = mode === 'artisan' ? 'artisan' : 'tanguy';
  const projetId = document.getElementById('fiche-ch-host')?.dataset.projetId;
  if (projetId) { closeFicheChantier(); _renderFicheChantier(projetId); }
}
function _renderFicheChantier(projetId) {
  const p = DATA.projets.find(x => x.id === projetId);
  if (!p) return;
  const isArtisan = CURRENT_FICHE_MODE === 'artisan';
  const client = Array.isArray(p.Client) ? DATA.clients.find(c => c.id === p.Client[0]) : null;
  const devisLies = DATA.devis.filter(d => Array.isArray(d.Projet) && d.Projet.includes(p.id));
  const commandesLiees = DATA.commandes.filter(c => Array.isArray(c.Projet) && c.Projet.includes(p.id));
  const tachesLiees = DATA.taches.filter(t => Array.isArray(t.Projet) && t.Projet.includes(p.id));
  const artisansProjet = (Array.isArray(p.Artisans) ? p.Artisans : []).map(id => DATA.artisans.find(a=>a.id===id)).filter(Boolean);
  const devisArtisansLies = (DATA['devis-artisans']||[]).filter(d => Array.isArray(d.Projet) && d.Projet.includes(p.id));
  const journalEntries = parseJournalEntries(p['Journal chantier']);
  const planTech = Array.isArray(p['Plan technique']) ? p['Plan technique'] : [];

  const totalDevisHT = devisLies.reduce((s,d)=>s+(d['Total HT final']||d['Total HT après remise']||d['Total HT articles']||0),0);
  const totalCmdHT  = commandesLiees.reduce((s,c)=>s+(c['Montant HT']||0),0);
  const totalArtisansHT = devisArtisansLies.reduce((s,d)=>s+(d['Montant HT']||0),0);
  const marge = totalDevisHT - totalCmdHT - totalArtisansHT;

  const titreFiche = isArtisan ? '🛠️ Fiche Artisan' : '📋 Fiche Tanguy';
  const sousTitre = isArtisan
    ? 'Document chantier sans informations financières — destiné aux artisans intervenant'
    : 'Document interne complet — vue Tanguy Design avec budget et marge';

  const html = `
    <div class="modal-bg on" id="fiche-ch-bg" onclick="if(event.target===this)closeFicheChantier()">
      <div class="modal-card fc-modal" style="max-width:860px;max-height:94vh;overflow-y:auto;padding:0">
        <div class="modal-head no-print" style="padding:16px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:10;flex-wrap:wrap;gap:8px">
          <div class="modal-title" style="margin:0">${titreFiche} · ${esc(p.Référence||'—')}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <div style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
              <button class="abtn" style="border-radius:0;border:none;${!isArtisan?'background:var(--ink);color:#fff':''}" onclick="switchFicheMode('tanguy')">Tanguy</button>
              <button class="abtn" style="border-radius:0;border:none;border-left:1px solid var(--border);${isArtisan?'background:var(--ink);color:#fff':''}" onclick="switchFicheMode('artisan')">Artisan</button>
            </div>
            <button class="abtn" onclick="window.print()">📄 Imprimer / PDF</button>
            <button class="abtn primary" onclick="sendFicheChantier('${p.id}')">✉️ Envoyer</button>
            <button class="modal-close" onclick="closeFicheChantier()">×</button>
          </div>
        </div>
        <div class="fc-body" style="padding:28px 36px">
          <h1 style="font-family:'DM Serif Display',serif;font-weight:400;font-size:28px;margin:0 0 4px">${esc(p.Référence||'Projet')}</h1>
          <div style="color:var(--ink3);margin-bottom:6px;font-size:13px">${titreFiche} générée le ${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}${window.ME?' · '+esc(window.ME.charAt(0).toUpperCase()+window.ME.slice(1)):''}</div>
          <div style="color:var(--ink4);margin-bottom:22px;font-size:11px;font-style:italic">${esc(sousTitre)}</div>

          <div class="fc-section">
            <div class="fc-title">Informations projet</div>
            <div class="fc-grid">
              <div><span class="fc-lbl">Statut</span><strong>${esc(p.Statut||'—')}</strong></div>
              ${isArtisan ? '' : `<div><span class="fc-lbl">Budget HT</span><strong>${euros(p['Budget HT'])}</strong></div>`}
              ${isArtisan ? '' : `<div><span class="fc-lbl">Marge prévue</span><strong>${pct(p['Marge prévisionnelle'])}</strong></div>`}
              <div><span class="fc-lbl">Date découverte</span><strong>${esc(p['Date découverte']||'—')}</strong></div>
              <div><span class="fc-lbl">Date pose prévue</span><strong>${esc(p['Date pose prévue']||'—')}</strong></div>
              <div><span class="fc-lbl">Artisans</span><strong>${artisansProjet.length}</strong></div>
            </div>
            ${p.Description ? `<div style="margin-top:12px;padding:12px 14px;background:#faf8f4;border-radius:6px;font-size:13px;white-space:pre-wrap">${esc(p.Description)}</div>` : ''}
          </div>

          ${client ? `
          <div class="fc-section">
            <div class="fc-title">Client</div>
            <div><strong>${esc(client.Nom||'—')}</strong>${client.Contact?' · '+esc(client.Contact):''}</div>
            <div style="color:var(--ink3);font-size:13px;margin-top:4px">${[client.Email,client.Téléphone].filter(Boolean).map(esc).join(' · ')}</div>
            ${client.Adresse?`<div style="color:var(--ink3);font-size:13px;margin-top:4px;white-space:pre-wrap">${esc(client.Adresse)}</div>`:''}
          </div>` : ''}

          ${planTech.length ? `
          <div class="fc-section">
            <div class="fc-title">Plan technique (${planTech.length})</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${planTech.map(a => `<a href="${a.url}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:4px;font-size:12px;text-decoration:none;color:var(--ink2)"><span style="font-family:'DM Mono',monospace;font-size:9px;background:var(--ink);color:#fff;padding:2px 5px;border-radius:2px">${esc((a.filename||'').split('.').pop().toUpperCase())}</span><span>${esc(a.filename||'plan')}</span></a>`).join('')}
            </div>
          </div>` : ''}

          ${isArtisan ? '' : `
          <div class="fc-section">
            <div class="fc-title">Bilan financier</div>
            <table class="fc-table"><tbody>
              <tr><td>Devis Tanguy Design (HT)</td><td class="num">${euros(totalDevisHT)}</td></tr>
              <tr><td>Commandes fournisseurs (HT)</td><td class="num">${euros(totalCmdHT)}</td></tr>
              <tr><td>Devis artisans (HT)</td><td class="num">${euros(totalArtisansHT)}</td></tr>
              <tr style="font-weight:700;border-top:2px solid var(--ink)"><td>Marge estimée</td><td class="num ${marge>=0?'':'fc-neg'}">${euros(marge)}</td></tr>
            </tbody></table>
          </div>`}

          ${(isArtisan || !devisLies.length) ? '' : `
          <div class="fc-section">
            <div class="fc-title">Devis (${devisLies.length})</div>
            <table class="fc-table"><tbody>
              ${devisLies.map(d => `<tr>
                <td>${esc(d['Numéro devis']||'—')}${d['Type devis']==='Additif'?' <span class="badge b-amber">Additif</span>':''}${d.Milieu?' · '+esc(d.Milieu):''}</td>
                <td>${esc(d.Statut||'')}</td>
                <td class="num">${euros(d['Total TTC'])}</td>
              </tr>`).join('')}
            </tbody></table>
          </div>`}

          ${(isArtisan || !commandesLiees.length) ? '' : `
          <div class="fc-section">
            <div class="fc-title">Commandes fournisseurs (${commandesLiees.length})</div>
            <table class="fc-table"><tbody>
              ${commandesLiees.map(c => `<tr>
                <td>${esc(c['Numéro']||'—')}</td>
                <td>${esc(c.Statut||'')}</td>
                <td>${esc(c['Date livraison prévue']||'—')}</td>
                <td class="num">${euros(c['Montant HT'])}</td>
              </tr>`).join('')}
            </tbody></table>
          </div>`}

          ${artisansProjet.length ? `
          <div class="fc-section">
            <div class="fc-title">Artisans (${artisansProjet.length})</div>
            <table class="fc-table"><tbody>
              ${artisansProjet.map(a => `<tr>
                <td>${esc(a.Nom||'—')}</td>
                <td>${esc(a['Spécialité']||'')}</td>
                <td>${esc(a['Contact principal']||'')}</td>
                <td>${esc(a.Téléphone||a.Email||'')}</td>
              </tr>`).join('')}
            </tbody></table>
          </div>` : ''}

          ${tachesLiees.length ? `
          <div class="fc-section">
            <div class="fc-title">Tâches (${tachesLiees.length})</div>
            <table class="fc-table"><tbody>
              ${tachesLiees.map(t => `<tr>
                <td>${esc(t.Titre||'—')}</td>
                <td>${esc(t.Statut||'')}</td>
                <td>${esc(t['Assignée à']||'')}</td>
                <td>${esc(t.Échéance||'—')}</td>
              </tr>`).join('')}
            </tbody></table>
          </div>` : ''}

          ${journalEntries.length ? `
          <div class="fc-section">
            <div class="fc-title">Journal chantier (${journalEntries.length})</div>
            <div class="journal-list">
              ${journalEntries.map(e => `<div class="journal-entry">
                ${e.meta?`<div class="journal-meta">${esc(e.meta)}</div>`:''}
                <div class="journal-text">${esc(e.text)}</div>
              </div>`).join('')}
            </div>
          </div>` : ''}

          <div class="fc-footer no-print" style="margin-top:32px;padding-top:16px;border-top:1px solid var(--border);font-size:11px;color:var(--ink4);text-align:center">
            Cockpit Tanguy Design — document de travail interne
          </div>
        </div>
      </div>
    </div>`;
  const host = document.createElement('div'); host.id = 'fiche-ch-host'; host.dataset.projetId = projetId; host.innerHTML = html;
  document.body.appendChild(host);
}
function closeFicheChantier(){ document.getElementById('fiche-ch-host')?.remove(); }

function sendFicheChantier(projetId) {
  const p = DATA.projets.find(x => x.id === projetId); if (!p) return;
  const client = Array.isArray(p.Client) ? DATA.clients.find(c => c.id === p.Client[0]) : null;
  const journalEntries = parseJournalEntries(p['Journal chantier']);
  const artisansProjet = (Array.isArray(p.Artisans) ? p.Artisans : []).map(id => DATA.artisans.find(a=>a.id===id)).filter(Boolean);

  const subject = `[Tanguy Design] Fiche chantier — ${p.Référence||''}`;
  const lines = [
    `Fiche chantier · ${p.Référence||'—'}`,
    `Date : ${new Date().toLocaleDateString('fr-FR')}`,
    ``,
    `STATUT : ${p.Statut||'—'}`,
    `Budget HT : ${euros(p['Budget HT'])}`,
    p['Date pose prévue'] ? `Pose prévue : ${p['Date pose prévue']}` : null,
    ``,
    client ? `CLIENT : ${client.Nom||'—'}${client.Contact?' · '+client.Contact:''}` : null,
    client?.Email ? `Email : ${client.Email}` : null,
    client?.Téléphone ? `Téléphone : ${client.Téléphone}` : null,
    client?.Adresse ? `Adresse :\n${client.Adresse}` : null,
    ``,
    artisansProjet.length ? 'ARTISANS :' : null,
    ...artisansProjet.map(a => `  · ${a.Nom||''} (${a['Spécialité']||''})${a['Contact principal']?' — '+a['Contact principal']:''}`),
    artisansProjet.length ? '' : null,
    journalEntries.length ? `JOURNAL CHANTIER (${journalEntries.length} entrées) :` : null,
    ...journalEntries.slice(0, 20).map(e => `  ${e.meta?`[${e.meta}] `:''}${e.text}`),
    journalEntries.length > 20 ? `  … (${journalEntries.length - 20} entrées plus anciennes)` : null,
    ``,
    `— Cockpit Tanguy Design`
  ].filter(l => l !== null).join('\n');

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines)}`;
  window.location.href = mailto;
}

// ============ ONGLETS ATTACHMENTS (4 zones en 1) ============
// Avant : 4 sections empilées sur 800+ px. Maintenant : onglets — 1 visible à la fois.
// Onglet actif par défaut = premier non vide, sinon Plan 3D.
function projetAttachmentsTabs(p) {
  const fields = [
    {name:'Plan 3D',          hint:'Visualisations 3D Winner/Métron, plans d\'aménagement, dossiers de présentation client.', icon:'🏠'},
    {name:'Plan technique',   hint:'Plans techniques avec cotes, plans archi, vues autocad, prises de cotes.',                icon:'📐'},
    {name:'Images',           hint:'Photos chantier, références ambiance, moodboards.',                                       icon:'📸'},
    {name:'Documents projet', hint:'Factures, AR, attestations, cahier des charges, notices, comptes rendus…',                icon:'📁'}
  ];
  let activeIdx = 0;
  for (let i = 0; i < fields.length; i++) {
    const arr = Array.isArray(p[fields[i].name]) ? p[fields[i].name] : [];
    if (arr.length > 0) { activeIdx = i; break; }
  }
  const tabsHtml = fields.map((f, i) => {
    const count = Array.isArray(p[f.name]) ? p[f.name].length : 0;
    return `<button class="attach-tab ${i===activeIdx?'on':''}" type="button" data-attach-tab="${i}" onclick="switchAttachTab(${i})">
      ${f.icon} ${esc(f.name)} <span class="at-count">${count}</span>
    </button>`;
  }).join('');
  const panesHtml = fields.map((f, i) => {
    return `<div class="attach-pane ${i===activeIdx?'on':''}" data-attach-pane="${i}">
      ${projetAttachmentsSection(p, f.name, f.hint)}
    </div>`;
  }).join('');
  return `<div id="zone-attach">
    <div class="attach-tabs" role="tablist" aria-label="Documents du projet">${tabsHtml}</div>
    ${panesHtml}
  </div>`;
}
function switchAttachTab(idx) {
  document.querySelectorAll('[data-attach-tab]').forEach(b => b.classList.toggle('on', Number(b.dataset.attachTab) === idx));
  document.querySelectorAll('[data-attach-pane]').forEach(p => p.classList.toggle('on', Number(p.dataset.attachPane) === idx));
}

// ============ SIDEBAR TOC FICHE PROJET (desktop ≥1100px) ============
// Sticky panel à gauche avec ancres vers les sections + compteurs + indicateurs urgence.
function projetTOC(p, devisLies, commandesLiees, tachesLiees, devisArtisansLies) {
  const today = new Date().toISOString().slice(0,10);
  const cmdsUrgentes = commandesLiees.some(c => !c['Date livraison prévue'] && !['Livrée','Posée'].includes(c.Statut));
  const tachesEnRetard = tachesLiees.filter(t => t.Statut!=='Terminée' && t.Échéance && t.Échéance < today).length;
  const devisAttente = devisLies.filter(d => d.Statut === 'Envoyé').length;
  const items = [
    {id:'zone-stepper',  label:'Parcours',         count:''},
    {id:'zone-bilan',    label:'Bilan financier',  count:''},
    {id:'zone-info',     label:'Informations',     count:''},
    {id:'zone-devis',    label:'Devis Tanguy',     count:devisLies.length, urgent: devisAttente>0},
    {id:'zone-fact',     label:'Facturation',      count:''},
    {id:'zone-cmds',     label:'Commandes',        count:commandesLiees.length, urgent: cmdsUrgentes},
    {id:'zone-artisans', label:'Artisans',         count:(p.Artisans||[]).length},
    {id:'zone-devis-art',label:'Devis artisans',   count:devisArtisansLies.length},
    {id:'zone-taches',   label:'Tâches',           count:tachesLiees.filter(t=>t.Statut!=='Terminée').length, urgent: tachesEnRetard>0},
    {id:'zone-plaud',    label:'Réunions Plaud',   count:''},
    {id:'zone-journal',  label:'Journal',          count:''},
    {id:'zone-attach',   label:'Documents',        count:''}
  ];
  return `<aside class="proj-toc" id="proj-toc" aria-label="Sommaire de la fiche projet">
    <div class="proj-toc-title">Sommaire</div>
    ${items.map(it => `<a href="#${it.id}" onclick="event.preventDefault();document.getElementById('${it.id}')?.scrollIntoView({behavior:'smooth',block:'start'});" ${it.urgent?'class="urgent"':''} title="${it.urgent?'⚠ Action requise':''}">
      <span>${esc(it.label)}</span>
      ${it.count !== '' ? `<span class="toc-count">${it.count}</span>` : ''}
    </a>`).join('')}
  </aside>`;
}

// ============ BADGES URGENCE COMMANDES ============
// Calculés front. Visent à faire ressortir ce qui doit être traité.
function commandeUrgencyBadges(c) {
  const badges = [];
  if (!c['Date livraison prévue'] && !['Livrée','Posée'].includes(c.Statut)) {
    badges.push('<span class="badge-urg" title="Aucune date de livraison saisie">⚠ Sans date</span>');
  }
  if (c.Statut === 'Envoyée' && c['Date création']) {
    const days = Math.floor((Date.now() - Date.parse(c['Date création'])) / 86400000);
    if (days > 7) badges.push(`<span class="badge-urg warn" title="Envoyée depuis ${days} jours sans confirmation fournisseur">⏳ +${days}j sans AR</span>`);
  }
  return badges.join(' ');
}

// ============ EMPTY STATE AVEC CTA ============
// Plus expressif que "Aucun X" : titre + raison + bouton d'action.
function emptyCTA(title, sub, btnLabel, btnOnclick) {
  return `<div class="empty-cta">
    <div class="empty-cta-title">${esc(title)}</div>
    <div class="empty-cta-sub">${esc(sub)}</div>
    ${btnLabel ? `<button class="empty-cta-btn" type="button" onclick="${btnOnclick}">${esc(btnLabel)}</button>` : ''}
  </div>`;
}

function projetAttachmentsSection(p, fieldName, hint) {
  const list = Array.isArray(p[fieldName]) ? p[fieldName] : [];
  const inputId = 'att-upl-' + fieldName.replace(/\s+/g, '-').toLowerCase();
  const items = list.map(a => {
    const ext = (a.filename||'').split('.').pop().toUpperCase().slice(0,4);
    return `<div class="attach-chip">
      <a href="${a.url}" target="_blank" rel="noopener" class="attach-chip-link" title="${esc(a.filename)} (${(a.size/1024|0)} KB)">
        <span class="attach-ext">${esc(ext)}</span>
        <span class="attach-name">${esc(a.filename)}</span>
      </a>
      <button class="attach-del" onclick="deleteProjetAttachment('${p.id}','${esc(fieldName)}','${a.id}',${JSON.stringify(a.filename)})" title="Supprimer">×</button>
    </div>`;
  }).join('');
  const addBtn = `
    <label class="btn-ghost attach-add" style="padding:4px 10px;font-size:12px;cursor:pointer">
      + Ajouter
      <input type="file" id="${inputId}" style="display:none" onchange="uploadProjetAttachment('${p.id}','${esc(fieldName)}',this.files[0],this)">
    </label>`;
  const sectionId = 'attach-section-' + fieldName.replace(/\s+/g, '-').toLowerCase();
  return `
    <div id="${sectionId}" class="zone-title" style="margin-top:24px;display:flex;align-items:center;justify-content:space-between">
      <span>${esc(fieldName)} (${list.length})</span>
      ${addBtn}
    </div>
    <div style="font-size:11px;color:var(--ink4);margin-bottom:8px">${esc(hint)}</div>
    ${list.length ? `<div class="attach-grid">${items}</div>` : '<div class="muted" style="font-size:12px;color:var(--ink4);padding:8px">Aucun document</div>'}`;
}

async function uploadProjetAttachment(projetId, field, file, inputEl) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toastError(`Fichier trop gros (${(file.size/1024/1024).toFixed(1)} MB, max 5 MB)`);
    if (inputEl) inputEl.value = '';
    return;
  }
  showLoader('Upload…');
  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('field', field);
    const r = await fetch('/api/projets/'+projetId+'/attachments', { method:'POST', body: fd });
    if (!r.ok) throw new Error((await r.json()).error || 'erreur upload');
    toastSuccess(`"${file.name}" ajouté à ${field}`);
    await loadAll();
    const p = DATA.projets.find(x=>x.id===projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); if (inputEl) inputEl.value = ''; }
}

async function deleteProjetAttachment(projetId, field, attachmentId, filename) {
  if (!confirm(`Supprimer "${filename}" de ${field} ?`)) return;
  showLoader('Suppression…');
  try {
    const r = await fetch('/api/projets/'+projetId+'/attachments', {
      method:'DELETE',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ field, attachmentId })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'erreur suppression');
    toastSuccess(`"${filename}" supprimé`);
    await loadAll();
    const p = DATA.projets.find(x=>x.id===projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

async function saveProjet(projetId){
  const fields = {};
  document.querySelectorAll('#projet-detail-view [data-pf]').forEach(inp => {
    const key = inp.dataset.pf;
    let v = inp.value;
    if (['Budget HT','Marge prévisionnelle'].includes(key)) v = v?parseFloat(v):null;
    if (v !== '' && v !== null) fields[key] = v;
  });
  showLoader('Enregistrement…');
  try {
    await fetch('/api/data/projets/'+projetId, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    await loadAll();
    PROJET_EDIT = false;
    const p = DATA.projets.find(x=>x.id===projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}
async function deleteProjet(projetId){
  if (!confirm('Supprimer ce projet ?\n\nLes devis, commandes et tâches liés ne seront PAS supprimés mais perdront le lien.')) return;
  showLoader('Suppression…');
  try {
    await fetch('/api/data/projets/'+projetId, {method:'DELETE'});
    await loadAll();
    closeProjetDetail();
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

// ============ ARTISANS SUR PROJET ============
function openArtisanPicker(projetId){
  const p = DATA.projets.find(x=>x.id===projetId);
  const current = new Set(Array.isArray(p?.Artisans) ? p.Artisans : []);
  const bySpec = {};
  DATA.artisans.forEach(a => {
    const s = a['Spécialité'] || 'Autre';
    (bySpec[s] = bySpec[s] || []).push(a);
  });
  const sections = Object.keys(bySpec).sort().map(s => `
    <div class="ap-section" data-spec="${esc(s.toLowerCase())}" style="margin-top:14px">
      <div class="ap-section-title" style="font-size:10px;text-transform:uppercase;color:var(--ink3);letter-spacing:.06em;margin-bottom:6px;font-family:'DM Mono',monospace">${esc(s)}</div>
      ${bySpec[s].map(a => {
        const searchBag = [a.Nom, a['Contact principal'], a.Email, a['Téléphone'], a['Spécialité']].filter(Boolean).join(' ').toLowerCase();
        return `
        <div class="ap-row" data-search="${esc(searchBag)}" onclick="toggleArtisanChk('${a.id}')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-radius:6px;border:1px solid var(--border);margin-bottom:4px;background:#fff" onmouseover="this.style.background='#faf8f3'" onmouseout="this.style.background='#fff'">
          <input type="checkbox" class="ap-chk" id="ap-${a.id}" value="${a.id}" ${current.has(a.id)?'checked':''} style="width:16px;height:16px;padding:0;border:1px solid var(--border);margin:0;flex:none" onclick="event.stopPropagation()">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;color:var(--ink);font-weight:600">${esc(a.Nom)}</div>
            <div style="font-size:11px;color:var(--ink3);margin-top:2px">${esc(a['Contact principal']||'—')}${a.Email?' · '+esc(a.Email):''}${a['Téléphone']?' · '+esc(a['Téléphone']):''}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `).join('');
  const html = `
    <div class="modal-bg on" onclick="if(event.target===this)closeArtisanPicker()">
      <div style="background:#fff;border-radius:8px;padding:20px 22px;width:100%;max-width:600px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="font-family:'DM Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink4);margin-bottom:10px">Choisir les artisans du projet</div>
        <div style="position:relative;margin-bottom:10px">
          <input id="ap-search" type="text" placeholder="🔍 Rechercher par nom, lot, email, téléphone…" oninput="filterArtisanPicker(this.value)" style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:#faf8f3;outline:none;font-family:inherit;color:var(--ink)" autofocus>
        </div>
        <div id="ap-empty" style="display:none;padding:20px;text-align:center;color:var(--ink3);font-size:12px">Aucun artisan ne correspond à votre recherche.</div>
        <div id="ap-list" style="flex:1;overflow-y:auto;margin:0 -4px;padding:0 4px">${sections}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
          <button class="btn-ghost" onclick="closeArtisanPicker()">Annuler</button>
          <button class="btn-primary" onclick="saveArtisansProjet('${projetId}')">Enregistrer</button>
        </div>
      </div>
    </div>`;
  const div = document.createElement('div');
  div.id = 'artisan-picker';
  div.innerHTML = html;
  document.body.appendChild(div);
}

function closeArtisanPicker(){
  document.getElementById('artisan-picker')?.remove();
}

function toggleArtisanChk(artisanId){
  const chk = document.getElementById('ap-'+artisanId);
  if (chk) chk.checked = !chk.checked;
}

// ============ FICHE DE MISSION : éditer + (re)générer ============
function openFicheEditor(projetId, artisanId){
  const p = DATA.projets.find(x=>x.id===projetId);
  const a = DATA.artisans.find(x=>x.id===artisanId);
  if (!p || !a) return;
  // Pré-remplissage : cherche un devis artisan pour cet artisan sur ce projet
  const existing = (DATA['devis-artisans']||[]).find(d =>
    Array.isArray(d.Projet) && d.Projet.includes(projetId) &&
    Array.isArray(d.Artisan) && d.Artisan.includes(artisanId)
  );
  const clientId = Array.isArray(p.Client) ? p.Client[0] : null;
  const client = clientId ? DATA.clients.find(c=>c.id===clientId) : null;
  const defaultAdr = (existing && existing['Adresse chantier']) || p['Adresse chantier'] || (client?.Adresse) || '';
  const defaultDesc = (existing && existing['Description travaux']) || '';
  const defaultDate = (existing && existing['Date démarrage prévue']) || p['Date pose prévue'] || '';
  const defaultNotes = (existing && existing['Notes']) || '';
  const ficheUrl = existing ? ((existing['Fiche de mission PDF']||[])[0]?.url || null) : null;

  const html = `
    <div class="modal-bg on" onclick="if(event.target===this)closeFicheEditor()">
      <div style="background:#fff;border-radius:8px;padding:20px 22px;width:100%;max-width:620px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="font-family:'DM Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink4);margin-bottom:4px">Fiche de mission</div>
        <div style="font-size:18px;font-weight:600;color:var(--ink);margin-bottom:14px">${esc(a.Nom)} <span style="font-size:12px;color:var(--ink3);font-weight:400">· ${esc(a['Spécialité']||'')}</span></div>

        <div style="flex:1;overflow-y:auto;padding-right:4px">
          <div style="font-size:11px;color:var(--ink3);margin-bottom:10px;padding:8px 10px;background:var(--paper);border-radius:6px;line-height:1.5">
            <strong>Projet :</strong> ${esc(p['Référence']||'—')}<br>
            <strong>Client :</strong> ${esc(client?.Nom||'—')}<br>
            <strong>Contact artisan :</strong> ${esc(a['Contact principal']||'—')} · ${esc(a.Email||'—')} · ${esc(a['Téléphone']||'—')}
          </div>

          <div style="margin-top:14px">
            <label style="display:block;font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-bottom:4px">Adresse du chantier</label>
            <textarea id="fe-adresse" rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;resize:vertical">${esc(defaultAdr)}</textarea>
          </div>

          <div style="margin-top:12px">
            <label style="display:block;font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-bottom:4px">Description des travaux</label>
            <textarea id="fe-desc" rows="5" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;resize:vertical" placeholder="Ex : pose carrelage sol 60×60 cuisine + faïence salle d'eau, banc WEDI, protection à l'eau…">${esc(defaultDesc)}</textarea>
          </div>

          <div style="margin-top:12px;display:flex;gap:10px">
            <div style="flex:1">
              <label style="display:block;font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-bottom:4px">Date de démarrage prévue</label>
              <input id="fe-date" type="date" value="${esc(defaultDate)}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px">
            </div>
          </div>

          <div style="margin-top:12px">
            <label style="display:block;font-family:'DM Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-bottom:4px">Notes complémentaires</label>
            <textarea id="fe-notes" rows="3" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;resize:vertical" placeholder="Informations supplémentaires, contraintes accès, étages, code…">${esc(defaultNotes)}</textarea>
          </div>

          ${ficheUrl ? `<div style="margin-top:14px;padding:10px;background:var(--paper);border-radius:6px;font-size:12px"><a href="${ficheUrl}" target="_blank" style="color:var(--gold)">📄 Voir la fiche actuelle (PDF)</a> — modifiez les champs ci-dessus et cliquez sur « Regénérer » pour la remplacer.</div>` : ''}
        </div>

        <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
          <div style="font-size:11px;color:var(--ink3)">${existing ? 'Devis artisan lié · les modifications y sont enregistrées.' : 'Un record Devis Artisan sera créé pour persister les modifications.'}</div>
          <div style="display:flex;gap:8px">
            <button class="btn-ghost" onclick="closeFicheEditor()">Annuler</button>
            <button class="btn-primary" onclick="saveFicheAndGenerate('${projetId}','${artisanId}','${existing?existing.id:''}')">${ficheUrl?'Regénérer le PDF':'Générer le PDF'}</button>
          </div>
        </div>
      </div>
    </div>`;
  const div = document.createElement('div');
  div.id = 'fiche-editor';
  div.innerHTML = html;
  document.body.appendChild(div);
}

function closeFicheEditor(){
  document.getElementById('fiche-editor')?.remove();
}

async function saveFicheAndGenerate(projetId, artisanId, existingDevisId){
  const adresse = document.getElementById('fe-adresse').value.trim();
  const desc = document.getElementById('fe-desc').value.trim();
  const date = document.getElementById('fe-date').value || null;
  const notes = document.getElementById('fe-notes').value.trim();

  showLoader('Enregistrement + génération PDF…');
  try {
    // 1. UPSERT le devis artisan avec les champs éditables
    const fields = {
      'Adresse chantier': adresse,
      'Description travaux': desc,
      'Date démarrage prévue': date,
      'Notes': notes
    };
    // Nettoie null/empty
    Object.keys(fields).forEach(k => { if (fields[k] == null || fields[k] === '') delete fields[k]; });

    if (existingDevisId) {
      await fetch('/api/data/devis-artisans/'+existingDevisId, {
        method: 'PATCH',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ fields })
      });
    } else {
      // Création minimale — lie projet + artisan
      const createFields = {
        ...fields,
        'Numéro devis': 'FICHE-' + Date.now(),
        'Projet': [projetId],
        'Artisan': [artisanId],
        'Statut': 'À valider'
      };
      await fetch('/api/data/devis-artisans', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ fields: createFields })
      });
    }

    // 2. Génère la fiche
    const r = await fetch('/api/fiche-mission', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ projetId, artisanId })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur génération');

    closeFicheEditor();
    hideLoader();
    showMailtoModal(data);
    await loadAll();
    const p = DATA.projets.find(x=>x.id===projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { hideLoader(); toastError('Erreur : '+e.message); }
}

function filterArtisanPicker(q){
  const qn = (q||'').trim().toLowerCase();
  const rows = document.querySelectorAll('#ap-list .ap-row');
  const sections = document.querySelectorAll('#ap-list .ap-section');
  let totalVisible = 0;
  rows.forEach(r => {
    const hit = !qn || (r.dataset.search || '').includes(qn);
    r.style.display = hit ? '' : 'none';
    if (hit) totalVisible++;
  });
  sections.forEach(sec => {
    const anyVisible = Array.from(sec.querySelectorAll('.ap-row')).some(r => r.style.display !== 'none');
    sec.style.display = anyVisible ? '' : 'none';
  });
  document.getElementById('ap-empty').style.display = totalVisible === 0 ? 'block' : 'none';
}

async function saveArtisansProjet(projetId){
  const checked = Array.from(document.querySelectorAll('#artisan-picker .ap-chk:checked')).map(c => c.value);
  showLoader('Enregistrement…');
  try {
    await fetch('/api/data/projets/'+projetId, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ fields: { Artisans: checked } })
    });
    closeArtisanPicker();
    await loadAll();
    const p = DATA.projets.find(x=>x.id===projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

async function removeArtisanFromProjet(projetId, artisanId){
  const p = DATA.projets.find(x=>x.id===projetId);
  if (!p) return;
  const current = Array.isArray(p.Artisans) ? p.Artisans : [];
  const next = current.filter(id => id !== artisanId);
  try {
    await fetch('/api/data/projets/'+projetId, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ fields: { Artisans: next } })
    });
    await loadAll();
    if (CURRENT_PROJET_ID) {
      const pp = DATA.projets.find(x=>x.id===CURRENT_PROJET_ID);
      if (pp) renderProjetDetail(pp);
    }
  } catch(e) { toastError('Erreur : '+e.message); }
}

// ============ DEVIS ARTISANS ============
async function uploadArtisanDevis(event, projetId){
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { toastError('PDF trop volumineux (max 15 Mo)'); return; }
  showLoader('Analyse du devis artisan…');
  try {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('projetId', projetId);
    const r = await fetch('/api/artisan-devis/import', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur import');
    const s = data.parsed_summary || {};
    let msg = `✅ Devis ${s.numero||''} importé — ${euros(s.montant_ht)} HT · rétro-com ${euros(s.retrocommission)}`;
    if (!data.artisan_matched) msg += `\n⚠️ Artisan "${data.artisan_name||''}" non trouvé dans la base — à lier manuellement.`;
    alert(msg);
    event.target.value = ''; // reset pour pouvoir re-uploader
    await loadAll();
    const p = DATA.projets.find(x=>x.id===projetId);
    if (p) renderProjetDetail(p);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

async function sendFicheMission(devisArtisanId){
  const d = (DATA['devis-artisans']||[]).find(x=>x.id===devisArtisanId);
  if (!d) return;
  const artId = Array.isArray(d.Artisan) ? d.Artisan[0] : null;
  const art = artId ? DATA.artisans.find(a=>a.id===artId) : null;
  if (!art) { toastError('Aucun artisan lié à ce devis — liez-le d\'abord dans Airtable ou via l\'édition.'); return; }
  if (!art.Email) { if (!confirm(`L'artisan "${art.Nom}" n'a pas d'email renseigné. Continuer quand même ?`)) return; }
  showLoader('Génération de la fiche de mission…');
  try {
    const r = await fetch(`/api/artisan-devis/${devisArtisanId}/fiche-mission`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur génération');
    hideLoader();
    showMailtoModal(data);
    await loadAll();
    if (CURRENT_PROJET_ID) {
      const p = DATA.projets.find(x=>x.id===CURRENT_PROJET_ID);
      if (p) renderProjetDetail(p);
    }
  } catch(e) { hideLoader(); toastError('Erreur : '+e.message); }
}

async function sendAllFichesMission(projetId){
  const p = DATA.projets.find(x=>x.id===projetId);
  const artisanIds = Array.isArray(p?.Artisans) ? p.Artisans : [];
  if (!artisanIds.length) {
    toastError('Aucun artisan sélectionné pour ce projet. Utilisez "+ Ajouter" d\'abord.');
    return;
  }
  if (!confirm(`Générer ${artisanIds.length} fiche(s) de mission — une pour chaque artisan sélectionné ?`)) return;
  showLoader(`Génération de ${artisanIds.length} fiche(s)…`);
  const results = [];
  for (const artisanId of artisanIds) {
    try {
      const r = await fetch('/api/fiche-mission', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ projetId, artisanId })
      });
      const data = await r.json();
      if (r.ok) results.push(data);
      else results.push({ ok: false, error: data.error, artisanNom: (DATA.artisans.find(a=>a.id===artisanId)||{}).Nom || '?' });
    } catch(e) { results.push({ ok: false, error: e.message }); }
  }
  hideLoader();
  showBatchMailtoModal(results);
  await loadAll();
  const fresh = DATA.projets.find(x=>x.id===projetId);
  if (fresh) renderProjetDetail(fresh);
}

function showMailtoModal(data){
  const html = `
    <div class="modal-bg on" onclick="if(event.target===this)closeMailtoModal()">
      <div class="modal" style="max-width:520px">
        <h3 style="margin:0 0 14px;color:var(--ink1)">📋 Fiche de mission prête</h3>
        <p style="font-size:13px;color:var(--ink2);line-height:1.6">
          PDF généré et attaché au devis de <strong>${esc(data.artisanNom||'artisan')}</strong>.<br>
          ${data.ficheUrl ? `<a href="${data.ficheUrl}" target="_blank" style="color:var(--gold)">📄 Télécharger la fiche</a>` : ''}
        </p>
        ${data.artisanEmail ? `
          <a href="${data.mailto}" style="display:inline-block;margin-top:12px;background:var(--gold);color:#000;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">
            ✉️ Ouvrir mon email vers ${esc(data.artisanEmail)}
          </a>
          <p style="font-size:11px;color:var(--ink3);margin-top:10px">Votre client mail (Gmail, Outlook, Apple Mail…) s'ouvrira avec un message pré-rempli. Vérifiez et envoyez.</p>
        ` : `<p style="color:#c44;font-size:12px">⚠️ Aucun email renseigné pour cet artisan — mettez-le à jour dans Airtable.</p>`}
        <div style="text-align:right;margin-top:16px">
          <button class="btn-ghost" onclick="closeMailtoModal()">Fermer</button>
        </div>
      </div>
    </div>`;
  const div = document.createElement('div');
  div.id = 'mailto-modal';
  div.innerHTML = html;
  document.body.appendChild(div);
}

function showBatchMailtoModal(results){
  const rows = results.map(r => r.ok ? `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--border)">
      <div>
        <strong>${esc(r.artisanNom||'?')}</strong>
        <div style="font-size:11px;color:var(--ink3)">${esc(r.artisanEmail||'pas d\'email')}</div>
      </div>
      ${r.artisanEmail ? `<a href="${r.mailto}" style="background:var(--gold);color:#000;padding:6px 12px;border-radius:4px;text-decoration:none;font-size:12px;font-weight:600">✉️ Envoyer</a>` : '<span style="color:#c44;font-size:11px">sans email</span>'}
    </div>` : `
    <div style="padding:8px;border-bottom:1px solid var(--border);color:#c44;font-size:12px">⚠️ ${esc(r.error||'Erreur')}</div>
  `).join('');
  const html = `
    <div class="modal-bg on" onclick="if(event.target===this)closeMailtoModal()">
      <div class="modal" style="max-width:560px">
        <h3 style="margin:0 0 14px;color:var(--ink1)">📋 Fiches de mission générées</h3>
        <p style="font-size:13px;color:var(--ink2)">${results.filter(r=>r.ok).length}/${results.length} fiche(s) OK. Cliquez sur chaque artisan pour ouvrir le mail pré-rempli :</p>
        <div style="max-height:400px;overflow:auto;margin-top:10px;border:1px solid var(--border);border-radius:6px">${rows}</div>
        <div style="text-align:right;margin-top:16px">
          <button class="btn-ghost" onclick="closeMailtoModal()">Fermer</button>
        </div>
      </div>
    </div>`;
  const div = document.createElement('div');
  div.id = 'mailto-modal';
  div.innerHTML = html;
  document.body.appendChild(div);
}

function closeMailtoModal(){
  document.getElementById('mailto-modal')?.remove();
}

async function deleteArtisanDevis(id){
  if (!confirm('Supprimer ce devis artisan ?')) return;
  showLoader('Suppression…');
  try {
    await fetch('/api/data/devis-artisans/'+id, { method: 'DELETE' });
    await loadAll();
    if (CURRENT_PROJET_ID) {
      const p = DATA.projets.find(x=>x.id===CURRENT_PROJET_ID);
      if (p) renderProjetDetail(p);
    }
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

const PROJET_GROUP = ['projets','devis','decouverte','plaud','commandes','artisans','fournisseurs','sav'];
function switchTab(tabName){
  // Map sub-nav tab → which top-level button stays highlighted
  const inGroup = PROJET_GROUP.includes(tabName);
  const topTab = inGroup ? 'projets' : tabName;
  document.querySelectorAll('.nb').forEach(b => b.classList.toggle('on', b.dataset.tab===topTab));
  document.querySelectorAll('.scr').forEach(s => s.classList.toggle('on', s.id==='scr-'+tabName));
  // Sub-nav visibility + active state
  const subnav = document.getElementById('subnav');
  if (subnav) {
    subnav.classList.toggle('on', inGroup);
    subnav.querySelectorAll('.snb').forEach(b => b.classList.toggle('on', b.dataset.tab===tabName));
  }
  window.scrollTo({top:0,behavior:'instant'});
}
// Wire sub-nav click
document.addEventListener('click', e=>{
  const snb = e.target.closest('.snb');
  if (snb) switchTab(snb.dataset.tab);
});

// ============ CLIENT DETAIL (modal) ============
async function openClientDetail(clientId){
  const isNew = !clientId;
  const c = isNew ? { id:null, Nom:'', Contact:'', Email:'', Téléphone:'', Adresse:'', Type:'Particulier', Source:'', Notes:'' }
                  : (DATA.clients.find(x => x.id === clientId) || {});
  // Linked records
  const linkedDevis = DATA.devis.filter(d => Array.isArray(d.Client) && d.Client.includes(clientId));
  const linkedProjets = DATA.projets.filter(p => Array.isArray(p.Client) && p.Client.includes(clientId));

  const html = `
    <div class="modal-bg on" onclick="if(event.target===this)closeClientDetail()">
      <div class="modal-card client-modal">
        <div class="modal-head">
          <div class="modal-title">${isNew?'Nouveau client':esc(c.Nom||'Client')}</div>
          <button class="modal-close" onclick="closeClientDetail()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-row"><label>Nom</label><input id="cf-Nom" value="${esc(c.Nom||'')}"></div>
          <div class="form-row"><label>Contact (prénoms)</label><input id="cf-Contact" value="${esc(c.Contact||'')}"></div>
          <div class="form-grid2">
            <div class="form-row"><label>Email</label><input id="cf-Email" type="email" value="${esc(c.Email||'')}"></div>
            <div class="form-row"><label>Téléphone</label><input id="cf-Téléphone" value="${esc(c.Téléphone||'')}"></div>
          </div>
          <div class="form-row"><label>Adresse</label><textarea id="cf-Adresse" rows="3">${esc(c.Adresse||'')}</textarea></div>
          <div class="form-grid2">
            <div class="form-row"><label>Type</label>
              <select id="cf-Type">
                <option ${c.Type==='Particulier'?'selected':''}>Particulier</option>
                <option ${c.Type==='Professionnel'?'selected':''}>Professionnel</option>
              </select>
            </div>
            <div class="form-row"><label>Source</label>
              <select id="cf-Source">
                <option value="">—</option>
                ${['Showroom','Architecte','Recommandation','Web'].map(s=>`<option ${c.Source===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row"><label>Notes / Suivi</label><textarea id="cf-Notes" rows="5" placeholder="Suivi commercial, historique, préférences…">${esc(c.Notes||'')}</textarea></div>

          ${!isNew && (linkedProjets.length||linkedDevis.length) ? `
            <div class="linked-block">
              <div class="linked-title">Projets liés (${linkedProjets.length})</div>
              ${linkedProjets.length ? linkedProjets.map(p=>`<div class="linked-item" onclick="closeClientDetail();openProjetDetail('${p.id}')">${esc(p.Référence||'—')} <span style="color:var(--ink4)">· ${esc(p.Statut||'')}</span></div>`).join('') : '<div class="muted" style="font-size:11px;color:var(--ink4)">Aucun</div>'}
              <div class="linked-title" style="margin-top:14px">Devis liés (${linkedDevis.length})</div>
              ${linkedDevis.length ? linkedDevis.map(d=>`<div class="linked-item" onclick="closeClientDetail();switchTab('devis');openDevisDetail('${d.id}')">${esc(d['Numéro devis']||'—')} <span style="color:var(--ink4)">· ${euros(d['Total TTC'])}</span></div>`).join('') : '<div class="muted" style="font-size:11px;color:var(--ink4)">Aucun</div>'}
            </div>` : ''}
        </div>
        <div class="modal-foot">
          ${!isNew?`<button class="btn-danger" onclick="deleteClient('${clientId}')">Supprimer</button>`:'<span></span>'}
          <div style="display:flex;gap:8px">
            <button class="btn-ghost" onclick="closeClientDetail()">Annuler</button>
            <button class="btn-primary" onclick="saveClient('${clientId||''}')">${isNew?'Créer':'Enregistrer'}</button>
          </div>
        </div>
      </div>
    </div>`;
  let host = document.getElementById('client-modal-host');
  if (!host) { host = document.createElement('div'); host.id='client-modal-host'; document.body.appendChild(host); }
  host.innerHTML = html;
}
function closeClientDetail(){ const h=document.getElementById('client-modal-host'); if(h)h.innerHTML=''; }

async function saveClient(clientId){
  const fields = {};
  ['Nom','Contact','Email','Téléphone','Adresse','Type','Source','Notes'].forEach(k=>{
    const v = document.getElementById('cf-'+k)?.value?.trim();
    if (v) fields[k] = v;
  });
  if (!fields.Nom) { toastError('Le nom est obligatoire'); return; }
  showLoader('Enregistrement…');
  try {
    if (clientId) {
      await fetch('/api/data/clients/'+clientId, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    } else {
      await fetch('/api/data/clients', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    }
    await loadAll();
    closeClientDetail();
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}
async function deleteClient(clientId){
  if (!confirm('Supprimer ce client ?\n\nLes projets/devis liés ne seront PAS supprimés mais perdront le lien.')) return;
  showLoader('Suppression…');
  try {
    await fetch('/api/data/clients/'+clientId, {method:'DELETE'});
    await loadAll();
    closeClientDetail();
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}
function renderArtisans(){
  $('#list-artisans').innerHTML = DATA.artisans.length
    ? DATA.artisans.map(artisanCard).join('')
    : emptyState('Aucun artisan dans la base', ' Ajoute tes partenaires (plombier, électricien, carreleur…) — ils apparaîtront dans les fiches projet et le calcul de rétro 5 %.', '+ Ajouter un artisan', `openModal('artisans')`);
}
function renderFournisseurs(){
  $('#list-fournisseurs').innerHTML = DATA.fournisseurs.length
    ? DATA.fournisseurs.map(fournisseurCard).join('')
    : emptyState('Aucun fournisseur dans la base', ' Ajoute tes fournisseurs cuisine / électroménager / plan de travail — ils seront utilisés pour les commandes auto à la signature des devis.', '+ Ajouter un fournisseur', `openModal('fournisseurs')`);
}
function renderCommandes(){
  const fType = document.getElementById('commandes-filter-type')?.value || '';
  const fStatut = document.getElementById('commandes-filter-statut')?.value || '';
  let list = DATA.commandes;
  if (fType === '__notyped') list = list.filter(c => !c.Type);
  else if (fType) list = list.filter(c => c.Type === fType);
  if (fStatut) list = list.filter(c => c.Statut === fStatut);
  $('#list-commandes').innerHTML = list.length
    ? list.map(commandeCard).join('')
    : (fType||fStatut)
      ? emptyState('Aucune commande ne correspond', ' Essaie de retirer un filtre ou choisis « Tous les types / statuts ».', 'Réinitialiser les filtres', `document.getElementById('commandes-filter-type').value='';document.getElementById('commandes-filter-statut').value='';renderCommandes()`)
      : emptyState('Aucune commande pour l\'instant', ' Les commandes fournisseurs sont auto-créées à la signature d\'un devis (regroupées par type : Cuisine, Électroménager…). Tu peux aussi en créer manuellement.', '+ Nouvelle commande', `openModal('commandes')`);
}
function syncTachesProjetFilter(){
  const sel = document.getElementById('taches-filter-projet');
  if (!sel) return;
  const current = sel.value;
  const opts = ['<option value="">Tous les projets</option>'];
  const sorted = (DATA.projets||[]).slice().sort((a,b)=>(a.Référence||'').localeCompare(b.Référence||''));
  sorted.forEach(p => opts.push(`<option value="${p.id}" ${current===p.id?'selected':''}>${esc(p.Référence||p.id)}</option>`));
  sel.innerHTML = opts.join('');
}
function renderTaches(){
  syncTachesProjetFilter();
  const filter = document.getElementById('taches-filter')?.value || '';
  const filterProjet = document.getElementById('taches-filter-projet')?.value || '';
  const statuts = ['À faire','En cours','Terminée'];
  let tasksFiltered = DATA.taches;
  if (filter) tasksFiltered = tasksFiltered.filter(t => t['Assignée à'] === filter);
  if (filterProjet) tasksFiltered = tasksFiltered.filter(t => Array.isArray(t.Projet) && t.Projet.includes(filterProjet));

  const columnsHtml = statuts.map(st => {
    const col = tasksFiltered.filter(t => (t.Statut||'À faire') === st);
    const stClass = {'À faire':'b-gray','En cours':'b-amber','Terminée':'b-green'}[st];
    return `<div class="kanban-col" data-statut="${esc(st)}" ondragover="event.preventDefault();this.classList.add('drop');" ondragleave="this.classList.remove('drop');" ondrop="dropTask(event,'${esc(st)}')">
      <div class="kanban-head"><span class="badge ${stClass}">${esc(st)}</span><span class="kanban-count">${col.length}</span></div>
      ${col.length ? col.map(t => kanbanCard(t)).join('') : '<div class="kanban-empty">—</div>'}
    </div>`;
  }).join('');

  $('#taches-kanban').innerHTML = `<div class="kanban-grid">${columnsHtml}</div>`;
}
function kanbanAssigneeOptions(currentValue){
  const persons = ['Virginie','Solène','Sébastien','Marine'];
  const artisans = (DATA.artisans||[]).map(a=>a.Nom).filter(Boolean).sort();
  const opt = (v, sel) => `<option value="${esc(v)}" ${sel?'selected':''}>${esc(v)}</option>`;
  let html = '<option value="">—</option>';
  html += `<optgroup label="Équipe">${persons.map(p=>opt(p, currentValue===p)).join('')}</optgroup>`;
  if (artisans.length) html += `<optgroup label="Artisans">${artisans.map(a=>opt(a, currentValue===a)).join('')}</optgroup>`;
  return html;
}
function kanbanCard(t){
  const prioClass = {'Haute':'b-red','Moyenne':'b-amber','Basse':'b-gray'}[t.Priorité]||'b-gray';
  const overdue = t.Échéance && t.Échéance < new Date().toISOString().slice(0,10) && t.Statut !== 'Terminée';
  return `<div class="kanban-card" draggable="true" ondragstart="event.dataTransfer.setData('rid','${t.id}')" onclick="if(!event.target.closest('.kc-assign'))openTaskEdit('${t.id}')" style="cursor:pointer">
    <div class="kc-title">${esc(t.Titre||'—')}</div>
    <div class="kc-meta">
      <span class="badge ${prioClass}">${esc(t.Priorité||'—')}</span>
      <select class="kc-assign" onclick="event.stopPropagation()" onchange="reassignTask('${t.id}',this.value)">
        ${kanbanAssigneeOptions(t['Assignée à']||'')}
      </select>
    </div>
    ${t.Échéance?`<div class="kc-date${overdue?' overdue':''}">📅 ${esc(t.Échéance)}</div>`:''}
    ${t.Description?`<div class="kc-desc">${esc(t.Description.slice(0,90))}${t.Description.length>90?'…':''}</div>`:''}
  </div>`;
}

// ============ TASK EDIT MODAL ============
function openTaskEdit(taskId){
  const isNew = !taskId;
  const t = isNew ? {id:null,Titre:'',Description:'',Priorité:'Moyenne','Assignée à':'',Statut:'À faire',Échéance:''}
                  : (DATA.taches.find(x=>x.id===taskId)||{});
  const prios = ['Basse','Moyenne','Haute'];
  const statuts = ['À faire','En cours','Terminée'];
  const html = `
    <div class="modal-bg on" id="task-edit-bg" onclick="if(event.target===this)closeTaskEdit()">
      <div class="modal-card" style="max-width:520px">
        <div class="modal-head">
          <div class="modal-title">${isNew?'Nouvelle tâche':'Modifier la tâche'}</div>
          <button class="modal-close" onclick="closeTaskEdit()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-row"><label>Titre *</label><input id="te-Titre" value="${esc(t.Titre||'')}"></div>
          <div class="form-row"><label>Description</label><textarea id="te-Description" rows="3">${esc(t.Description||'')}</textarea></div>
          <div class="form-grid2">
            <div class="form-row"><label>Statut</label><select id="te-Statut">${statuts.map(s=>`<option ${t.Statut===s?'selected':''}>${s}</option>`).join('')}</select></div>
            <div class="form-row"><label>Priorité</label><select id="te-Priorite">${prios.map(p=>`<option ${t.Priorité===p?'selected':''}>${p}</option>`).join('')}</select></div>
            <div class="form-row"><label>Assignée à</label><select id="te-Assignee">${kanbanAssigneeOptions(t['Assignée à']||'')}</select></div>
            <div class="form-row"><label>Échéance</label><input id="te-Echeance" type="date" value="${esc(t.Échéance||'')}"></div>
          </div>
        </div>
        <div class="modal-foot" style="display:flex;justify-content:space-between;gap:8px;padding:14px 20px;border-top:1px solid var(--border)">
          ${isNew?'<span></span>':`<button class="abtn" style="color:#c25656;border-color:#e0a8a8" onclick="deleteTask('${t.id}')">Supprimer</button>`}
          <div style="display:flex;gap:8px">
            <button class="abtn" onclick="closeTaskEdit()">Annuler</button>
            <button class="abtn primary" onclick="saveTaskEdit('${t.id||''}')">Enregistrer</button>
          </div>
        </div>
      </div>
    </div>`;
  const host = document.createElement('div');
  host.id = 'task-edit-host';
  host.innerHTML = html;
  document.body.appendChild(host);
}
function closeTaskEdit(){ document.getElementById('task-edit-host')?.remove(); }
async function saveTaskEdit(taskId){
  const fields = {
    Titre: document.getElementById('te-Titre').value.trim(),
    Description: document.getElementById('te-Description').value.trim(),
    Statut: document.getElementById('te-Statut').value,
    Priorité: document.getElementById('te-Priorite').value,
    'Assignée à': document.getElementById('te-Assignee').value,
    Échéance: document.getElementById('te-Echeance').value || null,
  };
  if (!fields.Titre) { toastError('Titre obligatoire'); return; }
  try {
    const url = taskId ? '/api/data/taches/'+taskId : '/api/data/taches';
    const method = taskId ? 'PATCH' : 'POST';
    const r = await fetch(url, {method,headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    if (!r.ok) throw new Error((await r.json()).error||'erreur');
    toastSuccess(taskId?'Tâche mise à jour':'Tâche créée');
    closeTaskEdit();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}
async function deleteTask(taskId){
  if (!confirm('Supprimer définitivement cette tâche ?')) return;
  try {
    const r = await fetch('/api/data/taches/'+taskId, {method:'DELETE'});
    if (!r.ok) throw new Error('erreur');
    toastSuccess('Tâche supprimée');
    closeTaskEdit();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}
async function reassignTask(taskId, newPerson){
  const t = DATA.taches.find(x=>x.id===taskId);
  if (!t || t['Assignée à'] === newPerson) return;
  t['Assignée à'] = newPerson;
  renderTaches();
  try {
    await fetch('/api/data/taches/'+taskId, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{'Assignée à':newPerson}})});
  } catch(e) { toastError('Erreur : '+e.message); await loadAll(); }
}
async function dropTask(ev, newStatut){
  ev.preventDefault();
  document.querySelectorAll('.kanban-col.drop').forEach(c=>c.classList.remove('drop'));
  const rid = ev.dataTransfer.getData('rid');
  if (!rid) return;
  const task = DATA.taches.find(t => t.id === rid);
  if (!task || task.Statut === newStatut) return;
  task.Statut = newStatut; // optimistic
  renderTaches();
  try {
    await fetch('/api/data/taches/'+rid, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{Statut:newStatut}})});
  } catch(e) { toastError('Erreur : '+e.message); await loadAll(); }
}
function renderSAV(){
  $('#list-sav').innerHTML = DATA.sav.length
    ? DATA.sav.map(savCard).join('')
    : emptyState('Aucune intervention SAV', ' Les tickets SAV (créés via le bouton SAV en haut ou ici) sont centralisés sur 9·58 puis routés vers la bonne équipe.', '+ Nouveau SAV', `openModal('sav')`);
}

// ============ ADMIN — MARGES & STOCK ============
function switchAdminTab(tab){
  document.querySelectorAll('.atb').forEach(b=>b.classList.toggle('on', b.dataset.atab===tab));
  document.querySelectorAll('.admin-pane').forEach(p=>p.classList.toggle('on', p.id==='admin-'+tab));
}
function computeProjetMarge(p){
  // CA = somme Total HT final des devis Signé liés
  const devisSignes = DATA.devis.filter(d => Array.isArray(d.Projet) && d.Projet.includes(p.id) && d.Statut==='Signé');
  const ca = devisSignes.reduce((s,d)=>s+(d['Total HT final']||d['Total HT après remise']||d['Total HT articles']||0),0);
  // Coûts auto = somme Montant HT des commandes liées
  const cmds = DATA.commandes.filter(c => Array.isArray(c.Projet) && c.Projet.includes(p.id));
  const coutsAuto = cmds.reduce((s,c)=>s+(c['Montant HT']||0),0);
  // Override hybride
  const override = p['Coûts réels override'];
  const couts = (override!=null && override!=='') ? override : coutsAuto;
  const marge = ca - couts;
  const pct = ca>0 ? (marge/ca*100) : null;
  return {ca, coutsAuto, couts, override, marge, pct, isOverride: override!=null && override!=='' };
}
function renderMarges(){
  const rows = DATA.projets
    .filter(p=>p.Statut && p.Statut!=='Découverte' && p.Statut!=='Dessin')
    .map(p=>({p, ...computeProjetMarge(p)}))
    .sort((a,b)=>b.ca-a.ca);
  const totCA = rows.reduce((s,r)=>s+r.ca,0);
  const totCouts = rows.reduce((s,r)=>s+r.couts,0);
  const totMarge = totCA - totCouts;
  const totPct = totCA>0 ? (totMarge/totCA*100) : 0;
  $('#mg-ca').textContent = euros(totCA);
  $('#mg-couts').textContent = euros(totCouts);
  $('#mg-marge').textContent = euros(totMarge);
  $('#mg-pct').textContent = totCA>0 ? totPct.toFixed(1)+'%' : '—';

  // Conversion
  let won=0, live=0, lost=0;
  for (const p of DATA.projets) {
    if (CLIENT_STATUT_WON.has(p.Statut)) won++;
    else if (CLIENT_STATUT_LIVE.has(p.Statut)) live++;
    else lost++;
  }
  const closed = won + lost;
  const cvPct = closed>0 ? (won/closed*100).toFixed(1)+'%' : '—';
  const cvEl = $('#cv-pct'); if (cvEl) cvEl.textContent = cvPct;
  const wEl  = $('#cv-won');  if (wEl)  wEl.textContent  = won;
  const lvEl = $('#cv-live'); if (lvEl) lvEl.textContent = live;
  const lEl  = $('#cv-lost'); if (lEl)  lEl.textContent  = lost;
  if (!rows.length) {
    $('#marges-table').innerHTML = emptyState('Aucun projet signé pour l\'instant', ' Les marges apparaîtront dès qu\'un devis sera signé (et que les commandes/devis artisans seront enregistrés).');
    return;
  }
  $('#marges-table').innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>Projet</th><th class="hide-mob">Statut</th>
      <th class="num">CA HT</th><th class="num">Coûts</th>
      <th class="num">Marge €</th><th class="num">Marge %</th>
    </tr></thead><tbody>
    ${rows.map(r=>{
      const cls = r.marge>=0?'marge-pos':'marge-neg';
      const pctStr = r.pct!=null ? r.pct.toFixed(1)+'%' : '—';
      const overrideTag = r.isOverride ? ' <span class="badge-mini" title="Coûts saisis manuellement">M</span>' : '';
      return `<tr onclick="openMargeEdit('${r.p.id}')">
        <td><strong>${esc(r.p.Référence||'—')}</strong></td>
        <td class="hide-mob">${esc(r.p.Statut||'')}</td>
        <td class="num">${euros(r.ca)}</td>
        <td class="num">${euros(r.couts)}${overrideTag}</td>
        <td class="num ${cls}">${euros(r.marge)}</td>
        <td class="num ${cls}">${pctStr}</td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}
function openMargeEdit(projetId){
  const p = DATA.projets.find(x=>x.id===projetId); if(!p) return;
  const calc = computeProjetMarge(p);
  const html = `<div class="modal-bg on" id="marge-edit-bg" onclick="if(event.target===this)closeMargeEdit()">
    <div class="modal-card" style="max-width:480px">
      <div class="modal-head">
        <div class="modal-title">${esc(p.Référence||'Projet')} · Marge</div>
        <button class="modal-close" onclick="closeMargeEdit()">×</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:14px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>CA signé</span><strong>${euros(calc.ca)}</strong></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:var(--ink3)"><span>Coûts auto (commandes fournisseurs)</span><span>${euros(calc.coutsAuto)}</span></div>
        </div>
        <div class="form-row"><label>Coûts réels override (€) — laisser vide pour calcul auto</label><input id="me-override" type="number" step="0.01" value="${calc.override||''}" placeholder="${calc.coutsAuto}"></div>
        <div style="font-size:11px;color:var(--ink4);margin-top:8px">Si tu renseignes une valeur, elle remplacera le calcul automatique pour le calcul de marge.</div>
      </div>
      <div class="modal-foot" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border)">
        <button class="abtn" onclick="closeMargeEdit()">Annuler</button>
        <button class="abtn primary" onclick="saveMargeOverride('${p.id}')">Enregistrer</button>
      </div>
    </div></div>`;
  const host=document.createElement('div'); host.id='marge-edit-host'; host.innerHTML=html;
  document.body.appendChild(host);
}
function closeMargeEdit(){ document.getElementById('marge-edit-host')?.remove(); }
async function saveMargeOverride(projetId){
  const v = document.getElementById('me-override').value.trim();
  const fields = {'Coûts réels override': v===''?null:Number(v)};
  try {
    const r = await fetch('/api/data/projets/'+projetId, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    if (!r.ok) throw new Error((await r.json()).error||'erreur');
    toastSuccess('Coûts mis à jour');
    closeMargeEdit();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}

function renderStock(){
  const filter = document.getElementById('stock-filter')?.value || '';
  let items = DATA.stock||[];
  if (filter) items = items.filter(s=>s.Catégorie===filter);
  items = items.slice().sort((a,b)=>(a.Désignation||'').localeCompare(b.Désignation||''));
  const totalValue = items.reduce((s,i)=>s+((i['Quantité en stock']||0)*(i['Prix achat HT']||0)),0);
  $('#stock-count').textContent = items.length;
  $('#stock-value').textContent = euros(totalValue);
  if (!items.length) {
    $('#stock-table').innerHTML = emptyState('Stock vide', ' Ajoute ton premier article (référence + quantité + prix achat HT) pour commencer le suivi.');
    return;
  }
  $('#stock-table').innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>Désignation</th><th class="hide-mob">Catégorie</th><th class="hide-mob">Marque</th>
      <th class="num">Stock</th><th class="num hide-mob">Réservé</th>
      <th class="num">PA HT</th><th class="num hide-mob">Valeur</th>
    </tr></thead><tbody>
    ${items.map(i=>{
      const qte = i['Quantité en stock']||0;
      const res = i['Quantité réservée']||0;
      const dispo = qte - res;
      const valeur = qte * (i['Prix achat HT']||0);
      const lowCls = dispo<=1 ? 'stock-low' : '';
      return `<tr onclick="openStockEdit('${i.id}')">
        <td><strong>${esc(i.Désignation||'—')}</strong>${i.Référence?`<br><span style="font-size:10px;color:var(--ink4);font-family:'DM Mono',monospace">${esc(i.Référence)}</span>`:''}</td>
        <td class="hide-mob">${esc(i.Catégorie||'—')}</td>
        <td class="hide-mob">${esc(i.Marque||'')}</td>
        <td class="num ${lowCls}">${qte}${res?` <span style="color:var(--ink4);font-size:10px">(-${res})</span>`:''}</td>
        <td class="num hide-mob">${res||'—'}</td>
        <td class="num">${euros(i['Prix achat HT'])}</td>
        <td class="num hide-mob">${euros(valeur)}</td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}
function openStockEdit(stockId){
  const isNew = !stockId;
  const s = isNew ? {id:null,Référence:'',Désignation:'',Catégorie:'Électroménager',Marque:'',Fournisseur:[],'Quantité en stock':0,'Quantité réservée':0,Emplacement:'','Prix achat HT':0,'Date entrée':'','Affecté à':[],Notes:''}
                  : (DATA.stock.find(x=>x.id===stockId)||{});
  const cats = ['Électroménager','Sanitaire','Évier','Robinetterie','Accessoire','Autre'];
  const fournOptions = ['<option value="">—</option>'].concat(DATA.fournisseurs.map(f=>{
    const sel = Array.isArray(s.Fournisseur)&&s.Fournisseur.includes(f.id)?'selected':'';
    return `<option value="${f.id}" ${sel}>${esc(f.Nom||'—')}</option>`;
  })).join('');
  const projOptions = ['<option value="">—</option>'].concat(DATA.projets.map(p=>{
    const sel = Array.isArray(s['Affecté à'])&&s['Affecté à'].includes(p.id)?'selected':'';
    return `<option value="${p.id}" ${sel}>${esc(p.Référence||'—')}</option>`;
  })).join('');
  const html = `<div class="modal-bg on" id="stock-edit-bg" onclick="if(event.target===this)closeStockEdit()">
    <div class="modal-card" style="max-width:560px">
      <div class="modal-head">
        <div class="modal-title">${isNew?'Nouvel article stock':"Modifier l'article"}</div>
        <button class="modal-close" onclick="closeStockEdit()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-grid2">
          <div class="form-row"><label>Référence</label><input id="se-Reference" value="${esc(s.Référence||'')}"></div>
          <div class="form-row"><label>Catégorie</label><select id="se-Categorie">${cats.map(c=>`<option ${s.Catégorie===c?'selected':''}>${c}</option>`).join('')}</select></div>
        </div>
        <div class="form-row"><label>Désignation *</label><input id="se-Designation" value="${esc(s.Désignation||'')}"></div>
        <div class="form-grid2">
          <div class="form-row"><label>Marque</label><input id="se-Marque" value="${esc(s.Marque||'')}"></div>
          <div class="form-row"><label>Fournisseur</label><select id="se-Fournisseur">${fournOptions}</select></div>
          <div class="form-row"><label>Quantité en stock</label><input id="se-Qte" type="number" step="1" value="${s['Quantité en stock']||0}"></div>
          <div class="form-row"><label>Quantité réservée</label><input id="se-QteRes" type="number" step="1" value="${s['Quantité réservée']||0}"></div>
          <div class="form-row"><label>Prix achat HT (€)</label><input id="se-PA" type="number" step="0.01" value="${s['Prix achat HT']||0}"></div>
          <div class="form-row"><label>Date entrée</label><input id="se-Date" type="date" value="${esc(s['Date entrée']||'')}"></div>
          <div class="form-row"><label>Emplacement</label><input id="se-Emplacement" value="${esc(s.Emplacement||'')}"></div>
          <div class="form-row"><label>Affecté à projet</label><select id="se-Projet">${projOptions}</select></div>
        </div>
        <div class="form-row"><label>Notes</label><textarea id="se-Notes" rows="2">${esc(s.Notes||'')}</textarea></div>
      </div>
      <div class="modal-foot" style="display:flex;justify-content:space-between;gap:8px;padding:14px 20px;border-top:1px solid var(--border)">
        ${isNew?'<span></span>':`<button class="abtn" style="color:#c25656;border-color:#e0a8a8" onclick="deleteStock('${s.id}')">Supprimer</button>`}
        <div style="display:flex;gap:8px">
          <button class="abtn" onclick="closeStockEdit()">Annuler</button>
          <button class="abtn primary" onclick="saveStock('${s.id||''}')">Enregistrer</button>
        </div>
      </div>
    </div></div>`;
  const host=document.createElement('div'); host.id='stock-edit-host'; host.innerHTML=html;
  document.body.appendChild(host);
}
function closeStockEdit(){ document.getElementById('stock-edit-host')?.remove(); }
async function saveStock(stockId){
  const fournId = document.getElementById('se-Fournisseur').value;
  const projId = document.getElementById('se-Projet').value;
  const fields = {
    'Référence': document.getElementById('se-Reference').value.trim(),
    'Désignation': document.getElementById('se-Designation').value.trim(),
    'Catégorie': document.getElementById('se-Categorie').value,
    'Marque': document.getElementById('se-Marque').value.trim(),
    'Fournisseur': fournId?[fournId]:[],
    'Quantité en stock': Number(document.getElementById('se-Qte').value)||0,
    'Quantité réservée': Number(document.getElementById('se-QteRes').value)||0,
    'Prix achat HT': Number(document.getElementById('se-PA').value)||0,
    'Date entrée': document.getElementById('se-Date').value || null,
    'Emplacement': document.getElementById('se-Emplacement').value.trim(),
    'Affecté à': projId?[projId]:[],
    'Notes': document.getElementById('se-Notes').value.trim(),
  };
  if (!fields.Désignation) { toastError('Désignation obligatoire'); return; }
  try {
    const url = stockId ? '/api/data/stock/'+stockId : '/api/data/stock';
    const method = stockId ? 'PATCH' : 'POST';
    const r = await fetch(url, {method,headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})});
    if (!r.ok) throw new Error((await r.json()).error||'erreur');
    toastSuccess(stockId?'Article mis à jour':'Article créé');
    closeStockEdit();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}
async function deleteStock(stockId){
  if (!confirm('Supprimer définitivement cet article ?')) return;
  try {
    const r = await fetch('/api/data/stock/'+stockId, {method:'DELETE'});
    if (!r.ok) throw new Error('erreur');
    toastSuccess('Article supprimé');
    closeStockEdit();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); }
}

// ============ DEVIS ============
function devisCard(d){
  const statutClass = {'Brouillon':'b-gray','Envoyé':'b-amber','Signé':'b-green','Annulé':'b-red'}[d.Statut]||'b-gray';
  const typeDevis = d['Type devis'] || 'Principal';
  const typeClass = typeDevis === 'Additif' ? 'b-amber' : 'b-blue';
  return `<div class="card" style="cursor:pointer;position:relative">
    <div onclick="openDevisDetail('${d.id}')">
      <div class="card-top">
        <div class="card-nom">${esc(d['Numéro devis']||'—')} <span class="badge ${typeClass}">${esc(typeDevis)}</span> <span class="badge ${statutClass}">${esc(d.Statut||'—')}</span>${d.Milieu?` <span class="badge b-blue">${esc(d.Milieu)}</span>`:''}</div>
        <div class="card-amt">${euros(d['Total TTC'])}</div>
      </div>
      <div class="card-meta">
        <span>Date ${esc(d['Date devis']||'—')}</span>
        <span>Valable ${esc(d["Valable jusqu'au"]||'—')}</span>
        ${d['Alertes parsing']?`<span style="color:var(--amber)">⚠ Alertes parsing</span>`:''}
      </div>
    </div>
    <button class="btn-del-card" onclick="event.stopPropagation();deleteDevis('${d.id}','${esc(d['Numéro devis']||'ce devis')}')" title="Supprimer">×</button>
  </div>`;
}

async function deleteDevis(devisId, label){
  if (!confirm(`Supprimer définitivement "${label}" ?\n\nCela supprimera le devis, ses zones, lignes et échéances liées.\nLes commandes fournisseurs et tâches créées ne seront PAS supprimées.`)) return;
  showLoader('Suppression…');
  try {
    // Fetch detail to know linked records
    const r = await fetch('/api/devis/'+devisId+'/detail');
    const d = await r.json();
    const ids = {
      'zones-devis': (d.zones||[]).map(z=>z.id),
      'lignes-devis': (d.lignes||[]).map(l=>l.id),
      'echeances-devis': (d.echeances||[]).map(e=>e.id)
    };
    for (const [table, list] of Object.entries(ids)) {
      for (const rid of list) {
        await fetch('/api/data/'+table+'/'+rid, {method:'DELETE'});
      }
    }
    await fetch('/api/data/devis/'+devisId, {method:'DELETE'});
    hideLoader();
    await loadAll();
    closeDevisDetail();
  } catch(e) { hideLoader(); toastError('Erreur : '+e.message); }
}
function renderDevis(){
  $('#list-devis').innerHTML = DATA.devis.length
    ? DATA.devis.map(devisCard).join('')
    : emptyState('Aucun devis pour l\'instant', ' Importe un PDF Winner/Métron — Claude lit le PDF et crée le client + le projet + le devis avec ses zones/lignes/échéances en 1 étape.', '📄 Importer un PDF Winner', `document.getElementById('devis-pdf-input').click()`);
}

let DEVIS_CURRENT = null;
let DEVIS_EDIT = false;

async function openDevisDetail(devisId){
  showLoader('Chargement du devis…');
  try {
    const r = await fetch('/api/devis/'+devisId+'/detail');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error||'Erreur');
    DEVIS_CURRENT = d;
    DEVIS_EDIT = false;
    renderDevisDetail(d);
    $('#devis-list-view').style.display='none';
    $('#devis-detail-view').style.display='block';
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

function toggleDevisEdit(on){
  DEVIS_EDIT = on;
  renderDevisDetail(DEVIS_CURRENT);
}

async function signDevis(devisId){
  if (!confirm('Signer ce bon de commande ?\n\nCela va :\n- Passer le statut en SIGNÉ\n- Générer les commandes fournisseurs par catégorie\n- Créer les tâches de suivi (acompte, commandes, pose)\n- Passer le projet en statut "Commandes"')) return;
  showLoader('Signature en cours…');
  try {
    const r = await fetch('/api/devis/'+devisId+'/sign', {method:'POST'});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error||'Erreur signature');
    hideLoader();
    toastSuccess(`BC signé · ${d.commandes_creees} commandes · ${d.taches_creees} tâches créées`);
    await loadAll();
    openDevisDetail(devisId);
  } catch(e) { hideLoader(); toastError('Erreur : '+e.message); }
}

async function saveDevisEdits(){
  const inputs = document.querySelectorAll('#devis-detail-view [data-dirty-key]');
  const patches = {}; // { "lignes-devis/recXXX": { field: value } }
  inputs.forEach(inp => {
    const key = inp.dataset.dirtyKey; // ex: lignes-devis/recXXX/Désignation
    const [table, rid, ...fieldParts] = key.split('/');
    const field = fieldParts.join('/');
    const orig = inp.dataset.orig ?? '';
    if (inp.value !== orig) {
      const k = table+'/'+rid;
      patches[k] = patches[k] || { table, rid, fields: {} };
      patches[k].fields[field] = inp.value;
    }
  });
  const list = Object.values(patches);
  if (!list.length) { DEVIS_EDIT = false; renderDevisDetail(DEVIS_CURRENT); return; }
  showLoader('Enregistrement… ('+list.length+' modifs)');
  try {
    for (const p of list) {
      const r = await fetch('/api/data/'+p.table+'/'+p.rid, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fields:p.fields})});
      if (!r.ok) throw new Error('Echec sauvegarde '+p.rid);
    }
    // Recharge
    const r = await fetch('/api/devis/'+DEVIS_CURRENT.devis.id+'/detail');
    DEVIS_CURRENT = await r.json();
    DEVIS_EDIT = false;
    renderDevisDetail(DEVIS_CURRENT);
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

function renderDevisDetail(data){
  const dv = data.devis.fields || {};
  const zones = (data.zones||[]).map(r=>({id:r.id, ...r.fields})).sort((a,b)=>(a.Ordre||0)-(b.Ordre||0));
  const lignes = (data.lignes||[]).map(r=>({id:r.id, ...r.fields})).sort((a,b)=>{
    const pa = parseFloat(a.Position||'0'); const pb = parseFloat(b.Position||'0');
    return pa-pb;
  });
  const echeances = (data.echeances||[]).map(r=>({id:r.id, ...r.fields})).sort((a,b)=>(a.Ordre||0)-(b.Ordre||0));
  const devisId = data.devis.id;

  const editing = DEVIS_EDIT;
  const field = (table, rid, name, value) => {
    if (!editing) return esc(value||'');
    const v = esc(value||'');
    return `<input class="edit-inp" data-dirty-key="${table}/${rid}/${name}" data-orig="${v}" value="${v}">`;
  };

  const zonesHtml = zones.length ? zones.map(z => `
    <div class="zone-block">
      <div class="zone-title">${esc(z['Nom zone']||'Zone')}</div>
      <div class="zone-grid">
        ${['Marque','Modèle','Porte épaisseur','Modularité','Exécution façade','Coloris façade','Chant façade','Coloris caisson','Type de gorge','Exécution gorges','Finition gorges','Profondeur','Option ouverture','Finition socle','Finition étagères'].map(k => (z[k]||editing)?`<div>${esc(k)}<br><strong>${field('zones-devis',z.id,k,z[k])}</strong></div>`:'').join('')}
      </div>
    </div>
  `).join('') : '<div class="muted" style="font-size:12px;color:var(--ink4);padding:8px">Aucune zone définie</div>';

  const categoriesOrder = ['Meubles','Panneaux de recouvrement','Produits de vente','Eviers et robinetterie','Electroménager','Sanitaires','Dépose','Divers'];
  const lignesByCat = {};
  lignes.forEach(l => { const c = l['Catégorie']||'Autre'; (lignesByCat[c]=lignesByCat[c]||[]).push(l); });

  // RÉCAP PAR CATÉGORIE
  const catTotals = categoriesOrder.map(c => {
    const arr = lignesByCat[c] || [];
    const total = arr.reduce((s,l)=>s+(parseFloat(l['Montant HT'])||0),0);
    return { cat: c, count: arr.length, total };
  }).filter(r => r.count > 0);
  const catTotalSum = catTotals.reduce((s,r)=>s+r.total,0);
  const recapHtml = catTotals.length ? `
    <div class="zone-title" style="margin-top:22px">Résumé par catégorie</div>
    <table class="lignes-table recap-table">
      <tbody>
        ${catTotals.map(r=>`<tr>
          <td>${esc(r.cat)}</td>
          <td class="num" style="color:var(--ink4);font-size:11px">${r.count} ligne${r.count>1?'s':''}</td>
          <td class="num"><strong>${euros(r.total)}</strong></td>
        </tr>`).join('')}
        <tr style="border-top:2px solid var(--ink1)">
          <td><strong>Total des lignes d'articles</strong></td>
          <td></td>
          <td class="num"><strong>${euros(catTotalSum)}</strong></td>
        </tr>
      </tbody>
    </table>` : '';

  const lignesHtml = categoriesOrder.filter(c => lignesByCat[c]).map((c, idx) => {
    const catKey = 'cat-'+idx;
    const total = lignesByCat[c].reduce((s,l)=>s+(parseFloat(l['Montant HT'])||0),0);
    return `
    <div class="cat-block">
      <div class="cat-head" onclick="toggleCat('${catKey}')">
        <span class="cat-toggle" id="${catKey}-tog">▸</span>
        <span class="cat-name">${esc(c)}</span>
        <span class="cat-count">${lignesByCat[c].length} ligne${lignesByCat[c].length>1?'s':''}</span>
        <span class="cat-total">${euros(total)}</span>
      </div>
      <div class="cat-body" id="${catKey}-body" style="display:none">
        <table class="lignes-table">
          <thead><tr><th>Pos</th><th>Code</th><th>Désignation</th><th>Qté</th><th>HT</th></tr></thead>
          <tbody>
            ${lignesByCat[c].map(l => `<tr class="${l['Position parent']?'sub':''}">
              <td class="num">${esc(l.Position||'')}</td>
              <td class="code">${field('lignes-devis',l.id,'Code produit',l['Code produit'])}</td>
              <td>${field('lignes-devis',l.id,'Désignation',(l['Désignation']||'').slice(0,200))}</td>
              <td class="num">${l['Quantité']||''} ${esc(l['Unité']||'')}</td>
              <td class="num">${euros(l['Montant HT'])}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  const echeancesHtml = echeances.length ? `
    <div class="zone-title" style="margin-top:22px">Échéancier</div>
    <table class="lignes-table">
      <thead><tr><th>Libellé</th><th>Date prévue</th><th>Montant prévu</th><th>Statut</th></tr></thead>
      <tbody>${echeances.map(e => `<tr>
        <td>${esc(e['Libellé']||'')}</td>
        <td>${esc(e['Date prévue']||'—')}</td>
        <td class="num">${euros(e['Montant prévu'])}</td>
        <td><span class="badge b-gray">${esc(e.Statut||'—')}</span></td>
      </tr>`).join('')}</tbody>
    </table>` : '';

  const isSigned = dv.Statut === 'Signé';
  const actionsBar = editing
    ? `<div style="display:flex;gap:8px"><button class="btn-primary" onclick="saveDevisEdits()">Enregistrer</button><button class="btn-ghost" onclick="toggleDevisEdit(false)">Annuler</button></div>`
    : `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-ghost" onclick="toggleDevisEdit(true)">Modifier</button>
        ${isSigned ? '' : `<button class="btn-primary" onclick="signDevis('${devisId}')">✓ Signer ce BC</button>`}
        <button class="btn-danger" onclick="deleteDevis('${devisId}','${esc(dv['Numéro devis']||'ce devis')}')">Supprimer</button>
      </div>`;

  $('#devis-detail-view').innerHTML = `
    <button class="devis-back" onclick="closeDevisDetail()">← Retour aux devis</button>
    <div class="devis-detail">
      <div class="devis-header">
        <div>
          <div class="devis-title">${esc(dv['Numéro devis']||'Devis sans numéro')} <span class="badge b-blue">${esc(dv.Milieu||'')}</span> <span class="badge ${{'Brouillon':'b-gray','Envoyé':'b-amber','Signé':'b-green','Annulé':'b-red'}[dv.Statut]||'b-gray'}">${esc(dv.Statut||'')}</span></div>
          <div class="devis-sub">Date ${esc(dv['Date devis']||'—')} · Valable jusqu'au ${esc(dv["Valable jusqu'au"]||'—')}</div>
        </div>
        <div style="display:flex;align-items:flex-start;gap:24px">
          <div>
            <div class="devis-total-lbl">Total TTC</div>
            <div class="devis-total">${euros(dv['Total TTC'])}</div>
          </div>
          ${actionsBar}
        </div>
      </div>

      ${editing?`<div style="background:#FFF8E6;border:1px solid var(--amber);border-radius:5px;padding:10px;font-size:12px;color:#8A6100;margin-bottom:16px">✎ <strong>Mode édition actif.</strong> Clique sur « Enregistrer » pour valider, « Annuler » pour abandonner. Rien n'est sauvegardé tant que tu n'as pas cliqué.</div>`:''}

      ${dv['Alertes parsing']?`<div style="background:var(--amber-bg);border:1px solid var(--amber);border-radius:5px;padding:10px;font-size:12px;color:var(--amber);margin-bottom:16px">⚠ <strong>Alertes parsing :</strong> ${esc(dv['Alertes parsing'])}</div>`:''}

      ${recapHtml}

      <div class="zone-title" style="margin-top:22px">Paramètres par zone</div>
      ${zonesHtml}

      <div class="zone-title" style="margin-top:22px">Lignes · ${lignes.length} articles <span style="color:var(--ink4);font-size:11px;font-weight:400;text-transform:none;letter-spacing:0">— clique sur une catégorie pour déplier</span></div>
      ${lignesHtml}


      ${echeancesHtml}

      <div class="totaux-block">
        <div class="tl">Total lignes HT</div><div class="tv">${euros(dv['Total HT articles'])}</div>
        ${dv['Remise pourcentage']?`<div class="tl">Remise ${(dv['Remise pourcentage']*100).toFixed(0)}%</div><div class="tv">-${euros(dv['Montant remise'])}</div>`:''}
        ${dv['Livraison HT']?`<div class="tl">Livraison</div><div class="tv">${euros(dv['Livraison HT'])}</div>`:''}
        ${dv['Pose HT']?`<div class="tl">Pose</div><div class="tv">${euros(dv['Pose HT'])}</div>`:''}
        ${dv['Eco-participation mobilier']?`<div class="tl">Eco-participation mobilier</div><div class="tv">${euros(dv['Eco-participation mobilier'])}</div>`:''}
        ${dv['Eco-participation électroménager']?`<div class="tl">Eco-participation électro</div><div class="tv">${euros(dv['Eco-participation électroménager'])}</div>`:''}
        <div class="tl">Total HT final</div><div class="tv">${euros(dv['Total HT final'])}</div>
        ${dv['TVA taux 1 montant']?`<div class="tl">TVA ${dv['TVA taux 1 pourcentage']}%</div><div class="tv">${euros(dv['TVA taux 1 montant'])}</div>`:''}
        ${dv['TVA taux 2 montant']?`<div class="tl">TVA ${dv['TVA taux 2 pourcentage']}%</div><div class="tv">${euros(dv['TVA taux 2 montant'])}</div>`:''}
        <div class="tl tt">Total TTC</div><div class="tv tt">${euros(dv['Total TTC'])}</div>
      </div>
    </div>
  `;
}

function closeDevisDetail(){
  $('#devis-detail-view').style.display='none';
  $('#devis-list-view').style.display='block';
}

async function patchLigne(input){
  const rid = input.dataset.rid;
  const field = input.dataset.field;
  try {
    await fetch('/api/data/lignes-devis/'+rid, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{[field]:input.value}})});
    input.style.background='var(--green-bg)';
    setTimeout(()=>{input.style.background='';},800);
  } catch(e) { toastError('Erreur : '+e.message); }
}

function importDevisPdf(file){
  if (!file) return;
  if (file.size > 15*1024*1024) { toastError('PDF trop volumineux (max 15 MB)'); document.getElementById('devis-pdf-input').value=''; return; }
  openDevisTargetModal(file);
}

function openDevisTargetModal(file){
  const sorted = (DATA.projets||[]).slice().sort((a,b)=>(a.Référence||'').localeCompare(b.Référence||''));
  const options = sorted.map(p => `<option value="${p.id}">${esc(p.Référence||p.id)}${p.Statut?' · '+esc(p.Statut):''}</option>`).join('');
  const html = `
    <div class="modal-bg on" id="devis-tgt-bg" onclick="if(event.target===this)closeDevisTargetModal()">
      <div class="modal-card" style="max-width:520px">
        <div class="modal-head">
          <div class="modal-title">Importer « ${esc(file.name)} »</div>
          <button class="modal-close" onclick="closeDevisTargetModal()">×</button>
        </div>
        <div class="modal-body">
          <div style="font-size:13px;color:var(--ink2);margin-bottom:14px">Rattacher le devis à :</div>
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;cursor:pointer">
            <input type="radio" name="devis-tgt" value="new" checked onchange="document.getElementById('devis-tgt-sel').disabled=true">
            <div>
              <div style="font-weight:500">Nouveau projet</div>
              <div style="font-size:11px;color:var(--ink4)">Client + projet créés automatiquement à partir du PDF (comportement actuel)</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer">
            <input type="radio" name="devis-tgt" value="existing" onchange="document.getElementById('devis-tgt-sel').disabled=false;document.getElementById('devis-tgt-sel').focus()">
            <div style="flex:1">
              <div style="font-weight:500">Projet existant</div>
              <select id="devis-tgt-sel" disabled style="width:100%;margin-top:6px;padding:7px 10px;border:1px solid var(--border);border-radius:4px;font-family:inherit;font-size:13px;background:#fff">
                <option value="">— Choisir un projet —</option>
                ${options}
              </select>
            </div>
          </label>
        </div>
        <div class="modal-foot" style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border)">
          <button class="abtn" onclick="closeDevisTargetModal()">Annuler</button>
          <button class="abtn primary" onclick="confirmDevisImport()">Importer</button>
        </div>
      </div>
    </div>`;
  const host = document.createElement('div'); host.id = 'devis-tgt-host'; host.innerHTML = html;
  document.body.appendChild(host);
  window._pendingDevisFile = file;
}
function closeDevisTargetModal(){
  document.getElementById('devis-tgt-host')?.remove();
  const inp = document.getElementById('devis-pdf-input'); if (inp) inp.value = '';
  window._pendingDevisFile = null;
}
function confirmDevisImport(){
  const file = window._pendingDevisFile;
  if (!file) return closeDevisTargetModal();
  const target = document.querySelector('input[name="devis-tgt"]:checked')?.value;
  let projetId = null;
  if (target === 'existing') {
    projetId = document.getElementById('devis-tgt-sel').value;
    if (!projetId) { toastError('Choisis un projet existant ou choisis « Nouveau projet »'); return; }
  }
  document.getElementById('devis-tgt-host')?.remove();
  doImportDevisPdf(file, projetId);
}
async function doImportDevisPdf(file, projetId){
  showLoader('Analyse du PDF par Claude… (30-60s)');
  try {
    const fd = new FormData();
    fd.append('pdf', file);
    if (projetId) fd.append('projetId', projetId);
    const r = await fetch('/api/devis/import', {method:'POST', body:fd});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error||'Erreur parsing');
    hideLoader();
    toastSuccess(`Devis ${d.parsed_summary.numero} importé · ${d.parsed_summary.lignes} lignes · ${euros(d.parsed_summary.total_ttc)}`);
    await loadAll();
    openDevisDetail(d.devisId);
  } catch(e) {
    hideLoader();
    toastError('Erreur : '+e.message);
  }
  document.getElementById('devis-pdf-input').value='';
  window._pendingDevisFile = null;
}

// ============ FICHE DÉCOUVERTE ============
function fichesCard(f){
  return `<div class="card" onclick="openDecouverteForm('${f.id}')" style="cursor:pointer">
    <div class="card-top">
      <div class="card-nom">${esc(f.Titre||f.Nom||'Fiche sans nom')} <span class="badge b-gray">${esc(f['Type de projet']||'')}</span></div>
      <div class="card-amt">${esc(f['Date RDV']||'')}</div>
    </div>
    <div class="card-meta">
      <span>${esc(f.Conseiller||'—')}</span>
      <span>${esc(f.Email||'')}</span>
      <span>${esc(f.Téléphone||'')}</span>
    </div>
  </div>`;
}
function renderFichesDecouverte(){
  $('#list-fiches-decouverte').innerHTML = DATA['fiches-decouverte'].length
    ? DATA['fiches-decouverte'].map(fichesCard).join('')
    : emptyState('Aucune fiche découverte', ' Crée la première fiche pendant le RDV découverte (besoins, contraintes, budget envisagé) — elle alimente ensuite la fiche projet.', '+ Nouvelle fiche découverte', `openDecouverteForm()`);
}

const DF_SECTIONS = [
  { title: 'Identité projet', fields: [
    {k:'Titre', label:'Titre fiche', req:true, col:2},
    {k:'Nom', label:'Nom client'},
    {k:'Type de projet', label:'Type de projet'},
    {k:'Date RDV', label:'Date RDV', type:'date'},
    {k:'Conseiller', label:'Conseiller', type:'select', options:['Virginie','Solène','Sébastien','Marine']},
    {k:'Adresse facturation', label:'Adresse facturation', type:'textarea'},
    {k:'Adresse chantier', label:'Adresse chantier', type:'textarea'},
    {k:'Étage', label:'Étage'},
    {k:'Code accès', label:'Code d\'accès'},
    {k:'Stationnement', label:'Stationnement', type:'select', options:['','Oui','Non']},
    {k:'Email', label:'Email', type:'email'},
    {k:'Téléphone', label:'Téléphone'},
    {k:'Notes libres', label:'Notes libres', type:'textarea', col:2}
  ]},
  { title: 'Préparation plan technique', fields: [
    {k:'Hauteur socle', label:'Hauteur socle', type:'select', options:['','6','8','10','Autre']},
    {k:'Hauteur socle autre', label:'Hauteur socle autre'},
    {k:'Filtre socle', label:'Filtre socle suivant marque cuisson', type:'select', options:['','Oui','Non']},
    {k:'Extraction hotte', label:'Extraction hotte', type:'select', options:['','Recyclage','Extraction','Néant']},
    {k:'Cuve', label:'Cuve', type:'select', options:['','Par dessus','Par dessous','Monter par fournisseur']},
    {k:'Taille cuve', label:'Taille cuve', type:'select', options:['','Standard','Autre']},
    {k:'Taille cuve autre', label:'Taille cuve autre'},
    {k:'Egouttoir 1', label:'Egouttoir 1', type:'select', options:['','Oui','Non','Néant']},
    {k:'Rainures', label:'Rainures', type:'select', options:['','Oui','Non','Néant']},
    {k:'Rainures nombre', label:'Nombre de rainures', type:'number'},
    {k:'Mitigeur fenêtre', label:'Mitigeur spécial fenêtre', type:'select', options:['','Oui','Non']},
    {k:'Mitigeur type', label:'Type mitigeur', type:'select', options:['','Standard','Eau bouillante','Eau fraîche et pétillante','Eau filtrée']},
    {k:'Dosserets', label:'Dosserets', type:'select', options:['','Oui','Non']},
    {k:'Egouttoir 2', label:'Egouttoir 2', type:'select', options:['','Oui','Non','Néant']},
    {k:'Egouttoir 2 matière', label:'Egouttoir 2 matière'},
    {k:'Prise îlot', label:'Prise îlot', type:'select', options:['','Oui - à fournir','Oui - fourni client','Non']},
    {k:'Prise joue', label:'Prise joue', type:'select', options:['','Oui - à fournir','Oui - fourni client','Non']}
  ]},
  { title: 'Feuille de choix électroménager', fields: [
    {k:'Couleur électro', label:'Couleur électro', type:'select', options:['','Mat','Brillant']},
    {k:'Lave-vaisselle type', label:'Lave-vaisselle type', type:'select', options:['','Pause libre','Encastrable','Intégrable']},
    {k:'Lave-vaisselle paniers', label:'Lave-vaisselle paniers', type:'select', options:['','Panier à couverts','Tiroir à couverts']},
    {k:'Type pose cuisson', label:'Type pose cuisson', type:'select', options:['','Affleur','Encastré']}
  ]}
];

function openDecouverteForm(id){
  const existing = id ? DATA['fiches-decouverte'].find(x=>x.id===id) : null;
  const data = existing || {};
  let html = `<button class="devis-back" onclick="closeDecouverteForm()">← Retour aux fiches</button>
    <form class="decouverte-form" onsubmit="return saveDecouverte(event, ${id?`'${id}'`:'null'})">`;
  for (const sec of DF_SECTIONS) {
    html += `<div class="df-section"><h3>${sec.title}</h3><div class="df-grid">`;
    for (const f of sec.fields) {
      const val = data[f.k] || '';
      const idAttr = 'df_'+f.k.replace(/\W/g,'_');
      const span = f.col===2?' style="grid-column:span 2"':'';
      html += `<div class="df-field"${span}><label>${f.label}${f.req?' *':''}</label>`;
      if (f.type === 'select') {
        html += `<select id="${idAttr}">${f.options.map(o=>`<option value="${esc(o)}"${o===val?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        html += `<textarea id="${idAttr}">${esc(val)}</textarea>`;
      } else {
        html += `<input id="${idAttr}" type="${f.type||'text'}" value="${esc(val)}"${f.req?' required':''}>`;
      }
      html += '</div>';
    }
    html += '</div></div>';
  }
  html += `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
    <button type="button" class="mbtn cancel" onclick="closeDecouverteForm()">Annuler</button>
    <button type="submit" class="mbtn primary">Enregistrer</button>
  </div></form>`;
  $('#decouverte-form-view').innerHTML = html;
  $('#decouverte-list-view').style.display='none';
  $('#decouverte-form-view').style.display='block';
}

function closeDecouverteForm(){
  $('#decouverte-form-view').style.display='none';
  $('#decouverte-list-view').style.display='block';
}

async function saveDecouverte(e, id){
  e.preventDefault();
  const fields = {};
  for (const sec of DF_SECTIONS) for (const f of sec.fields) {
    const el = document.getElementById('df_'+f.k.replace(/\W/g,'_'));
    if (!el) continue;
    let v = el.value.trim();
    if (!v) continue;
    if (f.type === 'number') v = Number(v);
    fields[f.k] = v;
  }
  showLoader(id?'Mise à jour…':'Création…');
  try {
    const url = '/api/data/fiches-decouverte' + (id?'/'+id:'');
    const method = id?'PATCH':'POST';
    const r = await fetch(url, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify({fields})});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error||'Erreur');
    closeDecouverteForm();
    await loadAll();
  } catch(er) { toastError('Erreur : '+er.message); }
  finally { hideLoader(); }
  return false;
}

// ============ PLAUD ============
function plaudCard(p){
  const synth = (p.Synthèse||'').slice(0,160);
  return `<div class="card plaud-card">
    <div class="card-top">
      <div class="card-nom">${esc(p.Titre||'Réunion')} <span class="badge b-blue">${esc(p['Type réunion']||'')}</span></div>
      <div class="card-amt">${esc((p['Date heure']||'').slice(0,10))}</div>
    </div>
    <div class="card-meta">
      <span>${esc(p.Lieu||'')}</span>
      <span class="badge b-gray">${esc(p['Statut traitement']||'')}</span>
    </div>
    ${synth?`<div class="plaud-section"><span class="plaud-tag">Synthèse</span>${esc(synth)}${p.Synthèse&&p.Synthèse.length>160?'…':''}</div>`:''}
  </div>`;
}
function renderPlaud(){
  $('#list-reunions-plaud').innerHTML = DATA['reunions-plaud'].length
    ? DATA['reunions-plaud'].map(plaudCard).join('')
    : emptyState('Aucune transcription Plaud', ' Colle la transcription d\'une réunion (R1 = découverte / R2 = chantier) — Claude extrait les décisions, échéances et points d\'attention.', '+ Nouvelle transcription', `openPlaudModal()`);
}

function openPlaudModal(){
  $('#modalTitle').textContent = 'Nouvelle transcription Plaud';
  $('#modalBody').innerHTML = `
    <label>Type de réunion</label>
    <select id="plaud-type"><option>Découverte</option><option>Présentation devis</option><option>Chantier</option><option>SAV</option><option>Autre</option></select>
    <label>Transcription brute (coller le texte du Plaud)</label>
    <textarea id="plaud-transcript" style="min-height:180px" placeholder="Colle ici la transcription complète..."></textarea>
    <div style="font-size:11px;color:var(--ink4);margin-top:-8px;margin-bottom:12px">Claude va extraire automatiquement : synthèse, contexte, points de douleur, attentes, tâches.</div>
  `;
  currentModalTable = '__plaud__';
  $('#modalBg').classList.add('on');
}

async function submitPlaud(){
  const transcript = document.getElementById('plaud-transcript').value.trim();
  const type_reunion = document.getElementById('plaud-type').value;
  const projetId = document.getElementById('plaud-projet-id')?.value || null;
  const niveau = document.getElementById('plaud-niveau')?.value || null;
  if (!transcript) { toastError('Transcription requise'); return; }
  closeModal();
  showLoader('Analyse Claude en cours…');
  try {
    const payload = { transcript, type_reunion };
    if (projetId) payload.projetId = projetId;
    if (niveau) payload.niveau = niveau;
    const r = await fetch('/api/plaud/parse', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error||'Erreur');
    toastSuccess(`Transcription ${d.niveau||''} analysée et liée au projet`);
    await loadAll();
    // Si on était sur la fiche projet, refresh
    if (projetId) {
      const p = DATA.projets.find(x => x.id === projetId);
      if (p) renderProjetDetail(p);
    }
  } catch(e) { toastError('Erreur : '+e.message); }
  finally { hideLoader(); }
}

// ============ TABS ============
$$('.nb').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ============ MODAL (formulaires de création) ============
const FORMS = {
  clients: [
    {k:'Nom', label:'Nom *', req:true},
    {k:'Contact', label:'Contact'},
    {k:'Email', label:'Email', type:'email'},
    {k:'Téléphone', label:'Téléphone'},
    {k:'Type', label:'Type', type:'select', options:['Particulier','Professionnel']},
    {k:'Source', label:'Source', type:'select', options:['Showroom','Architecte','Recommandation','Web']},
    {k:'Adresse', label:'Adresse', type:'textarea'},
    {k:'Notes', label:'Notes', type:'textarea'}
  ],
  projets: [
    {k:'Référence', label:'Référence *', req:true},
    {k:'Statut', label:'Statut', type:'select', options:PIPE_STATUTS},
    {k:'Budget HT', label:'Budget HT (€)', type:'number'},
    {k:'Marge prévisionnelle', label:'Marge prév. (0-1)', type:'number', step:'0.01'},
    {k:'Date découverte', label:'Date découverte', type:'date'},
    {k:'Date pose prévue', label:'Date pose prévue', type:'date'},
    {k:'Description', label:'Description', type:'textarea'}
  ],
  artisans: [
    {k:'Nom', label:'Nom *', req:true},
    {k:'Spécialité', label:'Spécialité', type:'select', options:['Plomberie','Électricité','Carrelage','Menuiserie','Peinture','Maçonnerie']},
    {k:'Type', label:'Type', type:'select', options:['Contractuel','Non contractuel']},
    {k:'Contact principal', label:'Contact principal'},
    {k:'Email', label:'Email', type:'email'},
    {k:'Téléphone', label:'Téléphone'}
  ],
  fournisseurs: [
    {k:'Nom', label:'Nom *', req:true},
    {k:'Type', label:'Type', type:'select', options:['Meubles','Électroménager','Plan travail','Sanitaire','Accessoires']},
    {k:'Plateforme', label:'Plateforme', type:'select', options:['Direct','Fundis','Autre']},
    {k:'Email commande', label:'Email commande', type:'email'},
    {k:'Contact', label:'Contact'},
    {k:'Notes', label:'Notes', type:'textarea'}
  ],
  commandes: [
    {k:'Numéro', label:'Numéro *', req:true},
    {k:'Statut', label:'Statut', type:'select', options:['Créée','Envoyée','Confirmée','Livrée','Posée']},
    {k:'Montant HT', label:'Montant HT (€)', type:'number'},
    {k:'Date création', label:'Date création', type:'date'},
    {k:'Date livraison prévue', label:'Date livraison prévue', type:'date'}
  ],
  taches: [
    {k:'Titre', label:'Titre *', req:true},
    {k:'Assignée à', label:'Assignée à', type:'select', options:['Virginie','Solène','Sébastien','Marine']},
    {k:'Priorité', label:'Priorité', type:'select', options:['Haute','Moyenne','Basse']},
    {k:'Statut', label:'Statut', type:'select', options:['À faire','En cours','Terminée']},
    {k:'Échéance', label:'Échéance', type:'date'},
    {k:'Description', label:'Description', type:'textarea'}
  ],
  sav: [
    {k:'Référence', label:'Référence *', req:true},
    {k:'Date demande', label:'Date demande', type:'date'},
    {k:'Type', label:'Type / description', type:'textarea'},
    {k:'Réalisé par', label:'Réalisé par', type:'select', options:['Sébastien','Artisan externe']},
    {k:'Date réception', label:'Date réception', type:'date'},
    {k:'Date réalisation', label:'Date réalisation', type:'date'}
  ]
};

let currentModalRecordId = null;

function openModal(table, recordId){
  currentModalTable = table;
  currentModalRecordId = recordId || null;
  const form = FORMS[table];
  const record = recordId ? (DATA[table]||[]).find(r => r.id === recordId) : null;
  $('#modalTitle').textContent = (record ? 'Éditer · ' : 'Nouveau · ') + table;
  let body = form.map(f => {
    const id = 'f_'+f.k.replace(/\W/g,'_');
    const rawVal = record ? record[f.k] : '';
    const val = rawVal == null ? '' : String(rawVal);
    const valEsc = esc(val);
    if (f.type === 'select') {
      return `<label>${f.label}</label><select id="${id}"><option value="">—</option>${f.options.map(o=>`<option ${o===val?'selected':''}>${o}</option>`).join('')}</select>`;
    }
    if (f.type === 'textarea') {
      return `<label>${f.label}</label><textarea id="${id}">${valEsc}</textarea>`;
    }
    return `<label>${f.label}</label><input id="${id}" type="${f.type||'text'}" ${f.step?`step="${f.step}"`:''} value="${valEsc}">`;
  }).join('');

  // Cas spécial projet (création uniquement) : raccourci pour import PDF Winner
  // L'import PDF crée auto le client + le projet + les devis liés (zones/lignes/échéances).
  // Bien plus rapide qu'une saisie manuelle dans 90% des cas.
  if (table === 'projets' && !record) {
    body = `<div style="margin-bottom:18px;padding:14px 16px;border:2px solid var(--gold);border-radius:6px;background:linear-gradient(135deg,var(--gold-bg) 0%,#fff 100%)">
      <div style="font-family:'DM Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--gold-dark);font-weight:700;margin-bottom:6px">⚡ Raccourci recommandé</div>
      <div style="font-size:13px;color:var(--ink2);margin-bottom:10px;line-height:1.4">Si tu as un <strong>PDF Winner</strong> (bon de commande / devis), importe-le directement : Claude lit le PDF et crée automatiquement le client, le projet, le devis avec toutes ses zones/lignes/échéances en une seule étape.</div>
      <button class="btn-primary" style="width:100%;padding:10px" onclick="closeModal();switchTab('devis');setTimeout(()=>document.getElementById('devis-pdf-input').click(),100)">📄 Importer un PDF Winner →</button>
      <div style="font-size:11px;color:var(--ink4);text-align:center;margin-top:8px">— ou continue ci-dessous pour saisir le projet manuellement —</div>
    </div>` + body;
  }

  // Cas spécial projet (création uniquement) : bloc Plaud optionnel pour enrichir
  if (table === 'projets' && !record) {
    body += `
      <div style="margin-top:18px;padding:12px;border:1px dashed var(--border);border-radius:6px;background:#faf8f4">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:0">
          <input type="checkbox" id="projet-plaud-toggle" onchange="document.getElementById('projet-plaud-box').style.display=this.checked?'block':'none'">
          <span style="font-weight:500">💬 Enrichir via transcription Plaud</span>
        </label>
        <div id="projet-plaud-box" style="display:none;margin-top:10px">
          <label>Type réunion</label>
          <select id="projet-plaud-type" style="margin-bottom:8px">
            <option>Découverte</option><option>Présentation devis</option><option>Chantier</option><option>Autre</option>
          </select>
          <label>Transcription brute</label>
          <textarea id="projet-plaud-transcript" style="min-height:120px" placeholder="Colle ici la transcription du Plaud…"></textarea>
          <div style="font-size:11px;color:var(--ink4);margin-top:4px">Claude analysera la transcription et enrichira la Description du projet (synthèse, attentes, contexte). Un record Réunion Plaud lié sera aussi créé.</div>
        </div>
      </div>`;
  }

  $('#modalBody').innerHTML = body;
  // Bouton supprimer visible uniquement en mode édition
  const delBtn = document.getElementById('modalDeleteBtn');
  if (delBtn) delBtn.style.display = record ? 'inline-block' : 'none';
  $('#modalBg').classList.add('on');
}

function closeModal(){
  $('#modalBg').classList.remove('on');
  currentModalTable = null;
  currentModalRecordId = null;
  const delBtn = document.getElementById('modalDeleteBtn');
  if (delBtn) delBtn.style.display = 'none';
}

async function submitModal(){
  if (!currentModalTable) return;
  if (currentModalTable === '__plaud__') { return submitPlaud(); }
  if (currentModalTable === '__devis_additif__') { return submitDevisAdditif(); }
  const form = FORMS[currentModalTable];
  const fields = {};
  for (const f of form) {
    const id = 'f_'+f.k.replace(/\W/g,'_');
    const el = document.getElementById(id);
    if (!el) continue;
    let v = el.value.trim();
    // En édition, envoyer les champs vides pour permettre de les effacer
    if (!v && !currentModalRecordId) continue;
    if (f.type === 'number') v = v === '' ? null : Number(v);
    fields[f.k] = v;
  }
  if (!currentModalRecordId && !fields[form[0].k]) { toastError('Champ obligatoire manquant'); return; }
  setSync('loading','envoi');
  try {
    const url = currentModalRecordId
      ? '/api/data/'+currentModalTable+'/'+currentModalRecordId
      : '/api/data/'+currentModalTable;
    const method = currentModalRecordId ? 'PATCH' : 'POST';
    const r = await fetch(url, {
      method,
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({fields})
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error||'erreur');

    // Enrichissement Plaud (uniquement à la création d'un projet)
    if (currentModalTable === 'projets' && !currentModalRecordId) {
      const plaudToggle = document.getElementById('projet-plaud-toggle');
      const transcript = document.getElementById('projet-plaud-transcript')?.value.trim();
      if (plaudToggle?.checked && transcript) {
        const typeReunion = document.getElementById('projet-plaud-type')?.value || 'Découverte';
        const projetId = d.record?.id;
        closeModal();
        showLoader('Analyse Claude de la transcription… (30-60s)');
        try {
          const pr = await fetch('/api/plaud/parse', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ transcript, type_reunion: typeReunion, projetId })
          });
          const pd = await pr.json();
          if (!pr.ok) throw new Error(pd.error || 'erreur parsing');
          // Enrichir la Description du projet avec la synthèse
          const descParts = [];
          if (pd.parsed?.synthese) descParts.push('**Synthèse :** ' + pd.parsed.synthese);
          if (pd.parsed?.contexte) descParts.push('**Contexte :** ' + pd.parsed.contexte);
          if (pd.parsed?.attentes) descParts.push('**Attentes :** ' + pd.parsed.attentes);
          if (pd.parsed?.points_douleur) descParts.push('**Points de douleur :** ' + pd.parsed.points_douleur);
          if (descParts.length && projetId) {
            const existingDesc = fields.Description || '';
            const newDesc = (existingDesc ? existingDesc + '\n\n' : '') + descParts.join('\n\n');
            await fetch('/api/data/projets/'+projetId, {
              method:'PATCH',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ fields: { Description: newDesc }})
            });
          }
          toastSuccess('Projet créé + enrichi via Plaud');
        } catch(e) {
          toastError('Projet créé mais enrichissement Plaud échoué : ' + e.message);
        } finally {
          hideLoader();
          await loadAll();
        }
        return;
      }
    }

    closeModal();
    await loadAll();
  } catch(e) {
    toastError('Erreur : '+e.message);
    setSync('error','erreur');
  }
}

async function deleteFromModal(){
  if (!currentModalTable || !currentModalRecordId) return;
  const record = (DATA[currentModalTable]||[]).find(r => r.id === currentModalRecordId);
  const label = record ? (record.Nom || record.Référence || record.Numéro || record.Titre || currentModalRecordId) : currentModalRecordId;
  if (!confirm(`Supprimer définitivement « ${label} » ?\n\nCette action est irréversible.`)) return;
  setSync('loading','suppression');
  try {
    const r = await fetch('/api/data/'+currentModalTable+'/'+currentModalRecordId, { method: 'DELETE' });
    if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.error||'erreur'); }
    closeModal();
    await loadAll();
  } catch(e) { toastError('Erreur : '+e.message); setSync('error','erreur'); }
}

// Fermer modal clic fond
$('#modalBg').addEventListener('click', e => { if (e.target === $('#modalBg')) closeModal(); });

// ============ INIT ============
loadAll();
setInterval(loadAll, 2*60*1000); // refresh 2 min
