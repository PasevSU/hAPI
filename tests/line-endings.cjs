'use strict';
// `.gitattributes` казва `* text=auto eol=lf`, тоест `git clone` връща LF. Работното копие обаче
// може да се разминава, а артефактите в `dist/` се сглобяват ОТ РАБОТНОТО КОПИЕ — значи
// `SHA256SUMS.txt` щеше да зависи от това къде е бил направен билдът. На 0.69.87 измереното:
// 85 проследени файла имаха CRLF на диска (12 в `hapi_enterprise/`, 2 в `custom_components/`,
// 43 в `tests/`), тоест същото издание от чист клон щеше да излезе с други байтове.
//
// Затова се проверяват ТРИ неща, всяко от които стига:
//   1. `.gitattributes` иска LF за всичко текстово;
//   2. в индекса (това, което клонът ще изтегли) няма CRLF — `git ls-files --eol` дава `i/lf`,
//      `i/-text` (двоично) или `i/crlf`/`i/mixed` (последните две са грешка);
//   3. сглобените артефакти в `dist/` не съдържат CRLF в нито един текстов запис — строителят
//      привежда текстовите файлове към LF при пакетиране, независимо от работното копие.
//
// Работното копие се отчита като информация (`w/crlf`), но не е провал: инструментите на
// Windows пишат CRLF, а това, което стига до потребителя, е артефактът, не копието.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readArchive, DIST_DIR } = require('../scripts/release-lib.cjs');

const root = path.join(__dirname, '..');

// ── 1. Правилото съществува ────────────────────────────────────────────────
const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
assert.match(attributes, /^\* text=auto eol=lf$/m, '.gitattributes иска LF за всички текстови файлове');

// ── 2. Индексът е LF (това получава един клон) ─────────────────────────────
const eol = execFileSync('git', ['ls-files', '--eol'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    // Формат: `i/lf  w/lf  attr/text=auto eol=lf<tab>път` — колоните са подравнени с интервали,
    // а пътят следва едва след табулатора (иначе файл с интервал в името се разпада).
    const [head, ...rest] = line.split('\t');
    const [index, work] = head.trim().split(/\s+/);
    return { index, work, file: rest.join('\t') };
  });
assert.ok(eol.length > 500, `git трябва да върне всички проследени файлове (намерени ${eol.length})`);

const badIndex = eol.filter((e) => e.index === 'i/crlf' || e.index === 'i/mixed').map((e) => `${e.file} (${e.index})`);
assert.deepEqual(badIndex.slice(0, 10), [], `индексът не бива да пази CRLF — клонът ще изтегли точно това (${badIndex.length} файла)`);

const workCrlf = eol.filter((e) => e.work === 'w/crlf' || e.work === 'w/mixed');

// ── 3. Артефактите НА ТЕКУЩАТА ВЕРСИЯ нямат CRLF в текстовите записи ────────
// `dist/` пази и стари издания (на 0.69.87 там стояха 69 версии) — те не се проверяват: важното
// е какво ще се публикува сега.
const version = (fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8').match(/^version:\s*"?([0-9.]+)"?/m) || [])[1];
assert.ok(version, 'config.yaml носи версия');
const archives = fs.existsSync(DIST_DIR) ? fs.readdirSync(DIST_DIR).filter((f) => /\.(tar\.gz|zip)$/.test(f) && f.includes(version)) : [];
assert.ok(archives.length >= 2, `в dist/ трябва да има сглобени артефакти за ${version} (намерени ${archives.length}) — пусни \`node scripts/build-release.cjs\``);

const TEXT = /\.(js|cjs|mjs|json|md|txt|ya?ml|html|css|py|pyw|bat|ps1|sh)$/i;
const crlfInside = [];
let textEntries = 0;
for (const name of archives) {
  const entries = readArchive(fs.readFileSync(path.join(DIST_DIR, name)), name);
  for (const entry of entries) {
    if (!TEXT.test(entry.path)) continue;
    if (entry.data.includes(0)) continue; // двоично с текстово разширение — не се пипа
    textEntries += 1;
    if (entry.data.includes(Buffer.from('\r\n'))) crlfInside.push(`${name}: ${entry.path}`);
  }
}
assert.deepEqual(crlfInside.slice(0, 10), [], `артефактите не бива да съдържат CRLF — иначе SHA256SUMS зависи от копието (${crlfInside.length} записа)`);

console.log(
  `line-endings: ${eol.length} проследени · индексът е LF · ${textEntries} текстови записа в ${archives.length} артефакта без CRLF` +
  ` · работното копие: ${workCrlf.length} файла с CRLF${workCrlf.length ? ` (${workCrlf.slice(0, 3).map((e) => e.file).join(', ')})` : ''} — наред`,
);
