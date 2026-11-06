'use strict';
// Libellés historiques des affectations, associés uniquement à un compte actif.
function membresActifs(users) {
  const noms = { virginie: 'Virginie', sebastien: 'Sébastien', marine: 'Marine' };
  return users.filter(u => u.source === 'airtable' && u.actif === true && (!u.poseur || u.admin))
    .map(u => ({ login: u.login, nom: noms[u.login] || u.displayName || u.login }));
}
module.exports = { membresActifs };
