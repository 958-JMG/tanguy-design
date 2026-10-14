const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const crypto=require('node:crypto');
function createStore(env=process.env){
 const bucket=env.SITE_BUCKET, client=new S3Client({endpoint:env.SITE_S3_ENDPOINT||'https://s3.fr-par.scw.cloud',region:'fr-par',forcePathStyle:true,credentials:{accessKeyId:env.SITE_S3_ACCESS_KEY||'',secretAccessKey:env.SITE_S3_SECRET_KEY||''}});
 const configured=Boolean(bucket&&env.SITE_S3_ACCESS_KEY&&env.SITE_S3_SECRET_KEY);
 const get=async key=>client.send(new GetObjectCommand({Bucket:bucket,Key:'website/'+key}));
 const put=async(key,body,options={})=>client.send(new PutObjectCommand({Bucket:bucket,Key:'website/'+key,Body:body,...options}));
 return {configured,
  async read(){if(!configured)return null;try{const r=await get('state.json');return {value:JSON.parse(await r.Body.transformToString()),etag:r.ETag};}catch(e){if(e.name==='NoSuchKey')return null;throw e;}},
  async write(value,etag){if(!configured)throw Error('Stockage non configuré');const body=JSON.stringify(value);await put('history/'+Date.now()+'-'+crypto.randomUUID()+'.json',body,{ContentType:'application/json'});try{return await put('state.json',body,{ContentType:'application/json',...(etag?{IfMatch:etag}:{IfNoneMatch:'*'})});}catch(e){if(e.$metadata?.httpStatusCode===412||e.$metadata?.httpStatusCode===409){e.status=409;e.message='Une autre modification a été enregistrée. Rechargez la page avant de continuer.';}throw e;}},
  async media(id){return get('media/'+id);},
  async upload(id,body,type){return put('media/'+id,body,{ContentType:type,CacheControl:'public, max-age=31536000, immutable'});}
 };
}
module.exports={createStore};
