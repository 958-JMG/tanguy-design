// Aide utilisateur contextuelle (Sprint v5.1) — bouton « ? » dans la topbar.
// Ouvre un panneau latéral qui explique LA page en cours : à quoi elle sert,
// quoi faire, et comment. Contenu filtré par rôle (admin vs membre).
//
// Le CONTENU vit dans la table Airtable « Aide » (clé `aide`, ACL : lecture
// libre, écriture admin) : les admins (Virginie) l'éditent directement depuis
// le cockpit — crayon sur chaque bloc, ajout, masquage, suppression.
// FALLBACK : si la table est vide ou injoignable, le contenu intégré ci-dessous
// est affiché (lecture seule). Le guide complet (#aide) réutilise ce module.

import { icon } from './lucide.js';
import { state } from './state.js';
import { navigateTo } from './router.js';
import { toast, confirmModal } from './ui.js';
import { fetchAide, createAide, patchAide, deleteAide } from './api.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

// Mise en gras des libellés de boutons « entre guillemets » dans les étapes.
// On échappe d'abord, puis on transforme — jamais de HTML brut dans le contenu.
function fmt(s) {
  return esc(s).replace(/« ([^»]+) »/g, '« <strong>$1</strong> »');
}

// ---------------------------------------------------------------------------
// MÉTADONNÉES des pages — côté code (titres, icônes, visibilité par rôle).
// Le contenu (intros + blocs) vit dans Airtable, éditable par les admins.
// ---------------------------------------------------------------------------
export const PAGE_META = {
  dashboard:        { title: 'Dashboard',       icon: 'home' },
  clients:          { title: 'Clients',         icon: 'users' },
  pipeline:         { title: 'Pipeline',        icon: 'chart' },
  calendar:         { title: 'Calendar',        icon: 'calendar' },
  projet:           { title: 'Fiche projet',    icon: 'compass' },
  devis:            { title: 'Devis',           icon: 'file' },
  commande:         { title: 'Bon de commande', icon: 'building' },
  gestion:          { title: 'Gestion',         icon: 'landmark', adminOnly: true },
  admin:            { title: 'Admin',           icon: 'settings', adminOnly: true },
  // Sections du guide complet (#aide)
  'guide-parcours': { title: 'Le fil d’un projet, de A à Z', icon: 'compass' },
  'guide-bases':    { title: 'Les bases',                    icon: 'bookOpen' },
};

