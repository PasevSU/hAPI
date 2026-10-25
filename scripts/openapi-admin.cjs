'use strict';
// МАШИННО ЧЕТИМИЯТ ДОГОВОР ЗА АДМИНИСТРАТИВНОТО API — като ФАЙЛ, а не само като код.
//
// `hapi_enterprise/admin-api-spec.js` знаеше 208 операции, но документът съществуваше само в
// паметта на процеса: клиент (Postman, генератор на код, проверяващ) нямаше какво да отвори и
// научаваше за маршрут от 404. `documentation/…/API_ENDPOINT_REFERENCE.md` е за ЧОВЕК (таблици),
// този файл е за МАШИНА.
//
// Затова тук има два артефакта от ЕДИН източник:
//   api/hapi-admin.openapi.json              OpenAPI 3.1
//   api/hapi-admin.postman_collection.json   Postman v2.1 (за ръчна проверка на маршрут)
// Нито един от тях не се пише на ръка — `--check` сравнява байт по байт с изхода на генератора,
// точно както `api-reference.cjs --check` пази човешкия справочник.
//
// Употреба:
//   node scripts/openapi-admin.cjs            # записва двата файла
//   node scripts/openapi-admin.cjs --check    # само сравнява (за гейтове)
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./release-lib.cjs');
const spec = require('../hapi_enterprise/admin-api-spec.js');

const root = lib.ROOT;
const outDir = path.join(root, 'api');
const check = process.argv.includes('--check');
const version = lib.readAddonVersion(root);

const OPENAPI = 'hapi-admin.openapi.json';
const POSTMAN = 'hapi-admin.postman_collection.json';

/** OpenAPI документът — с РЕАЛНАТА версия, не `0.0.0` (иначе договорът не казва за кое издание е). */
function openapi() {
  const doc = spec.build({ baseUrl: 'http://127.0.0.1:8099' });
  doc.info.version = version;
  // `servers` е подсказка, не адрес: инсталацията може да е под ingress, на друг порт или в друг
  // домейн. Затова е с променлива, а не с твърд адрес, който някой ще копира и ще се чуди защо 404.
  doc.servers = [{ url: '{baseUrl}', description: 'Адресът на административния порт (по подразбиране http://127.0.0.1:8099)', variables: { baseUrl: { default: 'http://127.0.0.1:8099' } } }];
  return doc;
}

/** Postman v2.1 от СЪЩИЯ документ: папките са таговете, заявките — операциите. */
function postman(doc) {
  const folders = new Map();
  for (const [routePath, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const tag = (op.tags && op.tags[0]) || 'other';
      if (!folders.has(tag)) folders.set(tag, []);
      folders.get(tag).push({
        name: op.summary || op.operationId,
        request: {
          method: method.toUpperCase(),
          header: [{ key: 'Authorization', value: 'Bearer {{adminToken}}' }],
          url: {
            raw: '{{baseUrl}}' + routePath,
            host: ['{{baseUrl}}'],
            // Пътят се разбива на сегменти; `:param` става `{{param}}`, за да е попълваемо на ръка.
            path: routePath.split('/').filter(Boolean).map((seg) => (seg.startsWith('{') ? '{{' + seg.slice(1, -1) + '}}' : seg)),
          },
          description: [
            op.summary || '',
            '',
            // Какво пази маршрута: право по RBAC или изрично обяснение, че достъпът е друг.
            op['x-hapi-capability']
              ? 'Право (RBAC): `' + op['x-hapi-capability'] + '`'
              : 'Достъп: ' + (op['x-hapi-access'] || 'не е указан') + ' (не е RBAC)',
            op['x-hapi-notes'] || '',
          ].join('\n').trim(),
        },
        response: [],
      });
    }
  }
  const order = (doc.tags || []).map((t) => t.name);
  const items = [...folders.keys()]
    .sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b))
    .map((tag) => ({ name: tag, item: folders.get(tag) }));
  return {
    info: {
      name: 'hAPI Enterprise — административно API ' + version,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Генериран от `hapi_enterprise/admin-api-spec.js` (node scripts/openapi-admin.cjs). Не се редактира на ръка.',
    },
    variable: [
      { key: 'baseUrl', value: 'http://127.0.0.1:8099' },
      { key: 'adminToken', value: '' },
    ],
    item: items,
  };
}

const files = {
  [OPENAPI]: JSON.stringify(openapi(), null, 2) + '\n',
  [POSTMAN]: JSON.stringify(postman(openapi()), null, 2) + '\n',
};

let drift = 0;
for (const [name, text] of Object.entries(files)) {
  const target = path.join(outDir, name);
  if (check) {
    // Сравнението е ТОЧНО, но без значение на окончанията на редовете: Git на Windows може да
    // докара файла с CRLF при checkout, а това не е разминаване в договора. Всяка ЛОГИЧЕСКА
    // промяна (ръчно пипане на поле) пак се хваща — виж негативната проверка в теста.
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current !== text) {
      console.error('остарял: ' + path.relative(root, target) + ' — пусни node scripts/openapi-admin.cjs');
      drift += 1;
    }
    continue;
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(target, text, 'utf8');
  console.log('записан ' + path.relative(root, target) + ' · ' + Buffer.byteLength(text, 'utf8') + ' байта');
}

if (check) {
  if (drift) process.exit(1);
  console.log('договорът е актуален (' + Object.keys(files).length + ' файла)');
}
