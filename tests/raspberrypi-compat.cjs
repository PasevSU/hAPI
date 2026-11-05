'use strict';
// Сценарий: съвместимост с Raspberry Pi и други ARM машини.
//
// Това е договорът за хардуер — проверява се, че обещанието „работи на Pi“ не е
// само текст:
//   • `arch` в config.yaml съдържа точно поддържаните архитектури — само 64-битовите
//     (amd64, aarch64) — и НЕ обещава нито една от deprecated стойностите на Supervisor
//     (armv7, armhf, i386), нито armv6, за които Node 22 няма билд;
//   • Dockerfile-ът е архитектурно неутрален: официална multi-arch снимка без
//     `--platform`, без `apk add` и без `npm install` (всичко е Node built-in);
//   • package.json няма runtime зависимости → няма native модули за компилиране;
//   • `memory_limit_mb` съществува в опциите, schema и преводите и се превръща в
//     `--max-old-space-size` с валидация в start.js (малките машини не бива да падат в OOM);
//   • Node ≥ 22.13 гейтът (node:sqlite) важи еднакво за всички архитектури;
//   • документацията описва дъските, включително изключването на Pi Zero/1.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── 1. Архитектури в config.yaml ────────────────────────────────────────────
const cfg = read('hapi_enterprise/config.yaml');
const archBlock = /^arch:\n((?: {2}- .*\n| {2}# .*\n)+)/m.exec(cfg);
assert.ok(archBlock, 'config.yaml: липсва arch списък');
const arches = [...archBlock[1].matchAll(/^ {2}- ([a-z0-9]+)$/gm)].map((m) => m[1]);
assert.deepEqual(
  arches.sort(),
  ['aarch64', 'amd64'],
  `arch трябва да е точно 64-битовите amd64+aarch64, намерени: ${arches.join(',')}`,
);
// Supervisor: ARCH_ALL = [aarch64, amd64], ARCH_DEPRECATED = [armhf, armv7, i386]. Обещано
// deprecated значи warning при всяко зареждане на store-а и repair, ако е единственото.
for (const forbidden of ['armv7', 'armhf', 'i386', 'armv6']) {
  assert.ok(
    !arches.includes(forbidden),
    `${forbidden} е deprecated в Supervisor (или няма Node 22 билд) — не бива да се обещава`,
  );
}
assert.match(archBlock[0], /armhf[\s\S]{0,120}Pi Zero/i, 'коментарът в arch обяснява защо armhf липсва');
assert.match(archBlock[0], /ARCH_DEPRECATED|deprecated/i, 'коментарът в arch казва защо 32-bit отпада');

// ── 2. Dockerfile: архитектурно неутрален ───────────────────────────────────
const dockerfile = read('hapi_enterprise/Dockerfile');
const from = /^FROM\s+(\S+)/m.exec(dockerfile);
assert.ok(from, 'Dockerfile: липсва FROM');
assert.match(from[1], /^node:22\.\d+\.\d+-alpine/, `очаквам официална node:22-alpine снимка, намерено ${from[1]}`);
assert.ok(!/--platform=/.test(dockerfile), 'не се фиксира --platform (иначе снимката е само за една архитектура)');
assert.ok(!/--platform=\S*arm64\/v8/.test(dockerfile), 'без arm64/v8 фиксация');
assert.ok(!/^\s*RUN\s+.*\bapk\s+add\b/m.test(dockerfile), 'без apk пакети — те са архитектурно-зависими');
assert.ok(!/npm (install|ci)/.test(dockerfile), 'без npm install по време на билд');
assert.match(dockerfile, /linux\/arm64/, 'коментарът изброява поддържаните платформи');
assert.match(dockerfile, /Multi-arch/i, 'Dockerfile документира multi-arch основанието');

// ── 3. Без native зависимости ──────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.dependencies, undefined, 'runtime зависимости биха изисквали компилация за всяка архитектура');
assert.equal(pkg.optionalDependencies, undefined);
for (const key of Object.keys(pkg.devDependencies || {})) {
  assert.ok(!/sqlite|sharp|canvas|bcrypt/.test(key), `devDependency ${key} е native и чупи cross-build`);
}

// ── 4. memory_limit_mb: опция, schema, преводи, start.js ───────────────────
// Стойността по подразбиране НЕ е задължително 0: от 0.69.160 тя е 1024, за да съвпада с
// работещото разпределение (изданието се доставя с изпитаните стойности). Важното за Pi е
// стойността да е в разумен диапазон и документацията да казва кога да се смъкне до
// 256-384 на малка машина — иначе heap-ът може да надхвърли паметта на контейнера.
const memMatch = /^ {2}memory_limit_mb: (\d+)$/m.exec(cfg);
assert.ok(memMatch, 'опцията memory_limit_mb липсва в config.yaml');
const memDefault = Number(memMatch[1]);
assert.ok(
  memDefault === 0 || (memDefault >= 256 && memDefault <= 2048),
  `memory_limit_mb по подразбиране е ${memDefault} MB — допустимо е 0 (auto) или 256..2048`,
);
assert.match(cfg, /^ {2}memory_limit_mb: int\(0,8192\)\?$/m, 'schema трябва да ограничава 0..8192');
for (const lang of ['en', 'bg']) {
  const text = read(`hapi_enterprise/translations/${lang}.yaml`);
  assert.match(text, /^ {2}memory_limit_mb:$/m, `${lang}.yaml не покрива memory_limit_mb`);
  // Описанието трябва да казва и безопасния диапазон за малка машина.
  assert.match(text, /256-384/, `${lang}.yaml не споменава безопасния диапазон 256-384 за малки машини`);
}
// Entrypoint-ът е JS: опцията се чете от options.json и се превръща в NODE_OPTIONS.
const startJs = read('hapi_enterprise/start.js');
assert.match(startJs, /memory_limit_mb/, 'start.js не чете memory_limit_mb');
assert.match(startJs, /--max-old-space-size=/, 'start.js не подава --max-old-space-size');
assert.match(startJs, /memoryMb < 64/, 'start.js трябва да пази долна граница 64 MB');
assert.match(startJs, /8192/, 'start.js трябва да пази горна граница 8192 MB');
assert.match(startJs, /memory_limit_mb must be a whole number/, 'start.js трябва да отхвърля нечислови стойности');
// Гейтът за Node остава преди всичко останало и е един и същ за всички архитектури.
assert.match(startJs, /requires Node\.js >=22\.13/, 'липсва Node >=22.13 гейтът (node:sqlite)');

// ── 5. Документация ────────────────────────────────────────────────────────
const readme = read('hapi_enterprise/README.md');
assert.match(readme, /## Raspberry Pi and small boards/, 'липсва секция за Raspberry Pi');
for (const needle of ['aarch64', 'Pi Zero', 'memory_limit_mb', 'linux/arm64', '32-bit']) {
  assert.ok(readme.includes(needle), `README не споменава „${needle}“`);
}
const rootReadme = read('README.md');
assert.match(rootReadme, /arch-amd64%20%7C%20aarch64/, 'root README: баджът не показва поддържаните архитектури');

// add-on-ът не бива да изисква x86-специфични инструменти в runtime пътя.
const serverSrc = read('hapi_enterprise/server.js');
assert.ok(!/x86_64|amd64-only|\bAVX2?\b/.test(serverSrc), 'server.js не бива да зависи от x86 инструкции');

console.log(
  `PASS raspberrypi compat: arch=${arches.join('+')}, multi-arch Dockerfile, без native модули, memory_limit_mb, документация`,
);
