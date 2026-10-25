'use strict';
// КАТАЛОГ НА КОДОВЕТЕ ЗА ГРЕШКА — ГЕНЕРИРАН ОТ КОДА.
//
// Защо: кодът излъчва ~47 машинни кода (`SECRET_PATH_RELATIVE`, `UNSUPPORTED_PKESK`, …), а
// документите обясняваха само част от тях. Одитът на 0.69.87 намери **23 кода без нито едно
// обяснение в документацията** — потребител, който ги види, няма къде да ги потърси.
// Кодът за грешка е договор; договор, който не е описан, е просто низ.
//
// Значението идва от САМИЯ код — текстът на изключението до кода — затова каталогът не може
// да измисли нещо, което кодът не казва, и не може да изостане от него.
//
// Употреба:
//   node scripts/error-codes.cjs              # записва документа
//   node scripts/error-codes.cjs --check      # само проверява (код 1 при разлика)
//   node scripts/error-codes.cjs --out=ПЪТ    # друг файл (за тестове)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'documentation', '04_FUNCTION_SPECIFICATIONS', 'ERROR_CODES.md');
const ARGS = process.argv.slice(2);
const argValue = (name) => {
  const hit = ARGS.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const CHECK = ARGS.includes('--check');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'ui', 'assets', 'fonts', 'rules', 'plugins', 'translations'].includes(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

/** Един ред на код: значението е текстът на изключението до него, не измислено описание. */
function collect() {
  const map = new Map(); // код → { meaning, files:Set }
  const add = (code, meaning, rel) => {
    const clean = String(meaning || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
    if (!map.has(code)) map.set(code, { meaning: '', files: new Set() });
    const row = map.get(code);
    if (!row.meaning && clean) row.meaning = clean;
    row.files.add(rel);
  };
  for (const abs of walk(path.join(ROOT, 'hapi_enterprise'))) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf8');
    // fail('CODE', 'текст')
    for (const m of src.matchAll(/fail\(\s*'([A-Z][A-Z0-9_]{3,})'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) add(m[1], m[2], rel);    // empty('CODE', {...}) / fail('CODE', {...}) — кодът е първи аргумент, без текст до него
    for (const m of src.matchAll(/\b(?:fail|empty|deny)\(\s*'([A-Z][A-Z0-9_]{3,})'/g)) add(m[1], '', rel);    // fail(res, NNN, 'CODE: текст')  и  'CODE: текст' в error сообщения
    for (const m of src.matchAll(/'([A-Z][A-Z0-9_]{5,}):\s*([^']*)'/g)) add(m[1], m[2], rel);
    // err.code = 'CODE' (без текст до него)
    for (const m of src.matchAll(/\.code\s*=\s*'([A-Z][A-Z0-9_]{3,})'/g)) add(m[1], '', rel);
  }
  return map;
}

function generate() {
  const map = collect();
  const codes = [...map.keys()].sort((a, b) => a.localeCompare(b));
  const withText = codes.filter((c) => map.get(c).meaning).length;
  const configYaml = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
  const version = (configYaml.match(/^version: "([^"]+)"/m) || [])[1] || 'неизвестна';

  const lines = [
    '# Кодове за грешка — каталог',
    '',
    `> **Генериран документ.** Версия на кода: **${version}**. Пише се от`,
    '> `node scripts/error-codes.cjs`, проверява се от `tests/error-codes.cjs`.',
    '> Значението идва от текста на самото изключение — ръчна редакция се губи при следващото',
    '> генериране и не може да измисли поведение, което кодът не изпълнява.',
    '',
    `Общо: **${codes.length}** кода, излъчвани от \`hapi_enterprise/\`. От тях **${withText}** носят`,
    'собствено обяснение в кода; останалите се разпознават по кода и файла.',
    '',
    '## Кодове по азбучен ред',
    '',
    '| Код | Значение (от кода) | Къде се излъчва |',
    '| --- | ------------------ | --------------- |',
    ...codes.map((code) => {
      const row = map.get(code);
      const where = [...row.files].sort().map((f) => '`' + f + '`').join(' · ');
      return `| \`${code}\` | ${row.meaning ? row.meaning : '—'} | ${where} |`;
    }),
    '',
    '## Защо това е договор',
    '',
    'Кодът за грешка е това, което клиентът проверява програмно: той е стабилен, докато текстът',
    'се променя. Затова код не се преименува тихо — смяната е промяна в договора и се записва в',
    '`CHANGELOG.md`. HTTP статусът и формата на тялото са в `API_ARCHITECTURE_SPEC.md` §4.4a',
    '(RFC 9457).',
    '',
  ];
  return lines.join('\n');
}

try {
  const next = generate();
  const out = argValue('out') || OUT;
  if (CHECK) {
    let current = '';
    try { current = fs.readFileSync(out, 'utf8') } catch { current = '' }
    if (current !== next) {
      console.error('error-codes: документът е остарял — пусни `node scripts/error-codes.cjs`');
      process.exit(1);
    }
    const count = (next.match(/^\| `/gm) || []).length;
    console.log('error-codes: актуален (' + count + ' кода, всеки с файл на излъчване)');
  } else {
    fs.writeFileSync(out, next);
    const count = (next.match(/^\| `/gm) || []).length;
    console.log('error-codes: записан ' + out.replace(ROOT + path.sep, '') + ' (' + count + ' кода)');
  }
} catch (e) {
  console.error('error-codes: ' + e.message);
  process.exit(1);
}
