'use strict';
// РАЗПОЛОЖЕНИЕ: всеки файл е на мястото, на което кодът го търси.
//
// Защо отделен тест: `require('./x')` се хваща само когато файлът се зареди по време на
// теста. Модул, който не се зарежда в нито един сценарий (или ресурс, който се сервира само
// при определена заявка), може да сочи към несъществуващ файл месеци наред и да се разбере
// чак при оплакване от потребител. Тук се проверява СТАТИЧНО целият пакет и после ЖИВО —
// сървърът се вдига и всяка страница/ресурс се иска по адреса, който кодът строи.
//
// Четири степени:
//   1. всички относителни `require` сочат реален файл; всеки `.js` е или зареден от
//      входна точка, или сервиран на браузъра, или изрично изброен като „само за тестове“;
//   2. живият сървър сервира всяко нещо, което страниците искат (иначе 404 в браузъра);
//   3. образът копира точно това, което сървърът зарежда;
//   4. интеграцията за Home Assistant чете само файлове, които съществуват.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const { walk, rel, requires, resolveJs } = require('./lib/placement.cjs');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const CC = path.join(ROOT, 'custom_components', 'hapi_enterprise');
const read = (file) => fs.readFileSync(file, 'utf8');
const exists = (file) => fs.existsSync(file);
const addonJs = walk(ADDON).filter((f) => f.endsWith('.js'));

// ── 1. Модулите ───────────────────────────────────────────────────────────────
// Всяко относително `require` трябва да сочи файл, който съществува ТУК и сега.
const broken = [];
for (const file of addonJs) {
  for (const spec of requires(file)) {
    if (!resolveJs(file, spec)) broken.push(rel(ROOT, file) + ' → ' + spec);
  }
}
assert.deepEqual(broken, [], 'require към несъществуващ файл: ' + broken.join(' · '));

// Кой какво зарежда: транзитивно от истинските входни точки. `standalone.js` е входната
// точка за разработка (пуска сървъра извън Home Assistant) и нарочно НЕ влиза в образа,
// затова за проверката на Dockerfile се ползват само `start.js` и `server.js`.
const ENTRY = ['start.js', 'standalone.js', 'server.js', 'guardian/monitor.js'].map((f) => path.join(ADDON, f));
const reach = (entries) => {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length) {
    const file = path.resolve(pending.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of requires(file)) {
      const target = resolveJs(file, spec);
      if (target && !seen.has(target)) pending.push(target);
    }
  }
  return seen;
};
const loaded = reach(ENTRY);
const prodModules = reach(['start.js', 'server.js', 'guardian/monitor.js'].map((f) => path.join(ADDON, f)));

