'use strict';
// Les fiches récentes séparent CP/Ville ; les imports anciens les placent dans
// Adresse. Conserver les deux formats et les éventuels compléments de rue.
function adresseFacturation(fields={}) {
  const value=x=>typeof x==='string'||typeof x==='number'?String(x).trim():'';
  const lines=value(fields.Adresse).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const index=lines.findIndex((line,i)=>i>0 && /^\d{5}\s+\S/.test(line));
  const legacy=index<0?null:lines[index].match(/^(\d{5})\s+(.+)$/);
  return {
    address:lines.filter((_,i)=>i!==index).join('\n') || undefined,
    postal_code:value(fields.CP) || legacy?.[1] || undefined,
    city:value(fields.Ville) || legacy?.[2] || undefined,
  };
}
module.exports={adresseFacturation};
