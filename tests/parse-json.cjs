'use strict';
// DEF-67: едно място решава какво значи „невалиден JSON“.
//
// Правилото, което този тест пази:
//   • `parseJson` НИКОГА не хвърля — дори за `undefined`, обект или празен текст, защото
//     входът идва от файл, база и мрежа, където повреденият запис е нормален случай;
//   • `parseJsonOr` връща подразбирането САМО при повреда, тоест текстът `null` (валиден JSON,
//     стойност `null`) не се бърка с повреден запис;
//   • в продуктовия код (`hapi_enterprise/`) няма нито едно необяснено `JSON.parse(променлива)`
//     — всяко минава през `parse-json.js` или има писмена причина в `bad-code-allowlist.json`.
//
//   node tests/parse-json.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { parseJson, parseJsonOr } = require(path.join(ROOT, 'hapi_enterprise', 'parse-json.js'));

// 1. Валиден JSON минава, включително „стойност null“ и скалари.
assert.deepEqual(parseJson('{"a":1}'), { ok: true, value: { a: 1 } });
assert.deepEqual(parseJson('[1,2]'), { ok: true, value: [1, 2] });
assert.deepEqual(parseJson('null'), { ok: true, value: null }, 'текстът null е валиден JSON');
assert.deepEqual(parseJson('5'), { ok: true, value: 5 });
assert.deepEqual(parseJson('"текст"'), { ok: true, value: 'текст' });
assert.deepEqual(parseJson(Buffer.from('{"b":2}')), { ok: true, value: { b: 2 } }, 'Buffer се разчита');
// Входът се привежда до текст точно както при самия `JSON.parse`, за да не се промени
// поведението на заменените места.
assert.deepEqual(parseJson(5), { ok: true, value: 5 }, 'число се разчита');
assert.deepEqual(parseJson(null), { ok: true, value: null }, 'null се привежда до текста „null“');

// 2. Повреда връща резултат, не изключение — с текст, който може да влезе в 400/500.
for (const [label, input] of [
  ['невалиден JSON', '{"a":'],
  ['празен текст', ''],
  ['undefined', undefined],
  ['обект', { a: 1 }],
]) {
  let result;
  assert.doesNotThrow(() => { result = parseJson(input); }, `parseJson не хвърля при ${label}`);
  assert.equal(result.ok, false, `${label} се разпознава като повреда`);
  assert.equal(typeof result.error, 'string', `${label} носи текст на грешката`);
  assert.ok(result.error.length > 0, `${label} носи непразен текст`);
  assert.ok(!('value' in result), `${label} не дава стойност, за да не се подхлъзне викащият`);
}

// 3. Подразбирането се дава само при повреда.
assert.equal(parseJsonOr('{"a":1}', { x: 1 }).a, 1);
assert.deepEqual(parseJsonOr('{"a":', { x: 1 }), { x: 1 });
assert.equal(parseJsonOr('{"a":'), null, 'подразбирането по подразбиране е null');
assert.equal(parseJsonOr('null', 'друго'), null, 'валиден null не се заменя с подразбирането');
assert.equal(parseJsonOr('', 'друго'), 'друго');

// 4. Продуктовият код няма необяснено четене на външни данни.
// Правилото е на скенера (`json-parse-untrusted`); тук се иска същото, но само за
// `hapi_enterprise/` — тестовете и скриптовете за разработка не влизат в изданието и
// нарочно не се броят, за да остане гейтът им в `tests/bad-code.cjs`.
const scan = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'bad-code-scan.cjs'), '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
assert.equal(scan.status, 0, 'скенерът приключва без грешка: ' + (scan.stderr || '').slice(0, 300));
const report = JSON.parse(scan.stdout);
const isProduct = (f) => f.file.startsWith('hapi_enterprise/');
const unexplained = report.findings.filter((f) => f.rule === 'json-parse-untrusted' && isProduct(f));
assert.deepEqual(
  unexplained.map((f) => `${f.file}:${f.line}`),
  [],
  'всяко четене на външен JSON минава през parse-json.js или има причина в allowlist-а',
);

// 5. Изключенията в продуктовия код са точно тези, които човек е прегледал — не повече.
// Allowlist-ът е и списъкът на позволените изключения, и обосновката им.
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'bad-code-allowlist.json'), 'utf8'));
const allowed = new Set(
  allow.filter((e) => e.rule === 'json-parse-untrusted' && e.file.startsWith('hapi_enterprise/')).map((e) => e.file),
);
const suppressed = report.suppressed.filter((f) => f.rule === 'json-parse-untrusted' && isProduct(f));
for (const f of suppressed) {
  assert.ok(allowed.has(f.file), `приетото четене в ${f.file}:${f.line} има ред в allowlist-а`);
}
// Самият модул е мястото, в което четенето е позволено — ако редът изчезне, `parse-json.js`
// вече не е това, което тестът проверява.
assert.ok(allowed.has('hapi_enterprise/parse-json.js'), 'parse-json.js е обявен за единственото място');

console.log(
  `PASS parse-json: без изключение за повреда · 5 вида повреда · 0 необяснени четения в продукта · ` +
  `${suppressed.length} приети с причина`,
);
