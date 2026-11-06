import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionsWinner, renderLignesWinner } from './devis-winner.mjs';
const ligne = (Position, section, extra = {}) => ({ fields: { Position, 'Section Winner': section, 'Ordre Winner': 1, ...extra } });
test('affichage : sections contiguës, repères et fournisseurs conservés, sans regroupement global', () => {
  const lignes = [ligne('503', 'Meubles'), ligne('20', 'Plans de travail'), ligne('15', 'Panneaux'), ligne('2.1', 'Accessoires', { 'Position parent': '2' }), ligne('1', 'Meubles')];
  assert.deepEqual(sectionsWinner(lignes).map(g => g.section), ['Meubles', 'Plans de travail', 'Panneaux', 'Accessoires', 'Meubles']);
  const html = renderLignesWinner(lignes);
  assert.ok(html.indexOf('503') < html.indexOf('>20<'));
  assert.ok(html.indexOf('>20<') < html.indexOf('>15<'));
  assert.match(html, /lié à 2/);
  assert.match(html, /Fournisseur : <strong>À confirmer/);
});
test('texte du PDF échappé et description complète accessible', () => {
  const html = renderLignesWinner([ligne('1', '<img src=x>', { 'Désignation': '<script>' + 'x'.repeat(200), 'Fournisseur Winner': '<b>Test</b>' })]);
  assert.doesNotMatch(html, /<img|<script>|<b>Test/);
  assert.match(html, /<details>/);
  assert.match(html, /&lt;b&gt;Test/);
});
test('ancien import : limite annoncée, ne prétend pas connaître son ordre PDF', () => {
  assert.match(renderLignesWinner([{ fields: { Position: '1' } }]), /ordre Winner non enregistré/);
});
