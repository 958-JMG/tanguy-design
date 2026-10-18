const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/v3/assets/js/core/support.js','utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
function setup(){const badge={textContent:'1',setAttribute(){},remove(){this.removed=true;}},button={querySelector:()=>badge};const ctx=vm.createContext({document:{getElementById:()=>button},fetch:async()=>({ok:false}),console});vm.runInContext(source,ctx);return{ctx,badge};}
test('badge conservé sur erreur HTTP ou JSON invalide',async()=>{
 const {ctx,badge}=setup();await ctx.refreshSupportBadge();assert.equal(badge.removed,undefined);
 ctx.fetch=async()=>({ok:true,json:async()=>({ok:false})});await ctx.refreshSupportBadge();assert.equal(badge.removed,undefined);
});
test('une réponse GET ancienne ne ressuscite pas le badge après lecture',async()=>{
 const {ctx,badge}=setup();let resolve;ctx.fetch=()=>new Promise(r=>resolve=r);const old=ctx.refreshSupportBadge();
 ctx.fetch=async()=>({ok:true,json:async()=>({ok:true,notifications:[],unread:0})});await ctx.refreshSupportBadge();
 resolve({ok:true,json:async()=>({ok:true,notifications:[{}],unread:1})});await old;assert.equal(badge.removed,true);assert.equal(badge.textContent,'1');
});
