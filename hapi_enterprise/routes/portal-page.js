'use strict';
// Публичната страница на портала — ЕДИН адрес, на адреса на add-on-а (и през Home Assistant).
//
//   GET /portal.html                  → поздрав; един достъпен портал → неговата страница,
//                                       няколко → списък с бутони „Отвори“, нула → обяснение
//   GET /portal.html?folder=<slug>    → страницата на конкретен портал (същата, която лежи
//                                       в папката му като `portal.html`)
//
// Защо отделен модул: `server.js` има твърд таван на редовете (tests/server-structure.cjs) и
// точно това е смисълът на тавана — маршрутът се дописва, но логиката му отива в `routes/`.
//
// Защо ЕДИН адрес: човек не знае slug и не бива да знае. Дотук страницата се сервираше само с
// `?folder=<slug>`, тоест „порталът“ нямаше адрес без параметър, а панелът изреждаше осем
// технически адреса. Сега има един: страницата. До кой портал има достъп ТАЗИ заявка решава
// `portal-policy.js` (същото решение като за `/p/<id>`), а не тук.
//
// Договор като на останалите компоненти: `handle()` връща `true`, когато заявката е за този
// компонент (и е приключена).
function create(deps) {
  const { fail, resolvePortal, policy, portals, baseUrl, recordTelemetry, portalFolder, links } = deps;
  // CSP без `style-src`/`script-src`: страницата е обикновен HTML с класове, без вградени
  // стилове и без скриптове — точно каквото Home Assistant очаква от статична страница.
  const HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };

  async function handle({ req, res, url }) {
    if (url.pathname !== '/portal.html' || req.method !== 'GET') return false;
    const folder = url.searchParams.get('folder');
    const wanted = folder ? resolvePortal(folder) : null;
    if (folder && !wanted) {
      fail(res, 404, 'Not found');
      return true;
    }
    const allowed = (p) => policy.decide({ req, url, portal: p, action: 'read' }).allowed;
    const readable = wanted ? (allowed(wanted) ? [wanted] : []) : portals().filter(allowed);
    // С `?folder=` отказът е 404 (иначе частен портал се вижда като „съществува“); без
    // параметър нулата е валиден отговор — поздравът казва, че още няма портали.
    if (!readable.length && folder) {
      fail(res, 404, 'Not found');
      return true;
    }
    if (wanted) void recordTelemetry('visit', req, wanted, null, url);
    // Префиксът на Home Assistant (`/hapi`, от `X-Forwarded-Prefix`) влиза в адреса — иначе
    // страница, отворена на `https://<ha>/hapi/portal.html`, води към `https://<ha>/p/…`, а
    // там hAPI няма маршрут и връща 404.
    const base = links.withBase(baseUrl(req), links.prefixFromHeaders(req.headers));
    const html = readable.length === 1
      ? await portalFolder.listTree(readable[0].storage_root).then((tree) => portalFolder.page(readable[0], base, tree))
      : portalFolder.rootPage(readable, base);
    res.writeHead(200, HEADERS);
    res.end(html);
    return true;
  }

  return { handle };
}

module.exports = { create };
