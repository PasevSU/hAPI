'use strict';
// ДОГОВОРЪТ „АДРЕСИ ЗА ПОРТАЛА, ФАЙЛОВЕТЕ И ПРЕГЛЕДА — ОЩЕ ПРИ СЪЗДАВАНЕТО“ (0.69.219).
//
// Заявката на собственика: „създай договор, който създава API и QR кодовете за целия портал,
// за файловете и read-only още при създаването; те трябва да водят към портала, който дори и
// да няма нищо публикувано, трябва да го отразява“.
//
// Защо отделен модул: дотук адресите се сглобяваха на три места и по три повода —
// `adminPortal().urls` (част от публичния изглед), `GET …/api-info` (за панела) и
// `POST /admin/api/portals` (който **не връщаше нито един адрес**: човек създава портал и
// научава къде е QR кодът едва след втора заявка). Оттам идваха и разминаванията: `qr` в
// единия отговор беше SVG съдържание, в другия — адрес.
//
// Договорът (един обект, един построител):
//   • `page`     — човешката страница `/p/<id>` (с подписан достъп, ако порталът е частен);
//   • `api`      — `/api/v1/p/<slug>` + `apiJson` / `manifest` / `openapi`;
//   • `qr`       — АДРЕСЪТ на SVG-то (`…/qr.svg`), а `qrTarget` — какво то кодира;
//   • `file`     — шаблони с `{path}` за файл (страница, QR, изтегляне, JSON) — файловете
//                  още не съществуват при създаването, затова договорът е ШАБЛОН, а не списък;
//   • `folder`   — същите шаблони за папка (само QR и JSON: папка не се изтегля);
//   • `readOnly` — същият обект за спътника „само за преглед“ (или `null`, ако не е поискан);
//   • `files`    — колко е публикувано и `empty: true`, когато още нищо не е публикувано.
//                  Страницата показва точно това състояние (`files.empty.public|private` в
//                  `portal/portal-i18n.js`), а не 404 — пази го `portal-creation-contract.cjs`.
//
// Модулът е ЧИСТ: без `fs`, без състояние. Всичко, което знае за средата (базов адрес,
// подписан достъп), идва отвън — затова един и същ построител работи в сървъра и в теста.
const links = require('./links');

/** Празен обект вместо `undefined` — за да не се проверява навсякъде. */
const obj = (v) => (v && typeof v === 'object' ? v : {});

/**
 * Шаблоните за възел под портала. `{path}` е относителен път без воден наклон — същият,
 * който приемат `tree/file`, `tree/qr.svg` и `tree/api.json`.
 */
function nodeTemplates(api) {
  return {
    // Страницата на файла: `/file.html:<slug>/<път>` — същият адрес, който `tree/qr.svg`
    // кодира за файл (виж `portal-qr-levels.cjs`). Шаблонът е относителен; базовият адрес
    // се добавя от този, който го показва.
    page: '/file.html:{slug}/{path}',
    qr: api + '/tree/qr.svg?path={path}',
    download: api + '/tree/file?path={path}',
    apiJson: api + '/tree/api.json?path={path}',
  };
}

/**
 * Договорът за ЕДИН портал (нормалния или спътника „само за преглед“).
 * @param {object} p записът на портала
 * @param {{base?: string, accessQuery?: string, readOnly?: object|null}} [opts]
 *        `readOnly` е записът на спътника (или `null`) — така договорът на родителя
 *        съдържа адресите на прегледа, без втори източник да ги знае.
 */
function contract(p, opts = {}) {
  const base = String(opts.base || '');
  const accessQuery = String(opts.accessQuery || '');
  const api = links.withBase(base, links.portalApiPath(p));
  const landing = links.withBase(base, links.portalLandingPath(p));
  const page = links.joinQuery(landing, accessQuery);
  const listed = (p.files || []).filter((f) => f && f.listed !== false);
  const bytes = listed.reduce((n, f) => n + (Number(f.size) || 0), 0);
  const templates = nodeTemplates(api);
  return {
    // Адресите съществуват ОЩЕ ПРИ СЪЗДАВАНЕТО — независимо дали има публикуван файл.
    ready: true,
    id: p.id,
    slug: p.slug,
    readonly: p.readonly === true,
    parentId: p.parentId || null,
    page,
    api,
    apiJson: api + '/api.json',
    manifest: api + '/manifest',
    openapi: api + '/openapi.json',
    qr: api + '/qr.svg',
    qrTarget: page,
    // Шаблони: един адрес за всяко ниво (корен, папка, файл) — същият маршрут.
    file: templates,
    folder: { qr: templates.qr, apiJson: templates.apiJson },
    // Спътникът „само за преглед“: СВОИ адреси и свой QR (той е отделен запис с отделен
    // slug — вж. `portal-view.js`), а не препратка към родителя.
    //
    // ВАЖНО (DEF-65): ако дойде ГОТОВ договор (с подписан достъп), той се ползва както е.
    // До 0.69.220 тук се строеше нов без `accessQuery` — тоест за ЧАСТЕН портал адресът на
    // прегледа нямаше `?expires=&sig=` и правеше 404, макар договорът да твърдеше, че е готов.
    readOnly: readOnlyPart(opts, base),
    files: { count: listed.length, bytes, empty: listed.length === 0 },
  };
}

/** Спътникът: готов договор (с подпис) или запис, който се строи с подадения достъп. */
function readOnlyPart(opts, base) {
  const source = opts.readOnly;
  if (!source) return null;
  if (source.ready === true) return source;
  return contract(source, { base, accessQuery: String(opts.readOnlyAccess || '') });
}

/**
 * Сглобява отговора на административното API: снимката на портала + договора (+ спътника).
 * Едно място за `POST /admin/api/portals` и за `GET …/api-info`, за да не се разминават.
 * @param {object} admin изходът на `adminPortal(p)`
 * @param {object} p записът на портала
 * @param {string} base базов адрес (от `baseUrl(req)`, с префикса на HA, ако има)
 * @param {object|null} [adminView] изходът на `adminPortal(view)`
 * @param {object|null} [view] записът на спътника
 */
function attach(admin, p, base, adminView, view) {
  // Договорът на спътника се строи ПЪРВИ — с НЕГОВИЯ подписан достъп (`adminView.accessQuery`
  // идва от `adminPortal(view)`, тоест от САМИЯ запис на спътника) — и се подава готов.
  const viewContract = adminView && view ? contract(view, { base, accessQuery: obj(adminView).accessQuery }) : null;
  const out = { ...obj(admin), contract: contract(p, { base, accessQuery: obj(admin).accessQuery, readOnly: viewContract }) };
  if (viewContract) out.viewPortal = { ...obj(adminView), contract: viewContract };
  return out;
}

module.exports = { contract, attach, nodeTemplates };
