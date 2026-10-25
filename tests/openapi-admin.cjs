'use strict';
// ДОГОВОРЪТ ЗА АДМИНИСТРАТИВНОТО API — като ФАЙЛ, който клиент може да отвори.
//
// Вече има `tests/admin-api-spec.cjs`, който сверява ТАБЛИЦАТА с кода (всеки `url.pathname ===
// '/admin/api/…'` има ред и обратно). Тук се проверява другото, което може да изостане тихо:
// САМИЯТ ФАЙЛ — актуален ли е, валиден ли е като OpenAPI, сочат ли `$ref`-овете някъде, и
// съвпадат ли правата, които договорът обещава, с правата, които системата има.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('../scripts/release-lib.cjs');
const spec = require('../hapi_enterprise/admin-api-spec.js');
const rbac = require('../hapi_enterprise/rbac.js');

const root = path.join(__dirname, '..');
const cases = [];
const ok = (label) => cases.push(label);

const openapiPath = path.join(root, 'api', 'hapi-admin.openapi.json');
const postmanPath = path.join(root, 'api', 'hapi-admin.postman_collection.json');
for (const file of [openapiPath, postmanPath]) {
  assert.ok(fs.existsSync(file), 'липсва ' + path.relative(root, file) + ' — пусни node scripts/openapi-admin.cjs');
}
const doc = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
const collection = JSON.parse(fs.readFileSync(postmanPath, 'utf8'));

// ── 1. Файловете не са остарели ────────────────────────────────────────────
// Същият принцип като `api-reference --check`: артефакт, който може да изостане, изостава.
{
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'openapi-admin.cjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, 'договорът е остарял спрямо кода: ' + String(run.stderr || run.stdout).trim().slice(0, 200));
  ok('двата файла са точно изходът на генератора (не са пипане на ръка)');
}

// ── 2. Валиден OpenAPI 3.1 и правилна версия ───────────────────────────────
{
  assert.match(String(doc.openapi), /^3\.1\./, 'документът е OpenAPI 3.1, получено: ' + doc.openapi);
  const version = lib.readAddonVersion(root);
  assert.equal(doc.info.version, version, 'версията в договора е версията на add-on-а, а не 0.0.0');
  assert.ok(Array.isArray(doc.servers) && doc.servers.length === 1, 'има един `servers` запис');
  assert.equal(doc.servers[0].url, '{baseUrl}', 'адресът е променлива, а не твърд адрес, който да остарее');
  assert.ok(doc.info.description && doc.info.description.length > 40, 'описанието казва как се подава токенът');
  ok('OpenAPI ' + doc.openapi + ', версия ' + doc.info.version + ', адресът е `{baseUrl}`');
}

// ── 3. Операциите: брой, уникалност, отговори ──────────────────────────────
{
  const ops = [];
  for (const [routePath, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) ops.push({ routePath, method, op });
  }
  assert.equal(ops.length, spec.operations().length,
    'операциите в договора (' + ops.length + ') не съвпадат с таблицата (' + spec.operations().length + ')');
  const ids = ops.map((o) => o.op.operationId);
  assert.equal(new Set(ids).size, ids.length, 'има повторени operationId — генераторът на клиент ги ползва за имена');
  for (const { routePath, method, op } of ops) {
    assert.ok(op.summary && op.summary.trim(), 'операция без резюме: ' + method + ' ' + routePath);
    assert.ok(Array.isArray(op.tags) && op.tags.length, 'операция без таг: ' + method + ' ' + routePath);
    const statuses = Object.keys(op.responses || {});
    assert.ok(statuses.length >= 1, 'операция без нито един отговор: ' + method + ' ' + routePath);
    assert.ok(statuses.some((s) => /^2\d\d$/.test(s)), 'операция без успешен отговор: ' + method + ' ' + routePath);
    assert.ok(routePath.startsWith('/admin/api/'), 'път извън /admin/api/: ' + routePath);
  }
  ok(ops.length + ' операции, уникални operationId, всеки с таг, резюме и успешен отговор');
}

// ── 4. Правата в договора съществуват в системата ─────────────────────────
// Договорът обещава `x-hapi-capability` за всяка операция. Ако обещае право, което `rbac` не
// познава, клиентът ще получи 403 по причина, която никъде не е записана — точно класът
// разминаване, което се вижда само от потребителя.
{
  const known = new Set(Object.keys(rbac.CAPABILITIES));
  const used = new Set();
  let nonRbac = 0;
  for (const [routePath, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const cap = op['x-hapi-capability'];
      if (!cap) {
        // Маршрут, който НЕ се решава от RBAC, трябва да го каже изрично — иначе договорът
        // мълчи за достъпа, което е по-лошо от грешно поле.
        assert.ok(op['x-hapi-access'], 'операция без право и без обяснение за достъпа: ' + method + ' ' + routePath);
        nonRbac += 1;
        continue;
      }
      assert.ok(known.has(cap), 'право, което rbac не познава: ' + cap + ' (' + method + ' ' + routePath + ')');
      used.add(cap);
    }
  }
  assert.ok(used.size >= 10, 'правата в договора са само ' + used.size + ' — изглежда таблицата е орязана');
  ok('всяко от ' + used.size + ' права в договора съществува в `rbac.CAPABILITIES`; ' + nonRbac + ' маршрут(а) извън RBAC е с изрично `x-hapi-access`');
}

// ── 5. Всички `$ref` се решават вътре в документа ─────────────────────────
{
  const resolve = (ref) => {
    assert.ok(ref.startsWith('#/'), 'външен $ref не се поддържа: ' + ref);
    let node = doc;
    for (const seg of ref.slice(2).split('/')) {
      node = node && node[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
      assert.ok(node, 'счупен $ref: ' + ref);
    }
    return node;
  };
  let seen = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') { resolve(node.$ref); seen += 1; return }
    for (const value of Object.values(node)) walk(value);
  };
  walk(doc);
  assert.ok(seen >= 20, 'намерени са само ' + seen + ' $ref — изглежда компонентите липсват');
  ok(seen + ' $ref-а се решават локално (без външни адреси)');
}

// ── 6. Postman колекцията е използваема ────────────────────────────────────
{
  assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', 'колекцията е Postman v2.1');
  const variables = (collection.variable || []).map((v) => v.key);
  assert.ok(variables.includes('baseUrl') && variables.includes('adminToken'), 'колекцията има baseUrl и adminToken');
  const requests = [];
  for (const folder of collection.item || []) {
    for (const item of folder.item || []) requests.push({ folder: folder.name, item });
  }
  assert.equal(requests.length, spec.operations().length, 'заявките в колекцията (' + requests.length + ') не съвпадат с операциите');
  for (const { folder, item } of requests) {
    assert.ok(item.name, 'заявка без име в папка ' + folder);
    assert.ok(item.request && /^[A-Z]+$/.test(item.request.method), 'заявка без метод: ' + item.name);
    assert.ok(String(item.request.url.raw).startsWith('{{baseUrl}}'), 'заявка без {{baseUrl}}: ' + item.name);
    assert.match(String(item.request.description), /(Право \(RBAC\)|Достъп: )/, 'описанието казва кое право трябва (или защо достъпът е друг): ' + item.name);
  }
  const names = requests.map((r) => r.folder + '|' + r.item.name);
  assert.equal(new Set(names).size, names.length, 'две едноименни заявки в една папка — в Postman това е неразличимо');
  ok(requests.length + ' заявки в ' + (collection.item || []).length + ' папки, всяка с метод, адрес и право');
}

console.log('PASS openapi-admin: ' + cases.length + ' проверки — ' + cases.join('; '));
