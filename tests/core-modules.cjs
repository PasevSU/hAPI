'use strict';
// ГЛОБАЛНИТЕ ФУНКЦИИ СА КОМПОНЕНТИ — БЕЗ ТВЪРДО ВПИСАН СПИСЪК (0.69.223).
//
// Заявката на собственика: „изгради и глобални функции на същия принцип като server.js, но с
// името core.js, и там са всички кодове, които се използват многократно — като този за
// създаване на QR, API…“.
//
// Тестът пази СВОЙСТВАТА на договора, не наличието на папка:
//   1. зареждат се ВСИЧКИ `*.js` от `core_module/`, в предвидим ред, без нито един вписан в
//      `core.js` (проверява се с временна папка, която не съществува в хранилището);
//   2. счупен модул е грешка при СТАРТ — без `create`, без `fn`, стойност в `fn`, която не е
//      функция, две еднакви имена и невалидно име на файл;
//   3. `core.api` е ЗАМРАЗЕН: глобалният слой не се украсява по време на изпълнение;
//   4. функциите РАБОТЯТ: `qr.svg` дава истински SVG, `address.contract` — истинския договор;
//   5. никой вече не вика `qr-svg`/`portal-links` напряко: `server.js` и двата маршрута минават
//      през глобалния слой (иначе „глобална функция“ е само още един `require`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, ELIGIBLE } = require(path.join(__dirname, '..', 'hapi_enterprise', 'core.js'));

const root = path.join(__dirname, '..');
const dir = path.join(root, 'hapi_enterprise', 'core_module');
const read = (file) => fs.readFileSync(path.join(root, 'hapi_enterprise', file), 'utf8');
const coreSrc = read('core.js');
const serverSrc = read('server.js');

// ── 1. Папката има модули и всеки спазва договора ───────────────────────────
const files = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && ELIGIBLE.test(entry.name))
  .map((entry) => entry.name)
  .sort();
assert.ok(files.length >= 3, 'в core_module/ има поне три глобални функции (днес: ' + files.join(', ') + ')');
for (const file of files) {
  const mod = require(path.join(dir, file));
  assert.equal(typeof mod.create, 'function', `core_module/${file} изнася create(deps)`);
}

