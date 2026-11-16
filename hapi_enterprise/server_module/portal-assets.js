'use strict';
// СТАТИЧНИТЕ ФАЙЛОВЕ НА ПУБЛИЧНАТА СТРАНИЦА — `/portal.js`, `/portal-i18n.js`, `/portal.css`
// (0.69.222).
//
// Вторият компонент по договора от `server-modules.js`: `server.js` не знае името му, а го
// зарежда заедно с всички останали `*.js` от `server_module/`. Изваждането е смислено, защото
// тези три маршрута са публични, без състояние и без права — точно границата, която може да
// живее извън диспечера, без да мести логика за достъп.
//
// Защо не в `routes/`: там живеят договорите на HTTP API-то, които влизат след проверката за
// самоличност. Тук няма API — има три файла, които се сервират както са, с твърд тип.
//
// КЕШЪТ (0.69.226): дотук трите файла бяха `no-store`, за да не замръзне стар речник в браузъра
// след обновяване на add-on-а. Сега това се решава с версия в адреса: страницата иска
// `/portal.js?v=<версия>` и файлът може да е `immutable` за година. Който поиска файла БЕЗ
// версия (стар таб, ръчна заявка, тест) — получава `no-cache`, тоест пак не замръзва.
const fs = require('node:fs');
const path = require('node:path');

/** Един и същ договор за заглавките: тип, кеш според версията, без отгатване на типа. */
const headers = (type, versioned) => ({
  'Content-Type': type,
  'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'no-cache',
  'X-Content-Type-Options': 'nosniff',
});

function create(host) {
  const { portalSkin, portalDir } = host;
  // Файловете се четат веднъж при старт: те са част от изданието и не се сменят по време на
  // работа. Така и сгрешен път се вижда при старт, а не при първото отваряне на портала.
  const assets = new Map([
    [
      '/portal-i18n.js',
      {
        type: 'application/javascript; charset=utf-8',
        // Речникът на публичната страница (BG/EN/DE) — отделен файл, за да не се пълни
        // `portal.js` с 200 реда текстове и за да се проверява от тест.
        body: fs.readFileSync(path.join(portalDir, 'portal-i18n.js')),
      },
    ],
    ['/portal.js', { type: 'application/javascript; charset=utf-8', body: fs.readFileSync(path.join(portalDir, 'portal.js')) }],
    // Стиловете минават през `portal-skin.js` (класика или „modern“) — затова не се четат
    // като файл, а се искат от кожата, която решава кой вариант е избран.
    ['/portal.css', { type: 'text/css; charset=utf-8', body: () => portalSkin.stylesheet() }],
  ]);

  return {
    name: 'portal-assets',
    // След страницата на портала: ако `portal.js` се поиска преди HTML-а, няма значение,
    // но редът пази четим ред на диспечера (страница → нейните ресурси).
    order: 20,
    handle({ res, url, method }) {
      if (method !== 'GET') return false;
      const asset = assets.get(url.pathname);
      if (!asset) return false;
      res.writeHead(200, headers(asset.type, !!url.searchParams.get('v')));
      res.end(typeof asset.body === 'function' ? asset.body() : asset.body);
      return true;
    },
  };
}

module.exports = { create };
