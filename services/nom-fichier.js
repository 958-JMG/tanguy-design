/**
 * services/nom-fichier.js — Nom d'un fichier reçu par multer, tel que
 * l'utilisateur le voit sur son poste
 *
 * Constat du 24/09/2026 (multer 1.4.5-lts.2 comme 2.4.0) : un fichier envoyé par
 * un navigateur avec un nom accentué arrive abîmé dans req.file.originalname.
 * « devis-été Ça.pdf » devient « devis-Ã©tÃ© Ãa.pdf », et ce nom partait tel
 * quel dans Airtable et dans la réponse au client.
 *
 * Cause : le navigateur écrit le nom en octets UTF-8 dans l'en-tête multipart,
 * et busboy (sous multer) décode ce paramètre en latin1 : un octet devient un
 * caractère. On relit ces octets en UTF-8.
 *
 * Deux garde-fous pour ne jamais abîmer un nom déjà juste :
 *  - un caractère au-delà de U+00FF ne peut pas sortir d'un décodage latin1 : le
 *    nom a déjà été décodé correctement (client qui envoie filename*=UTF-8''…),
 *    on n'y touche pas ;
 *  - si la relecture en UTF-8 produit U+FFFD, les octets n'étaient pas de
 *    l'UTF-8 (vieux client qui envoie du latin1) : on garde le nom d'origine.
 *
 * NFC : macOS fournit souvent les accents décomposés (« e » + accent) ; on les
 * recompose pour qu'un même nom s'écrive d'une seule façon dans Airtable.
 *
 * RÈGLE : tout nom de fichier reçu passe par nomFichier(req.file), jamais par
 * req.file.originalname directement (vérifié par nom-fichier.test.js).
 *
 * Logique PURE, testable sans réseau (ADR-004).
 */

/**
 * @param {{ originalname?: string }} file - fichier reçu par multer (req.file)
 * @returns {string|undefined} le nom réparé ; vide ou absent, il est rendu tel
 *   quel pour que `nomFichier(req.file) || 'defaut.pdf'` continue de marcher
 */
function nomFichier(file) {
  const nom = file && file.originalname;
  if (typeof nom !== 'string' || nom === '') return nom;
  if (/[\u0100-\uffff]/.test(nom)) return nom.normalize('NFC');
  const relu = Buffer.from(nom, 'latin1').toString('utf8');
  if (relu.includes('\uFFFD')) return nom;
  return relu.normalize('NFC');
}

module.exports = { nomFichier };
