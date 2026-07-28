// Dashboard v3 — KPI + funnel cliquable + Mes tâches (urgence) + alertes
// Compteurs branchés sur state.clients + state.projets.

import { state } from '../core/state.js';
import { navigateTo } from '../core/router.js';
import { icon, hydrateIcons } from '../core/lucide.js';

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

// Item 4 — client en tête des tâches : dérive le nom du client via Projet → Client,
// avec repli sur le préfixe « [Client] » du titre (tâches sans lien projet).
function parsePrefixClient(titre) {
  const m = String(titre || '').match(/^\[([^\]]+)\]/);
  return m ? m[1].trim() : '';
}
function clientNomForTache(f) {
  const pid = (f.Projet || [])[0];
  if (pid) {
    const p = (state.projets || []).find(x => x.id === pid);
    const cid = p && (p.Client || [])[0];
    const nom = cid ? ((state.clients || []).find(x => x.id === cid)?.Nom || '') : '';
    if (nom) return nom;
  }
  return parsePrefixClient(f.Titre); // repli : préfixe [Client] dans le titre
}
// #1 — Dossier = référence du projet lié (le « numéro de dossier » métier).
function dossierForTache(f) {
  const pid = (f.Projet || [])[0];
  return pid ? ((state.projets || []).find(x => x.id === pid)?.Référence || '') : '';
}
// Retire le préfixe « [Client] » ou « [Client] / » du titre (le client est affiché à part).
function stripClientPrefix(titre) {
  return String(titre || '').replace(/^\[[^\]]+\]\s*\/?\s*/, '');
}

// Map login système (lowercase, sans accents) → nom Airtable "Assignée à"
const LOGIN_TO_ASSIGNEE = {
  'virginie':  'Virginie',
  'solene':    'Solène',
  'sebastien': 'Sébastien',
  'marine':    'Marine',
};

// Calcule l'urgence d'une tâche : retard / urgent / bientôt / normal
function tacheUrgence(t) {
  const f = t.fields || {};
  if (f.Statut === 'Terminée') return null;
  const ech = f.Échéance;
  if (!ech) return { level: 'normal', daysLeft: null };
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(ech); d.setHours(0,0,0,0);
  const days = Math.round((d - today) / 86400000);
  if (days < 0) return { level: 'retard', daysLeft: days };
  if (days <= 2) return { level: 'urgent', daysLeft: days };
  if (days <= 7) return { level: 'bientot', daysLeft: days };
  return { level: 'normal', daysLeft: days };
}

const URGENCE_ORDER = { retard: 0, urgent: 1, bientot: 2, normal: 3 };
const URGENCE_LABEL = {
  retard:  d => `en retard de ${Math.abs(d)} j`,
  urgent:  d => d === 0 ? 'aujourd\'hui' : (d === 1 ? 'demain' : `dans ${d} j`),
  bientot: d => `dans ${d} j`,
  normal:  d => d != null ? `dans ${d} j` : '',
};

const PHASES = [
  { key: 'Découverte',          icon: 'compass', pct: 0 },
  { key: 'Dessin',              icon: 'pencil',  pct: 25 },
  { key: 'Présentation devis',  icon: 'file',    pct: 50 },
  { key: 'En attente décision', icon: 'clock',   pct: 75 },
  { key: 'Signé',               icon: 'check',   pct: 100 },
];