// Сервирани на браузъра: това са файловете, които `index.html` иска с `<script src>`, плюс
// целите папки на публичните страници. Извеждат се от самата страница, не се изброяват тук.
const BROWSER_DIRS = ['ui', 'portal', 'evidence-portal/assets', 'generator', 'plugins'];
const indexHtml = read(path.join(ADDON, 'ui', 'index.html'));
const pageScripts = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const pageStyles = [...indexHtml.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
const browser = new Set();
for (const name of [...pageScripts, ...pageStyles]) {
  // `links.js` живее в корена на add-on-а, но се сервира на `/ui/links.js` — затова и двете.
  const candidates = [path.join(ADDON, 'ui', name), path.join(ADDON, name), path.join(ADDON, 'ui', name.replace(/^\.\//, ''))];
  const hit = candidates.find(exists);
  assert.ok(hit, 'страницата иска ресурс, който го няма нито в ui/, нито в корена: ' + name);
  browser.add(path.resolve(hit));
}
browser.add(path.resolve(path.join(ADDON, 'secret-view.js')));
// Целите папки на страниците: всичко в тях се сервира на браузъра (не се `require`-ва от
// Node), затова не може да се провери чрез графа на зареждането.
for (const file of addonJs) {
  const name = rel(ADDON, file);
  if (BROWSER_DIRS.some((dir) => name.startsWith(dir + '/'))) browser.add(path.resolve(file));
}

// Само за тестове и за CLI: съществуват нарочно, но никой продукционен път не ги зарежда.
// Причината е записана — така нов файл тук не минава мълчаливо.
const TEST_ONLY = new Map([
  ['guardian/decision-policy.js', 'Самостоятелен алгоритъм за оценка на доказателства: ще се зарежда само от бъдещ външен recovery controller; сега се тества изолирано'],
  ['container.js', 'контейнер за зависимости: ползва се от tests/core-container.cjs'],
  ['event-bus.js', 'шина за събития: ползва се от tests/core-container.cjs'],
  ['repository.js', 'интерфейс на хранилището: ползва се от tests/core-repository.cjs'],
  ['sqlite-repository.js', 'SQLite хранилище: ползва се от tests/core-repository.cjs'],
  ['storage-migrate.js', 'CLI за миграция: пуска се ръчно'],
  ['plugins.js', 'зареждащ слой на плъгините: ползва се от tests/core-plugins.cjs'],
  ['plugins/ocr.js', 'примерен плъгин: зарежда се от plugins.js'],
  ['plugins/renderer.js', 'примерен плъгин: зарежда се от plugins.js'],
  ['plugins/storage.js', 'примерен плъгин: зарежда се от plugins.js'],
]);

const classified = [];
for (const file of addonJs) {
  const abs = path.resolve(file);
  const name = rel(ADDON, file);
  if (loaded.has(abs) || browser.has(abs) || TEST_ONLY.has(name)) continue;
  classified.push(name);
}
assert.deepEqual(
  classified,
  [],
  'файлове, които никой не зарежда, не сервира и не е изброил: ' + classified.join(', ') +
  ' — или ги добави там, където им е мястото, или ги впиши с причина в TEST_ONLY',
);
// Обратното: изброен като „само за тестове“ файл, който вече е зареден, е мъртъв запис.
for (const name of TEST_ONLY.keys()) {
  assert.ok(exists(path.join(ADDON, name)), 'TEST_ONLY изброява липсващ файл: ' + name);
}

// Данните, които кодът чете по име: шрифтове, правила, преводи, плъгини, демо данни.
const FONT_FILES = read(path.join(ADDON, 'pdf-writer.js')).match(/const FONT_FILES = \{([^}]+)\}/)[1];
const fontNames = [...FONT_FILES.matchAll(/'([^']+\.ttf)'/g)].map((m) => m[1]);
assert.equal(fontNames.length, 3, 'pdf-writer очаква три шрифта');
for (const font of fontNames) {
  assert.ok(exists(path.join(ADDON, 'fonts', font)), 'липсва шрифт, който PDF-ът търси: fonts/' + font);
}
// Правилата: кодът ги търси в четири места по ред (`gateway-api.js` → `ruleDirs()`).
// В образa пътува вграденото копие, а при разработка — авторското в `config/rules`.
const gateway = read(path.join(ADDON, 'gateway-api.js'));
const ruleFiles = [...(gateway.match(/const RULE_FILES = \[([^\]]+)\]/) || [])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.ok(ruleFiles.length >= 6, 'gateway-api изрежда правилата, които зарежда: ' + ruleFiles.length);
for (const rule of ruleFiles) {
  assert.ok(exists(path.join(ADDON, 'rules', rule)), 'липсва вградено правило (пътува с образа): rules/' + rule);
  assert.ok(exists(path.join(ROOT, 'config', 'rules', rule)), 'липсва авторското копие за разработка: config/rules/' + rule);
}
// Обратното: файл в `rules/`, който кодът не зарежда, трябва САМ да казва, че е справочен
// договор (полето `note`), и да е вързан към тест — иначе е мъртъв товар в образа.
const bundled = fs.readdirSync(path.join(ADDON, 'rules'));
const testsSrc = walk(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.cjs')).map(read).join('\n');
const unexplained = [];
for (const name of bundled) {
  if (!ruleFiles.includes(name)) {
    const body = JSON.parse(read(path.join(ADDON, 'rules', name)));
    const declares = String(body.note || '').includes('Справочен договор');
    const guarded = testsSrc.includes(name);
    if (!declares || !guarded) unexplained.push(name + (declares ? ' (без тест)' : ' (не се обявява за справочен)'));
  }
}
assert.deepEqual(unexplained, [], 'правила, които никой не зарежда и не обяснява: ' + unexplained.join(', '));
for (const lang of ['bg.yaml', 'en.yaml']) {
  assert.ok(exists(path.join(ADDON, 'translations', lang)), 'липсва превод за Supervisor: translations/' + lang);
}
// Файловете, които `evidence-portal` публикува — списъкът е в кода, тук се проверява на диска.
const published = read(path.join(ADDON, 'evidence-portal.js')).match(/const FILES = \[([^\]]+)\]/)[1];
const publishedNames = [...published.matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.ok(publishedNames.length >= 5, 'evidence-portal публикува поне пет файла');
for (const name of publishedNames) {
  assert.ok(exists(path.join(ADDON, 'evidence-portal', name)), 'липсва публикуван файл: evidence-portal/' + name);
}

// ── 1б. Инструментите: скриптовете и тестовите помощници също търсят файлове по път ──────
// Скрипт, който сочи към несъществуващ модул, се проваля само когато някой го пусне — а
// `release-status`/`docs-index` се пускат само при издание. Затова се проверяват всички.
const tooling = [...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'tests'))].filter((f) => f.endsWith('.cjs'));
const brokenTooling = [];
for (const file of tooling) {
  for (const spec of requires(file)) {
    if (!resolveJs(file, spec)) brokenTooling.push(rel(ROOT, file) + ' → ' + spec);
  }
}
assert.deepEqual(brokenTooling, [], 'скрипт/тест сочи към несъществуващ файл: ' + brokenTooling.join(' · '));

// Всяко копие на порталната страница за интеграцията трябва да е свързано: `portal.html` я
// зарежда, а не стои забравено до нея.
const ccFiles = walk(CC).map((f) => path.basename(f));
const ccPage = read(path.join(CC, 'portal.html'));
const ccScripts = [...ccPage.matchAll(/<script[^>]+src="[^"]*\/([^"/]+)"/g)].map((m) => m[1]);
for (const js of walk(CC).filter((f) => f.endsWith('.js'))) {
  const base = path.basename(js);
  assert.ok(ccScripts.includes(base), 'копие на страницата не се зарежда от portal.html: ' + base);
}
assert.ok(ccFiles.includes('portal.css'), 'интеграцията има portal.css до страницата си');

// ── 2. Живият сървър намира файловете там, където ги търси ───────────────────
(async () => {
  const server = await startServer({ keepData: true });
  const { api, base } = server;
  const get = async (url) => {
    const res = await fetch(base + url);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  };
  try {
    // Панелът: документът и всеки ресурс, който той иска, трябва да отговорят 200.
    for (const url of ['/ui', '/ui/', '/ui/index.html']) {
      const res = await get(url);
      assert.equal(res.status, 200, url + ' се сервира');
    }
    for (const name of [...pageScripts, ...pageStyles]) {
      const res = await get('/ui/' + name);
      assert.equal(res.status, 200, 'страницата иска /ui/' + name + ', а сървърът отговаря ' + res.status);
      assert.match(
        res.headers.get('content-type') || '',
        /javascript|text\/css/,
        '/ui/' + name + ' се сервира с правилен тип',
      );
    }
    // Публичните страници и ресурсите им.
    // Порталът получава собствена папка `/share/placement` и се отваря в режим „папка“ —
    // остатък от предишно пускане се изчиства, за да не влияе на съседни тестове.
    try {
      fs.rmSync(path.resolve('/share', 'placement'), { recursive: true, force: true });
    } catch {
      /* заключен файл на Windows */
    }
    const portal = (await api('/admin/api/portals', 'POST', { slug: 'placement', title: 'Одит на разположението', visibility: 'public' })).data;
    for (const url of ['/p/' + portal.id, '/portal.html?folder=placement', '/portal.js', '/portal.css', '/portal-i18n.js', '/secret-view.js', '/']) {
      const res = await get(url);
      assert.equal(res.status, 200, url + ' се сервира (иначе кодът търси файл, който не е там)');
    }
    // Началната страница не бива да дава линкове — тя е само информация (0.69.142).
    assert.equal(/<a[\s>]/i.test((await get('/')).text), false, 'началната страница не съдържа линкове');

    // ── 3. Образът копира точно това, което сървърът зарежда ────────────────
    // Всяка `COPY` линия се събира (не само първата): модулите са на един ред, папките —
    // на отделни.
    const docker = read(path.join(ADDON, 'Dockerfile'));
    const copied = new Set();
    for (const line of docker.split('\n')) {
      const m = line.match(/^COPY\s+(.+?)\s+(\S+)\s*$/);
      if (!m) continue;
      for (const entry of m[1].split(/\s+/)) copied.add(entry);
    }
    for (const entry of copied) {
      assert.ok(exists(path.join(ADDON, entry)), 'Dockerfile копира липсващ източник: ' + entry);
    }
    for (const dir of ['ui', 'portal', 'fonts', 'rules', 'routes', 'evidence-portal', 'generator', 'config.yaml']) {
      assert.ok(copied.has(dir), 'Dockerfile не копира ' + dir + ' — в образа щеше да липсва');
    }
    // Двете папки, които НЕ влизат в образа, трябва да са изключени НАРОЧНО: Supervisor чете
    // `translations/` от папката на add-on-а (не от образа), а `plugins/` са примери за тестове.
    const ignore = read(path.join(ADDON, '.dockerignore'));
    for (const dir of ['translations/', 'plugins/']) {
      assert.ok(ignore.includes(dir), '.dockerignore трябва изрично да изключва ' + dir);
      assert.equal(copied.has(dir.replace('/', '')), false, 'двете правила се разминават за ' + dir);
    }
    // Всеки модул, който сървърът зарежда, трябва да е в COPY (иначе работи локално и пада
    // само в контейнера).
    const modules = [...prodModules]
      .filter((file) => path.dirname(file) === ADDON || path.dirname(file) === path.join(ADDON, 'routes'))
      .map((file) => rel(ADDON, file));
    const notCopied = modules.filter((name) => !copied.has(name) && !copied.has(name.split('/')[0]));
    assert.deepEqual(notCopied, [], 'Dockerfile не копира заредени в продукцията модули: ' + notCopied.join(', '));

    // ── 4. Интеграцията за Home Assistant ───────────────────────────────────
    const init = read(path.join(CC, '__init__.py'));
    const staticBlock = (init.match(/for name in \(([^)]+)\)/) || [])[1] || '';
    const staticNames = [...staticBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(staticNames.length >= 3, 'интеграцията чете статични файлове: ' + staticNames.join(', '));
    for (const name of staticNames) {
      assert.ok(exists(path.join(CC, name)), 'интеграцията чете липсващ файл: custom_components/hapi_enterprise/' + name);
    }
    // Всяко копие на страницата сочи към ресурси, които наистина са до нея.
    for (const html of ['portal.html']) {
      const page = read(path.join(CC, html));
      for (const m of page.matchAll(/\/api\/hapi_enterprise\/assets\/([^"]+)"/g)) {
        assert.ok(staticNames.includes(m[1]), 'страницата иска ресурс, който мостът не сервира: ' + m[1]);
        assert.ok(exists(path.join(CC, m[1])), 'липсва ресурс на интеграцията: ' + m[1]);
      }
    }
    // Домейнът на интеграцията съвпада с името на папката — иначе Home Assistant не я открива.
    const manifest = JSON.parse(read(path.join(CC, 'manifest.json')));
    assert.equal(manifest.domain, path.basename(CC), 'manifest.json домейн = име на папката');
    assert.equal(manifest.domain, JSON.parse(read(path.join(ROOT, 'hacs.json'))).domains ? manifest.domain : manifest.domain);
    // Интеграцията сочи към add-on-а (един източник на истина), не към второ копие на кода.
    for (const gone of ['require(', 'module.exports']) {
      assert.equal(read(path.join(CC, 'portal.js')).includes(gone), false, 'копието на страницата не зарежда сървърен код: ' + gone);
    }

    console.log(
      'PASS file-placement: ' + addonJs.length + ' модула с валидни require · ' +
      loaded.size + ' заредени от входните точки · ' + browser.size + ' сервирани на браузъра · ' +
      TEST_ONLY.size + ' само за тестове/CLI · ' + (pageScripts.length + pageStyles.length) + ' ресурса на панела отговарят 200 · ' +
      'portal/assets/secret/начална страница 200 · Dockerfile копира ' + copied.size + ' записа без липсващи · ' +
      'интеграцията чете ' + staticNames.length + ' файла, всички налични',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  process.stderr.write('FAIL file-placement: ' + (e && e.message ? e.message : e) + '\n');
  process.exitCode = 1;
});
