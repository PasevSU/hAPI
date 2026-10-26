'use strict';
// Страниците на add-on-а се сервират като статични файлове, тоест липсващ `<script src>` или
// `<link href>` не чупи нищо при пускане на тестовете — браузърът просто получава 404 и
// функцията липсва тихо. Затова всяка локална референция се сверява с диска, при това с
// уговорката, че add-on-ът сервира част от файловете от ДРУГА папка: `ui/index.html` зарежда
// `links.js`, който стои в корена на add-on-а и се сервира на `/ui/links.js` по allowlist-а
// `UI_FILES`. Проверка, която не знае това, би обявила работещ файл за липсващ (точно така
// стана при първия опит с този тест).
//
//   1. относителният път (`app.js`) се търси до самия HTML файл, а ако го няма там — приема се,
//      когато сървърът го сервира по allowlist-а;
//   2. абсолютният път (`/portal.css`) е маршрут на сървъра — трябва да съществува като файл в
//      `hapi_enterprise/portal/` И да е обявен изрично (`url.pathname === '/portal.css'`), за да
//      не се разминат двете страни при преименуване;
//   3. всяко име в allowlist-а `UI_FILES` има файл, иначе маршрутът води до нищо;
//   4. външни адреси, данни и шаблони (`{{…}}`) се прескачат — те не са файлове.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const SKIP_DIR = /[\\/](node_modules|dist|release|build|archive|\.git|coverage)[\\/]/;

const htmls = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP_DIR.test(full)) continue;
    if (entry.isDirectory()) walk(full);
    else if (/\.html$/i.test(entry.name)) htmls.push(full);
  }
};
walk(root);
assert.ok(htmls.length >= 5, `намерени са само ${htmls.length} HTML файла — счупен обход`);

// Кодът на сървъра, за да се свери, че абсолютните пътища са обявени маршрути, и за да се знае
// кои имена сервира allowlist-ът (`UI_FILES`).
const serverSources = [path.join(root, 'hapi_enterprise', 'server.js')];
for (const dir of ['routes']) {
  const full = path.join(root, 'hapi_enterprise', dir);
  if (fs.existsSync(full)) for (const name of fs.readdirSync(full)) if (/\.js$/.test(name)) serverSources.push(path.join(full, name));
}
const serverText = serverSources.filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// ── Allowlist-ът на сървъра — преди проверката на страниците ────────────────
// `UI_FILES` в `server.js` изброява какво сървърът сервира на `/ui/`, `/hapi_enterprise/` и
// `/generator/`. Точно затова `ui/index.html` може да зареди `links.js`, който стои в КОРЕНА на
// add-on-а: `/ui/links.js` се map-ва към него (специалният случай `f === 'links.js'`).
// Без тази част проверката би обявила работещ файл за липсващ.
const serverJs = fs.readFileSync(path.join(root, 'hapi_enterprise', 'server.js'), 'utf8');
const blockStart = serverJs.indexOf('const UI_FILES = (() => {');
assert.ok(blockStart > 0, 'блокът UI_FILES е намерен в server.js');
const block = serverJs.slice(blockStart, serverJs.indexOf('})();', blockStart));
const served = new Set();
const addServed = (raw) => {
  const name = String(raw).replace(/^.*\//, '');
  // Само имена на файлове: ключове като `/ui/` и `/generator/` сочат папка, не файл.
  if (/^[\w-]+(\.[\w-]+)+$/.test(name)) served.add(name);
};
// Имената се взимат САМО от масивите (`for (const f of [...])`) и от директните ключове
// (`files['/generator/app.js']`). Изразът за подравняване (`f === 'links.js' ? …`) НЕ се брои:
// иначе име, махнато от allowlist-а, пак изглежда „сервирано“ заради самото това сравнение.
for (const match of block.matchAll(/for \(const f of \[([^\]]+)\]/g)) {
  for (const name of match[1].matchAll(/'([\w./-]+)'/g)) addServed(name[1]);
}
for (const match of block.matchAll(/files\['([^']+)'\]/g)) addServed(match[1]);
assert.ok(served.size >= 20, `в allowlist-а са намерени само ${served.size} имена — счупен разбор`);

const problems = [];
const seen = new Set();
let refs = 0;
for (const file of htmls) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(https?:|data:|mailto:|#|\/api\/|\/admin|{{)/.test(target)) continue;
    const clean = target.split(/[?#]/)[0];
    if (!clean) continue;
    refs += 1;
    const key = `${rel} → ${clean}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (clean.startsWith('/')) {
      // Абсолютен път = маршрут на сървъра за портала. Файлът трябва да е там И маршрутът да е
      // обявен ИЗРИЧНО (`url.pathname === '/portal.css'`) — простото споменаване на низа не
      // стига, защото същият път се среща и в генериран HTML.
      const asset = path.join(root, 'hapi_enterprise', 'portal', clean.replace(/^\//, ''));
      if (!fs.existsSync(asset)) problems.push(`${rel} → ${clean} (няма такъв файл в hapi_enterprise/portal/)`);
      else if (!new RegExp(`url\\.pathname\\s*===\\s*['"]${clean.replace(/[/.]/g, '\\$&')}['"]`).test(serverText)) {
        problems.push(`${rel} → ${clean} (файлът е там, но маршрутът не е обявен в кода)`);
      }
      continue;
    }

    const resolved = path.join(path.dirname(file), clean);
    if (fs.existsSync(resolved)) continue;
    // Файлът може да е сервиран от allowlist-а на сървъра от друга папка (вж. `links.js`).
    if (served.has(path.basename(clean))) continue;
    problems.push(`${rel} → ${clean} (липсва файл до страницата и не е в UI_FILES)`);
  }
}
assert.deepEqual(problems, [], 'всяка локална референция в HTML трябва да сочи съществуващ файл');

// ── Всяко име в allowlist-а има файл ────────────────────────────────────────
const namesOnDisk = new Set();
const collect = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else namesOnDisk.add(entry.name);
  }
};
collect(path.join(root, 'hapi_enterprise'));
const dangling = [...served].filter((name) => !namesOnDisk.has(name));
assert.deepEqual(dangling, [], 'всяко име в UI_FILES трябва да съществува в hapi_enterprise/ (иначе маршрутът води до нищо)');

console.log(`html-assets: ${htmls.length} страници · ${refs} референции · ${seen.size} различни · ${served.size} имена в UI_FILES — наред`);
