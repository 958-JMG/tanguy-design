# Convention SAV inter-cockpits 9·58

**Objectif** : standardiser le workflow SAV pour tous les cockpits clients (Tanguy, Maiween, Junker, ImmoZel, Barbier, …) sans avoir à recoder n8n à chaque nouveau cockpit.

## Workflow bidirectionnel

```
Cockpit Client                       Cockpit Central 9·58 (n8n)
─────────────────                    ──────────────────────────
[Bouton support]
  │
  │ 1. POST /api/support/feedback
  ▼
[Forward webhook]
  │
  │ 2. POST {webhook}/sav-receiver
  │    avec callback_url dans payload
  ├─────────────────────────────────►  [Création ticket Airtable]
                                       │
                                       │ Stocke callback_url
                                       │
                                       │ ... JMG traite ...
                                       │
                                       │ [Transition "Résolu"]
                                       ▼
                                       [POST callback_url]
  ◄─────────────────────────────────┤  avec X-958-Secret
[/api/sav/callback]                    body { ticket_id, statut,
  │                                          message_resolution,
  │                                          auteur_email, titre }
  │ 3. Stocke notif RAM
  ▼
[Badge sur bouton support]
  │
  │ User clique → modale avec notifs + OK vu
  ▼
[POST /api/sav/notifications/:id/read]
```

## Payload standard envoyé par les cockpits

Tous les cockpits envoient ce payload au webhook n8n du cockpit central :

```json
{
  "client_slug": "tanguy",
  "cockpit_source": "Cockpit Tanguy Design",
  "abonnement": "Build",
  "categorie": "Feedback cockpit",
  "urgence": "P3",
  "titre": "[virginie] Description courte",
  "description": "Message complet + URL + User-Agent",
  "auteur_email": "virginie@tanguydesign.local",
  "callback_url": "https://tanguydesign.958.fr/api/sav/callback"
}
```

**Le champ `callback_url`** est la nouveauté Sprint v3.23. Chaque cockpit déclare son endpoint de callback. n8n n'a PAS besoin de maintenir un mapping `client_slug → URL`.

## Côté n8n — workflow résolution

1. À la création du ticket : stocker `callback_url` dans le record Airtable (nouveau champ `Callback URL` à ajouter)
2. À la résolution : lire `callback_url` du record + POST :

```http
POST {callback_url}
X-958-Secret: {{ $env.SAV_WEBHOOK_SECRET }}
Content-Type: application/json

{
  "ticket_id": "{{ $json.ticket_id }}",
  "statut": "Résolu",
  "message_resolution": "{{ $json.message_resolution }}",
  "auteur_email": "{{ $json.auteur_email }}",
  "titre": "{{ $json.titre }}"
}
```

Si le POST échoue (cockpit down), n8n log mais ne bloque pas la résolution.

## Côté cockpit client — endpoint `/api/sav/callback`

Spec standard pour tous les cockpits :

- **Méthode** : POST
- **Auth** : header `X-958-Secret` doit matcher `SAV_WEBHOOK_SECRET` (même secret env que pour l'envoi initial)
- **Body** : `{ ticket_id, statut, message_resolution, auteur_email, titre }`
- **Réponse** : `200 { ok: true, notif_id }` si OK, `401` si secret invalide, `400` si payload incomplet

Stockage côté cockpit :
- Tanguy (v3.23) : Map RAM `login → [{...notifs}]`, cleanup auto > 30j
- À migrer en Airtable (table `Notifications SAV`) pour persistance reboot

## Affichage user

- **Badge rouge** sur le bouton support (compteur unread)
- **Click sur le bouton** : modale avec notifs en haut (fond vert), formulaire de nouveau ticket en bas
- **Click "OK, vu"** sur une notif : `POST /api/sav/notifications/:id/read` → retire de la liste

## À répliquer dans les autres cockpits

Pour chaque cockpit (Maiween, Junker, ImmoZel, etc.) :

1. **Backend** : copier le bloc `/api/sav/callback` + `Map savNotifications` + endpoints `GET /api/sav/my-notifications` + `POST /api/sav/notifications/:id/read` depuis `server.js` Tanguy
2. **Backend** : ajouter `callback_url: SAV_CALLBACK_URL` dans le payload envoyé au webhook n8n
3. **Frontend** : copier `public/v3/assets/js/core/support.js` (badge + popover notifs)
4. **CSS** : copier les classes `.support-badge`, `.support-notifs*` depuis `styles.css`
5. **Env vars Scaleway** : vérifier que `SAV_WEBHOOK_URL` + `SAV_WEBHOOK_SECRET` sont set sur le container

Variables d'environnement attendues :
- `SAV_WEBHOOK_URL` (secret) : URL du webhook n8n receiver
- `SAV_WEBHOOK_SECRET` (secret) : partagé avec n8n pour signer les callbacks
- `SAV_CLIENT_SLUG` : slug court du cockpit (ex: `tanguy`, `maiween`)
- `SAV_COCKPIT_SOURCE` : nom lisible (ex: `Cockpit Tanguy Design`)
- `SAV_ABONNEMENT` : niveau abonnement client (`Build` / `Run` / etc.)
- `PUBLIC_BASE_URL` (optionnel) : URL publique du cockpit, défaut depuis le code
