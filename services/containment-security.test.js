const test=require('node:test'), assert=require('node:assert/strict'), http=require('node:http');
const {fork}=require('node:child_process'),{authenticator}=require('otplib');
test('confinement : accès activés conservés, aucun nouvel enrôlement ni reset sur deux processus',async t=>{
 process.env.SESSION_SECRET='fixture-containment-session-0123456789';
 const totp=require('./totp'),secret=authenticator.generateSecret();let writes=0,unavailable=false;
 const records=[{id:'admin',fields:{Login:'admin',Actif:true,Admin:true,'2FA actif':true,'TOTP secret':totp.encryptSecret(secret)}},{id:'new',fields:{Login:'new',Actif:true}},{id:'broken',fields:{Login:'broken',Actif:true,'2FA actif':true,'TOTP secret':'broken'}}];
 const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(unavailable){res.statusCode=503;return res.end('{}');}if(req.method!=='GET'){writes++;res.statusCode=500;return res.end('{}');}res.end(JSON.stringify({records}));});
 await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+fixture.address().port,children=[];
 t.after(async()=>{await Promise.all(children.map(c=>new Promise(r=>{if(c.exitCode!==null||c.signalCode)return r();c.once('exit',r);c.kill('SIGKILL');})));await new Promise(r=>fixture.close(r));});
 async function start(legacy=false){const c=fork(require.resolve('./containment-replica.cjs'),legacy?['--legacy']:[],{env:{PATH:process.env.PATH,NODE_ENV:'test',SESSION_SECRET:process.env.SESSION_SECRET,AIRTABLE_BASE_ID:'fixture',AIRTABLE_KEY:'fixture-key',USERS_TABLE_ID:'users',ADMIN_LOGINS:'admin',FIXTURE_ORIGIN:origin},stdio:['ignore','ignore','ignore','ipc']});children.push(c);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Démarrage absent')),10000);c.once('message',m=>{clearTimeout(timer);resolve('http://127.0.0.1:'+m.port);});c.once('exit',()=>{clearTimeout(timer);reject(Error('Arrêt'));});});}
 const bases=[await start(),await start()];
 function browser(){let cookie='';return async(base,path,body,method='POST')=>{const r=await fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const sc=r.headers.getSetCookie();if(sc.length)cookie=sc.map(s=>s.split(';')[0]).join('; ');return{status:r.status,data:await r.json()};};}
 const legacyBase=await start(true),legacySession=browser();
 assert.equal((await legacySession(legacyBase,'/api/login',{login:'new'})).data.step,'enroll');
 const oldQr=await legacySession(legacyBase,'/api/login/enroll/start',{});assert.equal(oldQr.status,200);assert.ok(oldQr.data.secret);
 for(const base of bases){
  assert.equal((await legacySession(base,'/api/login/enroll/start',{})).status,403,'ancienne session refusée au début');
  assert.equal((await legacySession(base,'/api/login/enroll/verify',{code:authenticator.generate(oldQr.data.secret)})).status,403,'ancienne session et vrai code refusés à la confirmation');
  assert.equal((await legacySession(base,'/api/me',undefined,'GET')).status,401);
 }
 assert.equal(records[1].fields['TOTP secret'],undefined);assert.equal(writes,0);
 const admin=browser();assert.equal((await admin(bases[0],'/api/login',{login:'admin'})).data.step,'totp');assert.equal((await admin(bases[1],'/api/login/totp',{code:authenticator.generate(secret)})).status,200);
 for(const base of bases){
  assert.equal((await admin(base,'/api/me',undefined,'GET')).status,200);
  for(const login of ['new','broken'])assert.equal((await browser()(base,'/api/login',{login})).status,403);
  for(const path of ['/api/login/enroll/start','/api/login/enroll/verify']){
   assert.equal((await browser()(base,path,{code:authenticator.generate(secret)})).status,403);
   assert.equal((await admin(base,path,{code:authenticator.generate(secret)})).status,403);
  }
  assert.equal((await admin(base,'/api/admin/users',{login:'other'})).status,503);
  assert.equal((await admin(base,'/api/admin/users/admin/reset-2fa',{})).status,503);
  assert.equal((await admin(base,'/api/me',undefined,'GET')).status,200);
 }
 assert.equal(writes,0);assert.equal(totp.decryptSecret(records[0].fields['TOTP secret']),secret);
 records[0].fields.Actif=false;assert.equal((await browser()(bases[0],'/api/login',{login:'admin'})).status,401);
 unavailable=true;assert.equal((await browser()(bases[1],'/api/login',{login:'admin'})).status,500,'aucun cache ni fallback lors d’une panne Airtable');
});
