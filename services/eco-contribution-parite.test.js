/**
 * Test de parité entre les DEUX copies du barème éco-contribution.
 *
 * Le calcul vit à deux endroits :
 *   - services/eco-contribution-bareme.js          (serveur, source de vérité)
 *   - public/v3/assets/js/views/devis-fournisseur.js (navigateur, recalcul live
 *     à la frappe sans aller-retour réseau)
 *
 * Une correction appliquée d'un seul côté ferait diverger le montant affiché et
 * le montant calculé, sans qu'aucun écran ne le dise. Ce test compare les 36
 * cellules et échoue à la première différence.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GRILLE_TTC } = require('./eco-contribution-bareme');

const VUE = path.join(__dirname, '..', 'public/v3/assets/js/views/devis-fournisseur.js');

// Extrait l'objet littéral GRILLE_ECO_TTC de la vue, sans exécuter le module
// (import ESM + DOM impossibles ici).
function grilleDuNavigateur() {
  const src = fs.readFileSync(VUE, 'utf8');
  const debut = src.indexOf('const GRILLE_ECO_TTC = {');
  assert.notEqual(debut, -1, 'GRILLE_ECO_TTC introuvable dans la vue Devis express');
  const ouvrante = src.indexOf('{', debut);
  let profondeur = 0, fin = -1;
  for (let i = ouvrante; i < src.length; i++) {
    if (src[i] === '{') profondeur++;
    else if (src[i] === '}') { profondeur--; if (profondeur === 0) { fin = i; break; } }
  }
  assert.notEqual(fin, -1, 'littéral GRILLE_ECO_TTC non refermé');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(ouvrante, fin + 1)}`)();
}

test('les deux copies du barème sont identiques, cellule par cellule', () => {
  const front = grilleDuNavigateur();
  const materiaux = Object.keys(GRILLE_TTC);
  assert.deepEqual(Object.keys(front).sort(), materiaux.slice().sort(), 'matériaux différents entre serveur et navigateur');

  let cellules = 0;
  for (const mat of materiaux) {
    for (const tranche of Object.keys(GRILLE_TTC[mat])) {
      assert.ok(front[mat]?.[tranche], `tranche « ${tranche} » absente côté navigateur pour ${mat}`);
      for (const hauteur of ['h<250', 'h>=250']) {
        for (const gd of ['sans', 'certifiee']) {
          const attendu = GRILLE_TTC[mat][tranche][hauteur][gd];
          const obtenu = front[mat][tranche][hauteur][gd];
          assert.equal(obtenu, attendu, `divergence ${mat} · ${tranche} · ${hauteur} · ${gd} : navigateur ${obtenu} ≠ serveur ${attendu}`);
          cellules++;
        }
      }
    }
  }
  assert.equal(cellules, 36, `36 cellules attendues, ${cellules} comparées`);
});
