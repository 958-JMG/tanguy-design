'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const EVENT_PATTERN = /^sav-[a-f0-9]{64}$/;
const quoted = value => JSON.stringify(value);

class NotificationStoreError extends Error {}

// Aucun état local : plusieurs instances partagent la même table. L'upsert ne
// transmet JAMAIS Read=false, même lorsqu'un callback est répété après lecture.
class AirtableNotificationStore {
  constructor({ token, base, table = 'SAV_Notifications', transport = (...args) => fetch(...args) }) {
    this.token = token;
    this.url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;
    this.transport = transport;
  }
  async request(method, body, params) {
    if (!this.token) throw new NotificationStoreError('storage_not_configured');
    try {
      const url = new URL(this.url);
      for (const [k,v] of Object.entries(params || {})) url.searchParams.set(k, v);
      const response = await this.transport(url, {
        method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new NotificationStoreError(`storage_http_${response.status}`);
      const result = await response.json();
      if (!result || !Array.isArray(result.records) || result.details) throw new NotificationStoreError('storage_incomplete_response');
      return result;
    } catch (e) {
      if (e instanceof NotificationStoreError) throw e;
      throw new NotificationStoreError('storage_unavailable');
    }
  }
  async receive(login, notification) {
    const key = 'sav-' + createHash('sha256').update(JSON.stringify([login, notification])).digest('hex');
    const fields = { 'Event Key': key, Recipient: login, Ticket: notification.ticket_id,
      Status: notification.statut, Title: notification.titre, Message: notification.message };
    const result = await this.request('PATCH', { performUpsert: { fieldsToMergeOn: ['Event Key'] }, records: [{ fields }] });
    if (result.records.length !== 1 || Object.entries(fields).some(([k,v]) => result.records[0]?.fields?.[k] !== v)) {
      throw new NotificationStoreError('storage_write_unconfirmed');
    }
    return key;
  }
  async records(login) {
    if (!login) return [];
    const params = { pageSize: '100', filterByFormula: `AND({Recipient}=${quoted(login)},IS_AFTER(CREATED_TIME(),${quoted(new Date(Date.now()-30*86400000).toISOString())}))` };
    const rows = [], offsets = new Set();
    while (true) {
      const result = await this.request('GET', null, params);
      rows.push(...result.records.filter(r => r.fields?.Recipient === login && EVENT_PATTERN.test(r.fields?.['Event Key'])));
      if (!result.offset) return rows;
      if (offsets.has(result.offset) || offsets.size >= 100) throw new NotificationStoreError('storage_invalid_pagination');
      offsets.add(result.offset); params.offset = result.offset;
    }
  }
  async listFor(login) {
    const grouped = new Map();
    for (const row of await this.records(login)) {
      const f = row.fields, key = f['Event Key'];
      const old = grouped.get(key);
      grouped.set(key, { id: key, date: old && old.date < row.createdTime ? old.date : row.createdTime,
        ticket_id: f.Ticket || '', statut: f.Status || '', titre: f.Title || '', message: f.Message || '', lu: !!f.Read || !!old?.lu });
    }
    return [...grouped.values()].sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  async markRead(login, key) {
    const rows = (await this.records(login)).filter(r => (!key || r.fields['Event Key'] === key) && !r.fields.Read);
    for (let i = 0; i < rows.length; i += 10) {
      const batch = rows.slice(i, i+10);
      const result = await this.request('PATCH', { records: batch.map(r => ({ id:r.id, fields:{ Read:true } })) });
      const saved = new Set(result.records.filter(r => r.fields?.Read === true).map(r => r.id));
      if (saved.size !== batch.length || batch.some(r => !saved.has(r.id))) throw new NotificationStoreError('storage_read_unconfirmed');
    }
    return new Set(rows.map(r => r.fields['Event Key'])).size;
  }
}

function createRouter({ requireAuth, store, findUser, secret, logger }) {
  const router = require('express').Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); });
  const fail = (res,e) => {
    logger.error({ error: e instanceof NotificationStoreError ? e.message : 'recipient_unavailable' }, '[sav] indisponible');
    return res.status(503).set('Retry-After','5').json({ok:false,error:'Notifications momentanément indisponibles. Réessayez.'});
  };
  router.post('/callback', async (req,res) => {
    const a = Buffer.from(req.get('X-958-Secret') || ''), b = Buffer.from(secret || '');
    if (!b.length || a.length !== b.length || !timingSafeEqual(a,b)) return res.status(401).json({error:'unauthorized'});
    const data = req.body;
    if (!data || Array.isArray(data) || typeof data !== 'object') return res.status(400).json({error:'Objet JSON requis'});
    const limits = {ticket_id:200,auteur_login:200,auteur_email:254,statut:100,titre:200,message_resolution:2000,event_id:200};
    for (const [field,limit] of Object.entries(limits)) if (data[field] != null && (typeof data[field] !== 'string' || data[field].length > limit)) return res.status(400).json({error:`Champ invalide : ${field}`});
    const login = (data.auteur_login?.trim() || data.auteur_email?.split('@')[0] || '').trim().toLowerCase();
    const ticket = data.ticket_id?.trim();
    if (!ticket || !login) return res.status(400).json({error:'ticket_id et auteur_login (ou auteur_email) requis'});
    try {
      const user = await findUser(login);
      if (!user || !user.actif) return res.status(422).json({error:'Destinataire inconnu ou désactivé'});
      const key = await store.receive(login, {ticket_id:ticket,statut:data.statut || 'Résolu',titre:data.titre || `Ticket ${ticket}`,message:data.message_resolution || "Ticket résolu par l'équipe 9·58.",event_id:data.event_id || ''});
      return res.json({ok:true,notif_id:key});
    } catch(e) { return fail(res,e); }
  });
  router.get('/my-notifications', requireAuth, async(req,res) => {
    try {
      const notifications = await store.listFor(req.session.user.trim().toLowerCase());
      res.json({ok:true,notifications,unread:notifications.filter(n => !n.lu).length});
    } catch(e) { fail(res,e); }
  });
  router.post('/notifications/:id/read', requireAuth, async(req,res) => {
    if (!EVENT_PATTERN.test(req.params.id)) return res.status(400).json({error:'Identifiant invalide'});
    try {
      const login = req.session.user.trim().toLowerCase();
      if (!(await store.listFor(login)).some(n => n.id === req.params.id)) return res.status(404).json({error:'introuvable'});
      await store.markRead(login,req.params.id);
      res.json({ok:true});
    } catch(e) { fail(res,e); }
  });
  router.post('/notifications/mark-all-read', requireAuth, async(req,res) => {
    try { res.json({ok:true,marked:await store.markRead(req.session.user.trim().toLowerCase())}); }
    catch(e) { fail(res,e); }
  });
  return router;
}

module.exports = { AirtableNotificationStore, NotificationStoreError, createRouter, EVENT_PATTERN };
