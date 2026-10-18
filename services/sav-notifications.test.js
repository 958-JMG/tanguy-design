const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { AirtableNotificationStore, createRouter } = require('./sav-notifications');
const notification = {ticket_id:'TEST',statut:'Résolu',titre:'Fictif',message:'Réponse',event_id:''};

function remote() {
  const rows = new Map(), writes = [];
  let fail = false;
  const transport = async (url, opts) => {
    if(fail) throw new Error('private secret must stay private');
    const body = opts.body && JSON.parse(opts.body);
    if(opts.method === 'GET') return Response.json({records:[...rows.values()]}); // filtre ignoré volontairement
    writes.push(body);
    const result = body.records.map(change => {
      let row;
      if(change.id) row=rows.get(change.id);
      else {
        assert.deepEqual(body.performUpsert,{fieldsToMergeOn:['Event Key']});
        assert.ok(!('Read' in change.fields));
        row=[...rows.values()].find(r => r.fields['Event Key'] === change.fields['Event Key']);
        if(!row) {row={id:'rec'+rows.size,createdTime:new Date().toISOString(),fields:{}}; rows.set(row.id,row);}
      }
      Object.assign(row.fields,change.fields); return row;
    });
    return Response.json({records:result});
  };
  const store = () => new AirtableNotificationStore({token:'fake',base:'appFake',transport});
  return {rows,writes,store,setFail(v){fail=v;}};
}

test('deux workers et un redémarrage conservent lecture et dédoublonnage', async()=>{
  const db=remote(), a=db.store(), b=db.store();
  const key=await a.receive('alice',notification);
  assert.equal((await b.listFor('alice'))[0].lu,false);
  await b.markRead('alice',key);
  await Promise.all(Array.from({length:20},()=>db.store().receive('alice',notification)));
  assert.equal(db.rows.size,1);
  assert.equal((await db.store().listFor('alice'))[0].lu,true);
});
test('isolation serveur même si le fournisseur ignore son filtre',async()=>{
  const db=remote(); const key=await db.store().receive('alice',notification);
  assert.deepEqual(await db.store().listFor('bob'),[]);
  assert.equal(await db.store().markRead('bob',key),0);
  assert.equal((await db.store().listFor('alice'))[0].lu,false);
});
test('une nouvelle réponse crée un événement et la lecture se fait par lots de dix',async()=>{
  const db=remote();
  for(let i=0;i<23;i++) await db.store().receive('alice',{...notification,message:`Réponse ${i}`});
  assert.equal(await db.store().markRead('alice'),23);
  assert.deepEqual(db.writes.filter(x=>!x.performUpsert).map(x=>x.records.length),[10,10,3]);
});
test('écriture incomplète et panne fournisseur ne sont pas annoncées comme réussies',async()=>{
  const store=new AirtableNotificationStore({token:'fake',base:'appFake',transport:async()=>Response.json({records:[]})});
  await assert.rejects(store.receive('alice',notification),/write_unconfirmed/);
  const db=remote();db.setFail(true);
  await assert.rejects(db.store().listFor('alice'),/storage_unavailable/);
});
test('pagination garde le filtre et refuse une boucle',async()=>{
  const urls=[];
  const store=new AirtableNotificationStore({token:'fake',base:'appFake',transport:async url=>{urls.push(new URL(url));return Response.json({records:[],offset:'repeat'});}});
  await assert.rejects(store.listFor('a"\\b'),/pagination/);
  assert.equal(urls.length,2);
  assert.equal(urls[0].searchParams.get('filterByFormula'),urls[1].searchParams.get('filterByFormula'));
});
test('vrais endpoints HTTP : refus, persistance, isolation, erreurs 503',async t=>{
  const db=remote(), app=express(); app.use(express.json());
  // Session fictive exclusivement dans ce banc, jamais dans le serveur déployé.
  app.use((req,_res,next)=>{if(req.get('Test-User'))req.session={user:req.get('Test-User')};next();});
  app.use('/api/sav',createRouter({store:db.store(),secret:'test-only',logger:{error(){}},
    requireAuth:(req,res,next)=>req.session?next():res.sendStatus(401),
    findUser:async login=>login==='alice'||login==='bob'?{actif:true}:null}));
  const server=http.createServer(app); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const call=(path,body,user,secret='test-only')=>fetch(`http://127.0.0.1:${server.address().port}/api/sav${path}`,{
    method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-958-Secret':secret,...(user?{'Test-User':user}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const body={ticket_id:'TEST',auteur_login:'Alice',titre:'Fictif',message_resolution:'Réponse'};
  assert.equal((await call('/callback',body,null,'wrong')).status,401);
  for(const bad of [[],{...body,ticket_id:[]},{...body,message_resolution:'x'.repeat(2001)}])assert.equal((await call('/callback',bad)).status,400);
  assert.equal((await call('/callback',{...body,auteur_login:'missing'})).status,422);
  assert.equal((await call('/my-notifications')).status,401);
  const key=(await(await call('/callback',body)).json()).notif_id;
  const list=await call('/my-notifications',undefined,'alice');assert.equal(list.headers.get('cache-control'),'no-store, private');assert.equal((await list.json()).unread,1);
  assert.equal((await call(`/notifications/${key}/read`,{},'bob')).status,404);
  assert.equal((await call(`/notifications/${key}/read`,{},'alice')).status,200);
  await call('/callback',body);
  assert.equal((await(await call('/my-notifications',undefined,'alice')).json()).unread,0);
  db.setFail(true);
  const failed=await call('/callback',body);assert.equal(failed.status,503);assert.equal(failed.headers.get('retry-after'),'5');assert.ok(!(await failed.text()).includes('private secret'));
});
