# Audit data quality Airtable — 2026-05-20

> ⚠️ **OBSOLÈTE** — JMG a confirmé après coup que la data actuelle du cockpit est **fictive** (jeu de test). Cet audit n'a donc **pas** de valeur pour la décision produit. Conservé uniquement comme test du script `audit-data-quality.js` (qui reste utilisable plus tard sur de la data réelle).
>
> Le seul findings exploitable du run : le projet Morales révèle un **bug de code réel** sur le parsing des échéances (voir [bug-morales-echeances.md](bug-morales-echeances.md)) — ce bug existe indépendamment de la data fictive.

---

Lecture seule. Sortie automatique de `scripts/audit-data-quality.js`.

## Vue d'ensemble

- **539** clients · **4** projets · **3** commandes · **27** fournisseurs
- Date du snapshot : 2026-05-20T13:55:59.380Z

## 1. Doublons clients

### Par nom normalisé — 0 groupes
✅ Aucun doublon par nom.

### Par email — 18 groupes

| Email | Nb | Records ID |
|-------|----|-----------|
| `smil.mine@wanadoo.fr` | 3 | `recOxBQFuEID0QSXH` · `recRkWMLbruzXXklC` · `recSG2PXDxvWPnbam` |
| `fabrice.daouezan@orange.fr` | 2 | `rec3563JxDOJNl2Fh` · `recbOTHJhO8McLRJ5` |
| `emmanuelbertholom@wanadoo.fr` | 2 | `rec5gn6adVSAYD0zb` · `rectpjs6AIEFKoGS6` |
| `tomgosschalk@hotmail.com` | 2 | `rec8xC65pJVIBFcva` · `recUhNXy7bYX6ZodI` |
| `francoiseledain6@gmail.com` | 2 | `recBj45HQvHj22AnJ` · `recLXovQ4vV5w0dsH` |
| `sarah.david.lasagesse@gmail.com` | 2 | `recDxE3Ld0vUXQECw` · `recJYmYogWxCY9Vip` |
| `azemarmichel@yahoo.fr` | 2 | `recE2UJlKd8fRyPUO` · `recvD7Hm6WpIBCHYQ` |
| `maconneriealp@gmail.com` | 2 | `recLG9ZEx1gRE5TMa` · `recyiRiZfrmpEivUW` |
| `claudielebohec@orange.fr` | 2 | `recLzjyoKBA86j1Is` · `recQqmraGTKkz7jS8` |
| `cplhermitte@gmail.com` | 2 | `recNgxb0aLv0cjTWI` · `recQP76GVfBusaAJc` |
| `moro.jac@free.fr` | 2 | `recO7TvBp3Wdympa6` · `reczntRm6HYwW341y` |
| `bjbranellec@gmail.com` | 2 | `recSdaLLtbE97wxEh` · `recrX9XtiM4LjlF6x` |
| `nadinelopezgoris@gmail.com` | 2 | `recSw2idegcxSjqai` · `recdt3Ez7EjFC5yXY` |
| `calhoundrive@sfr.fr` | 2 | `recSwYjKsCEau0itb` · `recYanJbkUib6OdFQ` |
| `patrick.lauzevis@orange.fr` | 2 | `recZlrpAOx6V68j2e` · `recbQXYTRGFXOQk3r` |
| `empainvin@gmail.com` | 2 | `recat2vLYkIqFNBM3` · `recbAVD4L0dymlNeS` |
| `056mlg@orange.fr` | 2 | `recivkSBkYJi3z60D` · `recnlLGswZaxQMk8b` |
| `isabelle1.mayer@gmail.com` | 2 | `recmsmcygNIwN6wbh` · `recriqQx1paMhd73c` |

### Par téléphone normalisé — 2 groupes

| Téléphone (norm.) | Nb | Records ID |
|-------------------|----|-----------|
| `33297529298` | 2 | `rec5GulKOhLI3kZKX` · `recWeDvxJud7TgsBx` |
| `33611707410` | 2 | `recO7TvBp3Wdympa6` · `recRLg5MCtnnxr42Q` |

## 2. Projets orphelins (sans client lié)

🔴 **2 projets sans client lié.**

| ID projet | Référence | Statut | Date découverte |
|-----------|-----------|--------|-----------------|
| `rec3rbVuNK90nfurZ` | REF 544 | Découverte | 2026-05-12 |
| `recwHiHXNewHKCA8N` | LIGER - BELAIR | Découverte | 2026-03-30 |

## 3. Statuts projet incohérents

✅ Aucune incohérence statut/date détectée.

## 4. Clients sans projet rattaché

ℹ️ **538 clients sans projet** (candidats archivage ou nettoyage).

