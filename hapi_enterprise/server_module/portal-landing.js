'use strict';
// ПУБЛИЧНАТА СТРАНИЦА НА ПОРТАЛА — `/p/<id>[/]` (0.69.220).
//
// Първият компонент, изваден от `server.js` по новия договор: сървърът зарежда ВСИЧКИ файлове
// от `server_module/` (`server-modules.js`), без твърдо вписан списък. Затова тук живее целият
// маршрут — адресът, който QR кодът отваря: проверка за затворен/изтекъл портал, посещение в
// сензорите и подмяна на `{{BASE}}`/`{{API}}`/`{{FOLDER}}`/`{{QR}}`/`{{FOLDERS}}`/`{{LOCKED}}`
// в `portal/portal.html`.
//
// Защо точно този сегмент първи: той е САМОСТОЯТЕЛЕН (никакво състояние на `server.js` освен
// даденото през `host`), има ясна граница (един път и един метод) и носи най-много редове на
// квадратен метър — тоест освобождава бюджета на `server.js`, без да мести логика.
const fs = require('node:fs');

/** Адресите и политиката идват от `server.js` — компонентът не ги строи сам. */
function create(host) {
  const {
    links,
    baseUrl,
    htmlEsc,
    fail,
    portalPolicy,
    resolvePortal,
    portalArchive,
    recordTelemetry,
    portalRoot,
    portalPageFile,
    addonVersion,
  } = host;
  // Страницата се чете веднъж при старт: файлът е част от изданието и не се сменя по време
  // на работа. Така и грешка в пътя се вижда при старт, а не при първото отваряне на QR код.
  const template = fs.readFileSync(portalPageFile, 'utf8');

  return {
    name: 'portal-landing',
    // Страницата на портала е ПРЕДИ адресите на API-то: `/p/<id>` е човешкият вход.
    order: 10,
    handle({ req, res, url, parts, method }) {
      if (parts[0] !== 'p') return false;
      const single = parts.length === 2 || (parts.length === 3 && parts[2] === '');
      if (!single || method !== 'GET') return false;
      const portal = resolvePortal(parts[1]);
      if (!portal) {
        // Затворен (архивиран) портал казва защо го няма; останалото е 404.
        if (portalArchive.sendClosed(res, parts[1])) return true;
        fail(res, 404, 'Not found');
        return true;
      }
      // Заключеният портал СЕ ОТВАРЯ като кора (без съдържание), за да попита за парола:
      // иначе посетителят вижда 404 и няма къде да я въведе. Изтеклият остава 404.
      const decision = portalPolicy.decide({ req, url, portal, action: 'read' });
      if (!decision.allowed && decision.reason !== 'locked') {
        fail(res, 404, 'Not found');
        return true;
      }
      void recordTelemetry('visit', req, portal, null, url);
      // Адресите се строят през `links.js`: база от `public_base_url`/заявката, не от
      // `location.origin`. `{{FOLDERS}}` казва на страницата, че порталът има СОБСТВЕНА
      // папка — тогава тя се отваря в режим „папка“, а `?folder=` сочи подпапка в нея.
      const stRoot = portalRoot(portal.storage_root || '/share');
      const dedicated = stRoot !== '/share' && stRoot !== '/media';
      const fwd = links.prefixFromHeaders(req.headers);
      const base = links.withBase(baseUrl(req), fwd);
      const version = typeof addonVersion === 'function' ? addonVersion() : '';
      const html = template
        .replace('{{BASE}}', htmlEsc(base))
        .replace('{{API}}', htmlEsc(links.withBase(fwd, links.portalApiPath(portal))))
        .replace('{{FOLDER}}', htmlEsc(links.portalFolderRel(url.searchParams.get('order') || url.searchParams.get('folder') || '')))
        .replace('{{QR}}', htmlEsc(String(url.searchParams.get('qr') || '')))
        .replace('{{FOLDERS}}', dedicated ? '1' : '')
        .replace('{{LOCKED}}', decision.allowed ? '' : '1')
        // Ресурсите се искат с версия в адреса (0.69.226): така `portal-assets.js` ги дава с
        // `immutable` и второто отваряне на портала не тегли 150 KB наново, а след обновяване
        // на add-on-а версията се сменя и браузърът взима новите файлове — без `no-store`.
        .replace(/"\/(portal(?:-i18n)?\.(?:css|js))"/g, (m, ref) => '"/' + ref + '?v=' + encodeURIComponent(version) + '"');
      // Вградени стилове не се allow-ват; QR кодът е локален SVG (`img-src 'self'`).
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(html);
      return true;
    },
  };
}

module.exports = { create };
