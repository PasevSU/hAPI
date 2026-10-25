'use strict';
// ГРЕШКАТА КАТО ДОКУМЕНТ (RFC 9457, „problem details“).
//
// Защо е отделен модул: `server.js` има твърд таван на редовете (`tests/server-structure.cjs`),
// а формата на грешката е договор, който се ползва навсякъде — тук е и прегледим, и тестваем
// без сървър.
//
// Защо НЕ сменяме `Content-Type` на `application/problem+json`: всеки съществуващ клиент
// проверява за `application/json` и чете `error`. Смяната би била тихо чупене на договора.
// Затова тялото носи ЕДНОВРЕМЕННО старото `error` и полетата от RFC 9457: `type`, `title`,
// `status`, `detail`. Никой не губи нищо, а машината получава структура, по която да решава.
const CODE = 'PROBLEM_DETAILS_RFC9457';

const TITLES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  410: 'Gone',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** Тялото на грешката: старото `error` + полетата по RFC 9457. */
function body(status, message) {
  const code = Number(status) || 500;
  const text = message == null ? '' : String(message);
  return { error: text, type: 'about:blank', title: TITLES[code] || 'Error', status: code, detail: text };
}

module.exports = { CODE, TITLES, body };