| ID | Nom | Type | Source | Date contact |
|----|-----|------|--------|--------------|
| `rec04m4zurddKp1Qz` | MADELEINE BAEY | Particulier | — | — |
| `rec06MWrhyLawt5TN` | STEPHAN STEPHAN | Particulier | — | — |
| `rec0QBIGMfb9A4ETz` | Catherine et Gwenael DREANO | Particulier | — | — |
| `rec0Qd1iUI6i67DHm` | IANIELLO | Particulier | — | — |
| `rec0R9od7hpWcWvf8` | Le PENNEC | Particulier | — | — |
| `rec0TLRx5vMfYj5Sz` | LE PAIH | Particulier | — | — |
| `rec0TiZngmvWTwkow` | JULIE et GILLES THOMAS | Particulier | — | — |
| `rec0W7qv1u6TuWPvF` | Véronique et Alain BARBIER | Particulier | — | — |
| `rec0bUutfBshO3KMj` | Marie-josé LE ROUX | Particulier | — | — |
| `rec0mbp3wu6AxxrTe` | Jean Philippe SCIAPA | Particulier | — | — |
| `rec12IoUJ1gunhNws` | Ghislaine STEPHAN | Particulier | — | — |
| `rec16gbbsQxS9oTQW` | Jacques MOREAU | Particulier | — | — |
| `rec1Bkt3yy6S2FPPC` | Jean Francois Le Garrec | Particulier | — | — |
| `rec1FuTKVeAS2dxki` | ROLLAND | Particulier | — | — |
| `rec1GA1uRifBW80ZY` | Nocera | Particulier | — | — |
| `rec1fAaxxlH03FFzo` | KERSUZAN | Particulier | — | — |
| `rec1i7t5K0lUhZS3c` | Décors et des lettres | Particulier | — | — |
| `rec1q4L2hfUKMqFPV` | Le moing | Particulier | — | — |
| `rec1ugIXqFaTpEzSj` | LORD | Particulier | — | — |
| `rec2MuWWBBgn2dTjY` | GREGOIRE | Particulier | — | — |
| `rec2S9L5eQJ0WVEtf` | Jean Noël VEYRES | Particulier | — | — |
| `rec2VBiRiFVsm65ID` | GUYON | Particulier | — | — |
| `rec2XyU4pqI2Dc9z1` | AUFFRET | Particulier | — | — |
| `rec2YiBTVB0s7L7eG` | Pascale et Remy TOUSSAINT | Particulier | — | — |
| `rec2df1OXeHQNol5n` | aroche | Particulier | — | — |
| `rec2i8tcKNMmgudJW` | GIROUX | Particulier | — | — |
| `rec2lfRNwAwvMuCGK` | Simone Dreano | Particulier | — | — |
| `rec2xe0pNO73lFgFF` | LE TRIONNAIRE | Particulier | — | — |
| `rec30XhEArjax2SAZ` | leveque | Particulier | — | — |
| `rec3563JxDOJNl2Fh` | Fabrice et Catherine DAOUEZAN | Particulier | — | — |
| `rec38FIdEXOaQ7Md2` | Xavier et Morgane DOUILLET et LACROIX | Particulier | — | — |
| `rec392qZ4BoSgEwGl` | Frédérique et Pascal MOREAC | Particulier | — | — |
| `rec3Ck2T31SHqkcJm` | Gilles MORAGUES | Particulier | — | — |
| `rec3CsRVUccaT8ZBB` | JEAN JACQUES TROADEC | Particulier | — | — |
| `rec3DDwQpjP8ZYtdS` | Béatrice LE PORT | Particulier | — | — |
| `rec3DfKbKroGeWoub` | Emmanuelle et Raphael BIROT | Particulier | — | — |
| `rec3EAgFmf8MPIzMS` | Mickael et Rozen LE MANACH | Particulier | — | — |
| `rec3F2jExOxPjXueQ` | Stéphanie et Joe LACEY | Particulier | — | — |
| `rec3a1I4kTUjDShkK` | Sabrina et Emmanuel COLLARD | Particulier | — | — |
| `rec49wXX0Wua8P98F` | Pascal TANGUY | Particulier | — | — |
| `rec4E4OA3CvfZ8lBJ` | Marie Christine PALAMOUR | Particulier | — | — |
| `rec4I0WifUjWeTEay` | COLLEOC | Particulier | — | — |
| `rec4NMxqsnY4uLW1p` | LE NAIR LE NAIR | Particulier | — | — |
| `rec4PRNzdTZPStYF2` | Béatrice POULLET | Particulier | — | — |
| `rec4UD0tSrKv8k39b` | MORIN | Particulier | — | — |
| `rec4atFicixN5kdl3` | Jean-Claude LECLERC | Particulier | — | — |
| `rec4pzMJS7EqL6s8R` | BELOTTI | Particulier | — | — |
| `rec5DNGQWmfggKDb2` | OMNES | Particulier | — | — |
| `rec5EMJqNr2E0b3G9` | Thomas Julie | Particulier | — | — |
| `rec5GulKOhLI3kZKX` | LE DIRAISON | Particulier | — | — |
| … | … | … | … | (488 de plus) |

## 5. Commandes "plan de travail" mal classées (famille Divers)

✅ Aucune commande "plan de travail" en famille Divers.

## 6. Stats globales

### Répartition projets par statut

| Statut | Nb |
|--------|----|
| Découverte | 2 |
| Devis | 1 |
| Pose | 1 |

### Top 10 clients par nombre de projets

| Client | Nb projets |
|--------|-----------|
| MORALES | 2 |

---

## Actions recommandées (Sprint 0.5)

- 🔴 **Fusionner 18 doublons par email** (probablement les mêmes que les doublons nom).
- 🟠 **Vérifier 2 doublons par téléphone** (peut être conjoints partageant un numéro).
- 🔴 **Rattacher ou supprimer 2 projets orphelins.** Sans client, ils disparaîtront de la nav v3.
- ℹ️ **538 clients sans projet** : décider avec Tanguy si on archive ou si on conserve (prospects).

---

_Rapport généré automatiquement. Pour relancer : `node scripts/audit-data-quality.js`._