// ---------------------------------------------------------------------------
// FALLBACK intégré — utilisé uniquement si la table Airtable « Aide » est vide
// ou injoignable. La table a été seedée avec ce même contenu (2026-06-07).
// ---------------------------------------------------------------------------
export const FALLBACK = {
  dashboard: {
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
  'guide-parcours': {
    intro: '',
    items: [
      { q: 'Créer le client', steps: ['Onglet Clients → « + Nouveau client ». Nom + type suffisent pour démarrer.'] },
      { q: 'Créer le projet', steps: ['Depuis la fiche du client → « + Nouveau projet ». La référence se génère toute seule.'] },
      { q: 'La découverte (Plaud R1)', steps: ['Après le rendez-vous découverte, ajoute la réunion dans la fiche projet : section « Réunions Plaud » → « + Nouvelle », niveau R1.'] },
      { q: 'Importer le devis Winner', steps: ['Fiche projet → section « Devis Tanguy » → « + Importer PDF ». L’IA lit le PDF et crée zones, lignes et échéances (2-3 minutes, ne ferme pas la page).'] },
      { q: 'Faire signer', steps: ['Sur le devis → « Signer ce devis ». Les bons de commande fournisseurs et les tâches (acompte, artisans, planning) sont créés automatiquement.'] },
      { q: 'Envoyer les commandes fournisseurs', steps: ['Ouvre chaque bon de commande : « Télécharger PDF », puis « Préparer mail », et joins le PDF au mail. Mets le statut à jour au fil de l’eau.'] },
      { q: 'Préparer et suivre le chantier', steps: ['Bouton « Dossier chantier » pour la checklist administrative. Pose planifiée dans Calendar (glisser-déposer). Pendant le chantier : journal (« + Entrée »), photos dans Images, réunions Plaud R2.'] },
      { q: 'Facturer et clôturer', steps: ['Section « Facturation client » : chaque échéance suit son chemin — « + Créer la tâche pour Virginie », puis « Marquer encaissée » une fois payée. Le SAV se suit depuis la fiche projet.'] },
    ],
  },
  'guide-bases': {
    intro: '',
    items: [
      { q: 'La navigation', steps: ['Les onglets en haut (ou en bas sur mobile) : Dashboard (ta journée), Clients, Pipeline (suivi commercial), Calendar (poses). Tout le reste se passe dans la fiche projet.'] },
      { q: 'La recherche', steps: ['La loupe en haut à droite — ou Cmd+K (Ctrl+K sur PC) — cherche partout : clients, projets, devis, commandes.'] },
      { q: 'L’aide contextuelle', steps: ['Le bouton « ? » en haut à droite explique la page où tu te trouves : à quoi elle sert et comment faire les actions courantes.'] },
      { q: 'Signaler un problème', steps: ['Le bouton orange en bas à droite : décris ce qui ne va pas, l’équipe 9·58 est prévenue et tu reçois une notification quand c’est résolu.'] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Chargement du contenu (table « Aide ») + assemblage par page
// ---------------------------------------------------------------------------
let aideRecords = null; // cache session — invalidé après chaque édition admin

export async function loadAide(force = false) {
  if (aideRecords && !force) return aideRecords;
  try {
    aideRecords = await fetchAide();
  } catch (e) {
    aideRecords = null; // fallback intégré
  }
  return aideRecords;
}

export function invalidateAide() { aideRecords = null; }

/**
 * Contenu assemblé d'une page : { meta, intro, introRecord, items }.
 * items = [{ id?, q, steps, visible, ordre }] — `id` absent en mode fallback.
 * Les blocs masqués (Visible décoché) ne sont retournés que pour les admins.
 */
export function getPageContent(key) {
  const meta = PAGE_META[key] || PAGE_META.dashboard;
  const recs = (aideRecords || []).filter(r => r.Page === key);
  if (!recs.length) {
    const fb = FALLBACK[key] || { intro: '', items: [] };
    return { meta, intro: fb.intro, introRecord: null, items: fb.items.map(i => ({ ...i, visible: true })), fallback: true };
  }
  const introRecord = recs.find(r => r.Type === 'Intro') || null;
  const items = recs
    .filter(r => r.Type !== 'Intro')
    .map(r => ({
      id: r.id,
      q: r.Titre || '',
      steps: String(r.Contenu || '').split('\n').map(s => s.trim()).filter(Boolean),
      visible: !!r.Visible,
      ordre: r.Ordre ?? 999,
    }))
    .filter(i => i.visible || state.isAdmin)
    .sort((a, b) => a.ordre - b.ordre);
  return { meta, intro: introRecord?.Contenu || '', introRecord, items, fallback: false };
}

// ---------------------------------------------------------------------------
// Éditeur admin (modale) — créer / modifier / masquer / supprimer un bloc
// ---------------------------------------------------------------------------
export function openAideEditor({ record = null, page, type = 'Action', onSaved = () => {} }) {
  const isIntro = (record ? record.Type : type) === 'Intro';
  const titre = record?.Titre || '';
  const contenu = record?.Contenu || '';
  const ordre = record?.Ordre ?? '';
  const visible = record ? !!record.Visible : true;

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="aide-edit-title">
      <h2 id="aide-edit-title">${record ? 'Modifier' : 'Ajouter'} ${isIntro ? 'l’introduction' : 'un bloc d’aide'} — ${esc(PAGE_META[page]?.title || page)}</h2>
      <form id="aide-edit-form">
        ${isIntro ? '' : `
        <label>Question / titre du bloc
          <input type="text" name="titre" value="${esc(titre)}" placeholder="Ex : Créer un client" required>
        </label>`}
        <label>${isIntro ? 'Texte d’introduction de la page' : 'Étapes — une par ligne'}
          <textarea name="contenu" rows="${isIntro ? 3 : 6}" placeholder="${isIntro ? 'À quoi sert cette page, en une phrase.' : 'Une étape par ligne.\nMets les noms de boutons entre guillemets « comme ça » : ils apparaîtront en gras.'}" required>${esc(contenu)}</textarea>
        </label>
        ${isIntro ? '' : `
        <div class="aide-edit-row">
          <label>Ordre
            <input type="number" name="ordre" value="${esc(ordre)}" min="1" step="1" style="width:90px">
          </label>
          <label class="aide-edit-visible">
            <input type="checkbox" name="visible" ${visible ? 'checked' : ''}> Visible par l’équipe
          </label>
        </div>`}
        <div class="modal-actions">
          ${record ? `<button type="button" class="btn btn-ghost aide-edit-delete" data-action="delete">${icon('trash', 14)} Supprimer</button>` : ''}
          <button type="button" class="btn btn-ghost" data-action="cancel">Annuler</button>
          <button type="submit" class="btn btn-primary">${record ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => { modal.remove(); document.removeEventListener('keydown', kh); };
  const kh = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', kh);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  modal.querySelector('[data-action=cancel]').onclick = close;

  modal.querySelector('[data-action=delete]')?.addEventListener('click', async () => {
    const ok = await confirmModal('Supprimer ce bloc d’aide ? (l’équipe ne le verra plus)', { okLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      await deleteAide(record.id);
      invalidateAide();
      toast('Bloc d’aide supprimé');
      close();
      onSaved();
    } catch (e) { toast(`Erreur : ${e.message}`, 'error'); }
  });

  modal.querySelector('#aide-edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const fields = isIntro
      ? { Page: page, Type: 'Intro', Titre: '', Contenu: f.contenu.value.trim(), Ordre: 0, Visible: true }
      : {
          Page: page,
          Type: 'Action',
          Titre: f.titre.value.trim(),
          Contenu: f.contenu.value.trim(),
          Ordre: f.ordre.value ? Number(f.ordre.value) : 999,
          Visible: f.visible.checked,
        };
    try {
      if (record) await patchAide(record.id, fields);
      else await createAide(fields);
      invalidateAide();
      toast(record ? 'Aide mise à jour' : 'Bloc d’aide ajouté');
      close();
      onSaved();
    } catch (err) { toast(`Erreur : ${err.message}`, 'error'); }
  });

  setTimeout(() => modal.querySelector(isIntro ? 'textarea' : 'input[name=titre]')?.focus(), 50);
}

// Retrouve le record brut d'un item (pour l'éditeur).
function recordById(id) {
  return (aideRecords || []).find(r => r.id === id) || null;
}

// HTML d'un accordéon d'aide (partagé panneau + guide). Admin : crayon d'édition,
// blocs masqués affichés grisés avec la mention (masqué).
export function renderHelpItem(item, page, { open = false } = {}) {
  const editBtn = state.isAdmin && item.id
    ? `<button type="button" class="aide-edit-btn" data-aide-edit="${esc(item.id)}" data-aide-page="${esc(page)}" title="Modifier ce bloc" aria-label="Modifier ce bloc">${icon('pencil', 13)}</button>`
    : '';
  return `
    <details class="help-item ${item.visible === false ? 'is-hidden-item' : ''}" ${open ? 'open' : ''}>
      <summary>${esc(item.q)}${item.visible === false ? ' <span class="badge">masqué</span>' : ''}${editBtn}</summary>
      <ol class="help-steps">
        ${item.steps.map(s => `<li>${fmt(s)}</li>`).join('')}
      </ol>
    </details>
  `;
}

// Branche les crayons d'édition + boutons d'ajout d'un conteneur rendu.
export function bindAideAdmin(root, onSaved) {
  if (!state.isAdmin) return;
  root.querySelectorAll('[data-aide-edit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openAideEditor({ record: recordById(btn.dataset.aideEdit), page: btn.dataset.aidePage, onSaved });
    });
  });
  root.querySelectorAll('[data-aide-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAideEditor({ page: btn.dataset.aideAdd, type: btn.dataset.aideType || 'Action', onSaved });
    });
  });
  root.querySelectorAll('[data-aide-edit-intro]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.aideEditIntro;
      const introRecord = (aideRecords || []).find(r => r.Page === page && r.Type === 'Intro') || null;
      openAideEditor({ record: introRecord, page, type: 'Intro', onSaved });
    });
  });
}

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

