// Guide complet (#aide) — Sprint v5.1. Mode d'emploi du cockpit :
// les bases, le fil d'un projet de A à Z, puis l'aide page par page
// (réutilise PAGES de core/help.js). Sections admin masquées aux membres.

import { icon } from '../core/lucide.js';
import { state } from '../core/state.js';
import { PAGES } from '../core/help.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function fmt(s) {
  return esc(s).replace(/« ([^»]+) »/g, '« <strong>$1</strong> »');
}

// Le fil d'un projet, de A à Z — colonne vertébrale du guide.
const PARCOURS = [
  { titre: 'Créer le client', page: 'clients', texte:
    'Onglet Clients → « + Nouveau client ». Nom + type suffisent pour démarrer.' },
  { titre: 'Créer le projet', page: 'clients', texte:
    'Depuis la fiche du client → « + Nouveau projet ». La référence se génère toute seule.' },
  { titre: 'La découverte (Plaud R1)', page: 'projet', texte:
    'Après le rendez-vous découverte, ajoute la réunion dans la fiche projet : section « Réunions Plaud » → « + Nouvelle », niveau R1.' },
  { titre: 'Importer le devis Winner', page: 'projet', texte:
    'Fiche projet → section « Devis Tanguy » → « + Importer PDF ». L’IA lit le PDF et crée zones, lignes et échéances (2-3 minutes, ne ferme pas la page).' },
  { titre: 'Faire signer', page: 'projet', texte:
    'Sur le devis → « Signer ce devis ». Les bons de commande fournisseurs et les tâches (acompte, artisans, planning) sont créés automatiquement.' },
  { titre: 'Envoyer les commandes fournisseurs', page: 'commande', texte:
    'Ouvre chaque bon de commande : « Télécharger PDF », puis « Préparer mail », et joins le PDF au mail. Mets le statut à jour au fil de l’eau.' },
  { titre: 'Préparer et suivre le chantier', page: 'projet', texte:
    'Bouton « Dossier chantier » pour la checklist administrative. Pose planifiée dans Calendar (glisser-déposer). Pendant le chantier : journal (« + Entrée »), photos dans Images, réunions Plaud R2.' },
  { titre: 'Facturer et clôturer', page: 'projet', texte:
    'Section « Facturation client » : chaque échéance suit son chemin — « + Créer la tâche pour Virginie », puis « Marquer encaissée » une fois payée. Le SAV se suit depuis la fiche projet.' },
];

const BASES = [
  { icone: 'compass', titre: 'La navigation', texte:
    'Les onglets en haut (ou en bas sur mobile) : Dashboard (ta journée), Clients, Pipeline (suivi commercial), Calendar (poses). Tout le reste se passe dans la fiche projet.' },
  { icone: 'search', titre: 'La recherche', texte:
    'La loupe en haut à droite — ou Cmd+K (Ctrl+K sur PC) — cherche partout : clients, projets, devis, commandes.' },
  { icone: 'helpCircle', titre: 'L’aide contextuelle', texte:
    'Le bouton « ? » en haut à droite explique la page où tu te trouves : à quoi elle sert et comment faire les actions courantes.' },
  { icone: 'alert', titre: 'Signaler un problème', texte:
    'Le bouton orange en bas à droite : décris ce qui ne va pas, l’équipe 9·58 est prévenue et tu reçois une notification quand c’est résolu.' },
];

export function renderAide(app) {
  const pagesVisibles = Object.entries(PAGES)
    .filter(([, p]) => !p.adminOnly || state.isAdmin);

  const basesHtml = BASES.map(b => `
    <div class="card guide-base-card">
      <span class="guide-base-icon" aria-hidden="true">${icon(b.icone, 20)}</span>
      <div>
        <h3>${esc(b.titre)}</h3>
        <p>${fmt(b.texte)}</p>
      </div>
    </div>
  `).join('');

  const parcoursHtml = PARCOURS.map((e, i) => `
    <li class="guide-step">
      <span class="guide-step-num" aria-hidden="true">${i + 1}</span>
      <div>
        <h3>${esc(e.titre)}</h3>
        <p>${fmt(e.texte)}</p>
      </div>
    </li>
  `).join('');

  const pagesHtml = pagesVisibles.map(([key, p]) => `
    <details class="help-item guide-page-item" id="guide-${esc(key)}">
      <summary><span aria-hidden="true">${icon(p.icon, 16)}</span> ${esc(p.title)}${p.adminOnly ? ' <span class="badge">Admin</span>' : ''}</summary>
      <p class="help-intro">${esc(p.intro)}</p>
      ${p.items.map(item => `
        <div class="guide-page-action">
          <h4>${esc(item.q)}</h4>
          <ol class="help-steps">${item.steps.map(s => `<li>${fmt(s)}</li>`).join('')}</ol>
        </div>
      `).join('')}
    </details>
  `).join('');

  app.innerHTML = `
    <div class="guide-wrap">
      <header class="page-header">
        <div>
          <h1 class="page-title">Guide d’utilisation</h1>
          <p class="muted">Tout ce qu’il faut savoir pour utiliser le cockpit au quotidien. Et à tout moment, le bouton « ? » en haut à droite explique la page en cours.</p>
        </div>
      </header>

      <section aria-labelledby="guide-bases-title">
        <h2 class="section-title" id="guide-bases-title">Les bases</h2>
        <div class="guide-bases">${basesHtml}</div>
      </section>

      <section aria-labelledby="guide-parcours-title">
        <h2 class="section-title" id="guide-parcours-title">Le fil d’un projet, de A à Z</h2>
        <ol class="guide-parcours">${parcoursHtml}</ol>
      </section>

      <section aria-labelledby="guide-pages-title">
        <h2 class="section-title" id="guide-pages-title">L’aide, page par page</h2>
        <div class="guide-pages">${pagesHtml}</div>
      </section>
    </div>
  `;
}
