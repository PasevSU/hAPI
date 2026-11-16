'use strict';
// НИКОЯ ОПЦИЯ НА ADD-ON-А НЕ БИВА ДА СЕ ПРЕДСТАВЯ ЗА РАБОТЕЩА, БЕЗ ДА Я ЧЕТЕ КОД (0.69.210).
//
// Защо има тест: опция в интерфейса на Supervisor е ОБЕЩАНИЕ. Ако никой файл не я чете,
// човек сменя стойност, чака ефект и не получава нищо — точно това се случи с `db_name`
// (описанието твърдеше „име на базата и портала“, а кодът не го четеше).
//
// Правилото: всяка опция от `schema:` в `config.yaml` трябва или (а) да се чете от кода
// (`options.<име>`, низ `'<име>'` или env `ИМЕ`), или (б) да е в ОСТАРЕЛИТЕ по-долу — и
// тогава преводът ѝ ЗАДЪЛЖИТЕЛНО казва, че не се ползва.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const addon = path.join(root, 'hapi_enterprise');

// Остарели опции: не минават през обичайния канал (env / `options.<ключ>`) и се четат
// САМО ВЕДНЪЖ, при първи старт, от `/data/options.json` (`firstRunSeed` в `server.js`).
// Причината е конкретна за всяка, а преводът трябва да казва ТОВА, не че „никой не ги чете“
// (DEF-90: точно това твърдение стоеше в трите езика и беше невярно).
const OBSOLETE = {
  username: 'само при първи старт: началният потребител на конзолата; след това входът е по самоличността на Home Assistant',
  password: 'само при първи старт: паролата на началния потребител (иначе се генерира в api-credentials.txt)',
  db_name: 'само при първи старт: адресът и заглавието на ПЪРВИЯ портал; базата винаги е hapi.sqlite',
};

// ── 1. Ключовете от схемата ───────────────────────────────────────────────
const yaml = fs.readFileSync(path.join(addon, 'config.yaml'), 'utf8').split('\n');
const start = yaml.findIndex((l) => /^schema:\s*$/.test(l));
assert.ok(start > 0, 'config.yaml има секция schema');
const keys = [];
for (let i = start + 1; i < yaml.length; i++) {
  if (/^[a-z_]+:/.test(yaml[i])) break;
  const m = yaml[i].match(/^ {2}([a-z_][a-z0-9_]*):/);
  if (m) keys.push(m[1]);
}
assert.ok(keys.length > 30, 'схемата изглежда непрочетена: ' + keys.length + ' ключа');

// ── 2. Кодът, който би чел опциите ────────────────────────────────────────
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(js|cjs)$/.test(e.name)) files.push(full);
  }
};
walk(addon);
const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const readBy = (key) => {
  const env = key.toUpperCase();
  return (
    new RegExp('options\\.' + key + '\\b').test(code) ||
    code.includes(`'${key}'`) ||
    code.includes(`"${key}"`) ||
    new RegExp('\\b' + env + '\\b').test(code)
  );
};

// ── 3. Нищо извън остарелите не бива да е „мъртво“ ────────────────────────
const unread = keys.filter((k) => !readBy(k) && !(k in OBSOLETE));
assert.deepEqual(
  unread,
  [],
  'опции, които никой код не чете и не са обявени за остарели: ' + unread.join(', ') +
    ' — или ги свържи с код, или ги добави в OBSOLETE с причина и честен превод',
);
assert.equal(Object.keys(OBSOLETE).length, 3, 'броят на остарелите опции се промени — обнови анализа и този тест');

// ── 4. Рядко четена опция ЗАДЪЛЖИТЕЛНО лъже по-малко: преводът го казва ────
// Изискването е двойно: текстът трябва да обясни КОГА се чете и да не твърди, че не се чете.
const dict = (lang) => fs.readFileSync(path.join(addon, 'translations', lang + '.yaml'), 'utf8');
const LIE = /никой код не|kein code liest|no code reads/i;
for (const lang of ['bg', 'en', 'de']) {
  const text = dict(lang);
  for (const key of Object.keys(OBSOLETE)) {
    const block = text.split(new RegExp('^  ' + key + ':', 'm'))[1] || '';
    const slice = block.slice(0, 400);
    const honest = lang === 'bg' ? /първи старт/i : lang === 'de' ? /ersten Start/i : /first start/i;
    assert.match(slice, honest, `преводът на „${key}“ (${lang}) не казва, че се чете при първи старт`);
    assert.equal(LIE.test(slice), false, `преводът на „${key}“ (${lang}) твърди, че кодът не го чете`);
  }
}

// ── 5. Остарелите стоят и в опциите (иначе Supervisor ги губи при обновяване) ─
const optionsBlock = yaml.slice(yaml.findIndex((l) => /^options:\s*$/.test(l)), start).join('\n');
for (const key of Object.keys(OBSOLETE)) {
  assert.ok(new RegExp('^  ' + key + ':', 'm').test(optionsBlock), `остарялата опция „${key}“ липсва в options: — старите инсталации ще я загубят`);
}

console.log(
  `PASS addon-options-wired: ${keys.length} опции · ${keys.length - 3} се четат от кода · 3 остарели с честен превод (${Object.keys(OBSOLETE).join(', ')})`,
);
