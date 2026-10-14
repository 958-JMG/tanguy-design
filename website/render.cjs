const dimensions=require('./image-sizes.json');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function render(template,content,{origin,basePath='',indexable=false,slug=''}){
  let fill=template.replace(/\{\{([\w.-]+)\}\}/g,(_,p)=>esc(p.split('.').reduce((o,k)=>o?.[k],content)));
  fill=fill.replace(/<img\b[^>]*>/g,tag=>{const src=tag.match(/src="([^"]+)"/)?.[1],size=dimensions[src];if(!size)return tag;const small=src.replace(/\.webp$/,'-800.webp');return tag.replace('<img ',`<img width="${size[0]}" height="${size[1]}" ${small!==src&&dimensions[small]?`srcset="${small} 800w, ${src} ${size[0]}w" sizes="(max-width: 760px) 100vw, 90vw" `:''}`);});
  const localUrl=origin+basePath, pageUrl=localUrl+'/'+(slug?slug+'/':'');
  const business={'@type':'HomeAndConstructionBusiness','@id':localUrl+'/#entreprise',name:content.brand.name,url:localUrl+'/',image:origin+basePath+content.home.hero,logo:localUrl+'/assets/logo.png',telephone:content.brand.phone,email:content.brand.email,address:{'@type':'PostalAddress',streetAddress:content.brand.address,postalCode:'56400',addressLocality:'Auray',addressCountry:'FR'},areaServed:[{'@type':'City',name:'Auray'},{'@type':'City',name:'Vannes'},{'@type':'Place',name:'Golfe du Morbihan'}]};
  const title=fill.match(/<title>(.*?)<\/title>/s)?.[1]?.replaceAll('&amp;','&')||content.brand.name;
  const graph=[business,{'@type':'WebSite','@id':localUrl+'/#site',url:localUrl+'/',name:content.brand.name,inLanguage:'fr-FR',publisher:{'@id':business['@id']}},{'@type':'WebPage','@id':pageUrl+'#page',url:pageUrl,name:title,inLanguage:'fr-FR',isPartOf:{'@id':localUrl+'/#site'},about:{'@id':business['@id']}}];
  if(slug){const parts=slug.split('/');graph.push({'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Accueil',item:localUrl+'/'},...parts.map((p,i)=>({'@type':'ListItem',position:i+2,name:i===parts.length-1?title.split(' | ')[0]:(p==='realisations'?'Réalisations':'Inspirations'),item:localUrl+'/'+parts.slice(0,i+1).join('/')+'/'}))]});}
  if(content.universes[slug]){graph.push({'@type':'Service',name:slug==='cuisines'?'Conception de cuisines haut de gamme sur mesure':content.universes[slug].label,url:pageUrl,provider:{'@id':business['@id']},areaServed:business.areaServed});}
  const faq=content.universes[slug]?.faq;
  if(faq?.length)graph.push({'@type':'FAQPage',mainEntity:faq.map(x=>({'@type':'Question',name:x.q,acceptedAnswer:{'@type':'Answer',text:x.a}}))});
  return fill.replaceAll('__ORIGIN__',esc(localUrl)).replaceAll('__ROBOTS__',indexable?'index,follow,max-image-preview:large':'noindex,follow')
    .replace('<!--SCHEMA-->',`<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@graph':graph}).replaceAll('<','\\u003c')}</script>`)
    .replace(/(href|src)="\/(?!\/)/g,`$1="${basePath}/`)
    .replace(/srcset="([^"]+)"/g,(_,v)=>`srcset="${v.replace(/(^|, )\//g,`$1${basePath}/`)}"`);
}
module.exports={render,esc};
