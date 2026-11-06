// Une coupure peut survenir pendant fetch OU pendant la lecture du corps JSON
// (après les premiers espaces keep-alive). Dans les deux cas, le devis n'est pas créé.
export async function analyserFournisseur({ file, signal = null, requete = fetch }) {
  const fd = new FormData(); fd.append('pdf', file);
  let r, texte;
  try {
    r = await requete('/api/devis-fournisseur/parse', { method: 'POST', credentials: 'same-origin', body: fd, signal });
    texte = await r.text();
  } catch (e) {
    if (signal?.aborted) throw new Error('Analyse annulée.');
    throw new Error('La connexion a été interrompue pendant l’analyse. Aucun devis n’a été créé. Le fichier reste disponible dans cet onglet : utilise « Réessayer l’analyse ».');
  }
  if (r.status === 401 || r.redirected && /\/login(?:[?#]|$)/.test(r.url)) throw new Error('Ta session a expiré. Reconnecte-toi puis relance l’analyse.');
  let j;
  try { j = JSON.parse(texte); } catch { /* page d'erreur du proxy ou réponse tronquée */ }
  if (j?.error) throw new Error(j.error);
  if (!r.ok || !j) {
    if ([502, 503, 504].includes(r.status)) throw new Error('Le serveur a interrompu l’analyse ou est momentanément indisponible. Aucun devis créé. Utilise « Réessayer l’analyse ».');
    throw new Error(`Analyse non reçue (${r.status || 'réponse incomplète'}). Réessaie sans recréer de devis.`);
  }
  return j;
}
