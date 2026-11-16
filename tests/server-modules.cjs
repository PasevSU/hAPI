'use strict';
// ВСЕКИ ФАЙЛ В `server_module/` Е КОМПОНЕНТ — БЕЗ ТВЪРДО ВПИСАН СПИСЪК (0.69.220).
//
// Заявката на собственика: „server.js да обединява множество компоненти (отделни js), за да
// се фокусира към стабилни сегменти; да зарежда всички js файлове от папка `server_module/`,
// без твърдо вписани файлове — просто всички на принципа `*.js`“.
//
// Тестът пази СВОЙСТВАТА на този договор, а не наличието на папка:
//   1. зареждат се ВСИЧКИ `*.js` от папката, в предвидим ред (по име), без нито един вписан
//      в `server.js` — проверява се и с временна папка с три файла, които не съществуват в
//      хранилището (тоест „някой е дописал списък“ не минава);
//   2. счупен компонент е ГРЕШКА ПРИ СТАРТ, не тихо пропуснат (иначе 404, който никой не
//      свързва с папката);
//   3. диспечерът спира на първия, който е приключил заявката (един маршрут = един отговор);
//   4. `server.js` НЕ съдържа име на компонент — нито път, нито файл от `server_module/`;
//   5. компонентът за публичната страница (`portal-landing.js`) съществува и `server.js`
//      вика диспечера, а не носи самия маршрут.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, ELIGIBLE } = require(path.join(__dirname, '..', 'hapi_enterprise', 'server-modules.js'));

const root = path.join(__dirname, '..');
const dir = path.join(root, 'hapi_enterprise', 'server_module');
const serverSrc = fs.readFileSync(path.join(root, 'hapi_enterprise', 'server.js'), 'utf8');

// ── 1. Папката има компоненти и всеки спазва договора ───────────────────────
const files = fs.readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && ELIGIBLE.test(entry.name))
  .map((entry) => entry.name)
  .sort();
assert.ok(files.length >= 1, 'в server_module/ има поне един компонент');
for (const file of files) {
  const mod = require(path.join(dir, file));
  assert.equal(typeof mod.create, 'function', `server_module/${file} изнася create(host)`);
}

