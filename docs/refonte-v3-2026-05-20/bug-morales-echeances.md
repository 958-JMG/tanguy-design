# Investigation bug Morales — échéanciers incorrects

**Contexte** : le PDF de la réunion 20 mai 2026 mentionne explicitement *"La gestion des dates automatiques basées sur l'import de devis a créé des échéanciers incorrects (projet Morales)"*. Investigation réalisée le 20/05/2026.

---

## Symptôme

Sur le projet `MORALES · CUISINE` (rec `recqX8qYVLSjd3eSg`, devis signé `563/1/12`, total TTC 36 485,25 €), les 3 échéances créées par l'import sont :

| Ordre | Libellé | Montant prévu | Date prévue | Statut |
|-------|---------|---------------|-------------|--------|
| 1 | A la commande | 10 945,58 € | **(vide)** | À encaisser |
| 2 | A la livraison | 23 715,41 € | **(vide)** | À encaisser |
| 3 | A la fin de la pose | 1 824,26 € | **(vide)** | À encaisser |

**Constat** : aucune date d'échéance n'est enregistrée. Conséquences :
- Impossible de générer un planning trésorerie.
- Impossible de relancer Virginie à la bonne date.
- Le stepper de la fiche projet ne peut pas dériver l'état "facture acompte due".
- Date de pose prévue = 19/05/2026 (hier) mais les 3 échéances sont encore à *À encaisser* — la mise à jour automatique du statut ne se fait pas non plus.

---

## Cause racine

Chaîne complète du bug :

### 1. Le PDF Winner ne contient pas de dates d'échéance

Les devis Winner exportés en PDF n'indiquent que les **libellés sémantiques** des échéances (`A la commande` / `A la livraison` / `A la fin de la pose`), pas des dates absolues. C'est cohérent avec le métier — la cuisine n'a pas encore de date de pose au moment de l'édition du devis.

### 2. Le prompt Claude renvoie `date_prevue: null` systématiquement

[services/devis-parser.js:117](services/devis-parser.js:117) — le schéma du prompt demande explicitement :

```json
"echeances": [
  {
    "ordre": 1,
    "libelle": "A la commande",
    "montant_prevu": 10945.58,
    "date_prevue": null
  }
]
```

Avec la règle ligne 129 : *"Si un champ est absent du devis, mets chaîne vide ou null, ne l'invente jamais"*. Claude retourne donc systématiquement `date_prevue: null`.

### 3. Le serveur supprime le champ null avant insertion

[server.js:577-590](server.js:577) — code d'insertion :

```js
const echeancesBatch = parsed.echeances.map(e => {
  const f = {
    'Libellé': e.libelle || '',
    'Devis': [devisId],
    'Ordre': e.ordre || null,
    'Montant prévu': e.montant_prevu || null,
    'Date prévue': e.date_prevue || null,
    'Statut': 'À encaisser'
  };
  Object.keys(f).forEach(k => { if (f[k] === null || f[k] === '') delete f[k]; });
  return f;
});
```

Ligne 586 : `if (f[k] === null || f[k] === '') delete f[k]` supprime `Date prévue` puisqu'elle est null. Le record Airtable est créé sans date.

### 4. Aucune logique de calcul de date côté serveur

Nulle part dans le code (`server.js`, `services/devis-parser.js`) on ne trouve de logique qui dérive une date d'échéance à partir de :
- la date du devis
- la date de pose prévue du projet
- la sémantique du libellé

Donc une fois inséré, le champ reste vide pour toujours.

---

## Fix proposé (Sprint 4)

**Principe** : à l'import d'un devis OU à la mise à jour de `Date pose prévue` sur un projet, dériver les dates d'échéance à partir de la sémantique des libellés.

### Algorithme heuristique

```js
function deriveDateEcheance(libelle, devisDate, datePose) {
  const lib = (libelle || '').toLowerCase();

  // "A la commande" / "Acompte" / "30%" → date signature (≈ date devis si signé immédiatement)
  if (/(commande|acompte|signat)/.test(lib))            return devisDate;

  // "A la livraison" → date pose - 7 jours
  if (/livraison/.test(lib))                            return offset(datePose, -7);

  // "A la fin de la pose" / "Solde" / "Réception" → date pose + 5 jours
  if (/(fin de la pose|solde|réception|reception)/.test(lib)) return offset(datePose, +5);

  // Fallback : date devis (le plus prudent)
  return devisDate;
}

function offset(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
```

### Intégration

1. **À l'import** (`server.js:577`) : avant de supprimer le `null`, appeler `deriveDateEcheance(libelle, dateDevis, datePose)`.
   - Requiert que `parsed.echeances[].date_prevue` accepte une dérivation côté serveur si null.
   - Requiert l'accès à la `Date pose prévue` du projet (linked record).

2. **Au changement de `Date pose prévue`** : nouvel endpoint `PATCH /api/projets/:id/date-pose` qui :
   - Met à jour le projet
   - Recalcule les dates des échéances liées via la même heuristique
   - Si l'utilisateur a déjà ajusté manuellement une date, ne pas l'écraser (flag `Date manuelle` à ajouter, ou check si différente du calcul auto)

3. **Mise à jour auto du statut** : un cron quotidien (ou un hook au login) pourrait flagger les échéances dont `Date prévue < today` et `Statut = À encaisser` comme `Retard` — utile pour les alertes Dashboard.

### Cas tordus à valider avec Tanguy / Virginie

- **Échéances sur devis non signé** : on calcule quand même les dates ou on attend la signature ? → Recommandation : on calcule (informatif), on ne déclenche pas de relance tant que pas signé.
- **Plusieurs date de pose** (projet avec sous-projets) : prendre la date de pose globale ou par sous-projet ? → Recommandation : Date pose du projet parent.
- **Devis additif** (avenant) : reprendre l'échéancier du devis principal ou créer de nouvelles échéances ? → À cadrer dans l'atelier avenants du Sprint 0.
- **Libellés inhabituels** (ex : "À la commande des plans de travail", "Acompte 50%") : la regex doit être tolérante. À tester sur les 4 devis existants.

---

## Impact sur le plan v3

Ajout au **Sprint 4** (BC tableau + Plaud enrichi + bugs) :

- [ ] Implémenter `deriveDateEcheance()` dans `services/devis-parser.js` ou un nouveau `services/echeances-helper.js`
- [ ] Brancher au point d'import `/api/devis/import`
- [ ] Ajouter endpoint `PATCH /api/projets/:id/date-pose` qui recalcule
- [ ] Backfill : script `scripts/backfill-dates-echeances.js` qui parcourt toutes les échéances sans `Date prévue` et calcule (idempotent, dry-run par défaut)
- [ ] Tests sur les 4 projets existants + cas tordus listés ci-dessus

**Effort** : ~1 j de dev + 0,5 j de validation Tanguy / tests sur projets réels.

---

## Note senior

C'est un **bug de spec** plus que de code. Le prompt Claude est correct (il ne devine pas une date qui n'existe pas), le serveur est correct (il ne pousse pas de null inutile en Airtable). Le manque, c'est la couche de dérivation métier qui devait être ajoutée mais ne l'a pas été.

Ce genre de manque est fréquent quand on bâtit en mode "import-puis-on-verra" : on capture les données brutes du PDF mais on ne raisonne pas sur leur transformation métier. La v3 doit explicitement traiter cette couche (rétro-planning automatique évoqué en sprint 3 — voir `04-architecture-cible.md §6`).
