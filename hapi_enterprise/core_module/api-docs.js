'use strict';
// ГЛОБАЛНА ФУНКЦИЯ „api-docs“ — API документът на портала (OpenAPI + api/<slug>/).
//
// Заявката на собственика (0.69.223) беше „глобални функции … като този за създаване на QR,
// **API**…“, а първото издание на слоя покри само QR и адресите. Затова `api-spec` и
// `api-registry` останаха в `server.js` на ТРИ места, две от които строят регистъра с
// различни опции (единият — вътре в заявка). Днес има един вход:
//
//     core.api['api-docs'].spec(portal, base)      → OpenAPI документ
//     core.api['api-docs'].registry({ root, baseUrl }) → записвач на api/<slug>/
//
// Защо модулът ползва ДРУГ глобален модул: QR кодът в `api/<slug>/qr.svg` се рисува от
// `api.qr`, а адресът, който кодът кодира, идва от `api.address.landingPath` — така няма
// втори построител и няма как QR в api папката да сочи друго място от QR на портала.
const apiRegistry = require('../api-registry');
const apiSpec = require('../api-spec');

module.exports.create = (deps = {}, api = {}) => {
  const links = (deps && deps.links) || require('../links');
  /** Адресът, който QR кодът в api/<slug>/ кодира: ПУБЛИЧНАТА страница, не JSON-ът. */
  const qrPayload = (record, portal, base) =>
    links.withBase(base, api.address ? api.address.landingPath(portal) : links.portalLandingPath(portal));
  return {
    name: 'api-docs',
    fn: {
      /** OpenAPI документът на портала — същият, който `api-spec.js` пише в `api.json`. */
      spec: (portal, base) => apiSpec.buildOpenApi(portal, { baseUrl: base || '' }),
      /** Картата `api.json` — записът, който се сервира на `/api/v1/p/<slug>/api.json`. */
      record: (portal, options = {}) => apiSpec.buildApiRecord(portal, options),
      /**
       * Записвачът на `api/<slug>/`. Опциите идват от викащия (`root`, `baseUrl`), а
       * рисуването на QR и адресът — от глобалния слой, за да е един източник.
       */
      registry: (options = {}) => apiRegistry.create({
        ...options,
        qrSvg: (text) => (api.qr ? api.qr.svg(text) : ''),
        qrPayload,
      }),
    },
  };
};