(async () => {
  // ── 2. Зареждат се ВСИЧКИ, по име, без вписан списък ────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-modules-'));
  try {
    for (const name of ['b-second.js', 'a-first.js', 'c-third.js']) {
      fs.writeFileSync(
        path.join(tmp, name),
        `module.exports.create = () => ({ name: ${JSON.stringify(name)}, handle: () => { (globalThis.__hapiModuleSeen ||= []).push(${JSON.stringify(name)}); return false; } });\n`,
        'utf8',
      );
    }
    // Не-компоненти: подпапка, текстови файл — не се зареждат и не се броят за грешка.
    // (Файл с невалидно ИМЕ вече е грешка — виж §3б.)
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x', 'utf8');
    globalThis.__hapiModuleSeen = [];
    const bundle = load({ dir: tmp, host: {} });
    assert.deepEqual(bundle.order, ['a-first.js', 'b-second.js', 'c-third.js'], 'редът е по име, а не по реда в диска');
    const handled = await bundle.handle({});
    assert.equal(handled, false, 'нито един не е приключил заявката → диспечерът връща false');
    assert.deepEqual(globalThis.__hapiModuleSeen, ['a-first.js', 'b-second.js', 'c-third.js'], 'извикани са ВСИЧКИ компоненти, без изключение');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete globalThis.__hapiModuleSeen;
  }

  // ── 3б. Файл с невалидно ИМЕ не се премълчава (DEF-72) ─────────────────────
  // Дотук `ELIGIBLE` просто го прескачаше: файлът изглежда като компонент, а маршрутът
  // му дава 404 — по-лошо от липсващ файл, защото никой не го търси.
  const misnamed = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-name-'));
  try {
    fs.writeFileSync(path.join(misnamed, 'Good.js'), 'module.exports.create = () => ({ handle: () => false });', 'utf8');
    fs.writeFileSync(path.join(misnamed, 'under_score.js'), 'module.exports.create = () => ({ handle: () => false });', 'utf8');
    assert.throws(() => load({ dir: misnamed, host: {} }), /НЕ се зареждат.*Good\.js.*under_score\.js/, 'невалидните имена спират старта и се ИЗБРОЯВАТ');
  } finally {
    fs.rmSync(misnamed, { recursive: true, force: true });
  }

  // ── 3. Счупен компонент не се премълчава ────────────────────────────────────
  // Всяка проверка е в СВОЯ папка: `require` кешира по път и пренаписан файл не се презарежда.
  const broken = (source) => {
    const made = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-bad-'));
    fs.writeFileSync(path.join(made, 'a.js'), source, 'utf8');
    try {
      return () => load({ dir: made, host: {} });
    } finally {
      // папката се трие от викащия, след като `load` хвърли
      queueMicrotask(() => fs.rmSync(made, { recursive: true, force: true }));
    }
  };
  assert.throws(broken('module.exports = { } ;'), /липсва create/, 'файл без create е грешка при старт');
  assert.throws(broken('module.exports.create = () => ({});'), /трябва да върне \{ handle/, 'create без handle е грешка при старт');
  const dup = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-dup-'));
  try {
    fs.writeFileSync(path.join(dup, 'a.js'), 'module.exports.create = () => ({ name: "same", handle: () => false });', 'utf8');
    fs.writeFileSync(path.join(dup, 'b.js'), 'module.exports.create = () => ({ name: "same", handle: () => false });', 'utf8');
    assert.throws(() => load({ dir: dup, host: {} }), /едно и също име/, 'две компоненти с едно име са грешка');
  } finally {
    fs.rmSync(dup, { recursive: true, force: true });
  }

  // ── 4. Диспечерът спира на първия, който е приключил заявката ───────────────
  const chain = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-chain-'));
  try {
    fs.writeFileSync(path.join(chain, 'a.js'), 'module.exports.create = () => ({ handle: () => { globalThis.__c = (globalThis.__c || 0) + 1; return true; } });', 'utf8');
    fs.writeFileSync(path.join(chain, 'b.js'), 'module.exports.create = () => ({ handle: () => { globalThis.__c = (globalThis.__c || 0) + 100; return true; } });', 'utf8');
    globalThis.__c = 0;
    const bundle = load({ dir: chain, host: {} });
    assert.equal(await bundle.handle({}), true, 'заявката е приключена');
    assert.equal(globalThis.__c, 1, 'вторият компонент НЕ се пита, след като първият е отговорил');
  } finally {
    fs.rmSync(chain, { recursive: true, force: true });
    delete globalThis.__c;
  }

// ── 5. `server.js` не знае имената на компонентите ─────────────────────────
assert.doesNotMatch(serverSrc, /server_module\/[a-z0-9-]+\.js/, 'server.js не вписва файл от server_module/');
assert.doesNotMatch(serverSrc, /\bportal-landing\b/, 'server.js не знае името на компонента за страницата');
assert.match(
  serverSrc,
  /require\('\.\/server-modules'\)\.load\(\{ dir: path\.join\(__dirname, 'server_module'\)/,
  'server.js зарежда папката през зареждащия модул',
);
assert.match(serverSrc, /if \(await serverModules\.handle\(\{ req, res, url, parts, method \}\)\) return;/, 'заявките минават през диспечера на компонентите');

// Компонентът за публичната страница е част от изданието и не носи база в себе си.
const landing = fs.readFileSync(path.join(dir, 'portal-landing.js'), 'utf8');
assert.match(landing, /name: 'portal-landing'/, 'компонентът се представя с име');
assert.match(landing, /portalPageFile/, 'пътят до portal.html идва от host, не се гадае');
assert.doesNotMatch(landing, /process\.env/, 'компонентът не чете среда — адресите идват през links/baseUrl');

// ── 5б. Компонент не поема административен маршрут (DEF-73) ─────────────────
// Два договора за едно място: `routes/` е за HTTP договора на `/admin/api` (влиза СЛЕД
// проверката за самоличност), а `server_module/` — за публични/статични сегменти, които се
// диспечират ПРЕДИ нея. Ако компонент отговаря на `/admin/api/…`, той заобикаля `adminGate`.
// Проверява се на живо: всеки реален компонент се пита с административна заявка и трябва
// да върне `false`.
  const liveBundle = load({
    dir,
    host: {
      links: require(path.join(__dirname, '..', 'hapi_enterprise', 'links.js')),
      baseUrl: () => 'http://127.0.0.1:1',
      htmlEsc: (s) => String(s),
      fail: (res, code) => res.end(String(code)),
      portalPolicy: { decide: () => ({ allowed: true }) },
      resolvePortal: () => null,
      portalArchive: { sendClosed: () => false },
      recordTelemetry: () => {},
      portalRoot: () => '/share',
      portalSkin: { stylesheet: () => '' },
      portalDir: path.join(root, 'hapi_enterprise', 'portal'),
      portalPageFile: path.join(root, 'hapi_enterprise', 'portal', 'portal.html'),
    },
  });
  const adminUrl = new URL('http://127.0.0.1:1/admin/api/portals');
  for (const component of liveBundle.components) {
    const handled = await liveBundle.handle({
      req: { headers: {}, socket: {} },
      res: { writeHead() {}, end() {} },
      url: adminUrl,
      parts: ['admin', 'api', 'portals'],
      method: 'GET',
    });
    assert.equal(handled, false, `компонент „${component.name}“ пое административен маршрут — там се влиза САМО през routes/ и adminGate`);
  }

  // Съобщението се печата СЛЕД всички проверки (включително асинхронните): иначе „PASS“
  // излиза преди тях и тестът изглежда зелен, докато още не е проверил нищо.
  console.log(
    `PASS server-modules: ${files.length} компонента в server_module/ · зареждат се ВСИЧКИ *.js по име · ` +
      'счупен компонент = грешка при старт · невалидно име = грешка при старт · диспечерът спира на първия · ' +
      'нито един не поема /admin/api · server.js не вписва имена',
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
