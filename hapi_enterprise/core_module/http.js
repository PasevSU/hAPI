'use strict';
// ГЛОБАЛНА ФУНКЦИЯ „http“ — един изходящ клиент с таймаут и типизирана грешка.
//
// Защо е глобална: в кода има 8 места с изходящи заявки (webhooks, notify, огледало, TSA), всяко
// със свой начин за таймаут, за четене на тялото и за грешка. Договорът е взет от
// `PasevSU/js_project_pack` (READY_JS_PACKAGES/02-api/http.mjs), кодът е наш — без зависимости,
// върху `fetch`, който Node 22 има.
//
// Правилата, които не се разхлабват:
//   • ВСЯКА заявка има таймаут (през `AbortController`), дори когато викащият не поиска;
//   • тялото се чете ВЕДНЪЖ и се връща разчетено; невалиден JSON не е изключение — връща се
//     текстът, за да реши викащият;
//   • при `!ok` се хвърля грешка с `status` и `data` — за да може одитът да запише какво е
//     отговорил отсрещният, без да гадае по текста;
//   • таймаутът е със СОБСТВЕН код `ETIMEDOUT`, за да не се бърка с чуждо прекъсване.

const { parseJson } = require('../parse-json'); // един четец на JSON — без хвърляне (DEF-67)

const DEFAULT_TIMEOUT = 15000;

function positive(value, fallback, name) {
  const number = Number(value == null ? fallback : value);
  if (!Number.isFinite(number) || number <= 0) {
    const err = new Error('HTTP_BAD_OPTION: настройката трябва да е положително число');
    err.code = 'HTTP_BAD_OPTION';
    err.option = name;
    err.value = value;
    throw err;
  }
  return Math.floor(number);
}

/**
 * Клиент за един базов адрес. Връща `{ request, get, post, baseUrl, timeout }`.
 * @param {{baseUrl?: string, timeout?: number, headers?: object, fetchImpl?: Function}} [options]
 */
function client(options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (typeof fetchImpl !== 'function') {
    const err = new Error('HTTP_NO_FETCH: липсва fetch — подай fetchImpl');
    err.code = 'HTTP_NO_FETCH';
    throw err;
  }
  const baseUrl = String(opts.baseUrl || '').replace(/\/+$/, '');
  const timeout = positive(opts.timeout, DEFAULT_TIMEOUT, 'timeout');
  const baseHeaders = { accept: 'application/json', ...(opts.headers || {}) };

  async function request(path, init) {
    const settings = init || {};
    const url = /^https?:/i.test(String(path)) ? String(path) : baseUrl + (String(path).startsWith('/') ? path : '/' + path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const external = settings.signal;
    const onAbort = () => controller.abort();
    if (external) external.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetchImpl(url, {
        method: settings.method || 'GET',
        headers: { ...baseHeaders, ...(settings.headers || {}) },
        body: settings.body,
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      if (text) {
        // Невалиден JSON не е провал на заявката: връща се текстът.
        const decoded = parseJson(text);
        data = decoded.ok ? decoded.value : text;
      }
      const result = { status: response.status, ok: Boolean(response.ok), data, headers: response.headers };
      if (!response.ok) {
        const err = new Error('HTTP ' + response.status + (response.statusText ? ': ' + response.statusText : ''));
        err.status = response.status;
        err.data = data;
        err.response = result;
        throw err;
      }
      return result;
    } catch (err) {
      // Прекъсване по наш таймер, а не от викащия: казва се ЯВНО, че е таймаут.
      if (controller.signal.aborted && !(external && external.aborted)) {
        const timeoutError = new Error('ETIMEDOUT: таймаут след ' + timeout + ' ms (' + url + ')');
        timeoutError.code = 'ETIMEDOUT';
        timeoutError.url = url;
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    }
  }

  return {
    baseUrl,
    timeout,
    request,
    get: (path, init) => request(path, { ...(init || {}), method: 'GET' }),
    post: (path, body, init) =>
      request(path, {
        ...(init || {}),
        method: 'POST',
        headers: { 'content-type': 'application/json', ...((init && init.headers) || {}) },
        body: JSON.stringify(body),
      }),
  };
}

module.exports.create = () => ({
  name: 'http',
  fn: { client },
});
