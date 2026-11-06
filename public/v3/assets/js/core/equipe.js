import { toast } from './ui.js';
export let equipe = [];
export async function chargerEquipe() {
  try {
    const r = await fetch('/api/equipe');
    if (!r.ok) throw new Error('Liste de l’équipe indisponible');
    equipe = (await r.json()).membres || [];
  } catch (e) { equipe = []; toast(e.message, 'error'); }
}
export function nomsEquipe() { return [...new Set(equipe.map(m => m.nom))]; }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
// Une ancienne valeur est conservée sur sa fiche, jamais proposée sur une nouvelle.
export function optionsEquipe(actuel = '', extras = []) {
  const noms = [...new Set([...nomsEquipe(), ...extras])];
  return (actuel && !noms.includes(actuel) ? `<option value="${esc(actuel)}" selected>${esc(actuel)} (ancien)</option>` : '') +
    noms.map(n => `<option value="${esc(n)}" ${n === actuel ? 'selected' : ''}>${esc(n)}</option>`).join('');
}
