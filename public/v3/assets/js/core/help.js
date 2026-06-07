// Aide utilisateur contextuelle (Sprint v5.1) — bouton « ? » dans la topbar.
// Ouvre un panneau latéral qui explique LA page en cours : à quoi elle sert,
// quoi faire, et comment. Contenu filtré par rôle (admin vs membre).
// Le guide complet (#aide) réutilise PAGES — voir views/aide.js.

import { icon } from './lucide.js';
import { state } from './state.js';
import { navigateTo } from './router.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

// Mise en gras des libellés de boutons « entre guillemets » dans les étapes.
// On échappe d'abord, puis on transforme — jamais de HTML brut dans le contenu.
function fmt(s) {
  return esc(s).replace(/« ([^»]+) »/g, '« <strong>$1</strong> »');
}

// ---------------------------------------------------------------------------
// CONTENU — une entrée par route. `items` = accordéons « Comment faire X ? ».
// Libellés de boutons textuels entre « guillemets » (mis en gras au rendu).
// ---------------------------------------------------------------------------
export const PAGES = {
  dashboard: {
    title: 'Dashboard',
    icon: 'home',
    intro: 'Ta vue d’ensemble au démarrage : tes tâches, l’activité commerciale et les poses à venir.',
    items: [
      { q: 'Voir ce que j’ai à faire', steps: [
        'Le bloc « Mes tâches » liste tes tâches, les plus urgentes en premier : rouge = en retard, orange = sous 2 jours, bleu = cette semaine.',
        'Clique une tâche pour ouvrir le projet concerné.',
      ]},
      { q: 'Suivre l’activité commerciale', steps: [
        'Le funnel montre combien de projets sont dans chaque phase, de la Découverte à la Signature.',
        'Clique une phase pour ouvrir le Pipeline.',
      ]},
      { q: 'Anticiper les poses', steps: [
        'Le bloc d’alertes liste les poses prévues dans les 30 prochains jours.',
      ]},
    ],
  },

  clients: {
    title: 'Clients',
    icon: 'users',
    intro: 'Tous les clients — particuliers, professionnels, architectes — et leurs projets.',
    items: [
      { q: 'Créer un client', steps: [
        'Clique « + Nouveau client » en haut à droite.',
        'Remplis au minimum le Nom et le Type, puis « Créer client ».',
      ]},
      { q: 'Retrouver un client', steps: [
        'Utilise la barre de recherche (nom, email, téléphone) ou les filtres Tous / Particuliers / Pros / Architectes.',
        'Astuce : Cmd+K (ou Ctrl+K) cherche partout dans le cockpit, depuis n’importe quelle page.',
      ]},
      { q: 'Créer un projet pour un client', steps: [
        'Ouvre la fiche du client, puis clique « + Nouveau projet ».',
        'Laisse la référence vide : elle se génère toute seule.',
      ]},
      { q: 'Modifier un client', steps: [
        'Ouvre sa fiche, puis clique « Éditer » en haut à droite.',
      ]},
    ],
  },

  pipeline: {
    title: 'Pipeline',
    icon: 'chart',
    intro: 'Le suivi commercial : chaque colonne est une phase, de la Découverte au Signé.',
    items: [
      { q: 'Changer la phase d’un projet', steps: [
        'Clique la petite flèche sur la carte du projet.',
        'Choisis la nouvelle phase dans le menu — c’est enregistré immédiatement.',
      ]},
      { q: 'Repérer les projets qui dorment', steps: [
        'Les cartes marquées en rouge n’ont pas bougé depuis plus de 30 jours : à relancer.',
        'Le compteur « À relancer » en haut de page les totalise.',
      ]},
      { q: 'Ouvrir un projet', steps: [
        'Clique simplement sa carte.',
      ]},
    ],
  },

  calendar: {
    title: 'Calendar',
    icon: 'calendar',
    intro: 'Le planning des poses de chantier, mois par mois.',
    items: [
      { q: 'Déplacer une pose', steps: [
        'Attrape la barre verte d’un chantier et glisse-la sur le nouveau jour.',
        'Confirme : les dates du projet sont mises à jour automatiquement.',
      ]},
      { q: 'Ouvrir le projet d’une pose', steps: [
        'Clique la barre verte (sans la déplacer).',
      ]},
      { q: 'Changer de mois', steps: [
        'Utilise les flèches à gauche et à droite du titre, ou « Aujourd’hui » pour revenir au mois en cours.',
      ]},
    ],
  },

  projet: {
    title: 'Fiche projet',
    icon: 'compass',
    intro: 'Le cœur du cockpit : tout part d’ici, de la découverte au SAV.',
    items: [
      { q: 'Savoir où en est le projet', steps: [
        'Le stepper en haut montre les 12 étapes du projet — l’étape en orange est l’étape en cours.',
        'Le bandeau « À faire maintenant » te dit les prochaines actions : clique dessus, il t’emmène au bon endroit.',
      ]},
      { q: 'Importer le devis Winner (PDF)', steps: [
        'Section « Devis Tanguy » → clique « + Importer PDF » et choisis le PDF Winner ou Métron.',
        'L’IA lit le devis et crée les zones, les lignes et les échéances toute seule.',
        'Patiente : ça peut prendre 2 à 3 minutes. Ne ferme pas la page.',
      ]},
      { q: 'Faire signer un devis', steps: [
        'Sur le devis, clique « Signer ce devis » puis confirme.',
        'Le cockpit crée automatiquement les bons de commande fournisseurs et les tâches (facture d’acompte, artisans, planning).',
      ]},
      { q: 'Gérer les tâches', steps: [
        '« + Nouvelle » pour créer une tâche, coche la case pour la terminer, clique son titre pour la modifier.',
        '« Dossier chantier » génère la checklist administrative complète pour Virginie (plans signés, acompte, assurances…).',
      ]},
      { q: 'Tenir le journal de chantier', steps: [
        'Clique « + Entrée » et écris ce qui s’est passé : l’entrée est datée et signée automatiquement.',
      ]},
      { q: 'Ajouter une réunion Plaud', steps: [
        'Section « Réunions Plaud » → « + Nouvelle ».',
        'R1 = avant chantier (découverte, présentation du devis) · R2 = pendant ou après (suivi, SAV).',
      ]},
      { q: 'Ajouter des documents, plans, photos', steps: [
        'En bas de page, 4 cases : Plan 3D, Plan technique, Images, Documents projet.',
        'Glisse-dépose tes fichiers dessus, ou clique « + Ajouter ». Limite : 5 Mo par fichier.',
      ]},
      { q: 'Affecter des artisans', steps: [
        'Section « Artisans » → « + Affecter », choisis l’artisan.',
        'Coche « Contractuel » si l’artisan a la rétro-commission 5 %.',
        'Pour son devis : section « Devis artisans » → « + Importer PDF ».',
      ]},
      { q: 'Suivre la facturation du client', steps: [
        'Section « Facturation client » : chaque carte est une échéance du devis signé.',
        'Échéance « À encaisser » → clique « + Créer la tâche pour Virginie ».',
        'Facture envoyée et payée → clique « Marquer encaissée ».',
      ]},
    ],
  },

  devis: {
    title: 'Devis',
    icon: 'file',
    intro: 'Le détail d’un devis Winner : zones, lignes et échéances de paiement.',
    items: [
      { q: 'Modifier les infos du devis', steps: [
        'Clique « Éditer » : numéro, type (Principal / Additif), statut, dates de validité.',
      ]},
      { q: 'Faire signer le devis', steps: [
        'Clique « Signer ce devis » puis confirme.',
        'Les bons de commande et les tâches sont créés automatiquement, et le projet passe en phase Commandes.',
      ]},
      { q: 'Re-importer un PDF', steps: [
        '« Re-importer PDF » crée un NOUVEAU devis à côté — l’ancien n’est pas remplacé.',
      ]},
    ],
  },

  commande: {
    title: 'Bon de commande',
    icon: 'building',
    intro: 'Le bon de commande fournisseur, prêt à imprimer et à envoyer.',
    items: [
      { q: 'Envoyer le BC au fournisseur', steps: [
        '1. Clique « Télécharger PDF » : le BC est enregistré sur ton ordinateur.',
        '2. Clique « Préparer mail » : un mail pré-rédigé s’ouvre dans ta messagerie.',
        '3. Joins le PDF téléchargé au mail avant d’envoyer — il ne s’attache pas tout seul.',
      ]},
      { q: 'Modifier le BC', steps: [
        '« Méta » : fournisseur, contremarque, statut, dates de livraison.',
        '« Lignes » : ajouter, modifier ou supprimer des articles.',
      ]},
      { q: 'Suivre la commande', steps: [
        'Mets à jour le Statut au fil de l’eau : Créée → Envoyée → Confirmée → Livrée → Posée.',
      ]},
    ],
  },

  gestion: {
    title: 'Gestion',
    icon: 'landmark',
    adminOnly: true,
    intro: 'L’espace administratif : facturation clients, achats, trésorerie et RH.',
    items: [
      { q: 'Relancer un impayé', steps: [
        'Onglet Facturation → tableau « Impayés — relances ».',
        'Clique « Relancer (R1) » (puis R2, R3 aux relances suivantes) : le mail de relance pré-rédigé s’ouvre.',
      ]},
      { q: 'Enregistrer un règlement', steps: [
        'Clique le bouton coche sur la ligne de la facture, puis confirme le règlement.',
      ]},
      { q: 'Facturer une échéance en retard', steps: [
        'Tableau « Échéances en retard à facturer » → clique « + Créer la facture ».',
      ]},
    ],
  },

  admin: {
    title: 'Admin',
    icon: 'settings',
    adminOnly: true,
    intro: 'Le pilotage du cockpit : briefing IA, marges par projet et comptes utilisateurs.',
    items: [
      { q: 'Générer le briefing IA', steps: [
        'Clique « Générer le briefing » : l’IA analyse le cockpit et propose 5 actions concrètes (~30 secondes).',
      ]},
      { q: 'Voir les marges par projet', steps: [
        'Clique « Charger » dans la section Marges : CA − fournisseurs − artisans + rétro 5 %.',
      ]},
      { q: 'Gérer les comptes utilisateurs', steps: [
        '« + Nouveau compte » pour créer un accès (le mail de bienvenue part automatiquement).',
        'Sur chaque ligne : éditer, renvoyer un mot de passe, ou désactiver le compte.',
      ]},
    ],
  },
};