export async function openHelp() {
  closeHelp();

  const route = (location.hash.slice(1) || 'dashboard').split('/')[0];
  if (route === 'aide') {
    // Déjà sur le guide : rien de plus à expliquer, on remonte en haut.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const key = PAGE_META[route] ? route : 'dashboard';
  const meta = PAGE_META[key];
  if (meta.adminOnly && !state.isAdmin) return;

  await loadAide();
  const page = getPageContent(key);

  const adminIntroBtn = state.isAdmin
    ? `<button type="button" class="aide-edit-btn" data-aide-edit-intro="${esc(key)}" title="Modifier l’introduction" aria-label="Modifier l’introduction">${icon('pencil', 13)}</button>`
    : '';
  const adminAddBtn = state.isAdmin
    ? `<button type="button" class="btn btn-ghost btn-sm" data-aide-add="${esc(key)}">${icon('plus', 14)} Ajouter un bloc</button>`
    : '';

  panelEl = document.createElement('div');
  panelEl.className = 'help-panel-bg';
  panelEl.innerHTML = `
    <aside class="help-panel" role="dialog" aria-modal="true" aria-label="Aide — ${esc(meta.title)}">
      <header class="help-panel-header">
        <span class="help-panel-icon" aria-hidden="true">${icon(meta.icon, 18)}</span>
        <h2>Aide — ${esc(meta.title)}</h2>
        <button type="button" class="help-close" data-action="close" aria-label="Fermer l’aide">${icon('x', 18)}</button>
      </header>
      <p class="help-intro">${esc(page.intro)} ${adminIntroBtn}</p>
      <div class="help-items">${page.items.map((item, i) => renderHelpItem(item, key, { open: i === 0 })).join('')}</div>
      <footer class="help-panel-footer">
        <button type="button" class="btn btn-ghost btn-sm" data-action="guide">
          ${icon('bookOpen', 16)} Voir le guide complet
        </button>
        ${adminAddBtn}
      </footer>
    </aside>
  `;
  document.body.appendChild(panelEl);
  document.addEventListener('keydown', onKeydown);

  panelEl.addEventListener('click', e => { if (e.target === panelEl) closeHelp(); });
  panelEl.querySelector('[data-action=close]').onclick = closeHelp;
  panelEl.querySelector('[data-action=guide]').onclick = () => { closeHelp(); navigateTo('aide'); };
  bindAideAdmin(panelEl, () => openHelp()); // re-render du panneau après édition

  // Animation d'entrée + focus accessibilité
  requestAnimationFrame(() => panelEl.classList.add('is-open'));
  setTimeout(() => panelEl?.querySelector('.help-close')?.focus(), 80);
}
