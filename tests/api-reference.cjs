'use strict';
// Приложението „API Endpoint Reference“ се ГЕНЕРИРА от кода — тестът пази да не се размине.
//
// Защо: документация, писана на ръка, остарява тихо. Тук източниците са живи
// (`admin-api-spec.js`, `public-route-allowlist.js`, `routes/`), а `--check` сравнява
// байт по байт — всеки нов маршрут без регенериране чупи матрицата.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'api-reference.cjs');
const doc = path.join(ROOT, 'documentation', '02_TO_BE_ARCHITECTURE', 'API_ENDPOINT_REFERENCE.md');

assert.equal(fs.existsSync(doc), true, 'документът съществува: ' + doc);
const check = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
assert.equal(check.status, 0, 'справочникът е актуален (иначе: node scripts/api-reference.cjs)\n' + (check.stderr || '') + (check.stdout || ''));

const text = fs.readFileSync(doc, 'utf8');
const spec = require(path.join(ROOT, 'hapi_enterprise', 'admin-api-spec.js'));
const allow = require(path.join(ROOT, 'hapi_enterprise', 'public-route-allowlist.js'));

// Всяка операция от договора е в таблицата; нищо измислено.
for (const [method, route] of spec.ROUTES) {
  assert.ok(text.includes('| ' + method + ' | `' + route + '` |'), `липсва ${method} ${route} в справочника`);
}
const tableRows = (text.match(/^\| (?:GET|POST|PUT|PATCH|DELETE) \| `\/admin/gm) || []).length;
assert.equal(tableRows, spec.ROUTES.length, `редове в таблицата (${tableRows}) = операции в договора (${spec.ROUTES.length})`);

// Публичните правила са изброени изрично, не „някъде“.
assert.equal((text.match(/^\| (?:GET|POST) \| `\^/gm) || []).length, allow.RULES.length, 'всички публични правила са в таблицата');
for (const rule of allow.RULES) assert.ok(text.includes('`' + rule.re.source + '`'), 'липсва публично правило ' + rule.re.source);

// Четирите договора и blok са назовани — иначе приложението не описва архитектурата.
for (const contract of ['`order`', '`file`', '`html`', '`blok`']) assert.ok(text.includes(contract), 'договорът ' + contract + ' е описан');
assert.ok(text.includes('410'), 'blok е описан с код 410');
assert.ok(/Не се редактира на ръка/.test(text), 'документът казва, че се генерира');
assert.ok(/не съдържат физически пътища/.test(text), 'казано е, че публичните грешки не разкриват пътища');

console.log(`api-reference OK: ${spec.ROUTES.length} операции · ${allow.RULES.length} публични правила · документът е байт-в-байт от кода`);
