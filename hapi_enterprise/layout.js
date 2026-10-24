'use strict';
// Карта на структурата: къде какво стои и на кой адрес се вижда.
//
// Причината да съществува: `portal.html` е ДВЕ неща с едно име —
//   1) страницата на add-on-а (в образа, до server.js) — сервира се на `/p/<slug>`;
//   2) генерираната страница на конкретен портал — в `api/<slug>/portal.html`,
//      сервира се на `/portal.html?folder=<slug>` и се записва до api.json.
// Затова „програмата не намира portal.html“ е въпрос на точния път, а не на липсващ файл.
// Тази карта се връща от `/admin/api/diagnostics` и се проверява от `tests/layout.cjs`.

const path = require('node:path');
const fsp = require('node:fs/promises');
const fs = require('node:fs');

// Проверявани адреси и какво точно сервират — за да не се гадае.
const ROUTES = [
  { url: '/ui/', serves: 'Enterprise Control Center (панелът)', source: 'app' },
  { url: '/p/<slug>', serves: 'страницата на add-on-а portal.html (evidence портал)', source: 'app' },
  { url: '/portal.html?folder=<slug>', serves: 'генерираната страница на ТОЗИ портал', source: 'api' },
  { url: '/api/v1/p/<slug>/api.json', serves: 'описание на API-то на портала', source: 'api' },
  { url: '/local/hapi/data/portal.html', serves: 'копие за Home Assistant (/config/www/hapi/data)', source: 'evidence-portal' },
];

/**
 * Описва структурата. ctx: { appDir, root, filesRoot, internalRoot, apiRoot, configDir }.
 * `path` е абсолютен път на диска; за папката на портала е относителна (`<storage_root>`),
 * защото тя е различна за всеки портал.
 */
function entries(ctx) {
  const c = ctx || {};
  const base = {
    appDir: String(c.appDir || __dirname),
    root: String(c.root || ''),
    filesRoot: String(c.filesRoot || ''),
    internalRoot: String(c.internalRoot || ''),
    apiRoot: String(c.apiRoot || ''),
    configDir: String(c.configDir || '/config'),
  };
  return [
    {
      id: 'app',
      label: 'Код на add-on-а (в Docker образа)',
      path: base.appDir,
      kind: 'dir',
      note: 'server.js, ui/, portal/ (страницата), fonts/, rules/ — чете се от образа, не се редактира',
    },
    {
      id: 'data',
      label: 'Данни на add-on-а',
      path: base.root,
      kind: 'dir',
      note: 'база (SQLite), ключове, одитна верига, backups/ — това е „работната папка“ на процеса',
    },
    {
      id: 'files',
      label: 'Байтове на качените файлове',
      path: base.filesRoot,
      kind: 'dir',
      note: 'по id: files/<portalId>/<fileId> — вътрешното хранилище (шифровано, ако е поискано)',
    },
    {
      id: 'internal',
      label: 'Вътрешни артефакти (версии, метаданни)',
      path: base.internalRoot,
      kind: 'dir',
      note: 'internal/<portalId>/<fileId>/…',
    },
    {
      id: 'api',
      label: 'Публикувано API на порталите (по една папка на портал)',
      path: base.apiRoot,
      kind: 'dir',
      note: 'api/<slug>/ — api.json, openapi.json, qr.svg и portal.html; генерират се при всяка промяна',
    },
    {
      id: 'portal-folder',
      label: 'Папка на портала с РЕАЛНИТЕ файлове',
      path: '<storage_root>/ (по подразбиране /share/<slug>)',
      kind: 'dir',
      note: 'тук качените файлове са с оригиналните си имена; виждат се и от Home Assistant /share',
    },
    {
      id: 'evidence-portal',
      label: 'Копие за Home Assistant (evidence портал)',
      path: path.join(base.configDir, 'www', 'hapi', 'data', 'portal.html'),
      kind: 'file',
      note: 'сервира се от HA на /local/hapi/data/portal.html; прави се при старт',
    },
  ];
}

async function statOf(entry) {
  if (!entry.abs || entry.abs.includes('<')) return { ...entry, checked: false };
  try {
    const st = await fsp.stat(entry.abs);
    const writable = st.isDirectory() ? await fsp.access(entry.abs, fs.constants.W_OK).then(() => true, () => false) : false;
    return { ...entry, checked: true, exists: true, isDirectory: st.isDirectory(), writable };
  } catch (e) {
    return { ...entry, checked: true, exists: false, writable: false, error: e.code || 'UNAVAILABLE' };
  }
}

/**
 * Замества абсолютните корени с токени: диагностиката показва КЪДЕ е нещото спрямо
 * познатите корени, но не издава пътя на машината (това е договор на `/admin/api/diagnostics`).
 */
function redact(value, ctx) {
  const pairs = [
    [String((ctx || {}).root || ''), '<данни>'],
    [String((ctx || {}).appDir || ''), '<приложение>'],
    [String((ctx || {}).apiRoot || ''), '<данни>/api'],
    [String((ctx || {}).filesRoot || ''), '<данни>/files'],
    [String((ctx || {}).internalRoot || ''), '<данни>/internal'],
  ].filter(([from]) => from);
  let out = String(value == null ? '' : value);
  for (const [from, to] of pairs) {
    if (out === from || out.startsWith(from + path.sep) || out.startsWith(from + '/')) out = to + out.slice(from.length);
  }
  return out.split(path.sep).join('/');
}

/** Картата с реални проверки на диска (пътищата са с токени, не абсолютни). */
async function check(ctx) {
  const list = [];
  // Обикновен цикъл с `await`: `map(async …)` не изчаква и редът на записите не е гарантиран.
  for (const entry of entries(ctx)) {
    const abs = entry.path.includes('<') ? entry.path : path.resolve(entry.path);
    const checked = await statOf({ ...entry, abs });
    delete checked.abs;
    checked.path = redact(checked.path, ctx);
    list.push(checked);
  }
  return { generatedAt: new Date().toISOString(), entries: list, routes: ROUTES };
}

module.exports = { entries, check, ROUTES };
