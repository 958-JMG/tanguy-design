'use strict';
const multer = require('multer');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { lireExcel } = require('./devis-excel');
const { nomFichier } = require('./nom-fichier');
const { CHAMP_DETAIL, preparerDetail, empreinteDetail, verifierDetail, ligneIdentique } = require('./devis-detail');
const { DEVIS_IMPORT_HASH_FIELD, buildHashFilterFormula } = require('./devis-idempotency');
const { numeroDevisExpress } = require('./devis-express-helper');

module.exports = function installer(app, { requireAdmin, TABLES, atFetchAll, atFetchByIds, atFetchFiltered, atCreate, atCreateBatch, atPatch, projetPourDevisExpress, typeDevisParDefaut, todayISO }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  app.get('/api/devis-express/detail/modele.csv', requireAdmin, (req, res) => {
    const rows = [
      'Total HT document;', 'Total TTC document;', 'Montant TVA;', 'Taux TVA;20', 'Total eco HT;0', 'Eco incluse;oui', 'Remise globale HT;0',
      'Section;Référence;Désignation;Quantité;PU HT;Remise HT;Remise %;Éco HT;Net HT;TVA;Catégorie;Type;Sans référence',
    ];
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="modele-devis-detail.csv"').send('\ufeff' + rows.join('\r\n') + '\r\n');
  });
  app.post('/api/devis-express/detail/excel', requireAdmin, (req, res, next) => upload.single('fichier')(req, res, e => e ? res.status(400).json({ error: e.message }) : next()), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Fichier Excel ou CSV requis.' });
      const parsed = await lireExcel(req.file.buffer, path.extname(nomFichier(req.file) || '').toLowerCase());
      res.json({ ok: true, parsed, source: { nom: nomFichier(req.file), empreinte: createHash('sha256').update(req.file.buffer).digest('hex') } });
    } catch (e) { res.status(422).json({ error: e.message }); }
  });

  // Une file pour les nouveaux numéros IMP, un état durable par import. Une
  // coupure après un lot de lignes se reprend sans rejouer les lots existants.
  let file = Promise.resolve();
  app.post('/api/devis-express/detail/creer', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const operation = file.then(async () => {
      if (!b.projetId && !b.clientId) throw Object.assign(new Error('Choisis un projet ou un client.'), { status: 400 });
      if (b.verifie !== true) throw Object.assign(new Error('Relis les références, les remises et les totaux, puis confirme la vérification.'), { status: 422 });
      if (!b.document || typeof b.document !== 'object') throw Object.assign(new Error('Détail du document requis.'), { status: 422 });
      const preparation = await preparerDetail(b.document, { source: b.source, famille: b.famille });
      const hash = empreinteDetail(preparation.snapshot.document, { projetId: b.projetId || '', clientId: b.projetId ? '' : b.clientId, famille: b.famille || '', typeDevis: b.typeDevis || '' });
      // Refus avant création d'un projet si la migration n'est pas disponible.
      await atFetchAll(TABLES.devis.id, new URLSearchParams({ 'fields[]': CHAMP_DETAIL, maxRecords: '1' }).toString());
      const existants = await atFetchFiltered(TABLES.devis.id, buildHashFilterFormula(hash));
      if (existants.length > 1) throw Object.assign(new Error('Plusieurs devis portent cette reprise. Fais vérifier ces doublons avant de poursuivre.'), { status: 409 });
      let devis = existants[0], projetCree = false;
      if (!devis) {
        const pr = b.projetId ? await projetPourDevisExpress({ projetId: b.projetId }) : { clientId: b.clientId, projet: {} };
        if (pr.erreur) throw Object.assign(new Error(pr.erreur.message), { status: pr.erreur.status });
        if (!pr.clientId || !(await atFetchByIds(TABLES.clients.id, [pr.clientId])).length) throw Object.assign(new Error('Le projet doit être rattaché à une fiche client existante.'), { status: 422 });
        const tous = await atFetchAll(TABLES.devis.id);
        const numero = numeroDevisExpress(tous.map(d => String(d.fields?.['Numéro devis'] || '').replace(/^IMP-/, 'EXP-')), todayISO().slice(0, 4)).replace(/^EXP-/, 'IMP-');
        const type = ['Principal', 'Additif'].includes(b.typeDevis) ? b.typeDevis : await typeDevisParDefaut(pr.projet);
        preparation.fields['Numéro devis'] = numero; preparation.fields['Type devis'] = type; preparation.fields['Date devis'] = todayISO();
        devis = await atCreate(TABLES.devis.id, { ...preparation.fields, [DEVIS_IMPORT_HASH_FIELD]: hash, ...(pr.projetId ? { Projet: [pr.projetId] } : {}), Client: [pr.clientId] });
      }
      if (!devis.fields.Projet?.length) {
        // Le projet est créé avec son lien Devis dans la même écriture. Même
        // si sa réponse est perdue, Airtable tient le lien inverse : la reprise
        // retrouve ce projet au lieu d'en créer un second.
        const pr = await projetPourDevisExpress({ clientId: devis.fields.Client?.[0], devisId: devis.id,
          libelle: b.document.produit_resume, budgetHt: preparation.controle.totaux.total_ht });
        if (pr.erreur) throw Object.assign(new Error(pr.erreur.message), { status: pr.erreur.status });
        projetCree = true;
        devis = (await atFetchByIds(TABLES.devis.id, [devis.id]))[0];
        if (!devis.fields.Projet?.includes(pr.projetId)) throw Object.assign(new Error('Le lien du projet n’est pas confirmé : création arrêtée. Fais vérifier le rattachement avant de relancer.'), { status: 409 });
      }
      const f = devis.fields;
      if ((b.projetId && !f.Projet?.includes(b.projetId)) || (!b.projetId && !f.Client?.includes(b.clientId))) throw Object.assign(new Error('Le rattachement de ce devis a changé. Fais vérifier sa fiche avant de reprendre.'), { status: 409 });
      const snapshot = JSON.parse(f[CHAMP_DETAIL]);
      let lignes = await atFetchByIds(TABLES['lignes-devis'].id, f['Lignes devis'] || []);
      if (snapshot.etat === 'complet') {
        await verifierDetail(f, lignes);
        return { ok: true, already: true, devisId: devis.id, numero: f['Numéro devis'], projetId: f.Projet?.[0], typeDevis: f['Type devis'], lignesCreees: lignes.length };
      }
      if (f.Statut !== 'Brouillon' || f['Pennylane quote ID']) throw Object.assign(new Error('Ce devis a déjà été utilisé. La reprise automatique de ses lignes est refusée.'), { status: 409 });
      try {
        const attendues = preparation.lignes;
        for (const l of lignes) {
          const cible = attendues.find(x => x.Position === l.fields.Position);
          if (!cible || !ligneIdentique(l.fields, cible) || lignes.filter(x => x.fields.Position === l.fields.Position).length !== 1) throw new Error('Une ligne existante a été modifiée ou dupliquée : reprise automatique arrêtée.');
        }
        const manquantes = attendues.filter(l => !lignes.some(x => x.fields.Position === l.Position));
        // Pas de helper tolérant : perdre une référence ou une remise est ici
        // un échec, jamais une création réussie avec des champs supprimés.
        await atCreateBatch(TABLES['lignes-devis'].id, manquantes.map(l => ({ ...l, Devis: [devis.id] })));
        devis = (await atFetchByIds(TABLES.devis.id, [devis.id]))[0];
        lignes = await atFetchByIds(TABLES['lignes-devis'].id, devis.fields['Lignes devis'] || []);
        await verifierDetail(devis.fields, lignes, { incomplet: true });
        snapshot.etat = 'complet';
        await atPatch(TABLES.devis.id, devis.id, { [CHAMP_DETAIL]: JSON.stringify(snapshot) });
        return { ok: true, devisId: devis.id, numero: f['Numéro devis'], projetId: f.Projet?.[0], projetCree, typeDevis: f['Type devis'], lignesCreees: lignes.length };
      } catch (e) { throw Object.assign(new Error(`Import incomplet (${f['Numéro devis']}) : ${e.message} Réessaie avec le même document et le même projet ; les lignes déjà enregistrées seront conservées.`), { status: 409, devisId: devis.id }); }
    });
    file = operation.catch(() => {});
    try { res.json(await operation); }
    catch (e) { res.status(e.status || 500).json({ error: e.message, ...(e.devisId ? { devisId: e.devisId } : {}) }); }
  });
};