// ── 2. Зареждат се ВСИЧКИ, по име, без вписан списък ────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-core-'));
try {
  fs.writeFileSync(path.join(tmp, 'b-second.js'), 'module.exports.create = () => ({ name: "second", fn: { two: () => 2 } });', 'utf8');
  fs.writeFileSync(path.join(tmp, 'a-first.js'), 'module.exports.create = () => ({ name: "first", fn: { one: () => 1 } });', 'utf8');
  fs.writeFileSync(path.join(tmp, 'c-third.js'), 'module.exports.create = (deps, api) => ({ name: "third", fn: () => api.first.one() + api.second.two() });', 'utf8');
  fs.mkdirSync(path.join(tmp, 'sub'));
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x', 'utf8');
  const bundle = load({ dir: tmp, deps: {} });
  assert.deepEqual(bundle.names, ['first', 'second', 'third'], 'редът е по име на файл, а не по реда в диска');
  assert.equal(bundle.api.first.one(), 1, 'функцията се вика през core.api');
  assert.equal(bundle.api.third.run(), 3, 'един модул ПОЛЗВА друг през подадения `api` (1 + 2), а не с втори require');
  assert.equal(bundle.has('second'), true, 'has() вижда модула');
  assert.equal(bundle.has('nope'), false, 'has() не лъже за липсващ модул');
  assert.throws(() => bundle.get('nope'), /няма глобална функция „nope“ \(има: first, second, third\)/, 'get() обяснява какво има');
  assert.ok(Object.isFrozen(bundle.api), 'core.api е замразен');
  assert.ok(Object.isFrozen(bundle.api.first), 'отделният модул също е замразен');
  assert.throws(() => { bundle.api.fourth = {}; }, TypeError, 'нов модул не се добавя по време на изпълнение');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 3. Счупен модул не се премълчава (всяка проба — в СВОЯ папка) ───────────
// `require` кешира по ПЪТ, не по съдържание: пренаписан файл в същата папка връща ПЪРВИЯ модул.
const probe = (name, source) => {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-corebad-'));
  fs.writeFileSync(path.join(made, name), source, 'utf8');
  try {
    return () => load({ dir: made, deps: {} });
  } finally {
    queueMicrotask(() => fs.rmSync(made, { recursive: true, force: true }));
  }
};
assert.throws(probe('a.js', 'module.exports = {};'), /липсва create/, 'файл без create е грешка при старт');
assert.throws(probe('a.js', 'module.exports.create = () => ({});'), /трябва да върне \{ fn \}/, 'create без fn е грешка при старт');
assert.throws(
  probe('a.js', 'module.exports.create = () => ({ name: "x", fn: { notAFunction: 5 } });'),
  /не е функция/,
  'стойност, която не е функция, е грешка при старт — глобалният слой държи само извикваем код',
);
assert.throws(probe('a.js', 'module.exports.create = () => ({ name: "x", fn: {} });'), /нито една функция/, 'модул без нито една функция не е глобална функция');
const misnamed = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-corename-'));
try {
  fs.writeFileSync(path.join(misnamed, 'Qr.js'), 'module.exports.create = () => ({ fn: { svg: () => "" } });', 'utf8');
  fs.writeFileSync(path.join(misnamed, 'api_docs.js'), 'module.exports.create = () => ({ fn: { x: () => 0 } });', 'utf8');
  assert.throws(
    () => load({ dir: misnamed, deps: {} }),
    /НЕ се зареждат(?=[\s\S]*Qr\.js)(?=[\s\S]*api_docs\.js)/,
    'невалидните имена спират старта и се ИЗБРОЯВАТ (същото правило като server_module/, DEF-72)',
  );
} finally {
  fs.rmSync(misnamed, { recursive: true, force: true });
}
const dup = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-coredup-'));
try {
  fs.writeFileSync(path.join(dup, 'a.js'), 'module.exports.create = () => ({ name: "same", fn: { f: () => 1 } });', 'utf8');
  fs.writeFileSync(path.join(dup, 'b.js'), 'module.exports.create = () => ({ name: "same", fn: { g: () => 2 } });', 'utf8');
  assert.throws(() => load({ dir: dup, deps: {} }), /едно и също име/, 'две глобални функции с едно име са грешка');
} finally {
  fs.rmSync(dup, { recursive: true, force: true });
}

// ── 4. Функциите РАБОТЯТ, не са само обвивка ────────────────────────────────
const live = load({
  dir,
  deps: { links: require(path.join(root, 'hapi_enterprise', 'links.js')) },
});
const portal = {
  id: 'p-1',
  slug: 'demo',
  title: 'Демо',
  visibility: 'public',
  storage_root: '/share/demo',
  files: [{ id: 'f1', name: 'a.pdf', size: 10, listed: true }],
};

const svg = live.api.qr.svg('https://example.test/p/demo');
assert.match(svg, /^<svg[\s>]/, 'qr.svg дава истински SVG');
assert.match(svg, /<\/svg>\s*$/, 'SVG-то е затворено');
assert.equal(svg, live.api.qr.svg('https://example.test/p/demo'), 'един и същ адрес → един и същ код (детерминиран)');
assert.notEqual(svg, live.api.qr.svg('https://example.test/p/demo2'), 'друг адрес → друг код');
assert.equal(typeof live.api.qr.options().cellSize, 'number', 'options() дава настройките на рисуването');
assert.notEqual(live.api.qr.options(), live.api.qr.options(), 'options() връща копие — викащият не пипа настройките');

const contract = live.api.address.contract(portal, { base: 'https://hapi.test', accessQuery: '' });
assert.equal(contract.ready, true, 'договорът е готов още при създаването');
assert.equal(contract.page, 'https://hapi.test/p/p-1', 'страницата на портала — по id, както я строи links.portalLandingPath');
assert.equal(contract.api, 'https://hapi.test/api/v1/p/demo', 'API адресът е по slug');
assert.equal(contract.qr, 'https://hapi.test/api/v1/p/demo/qr.svg', 'QR адресът сочи портала');
assert.equal(contract.qrTarget, contract.page, 'QR кодът води до СТРАНИЦАТА, не до JSON');
assert.equal(contract.files.count, 1, 'файловете са преброени');
assert.equal(contract.files.empty, false, 'порталът с файл не е празен');
assert.equal(live.api.address.landingPath(portal), '/p/p-1', 'landingPath дава относителния път');
const empty = live.api.address.contract({ id: 'p-2', slug: 'empty', visibility: 'public', files: [] }, { base: 'https://hapi.test' });
assert.equal(empty.files.empty, true, 'празният портал пак има адреси — това е смисълът на договора');

// API документът е глобална функция, не `require` на три места в server.js.
const openapi = live.api['api-docs'].spec(portal, 'https://hapi.test');
assert.equal(typeof openapi.openapi, 'string', 'api-docs.spec дава OpenAPI документ');
assert.equal(openapi.servers[0].url, 'https://hapi.test', 'базовият адрес влиза в документа');
assert.ok(openapi.paths && Object.keys(openapi.paths).length > 0, 'документът има пътища');

// ── 5. Никой не заобикаля глобалния слой ───────────────────────────────────
// `core.js` не знае имена на модули; `server.js` зарежда папката, а не файл по файл.
assert.doesNotMatch(coreSrc, /core_module\/[a-z0-9-]+\.js/, 'core.js не вписва файл от core_module/');
assert.doesNotMatch(coreSrc, /\bqr\b\s*:\s*require/, 'core.js не знае кои функции има');
// DEF-78: и двете динамични папки ползват ЕДНО правило за име на файл (`module-folder.js`).
// Ако някой върне второ копие на `ELIGIBLE` в един от зареждащите модули, редът по-долу пада.
assert.match(coreSrc, /require\('\.\/module-folder'\)/, 'core.js ползва общото правило за име на файл');
assert.match(read('server-modules.js'), /require\('\.\/module-folder'\)/, 'server-modules.js ползва СЪЩОТО правило');
assert.doesNotMatch(coreSrc, /const ELIGIBLE = \//, 'core.js не държи второ копие на ELIGIBLE');
assert.match(
  serverSrc,
  /require\('\.\/core'\)\.load\(\{ dir: path\.join\(__dirname, 'core_module'\)/,
  'server.js зарежда папката през зареждащия модул',
);
assert.match(serverSrc, /core\.api\.qr\.svg\(/, 'server.js прави QR през глобалната функция');
assert.match(serverSrc, /core\.api\.address\.attach\(/, 'server.js строи договора за адресите през глобалната функция');
assert.match(serverSrc, /core\.api\.address\.contract\(/, 'и `api-info` минава през същата функция');
assert.match(serverSrc, /core\.api\.address\.landingPath\(/, 'и относителният път идва от слоя, а не от втори построител');
assert.match(serverSrc, /core\.api\['api-docs'\]\.spec\(/, 'OpenAPI документът минава през глобалната функция');
assert.doesNotMatch(serverSrc, /require\('\.\/qr-svg'\)/, 'server.js вече не вика qr-svg напряко');
assert.doesNotMatch(serverSrc, /require\('\.\/portal-links'\)/, 'server.js вече не вика portal-links напряко');
assert.doesNotMatch(serverSrc, /require\('\.\/api-spec'\)/, 'server.js вече не вика api-spec напряко');
assert.doesNotMatch(
  serverSrc,
  /require\('\.\/api-registry'\)\.create\(/,
  'api-registry се строи само през `core.api[\'api-docs\'].registry` — два построителя с различни опции бяха находка',
);
assert.match(serverSrc, /core\.api\['api-docs'\]\.registry\(/, 'регистърът на api/ минава през глобалната функция');
for (const route of ['routes/portal-storage.js', 'routes/portal-tokens.js']) {
  const source = read(route);
  assert.doesNotMatch(source, /require\('\.\.\/qr-svg'\)/, `${route} не рисува QR напряко — взема го от deps`);
  assert.doesNotMatch(source, /=\s*deps\.qrRender\s*\|\|/, `${route} няма резервен път: липсващият QR е грешка при сглобяване`);
  assert.match(source, /if \(!deps\.qrRender[\s\S]{0,80}throw new Error\(/, `${route} отказва да се сглоби без QR функция`);
}
assert.match(serverSrc, /qrRender: core\.api\.qr/, 'server.js подава глобалния QR на маршрутите като `qrRender`');
assert.doesNotMatch(serverSrc, /qrSvg: core\.api\.qr/, 'името `qrSvg` остава само за полето в отговора — не за функции');

console.log(
  `PASS core-modules: ${files.length} глобални функции (${live.names.join(', ')}) · зареждат се ВСИЧКИ *.js по име · ` +
    'счупен модул/невалидно име/двойно име/празен fn = грешка при старт · core.api е замразен · ' +
    'модул ползва друг през подадения api · QR, договорът и OpenAPI работят · ' +
    'server.js и двата маршрута минават през core, без резервен път',
);
