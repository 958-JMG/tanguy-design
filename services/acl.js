/**
 * services/acl.js — Access Control List pour le proxy /api/data/:table
 *
 * Voir docs/refonte-v3-2026-05-20/06-code-review-architecture.md §P0-2.
 * Sprint 0.7 — Task 19.
 *
 * Roles :
 *  - 'admin'  : user dans ADMIN_LOGINS (typiquement Virginie)
 *  - '*'      : tout user authentifié
 *
 * canAccess(role, tableKey, verb) → boolean
 * pickAllowedFields(tableKey, fields) → filtré (champs hors whitelist supprimés silencieusement)
 */

const TABLE_ACL = {
  clients:             { GET: '*',     POST: '*',     PATCH: '*',     DELETE: 'admin' },
  projets:             { GET: '*',     POST: '*',     PATCH: '*',     DELETE: 'admin' },
  taches:              { GET: '*',     POST: '*',     PATCH: '*',     DELETE: '*'     },
  'reunions-plaud':    { GET: '*',     POST: '*',     PATCH: '*',     DELETE: 'admin' },
  sav:                 { GET: '*',     POST: '*',     PATCH: '*',     DELETE: 'admin' },
  'fiches-decouverte': { GET: '*',     POST: '*',     PATCH: '*',     DELETE: 'admin' },

  artisans:            { GET: '*',     POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  fournisseurs:        { GET: '*',     POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  'devis-artisans':    { GET: '*',     POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  stock:               { GET: 'admin', POST: 'admin', PATCH: 'admin', DELETE: 'admin' },

  devis:               { GET: '*',     POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  'zones-devis':       { GET: '*',     POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  'lignes-devis':      { GET: '*',     POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  'echeances-devis':   { GET: '*',     POST: '*',     PATCH: '*',     DELETE: 'admin' },
  commandes:           { GET: '*',     POST: 'admin', PATCH: '*',     DELETE: 'admin' },

  // Sprint v5 — Automatisation Virginie. Finance : lecture libre des factures
  // clients (suivi projet), écriture admin. Fournisseurs + RH : admin only
  // (confidentialité fournisseurs / données personnelles paie, RGPD).
  'factures-clients':      { GET: '*',     POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  'factures-fournisseurs': { GET: 'admin', POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  salaries:                { GET: 'admin', POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  absences:                { GET: 'admin', POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
  'heures-salaries':       { GET: 'admin', POST: 'admin', PATCH: 'admin', DELETE: 'admin' },
};

const FIELD_WHITELIST = {
  clients:             ['Nom', 'Type', 'Source', 'Email', 'Téléphone', 'Adresse', 'Contact', 'Notes', 'Date contact', 'Date création', 'Architecte référent'],
  projets:             ['Référence', 'Client', 'Statut', 'Phase commerciale', 'Statut chantier', 'Budget HT', 'Marge prévisionnelle', 'Date découverte', 'Date pose prévue', 'Date pose fin', 'Description', 'Journal chantier', 'Artisans'],
  taches:              ['Titre', 'Statut', 'Assignée à', 'Priorité', 'Échéance', 'Description', 'Projet', 'Type'],
  'reunions-plaud':    ['Titre', 'Date heure', 'Lieu', 'Client nom', 'Type réunion', 'Niveau', 'Synthèse', 'Contexte', 'Points de douleur', 'Attentes', 'Autres informations', 'Tâches identifiées', 'Transcription', 'Projet'],
  sav:                 ['Titre', 'Description', 'Statut', 'Priorité', 'Date', 'Projet', 'Client'],
  'fiches-decouverte': ['Titre', 'Date', 'Client', 'Projet', 'Notes'],
  artisans:            ['Nom', 'Contractuel', 'Téléphone', 'Email', 'Spécialité', 'Notes'],
  fournisseurs:        ['Nom', 'Famille', 'Email', 'Téléphone', 'Adresse', 'Notes'],
  'devis-artisans':    ['Numéro devis', 'Statut', 'Montant HT', 'Montant TTC', 'Rétro-commission HT', 'Notes', 'Projet', 'Artisan', 'Date devis', 'Description travaux', 'Adresse chantier', 'Date démarrage prévue'],
  stock:               ['Nom', 'Quantité', 'Prix unitaire', 'Famille', 'Notes'],
  devis:               ['Statut', 'Type devis', 'Notes', "Valable jusqu'au", 'Numéro devis', 'Date devis'],
  'zones-devis':       ['Nom', 'Ordre', 'Notes'],
  'lignes-devis':      ['Notes', 'Alertes'],
  'echeances-devis':   ['Statut', 'Date prévue', 'Date règlement', 'Montant règlé', 'Mode règlement', 'Notes', 'Montant prévu', 'Libellé', 'Ordre'],
  commandes:           ['Statut', 'Notes', 'Date envoi', 'Fournisseur', 'Contremarque', 'Contact Tanguy', 'Référence courte', 'Livraison semaine', 'Modèle choisi', 'Détails modèle', 'Lignes BC', 'Date livraison prévue', 'Numéro', 'Montant HT', 'Facture reçue', 'Type', 'Date création'],

  // Sprint v5 — Automatisation Virginie
  'factures-clients':      ['Numéro', 'Projet', 'Client', 'Échéance liée', 'Type', 'Date émission', 'Date échéance', 'Montant HT', 'Montant TVA', 'Montant TTC', 'Montant réglé', 'Date règlement', 'Mode règlement', 'Statut', 'Niveau relance', 'Date dernière relance', 'Notes'],
  'factures-fournisseurs': ['Numéro', 'Fournisseur', 'Commande', 'Projet', 'Date facture', 'Date échéance', 'Montant HT', 'Montant TVA', 'Montant TTC', 'Statut', 'Contrôle', 'Écart', 'Date paiement', 'Mode paiement', 'Pointée relevé', 'Alertes parsing', 'Notes'],
  salaries:                ['Nom', 'Poste', 'Email', 'Téléphone', 'Type contrat', 'Date entrée', 'Solde congés', 'Dernière visite médicale', 'Prochaine visite médicale', 'Actif', 'Notes'],
  absences:                ['Libellé', 'Salarié', 'Type', 'Date début', 'Date fin', 'Jours ouvrés', 'Statut', 'Notes'],
  'heures-salaries':       ['Libellé', 'Salarié', 'Semaine du', 'Heures normales', 'Heures supp', 'Projet', 'Validé', 'Notes'],
};

/**
 * Vérifie si un role peut effectuer une action sur une table.
 * @param {'admin'|'*'} role
 * @param {string} tableKey
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} verb
 * @returns {boolean}
 */
function canAccess(role, tableKey, verb) {
  const acl = TABLE_ACL[tableKey];
  if (!acl) return false;
  const required = acl[verb];
  if (!required) return false;
  if (required === '*') return true;
  return role === required;
}

/**
 * Filtre un objet de champs pour ne garder que ceux whitelisted pour la table.
 * Les champs non listés sont supprimés silencieusement (pas d'erreur 403).
 * @param {string} tableKey
 * @param {object} fields
 * @returns {object}
 */
function pickAllowedFields(tableKey, fields) {
  const wl = FIELD_WHITELIST[tableKey];
  if (!wl || !fields || typeof fields !== 'object') return fields || {};
  const out = {};
  for (const k of Object.keys(fields)) {
    if (wl.includes(k)) out[k] = fields[k];
  }
  return out;
}

module.exports = { TABLE_ACL, FIELD_WHITELIST, canAccess, pickAllowedFields };
