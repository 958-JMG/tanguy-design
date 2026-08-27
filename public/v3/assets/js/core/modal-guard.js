/**
 * core/modal-guard.js — Ne pas perdre une saisie sur un clic à côté
 *
 * Retour JMG (27/08/2026) : « de temps en temps, si on clique juste à côté, la
 * fenêtre se referme d'un coup sans que les infos soient enregistrées — c'est le
 * cas dans Méta ».
 *
 * Les 24 modales du cockpit se ferment toutes sur un clic dans le fond
 * (`if (e.target === modal) close()`), y compris au beau milieu d'une saisie.
 * Plutôt que de reprendre 24 endroits un par un — et d'oublier les prochains —
 * ce garde intercepte le clic EN AMONT, au niveau du document, en phase de
 * capture : il s'exécute avant le gestionnaire de chaque modale et peut donc
 * l'empêcher.
 *
 * Règle : une fenêtre dont aucun champ n'a été touché se ferme normalement (le
 * clic à côté reste un raccourci commode). Dès qu'un champ a été modifié, le
 * clic dans le fond ne ferme plus rien et un message rappelle comment sortir.
 * Fermer volontairement reste possible par Annuler, la croix, ou Échap.
 */

import { toast } from './ui.js';

/**
 * Un champ a-t-il été modifié depuis l'ouverture ?
 * On compare à la valeur INITIALE du HTML (defaultValue / defaultChecked), ce
 * qui fonctionne pour les modales rendues par template, sans avoir à mémoriser
 * un état à l'ouverture.
 */
function champModifie(el) {
  if (el.disabled || el.readOnly) return false;
  const type = (el.type || '').toLowerCase();
  if (type === 'checkbox' || type === 'radio') return el.checked !== el.defaultChecked;
  if (el.tagName === 'SELECT') {
    const initiale = [...el.options].find(o => o.defaultSelected);
    // Sans option marquée par défaut, le navigateur retient la première.
    const attendue = initiale ? initiale.value : (el.options[0] ? el.options[0].value : '');
    return el.value !== attendue;
  }
  if (type === 'file') return el.files && el.files.length > 0;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value !== el.defaultValue;
  if (el.isContentEditable) return true; // pas de valeur initiale fiable : on protège
  return false;
}

/** La modale contient-elle une saisie en cours ? */
export function saisieEnCours(modal) {
  if (!modal) return false;
  return [...modal.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"]')]
    .some(champModifie);
}

let installe = false;

/**
 * Installe le garde. Idempotent : un second appel ne fait rien.
 * En phase de CAPTURE sur document, donc avant les gestionnaires des modales.
 */
export function installerGardeModales() {
  if (installe) return;
  installe = true;

  document.addEventListener('click', (e) => {
    const cible = e.target;
    // Uniquement le clic sur le FOND (le voile), pas à l'intérieur de la boîte.
    if (!cible || !cible.classList || !cible.classList.contains('modal-bg')) return;
    if (!saisieEnCours(cible)) return; // rien de saisi → fermeture normale

    // On coupe le clic AVANT que le gestionnaire de la modale ne le reçoive.
    e.stopPropagation();
    e.preventDefault();
    toast('Fermeture annulée : des informations ont été saisies. Utilise « Annuler » pour fermer sans enregistrer.', 'error', 5000);
  }, true); // ← capture
}
