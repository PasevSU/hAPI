'use strict';
// Данни за GUI сценариите, които не могат да се създадат от интерфейса (напр. готов PGP ключ).
// Живеят тук, а не в `gui-journeys.cjs`, защото сценариите не бива да ползват add-on модули.
const pgp = require('../../hapi_enterprise/pgp.js');

const pgpKey = (name) => pgp.generate({ algorithm: 'ed25519', userId: `GUI ${name} <${name.toLowerCase()}@example.test>` }).secretArmored;

module.exports = { pgpKey };
