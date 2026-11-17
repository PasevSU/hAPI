'use strict';
// `/statik/<id>/<име>` — ЛИНКЪТ НА ОТЧЕТА, САМО ЗА ИЗТЕГЛЯНЕ (ADR-0028, D5/§6.3).
//
// Защо е отделен `server_module`: маршрутът е самостоятелен (никакво състояние на `server.js`
// освен даденото през `host`), има една граница и не иска ред в `server.js`, чийто бюджет е
// изчерпан. Зарежда се по име, както всички в папката.
//
// Правилата, които маршрутът налага:
//   1. файлът се намира САМО по `id` от листа — пътят в адреса не се използва за диск, тоест
//      `..`, абсолютен път и чуждо име не водят никъде (404, не 403: без изброяване);
//   2. `immutable` е верен, защото един `id` никога не сочи друго съдържание (нов отчет = нов
//      `id`), а `noindex` пази линка от търсачки — той е capability, не публична страница;
//   3. `304` при `If-None-Match` минава през СЪЩИЯ модул като другата статика (`static-etag`),
//      за да не се чете файлът при всяко питане;
//   4. само `GET`/`HEAD` — линкът не се променя и не се трие от този адрес.
const fs = require('node:fs');
const path = require('node:path');
const staticEtag = require('../static-etag');

const ID = /^[A-Za-z0-9_-]{32}$/;
// Публичен адрес: линкът се изтегля без токен, затова заглавките са строги и без реферер.
const IMMUTABLE = 'private, max-age=31536000, immutable';

function create(host) {
  const { statik, fail, audit, log } = host;
  const baseHeaders = (name, bytes, etag) => ({
    'Content-Type': 'application/pdf',
    'Content-Length': String(bytes),
    'Content-Disposition': 'attachment; filename="' + name + '"',
    'Cache-Control': IMMUTABLE,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  });

  return {
    name: 'statik',
    // Преди компонентите на API-то: `/statik/` не е API и не бива да се редува с тях.
    order: 20,
    handle({ req, res, parts, method }) {
      if (parts[0] !== 'statik') return false;
      if (method !== 'GET' && method !== 'HEAD') { fail(res, 405, 'Method not allowed'); return true; }
      // `/statik/<id>/<име>`: името е само за човека — то НЕ участва в намирането на файла.
      if (parts.length !== 3) { fail(res, 404, 'Not found'); return true; }
      const id = parts[1];
      const record = ID.test(id) ? statik.get(id) : null;
      if (!record) {
        void audit('statik.gone', { id });
        fail(res, 404, 'Not found');
        return true;
      }
      const file = path.join(statik.dir, id + '.pdf');
      let bytes;
      try {
        bytes = fs.statSync(file).size;
      } catch {
        // Записът е жив, а файлът го няма: листът се чисти, а отговорът е честно 404.
        statik.remove(id);
        void audit('statik.gone', { id, reason: 'file-missing' });
        fail(res, 404, 'Not found');
        return true;
      }
      const asset = staticEtag.load(file, null);
      if (staticEtag.matches(req, asset.etag)) {
        res.writeHead(304, baseHeaders(record.name || record.file, bytes, asset.etag));
        return res.end();
      }
      statik.touch(id);
      void audit('statik.get', { id, portalId: record.portalId, files: record.files, bytes });
      log?.info?.('statik.get', { ns: 'statik', id, bytes });
      res.writeHead(200, baseHeaders(record.name || record.file, asset.body.length, asset.etag));
      // `HEAD` носи същите заглавки, но без тяло — така проверката на линка не тегли 750 KB.
      if (method === 'HEAD') return res.end();
      return res.end(asset.body);
    },
  };
}

module.exports = { create };