// La fiche client réutilise l'aide « clients » ; le guide a sa propre entrée minimale.
const ROUTE_ALIASES = { aide: null };

// ---------------------------------------------------------------------------
// Panneau latéral contextuel
// ---------------------------------------------------------------------------
let panelEl = null;

export function closeHelp() {
  if (!panelEl) return;
  panelEl.remove();
  panelEl = null;
  document.removeEventListener('keydown', onKeydown);
}

function onKeydown(e) {
  if (e.key === 'Escape') closeHelp();
}

export function openHelp() {
  closeHelp();

  const route = (location.hash.slice(1) || 'dashboard').split('/')[0];
  if (route in ROUTE_ALIASES && ROUTE_ALIASES[route] === null) {
    // Déjà sur le guide : rien à expliquer de plus, on scroll en haut.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const page = PAGES[route] || PAGES.dashboard;
  if (page.adminOnly && !state.isAdmin) return;

  const itemsHtml = page.items.map((item, i) => `
    <details class="help-item" ${i === 0 ? 'open' : ''}>
      <summary>${esc(item.q)}</summary>
      <ol class="help-steps">
        ${item.steps.map(s => `<li>${fmt(s)}</li>`).join('')}
      </ol>
    </details>
  `).join('');

  panelEl = document.createElement('div');
  panelEl.className = 'help-panel-bg';
  panelEl.innerHTML = `
    <aside class="help-panel" role="dialog" aria-modal="true" aria-label="Aide — ${esc(page.title)}">
      <header class="help-panel-header">
        <span class="help-panel-icon" aria-hidden="true">${icon(page.icon, 18)}</span>
        <h2>Aide — ${esc(page.title)}</h2>
        <button type="button" class="help-close" data-action="close" aria-label="Fermer l’aide">${icon('x', 18)}</button>
      </header>
      <p class="help-intro">${esc(page.intro)}</p>
      <div class="help-items">${itemsHtml}</div>
      <footer class="help-panel-footer">
        <button type="button" class="btn btn-ghost btn-sm" data-action="guide">
          ${icon('bookOpen', 16)} Voir le guide complet
        </button>
      </footer>
    </aside>
  `;
  document.body.appendChild(panelEl);
  document.addEventListener('keydown', onKeydown);

  panelEl.addEventListener('click', e => { if (e.target === panelEl) closeHelp(); });
  panelEl.querySelector('[data-action=close]').onclick = closeHelp;
  panelEl.querySelector('[data-action=guide]').onclick = () => { closeHelp(); navigateTo('aide'); };

  // Animation d'entrée + focus accessibilité
  requestAnimationFrame(() => panelEl.classList.add('is-open'));
  setTimeout(() => panelEl?.querySelector('.help-close')?.focus(), 80);
}
