'use strict';
// ГЛОБАЛНА ФУНКЦИЯ „address“ — договорът за адресите на портала, файловете и прегледа.
//
// Защо е глобална: договорът (DEF-63/DEF-70) се строи на три места — при създаване
// (`POST /admin/api/portals`), в `GET …/api-info` за панела и при `attach` на спътника
// „само за преглед“. Всяко от тях стигаше до `portal-links` само̀. Сега има ЕДИН вход:
// `core.api.address.contract` / `.attach`, а `portal-links.js` остава построителят.
const linksLib = require('../portal-links');

module.exports.create = (deps = {}) => {
  const links = (deps && deps.links) || require('../links');
  return {
    name: 'address',
    fn: {
      /** Пълният договор за адресите на портала (page · api · qr · файлове · папки · readOnly). */
      contract: (portal, opts) => linksLib.contract(portal, opts),
      /** Същият договор, сглобен към отговора на административния изглед + спътника. */
      attach: (admin, portal, base, adminView, view) => linksLib.attach(admin, portal, base, adminView, view),
      /** Относителният път до публичната страница — за списъци и отчети. */
      landingPath: (portal) => links.portalLandingPath(portal),
    },
  };
};
