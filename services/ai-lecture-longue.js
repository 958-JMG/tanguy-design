'use strict';

// Les devis détaillés peuvent dépasser 5 minutes. Le flux évite une connexion
// silencieuse avec le fournisseur ; la limite globale reste inférieure aux 15 min
// du conteneur. Aucune relance automatique qui ferait repartir l'attente de zéro.
const DELAI_LECTURE_MS = 8 * 60_000;
async function lireFluxAnthropic(client, params, { delaiMs = DELAI_LECTURE_MS } = {}) {
  const controle = new AbortController();
  let limiteAtteinte = false;
  const timer = setTimeout(() => { limiteAtteinte = true; controle.abort(); }, delaiMs);
  try {
    return await client.messages.stream(params, { signal: controle.signal, timeout: delaiMs, maxRetries: 0 }).finalMessage();
  } catch (e) {
    if (limiteAtteinte || e.name === 'APIConnectionTimeoutError') {
      throw new Error('L’analyse a dépassé le délai de 8 minutes. Réessaie ; si cela se reproduit, fais vérifier ce document avant de créer le devis.');
    }
    throw e;
  } finally { clearTimeout(timer); }
}
module.exports = { lireFluxAnthropic, DELAI_LECTURE_MS };