const euros = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export async function renderDashboard(app) {
  const clients = state.clients || [];
  const projets = state.projets || [];
  const userLogin = (state.user || '').toLowerCase();
  const assigneeName = LOGIN_TO_ASSIGNEE[userLogin] || state.user;

  // Stats projets
  const enCours = projets.filter(p => {
    const chantier = p['Statut chantier'];
    return chantier && chantier !== 'Archivé' && chantier !== 'Terminé';
  });
  const enCoursNb = enCours.length || projets.filter(p => p['Phase commerciale'] === 'Signé').length;

  // CA aligné avec le Pipeline (cohérence CA ↔ Pipeline) :
  // - on exclut les projets archivés (comme le fait la vue Pipeline) ;
  // - « CA signé » = Σ Budget HT des projets en phase Signé = CA réellement engagé.
  //   Le Pipeline affiche le complément (Σ Budget HT des projets NON signés), donc
  //   CA signé + CA pipeline = total prévisionnel, sans double comptage.
  // Avant : « CA cumul prévi » sommait TOUS les projets (signés + prospects + archivés),
  // ce qui mélangeait engagé et prévisionnel — d'où le « ~20k » dominé par les dossiers signés.
  const phaseDe = p => p['Phase commerciale'] || mapLegacyStatut(p.Statut);
  const projetsActifs = projets.filter(p => (p['Statut chantier'] || '') !== 'Archivé');
  const caSigne = projetsActifs
    .filter(p => phaseDe(p) === 'Signé')
    .reduce((sum, p) => sum + (p['Budget HT'] || 0), 0);

  // Marge prévisionnelle peut être stockée en décimal (0.25) ou pourcent entier (25)
  // selon comment elle est saisie côté Airtable. On normalise sur 0-1 avant de multiplier par 100.
  // Calculée sur les projets actifs (archivés exclus, cohérent avec le CA ci-dessus).
  const margesValides = projetsActifs.map(p => p['Marge prévisionnelle']).filter(m => m != null && !isNaN(m));
  const margeAvgRaw = margesValides.length
    ? margesValides.reduce((sum, m) => sum + m, 0) / margesValides.length
    : 0;
  // Si la moyenne brute > 1, c'est qu'on est en notation pourcent entier → ne pas re-multiplier
  const margeAvgPct = margeAvgRaw > 1 ? margeAvgRaw : margeAvgRaw * 100;

  // Compteurs par phase (fallback Statut legacy si Phase commerciale absente)
  const countByPhase = {};
  for (const p of projets) {
    const phase = p['Phase commerciale'] || mapLegacyStatut(p.Statut);
    countByPhase[phase] = (countByPhase[phase] || 0) + 1;
  }

  // Alertes simples
  const alertes = [];
  const now = new Date();
  for (const p of projets) {
    if (p['Date pose prévue']) {
      const pose = new Date(p['Date pose prévue']);
      const diffJours = Math.round((pose - now) / (1000 * 60 * 60 * 24));
      if (diffJours > 0 && diffJours <= 30) {
        alertes.push({ severity: 'warn', text: `Pose ${p['Référence']} dans ${diffJours} j` });
      }
    }
  }

  app.innerHTML = `
    <h1 class="page-title">Dashboard${assigneeName ? ' — ' + esc(assigneeName) : ''}</h1>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-value">${clients.length}</div>
        <div class="kpi-label">Clients</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${enCoursNb}</div>
        <div class="kpi-label">Projets en cours</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${euros(caSigne)}</div>
        <div class="kpi-label">CA signé (HT)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${margesValides.length ? margeAvgPct.toFixed(1) + ' %' : '—'}</div>
        <div class="kpi-label">Marge prévi moyenne</div>
      </div>
    </div>

    <h2 class="section-title">Mes tâches ${assigneeName ? '— ' + esc(assigneeName) : ''}</h2>
    <div id="mes-taches-container" class="card mes-taches-card">
      <p class="muted">Chargement des tâches…</p>
    </div>

    <h2 class="section-title">Pipeline commercial</h2>
    <div class="funnel">
      ${PHASES.map(p => `
        <button class="funnel-step" data-phase="${p.key}" onclick="window.navigateTo('pipeline')">
          <div class="funnel-icon">${icon(p.icon, 24)}</div>
          <div class="funnel-count">${countByPhase[p.key] || 0}</div>
          <div class="funnel-name">${p.key}</div>
          <div class="funnel-pct">${p.pct}%</div>
        </button>
      `).join('')}
    </div>
    ${!Object.keys(countByPhase).some(k => k && PHASES.find(p => p.key === k))
      ? `<p class="muted muted-with-icon" style="margin-top:8px">${icon('alert', 14)} Migration Airtable v3 non appliquée : compteurs basés sur Statut legacy. Lance <code>node scripts/setup-fields-v3.js --apply</code> pour activer Phase commerciale.</p>`
      : ''}

    <h2 class="section-title">Alertes</h2>
    <div class="card">
      ${alertes.length === 0
        ? `<p class="muted">Pas d'alertes prioritaires.</p>`
        : `<ul class="alerts-list">${alertes.map(a => `<li>${icon('alert', 14)} ${a.text}</li>`).join('')}</ul>`}
    </div>
  `;

  hydrateIcons(app);

  // Sprint v3.6 — Charge les tâches assignées à l'user connecté et les affiche par urgence
  await loadMesTaches(assigneeName);
}

async function loadMesTaches(assigneeName) {
  const container = document.getElementById('mes-taches-container');
  if (!container) return;
  if (!assigneeName) {
    container.innerHTML = '<p class="muted">Connecte-toi avec un compte mappé (Virginie / Solène / Sébastien / Marine) pour voir tes tâches.</p>';
    return;
  }
  try {
    const r = await fetch('/api/data/taches');
    if (!r.ok) throw new Error('chargement tâches');
    const d = await r.json();
    const taches = (d.records || [])
      // #53 — « Mes tâches » honore aussi le multi-assign (Assignées à) : un co-assigné
      // voit la tâche dans son perso, pas seulement l'assigné principal (Assignée à).
      .filter(t => ((t.fields?.['Assignée à'] === assigneeName)
                    || (t.fields?.['Assignées à'] || []).includes(assigneeName))
                   && t.fields?.Statut !== 'Terminée');

    if (taches.length === 0) {
      container.innerHTML = '<p class="muted">Aucune tâche en cours assignée. ✨</p>';
      hydrateIcons(container);
      return;
    }

    // Calcul urgence + tri
    const enrichies = taches.map(t => ({ tache: t, urgence: tacheUrgence(t) }))
      .filter(x => x.urgence)
      .sort((a, b) => {
        const oa = URGENCE_ORDER[a.urgence.level];
        const ob = URGENCE_ORDER[b.urgence.level];
        if (oa !== ob) return oa - ob;
        return (a.urgence.daysLeft ?? 999) - (b.urgence.daysLeft ?? 999);
      });

    // Stats par niveau
    const stats = { retard: 0, urgent: 0, bientot: 0, normal: 0 };
    for (const x of enrichies) stats[x.urgence.level]++;

    container.innerHTML = `
      <div class="mes-taches-stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;font-size:12px">
        ${stats.retard  > 0 ? `<span class="badge" style="background:var(--accent-lo);color:var(--accent)">${icon('alert', 11)} ${stats.retard} en retard</span>` : ''}
        ${stats.urgent  > 0 ? `<span class="badge" style="background:var(--gold-lo);color:var(--gold)">${icon('clock', 11)} ${stats.urgent} urgent${stats.urgent>1?'es':''}</span>` : ''}
        ${stats.bientot > 0 ? `<span class="badge" style="background:var(--info-lo);color:var(--info)">${icon('calendar', 11)} ${stats.bientot} cette semaine</span>` : ''}
        ${stats.normal  > 0 ? `<span class="badge">${stats.normal} normale${stats.normal>1?'s':''}</span>` : ''}
      </div>
      ${enrichies.slice(0, 12).map(({ tache: t, urgence: u }) => {
        const f = t.fields || {};
        const projetId = (f.Projet || [])[0];
        const label = URGENCE_LABEL[u.level](u.daysLeft);
        const clientNom = clientNomForTache(f);
        const dossier = dossierForTache(f);
        const tete = [clientNom, dossier].filter(Boolean).join(' · ');
        const titre = stripClientPrefix(f.Titre) || '?';
        // A11y v3.7 : <button> au lieu de <div> pour accessibilité clavier.
        // aria-hidden sur svg décoratifs car le texte adjacent suffit.
        return `
          <button class="tache-urgence-item urgence-${u.level}" data-projet="${esc(projetId || '')}" aria-label="${esc((tete ? tete + ' — ' : '') + titre + ' — ' + label)}">
            <span class="tache-urgence-dot" aria-hidden="true"></span>
            <div class="tache-urgence-content">
              ${tete ? `<div class="tache-urgence-client" style="font-weight:700;font-size:12px">${esc(tete)}</div>` : ''}
              <div class="tache-urgence-titre">${esc(titre)}</div>
              <div class="tache-urgence-meta">
                ${f.Priorité ? `<span class="badge">${esc(f.Priorité)}</span>` : ''}
                ${f.Échéance ? `<span><span aria-hidden="true">${icon('calendar', 11)}</span> ${esc(f.Échéance)}</span>` : ''}
              </div>
            </div>
            <div class="tache-urgence-deadline">${esc(label)}</div>
          </button>`;
      }).join('')}
      ${enrichies.length > 12 ? `<p class="muted" style="margin-top:8px;font-size:12px;text-align:center">+ ${enrichies.length - 12} autres tâches</p>` : ''}
    `;
    hydrateIcons(container);

    // Bindings : clic sur une tâche → ouvre le projet
    container.querySelectorAll('.tache-urgence-item').forEach(el => {
      el.addEventListener('click', () => {
        const projetId = el.dataset.projet;
        if (projetId) location.hash = '#projet/' + projetId;
      });
    });
  } catch (err) {
    container.innerHTML = `<p class="muted">Erreur chargement tâches : ${esc(err.message)}</p>`;
  }
}

// Mapping legacy fallback pour les projets sans Phase commerciale (avant migration v3)
function mapLegacyStatut(s) {
  const lo = (s || '').toLowerCase();
  if (!lo || lo.includes('découverte') || lo.includes('decouverte')) return 'Découverte';
  if (lo.includes('dessin')) return 'Dessin';
  if (lo === 'devis' || lo.includes('présentation devis')) return 'Présentation devis';
  if (lo.includes('attente')) return 'En attente décision';
  return 'Signé';
}
