const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {adresseFacturation}=require('./adresse-client');
test('fiche actuelle : le CP et la ville arrivent dans le devis Pennylane',()=>{
 assert.deepEqual(adresseFacturation({Adresse:'1 rue de la Recette',CP:'56000',Ville:'Vannes'}),{address:'1 rue de la Recette',postal_code:'56000',city:'Vannes'});
});
test('import historique : adresse multiligne et compléments conservés',()=>{
 assert.deepEqual(adresseFacturation({Adresse:'1 rue des Lilas\r\nBâtiment B\r\n06000 Nice'}),{address:'1 rue des Lilas\nBâtiment B',postal_code:'06000',city:'Nice'});
});
test('les champs distincts priment sur une ancienne ligne postale',()=>{
 assert.deepEqual(adresseFacturation({Adresse:'1 rue des Lilas\n56000 Vannes',CP:'56400',Ville:'Auray'}),{address:'1 rue des Lilas',postal_code:'56400',city:'Auray'});
});
test('adresse absente : aucun contenu inventé et garde-fou serveur conservé',()=>{
 assert.deepEqual(adresseFacturation({CP:'56000',Ville:'Vannes'}),{address:undefined,postal_code:'56000',city:'Vannes'});
 const source=fs.readFileSync('server.js','utf8');assert.match(source,/adresseFacturation\(cf\)/);assert.match(source,/if \(!billingAddress.address\)/);assert.match(source,/\.\.\.billingAddress/);
});
