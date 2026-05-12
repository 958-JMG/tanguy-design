# Tests E2E manuels — Tanguy Design Cockpit

Scénarios à dérouler manuellement après chaque déploiement pour valider qu'aucune régression majeure n'est passée. Tous les tests doivent être faisables en **moins de 30 minutes** par un humain (Sébastien ou Virginie).

> **Stratégie de test** : pas de Playwright/Cypress pour l'instant. Le cockpit est petit, les chemins critiques sont peu nombreux, et un humain passe le check en 20 min avec un vrai PDF Winner / vraies tâches / vrais clients. Le coût d'écrire et maintenir Playwright n'est pas justifié à l'échelle actuelle.

---

## Avant de commencer

- [ ] Ouvrir https://tanguydesign.958.fr sur un navigateur (Chrome ou Safari).
- [ ] Se connecter avec le compte de test (ou Virginie/Sébastien).
- [ ] Avoir sous la main : 1 PDF de devis Winner (idéalement nouveau, jamais importé).
- [ ] Avoir un 2e navigateur ou un onglet privé (pour les tests multi-user).

---

## Scénario 1 — Import devis Winner → signature → tâches → commandes (chemin nominal)

**Durée : ~10 min · Critique : OUI**

1. **Importer un devis**
   - [ ] Onglet « Devis » → bouton « Importer un PDF Winner » → sélectionne le PDF.
   - [ ] Attendre 30-90s (parsing Claude, le spinner doit tourner).
   - [ ] **Pas de HTTP 524 dans la console** (sinon le keep-alive est cassé — voir feedback_claude_keepalive_524.md).
   - [ ] Le devis apparaît dans la liste avec son numéro, son total HT, son client.
   - [ ] Cliquer le devis → la fiche s'ouvre avec zones, lignes, échéances.

2. **Signer le devis (passage en commandes auto)**
   - [ ] Sur la fiche devis, cliquer « ✓ Signer ce BC ».
   - [ ] Confirmer.
   - [ ] Le statut passe à « Signé » (badge vert).
   - [ ] Aller dans l'onglet « Commandes » → vérifier qu'il y a N commandes auto-créées (1 par catégorie : Cuisine, Électroménager, etc.).
   - [ ] Aller dans l'onglet « Tâches » → vérifier 3 tâches auto-créées : « Envoyer facture acompte », « Envoyer commandes fournisseurs », « Planifier pose ».

3. **Ouvrir le projet du devis**
   - [ ] Onglet « Projets » → cliquer la fiche projet.
   - [ ] Le widget **🎯 Prochaines actions** affiche au moins « Émettre la facture d'acompte 30% » et « Envoyer la commande X au fournisseur ».
   - [ ] Le **stepper** montre étapes 1-3 verts (Découverte, Devis, Signature) et étape 4 (Acompte) en cours.

---

## Scénario 2 — Email fournisseur via mailto: (chemin critique 2026-05-12)

**Durée : ~3 min · Critique : OUI**

1. **Préparer une commande pour envoi**
   - [ ] Aller sur une fiche projet récente avec au moins 1 commande en statut « Créée ».
   - [ ] Cliquer la commande → la modale s'ouvre.
   - [ ] Le textarea « Contenu / lignes détail » est pré-rempli avec les lignes du devis.

2. **Cliquer « ✉️ Préparer l'email au fournisseur »**
   - [ ] Une mini-modale s'ouvre avec :
     - [ ] Champ **Destinataire(s)** pré-rempli avec l'« Email commande » du fournisseur (match par Type) — ou vide avec un warning jaune si pas trouvé.
     - [ ] Champ **Sujet** : `Commande XXX — chantier YYY — Tanguy Design`.
     - [ ] Champ **Corps** avec référence + projet + total + lignes + signature.
   - [ ] Cliquer « ✉️ Ouvrir mon client mail ».
   - [ ] Le client mail système s'ouvre (Mail.app / Gmail web / Outlook) avec les champs pré-remplis.
   - [ ] **NE PAS envoyer** (test). Fermer le client mail.
   - [ ] Revenir sur le cockpit.
   - [ ] Une **confirmation** apparaît : « Passer la commande en Envoyée ? »
   - [ ] Confirmer → toast « Commande passée en Envoyée ».

3. **Cas dégradé : pas d'email fournisseur**
   - [ ] Trouver une commande dont le Type n'a pas de fournisseur configuré.
   - [ ] Cliquer « Préparer l'email ».
   - [ ] **Warning jaune** doit s'afficher avec instructions pour ajouter un fournisseur.

---

## Scénario 3 — Sync multi-user fiche projet

**Durée : ~3 min · Critique : OUI (2026-05-12)**

1. **Setup**
   - [ ] Onglet 1 (Sébastien) : ouvrir le cockpit en mode kanban (onglet « Tâches »).
   - [ ] Onglet 2 (JMG / autre user) : ouvrir un projet contenant ≥ 1 tâche affectée à Sébastien.

2. **Onglet 1 : Sébastien termine une tâche**
   - [ ] Drag une tâche vers la colonne « Terminée ».

3. **Onglet 2 : vérification automatique**
   - [ ] Sans rien toucher, attendre **20 secondes max**.
   - [ ] La tâche dans la section « Tâches » de la fiche projet apparaît maintenant en vert « Terminée ».
   - [ ] Le stepper avance si la tâche était une étape clé (Acompte / PV / Solde / Avis).

4. **Cas dégradé : onglet en arrière-plan**
   - [ ] Onglet 2 → bascule sur un autre onglet du navigateur.
   - [ ] Attendre 1 min.
   - [ ] Revenir sur l'onglet 2.
   - [ ] La fiche se rafraîchit **immédiatement** (visibilitychange) avec les dernières données.

---

## Scénario 4 — Actions tâches inline depuis la fiche projet

**Durée : ~2 min · Critique : OUI (2026-05-12)**

1. **Sur la fiche projet**, section « Tâches » :
   - [ ] Cliquer une ligne tâche → la modale d'édition s'ouvre.
   - [ ] Modifier le titre, save → fiche se rafraîchit.
   - [ ] Bouton **« Démarrer » / « Terminer » / « Réactiver »** (selon statut courant) → cycle le statut sans quitter la fiche.
   - [ ] Bouton **🗑** → confirm → tâche supprimée → fiche se rafraîchit.
   - [ ] Bouton **+ Nouvelle tâche** en haut → modale ouverte → save → tâche apparaît dans la fiche **liée au projet**.

---

## Scénario 5 — Suppression plans uploadés

**Durée : ~2 min · Critique : OUI (2026-05-12)**

1. **Upload puis suppression**
   - [ ] Sur une fiche projet, section « Documents » → onglet « Plan technique ».
   - [ ] Cliquer « + Ajouter » → uploader un PDF (≤ 5 MB).
   - [ ] Le fichier apparaît dans la liste.
   - [ ] Cliquer le bouton **×** sur le fichier → confirm → toast « supprimé ».
   - [ ] Le fichier disparaît.

2. **Cas avec filename à apostrophes/accents**
   - [ ] Uploader un fichier nommé `Plan d'aménagement été.pdf`.
   - [ ] Le supprimer → doit fonctionner (escape JS-safe).

---

## Scénario 6 — Polling global accueil

**Durée : ~2 min · Faible criticité**

1. **Vérifier le rafraîchissement auto**
   - [ ] Aller sur l'onglet « Accueil ».
   - [ ] Ouvrir DevTools → Network.
   - [ ] Attendre 30s.
   - [ ] Une vague de requêtes `/api/data/*` part automatiquement.
   - [ ] Ouvrir une modale (par ex. nouveau ticket SAV) ou éditer un projet.
   - [ ] Attendre 30s → **aucun** refresh n'est tiré (pause édition).
   - [ ] Fermer la modale → 30s plus tard, refresh repart.

2. **Onglet en arrière-plan**
   - [ ] Sur l'accueil, bascule sur un autre onglet du navigateur.
   - [ ] Attendre 2 min.
   - [ ] Revenir → un refresh immédiat se déclenche.

---

## Scénario 7 — Prochaines actions (widget contextuel)

**Durée : ~3 min · Critique : OUI (2026-05-12)**

Vérifier que les actions affichées correspondent à l'état réel du projet :

| État projet | Actions attendues (top 4) |
|---|---|
| Pas de client lié | 👤 Lier ce projet à un client |
| Pas de devis | 📄 Importer le premier devis Winner |
| Devis brouillon | 📤 Envoyer le devis X au client |
| Devis envoyé | ✍️ Faire signer le devis X |
| Devis signé sans acompte | 💶 Émettre la facture d'acompte 30% |
| Commande Créée | 📦 Envoyer la commande X au fournisseur |
| Pose passée sans PV | 📋 Faire signer le PV de réception |
| Tâche en retard | ⚠ N tâche(s) en retard (en haut, prioritaire) |
| Tout est fait | « Tout est à jour sur ce projet » (vert) |

- [ ] Au moins 2 projets vérifiés à des étapes différentes : actions cohérentes.

---

## Checks transversaux après chaque déploiement

- [ ] Page d'accueil charge en < 3s sur 4G.
- [ ] Aucune erreur dans la console DevTools.
- [ ] Mobile (iPhone Safari 390px) : sidebar drawer ouvre, KPIs empilés, fiches lisibles.
- [ ] Test admin (uniquement comptes admin) : Marges / Stock visibles.
- [ ] Test non-admin (Virginie/Sébastien) : Marges / Stock cachés.

---

## En cas de bug bloquant

1. Capture d'écran + console DevTools.
2. URL exacte + référence projet / devis / tâche.
3. Heure (UTC+1) pour cross-référence avec les logs Scaleway.
4. Reporter à JMG ou créer un ticket directement dans le cockpit (onglet « SAV »).

> Logs Scaleway : `scw container container exec namespace-id=68691d55-c8d9-4d6a-84e0-a4d33d1be21d <id>` (voir Knowledge tanguy-design.md).
