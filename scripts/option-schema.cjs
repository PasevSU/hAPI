'use strict';
// `options:` И `schema:` СЕ ГЕНЕРИРАТ ОТ ДЕСКРИПТОРА (O2 от `DOCS_AND_OPTIONS_STRUCTURE.md` §7).
//
// Защо: `config.yaml` съдържа два ръчно поддържани блока — `options:` (стойности по подразбиране)
// и `schema:` (тип на всяка опция). Те са ТРЕТОТО и ЧЕТВЪРТОТО място за същата опция, след
// `option-spec.js` и преводите. Разминаване между тях не се вижда от нищо: Supervisor би
// нарисувал друго поле, а сървърът би получил стойност, която не очаква.
//
// Сега двата блока се строят от дескриптора в ЕДНА канонична форма:
//   • низовете са в двойни кавички (`""`, `"Files"`), числата и булевите — голи;
//   • редът е редът на дескриптора (той е редът на картата в Home Assistant);
//   • КОМЕНТАРИТЕ СЕ ПАЗЯТ: обяснението над дадена опция остава над нея, защото то казва ЗАЩО
//     стойността е такава (напр. „сверени с работещата инсталация“) — това не се генерира.
//
// Останалите секции на `config.yaml` не се пипат.
//
//   node scripts/option-schema.cjs            # записва блоковете
//   node scripts/option-schema.cjs --check    # само проверява (код 1 при разлика)
const fs = require('node:fs');
const path = require('node:path');
const { OPTIONS } = require('../hapi_enterprise/option-spec.js');

const ROOT = path.join(__dirname, '..');
const CFG = path.join(ROOT, 'hapi_enterprise', 'config.yaml');

/** YAML стойност по едно правило: низ → в кавички, число/булево → голо. */
function yamlValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Тялото на секция `<име>:` — до следващия топ-ключ. */
function sectionOf(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === name + ':');
  if (start < 0) throw new Error('config.yaml: липсва секция ' + name);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_]+:/.test(lines[end])) end += 1;
  return { start, end, body: lines.slice(start, end).join('\n') };
}

/** Коментарите, прикачени към всеки ключ в дадена секция (`ключ → редове`). */
function commentsOf(sectionText) {
  const out = new Map();
  let pending = [];
  for (const line of sectionText.split('\n').slice(1)) {
    if (/^\s*#/.test(line)) {
      pending.push(line);
      continue;
    }
    const m = /^ {2}([A-Za-z0-9_]+):/.exec(line);
    if (m) {
      if (pending.length) out.set(m[1], pending);
      pending = [];
    }
  }
  return out;
}

/** Коментарите в края на секцията — те принадлежат на СЛЕДВАЩИЯ топ-ключ и не бива да се губят. */
function trailingOf(sectionText) {
  const lines = sectionText.split('\n');
  let lastKey = -1;
  lines.forEach((line, i) => {
    if (/^ {2}[A-Za-z0-9_]+:/.test(line)) lastKey = i;
  });
  return lines.slice(lastKey + 1).filter((line) => /^\s*#/.test(line));
}

/** Двата блока като текст; `old` дава коментарите, които да се запазят. */
function blocks(entries = OPTIONS, old = {}) {
  const keep = (name) => (old[name] ? commentsOf(old[name]) : new Map());
  const optionsComments = keep('options');
  const schemaComments = keep('schema');
  const options = [
    'options:',
    ...entries.flatMap((o) => [...(optionsComments.get(o.key) || []), `  ${o.key}: ${yamlValue(o.def)}`]),
    ...(old.options ? trailingOf(old.options) : []),
  ].join('\n');
  const schema = [
    'schema:',
    ...entries.flatMap((o) => [...(schemaComments.get(o.key) || []), `  ${o.key}: ${/\|/.test(o.type) ? '"' + o.type + '"' : o.type}`]),
    ...(old.schema ? trailingOf(old.schema) : []),
  ].join('\n');
  return { options, schema };
}

function render(text = fs.readFileSync(CFG, 'utf8')) {
  const old = { options: sectionOf(text, 'options').body, schema: sectionOf(text, 'schema').body };
  const want = blocks(OPTIONS, old);
  let next = text;
  for (const name of ['options', 'schema']) {
    const { start, end } = sectionOf(next, name);
    const lines = next.split('\n');
    next = [...lines.slice(0, start), ...want[name].split('\n'), ...lines.slice(end)].join('\n');
  }
  return next;
}

function main() {
  const check = process.argv.includes('--check');
  const current = fs.readFileSync(CFG, 'utf8');
  const next = render(current);
  if (check) {
    if (current !== next) {
      console.error('option-schema: `options:`/`schema:` се разминават с дескриптора — пусни `node scripts/option-schema.cjs`');
      process.exit(1);
    }
    console.log(`option-schema: актуален (${OPTIONS.length} опции в options: и schema:)`);
    return;
  }
  if (current === next) {
    console.log(`option-schema: без промяна (${OPTIONS.length} опции)`);
    return;
  }
  fs.writeFileSync(CFG, next, 'utf8');
  console.log(`option-schema: записан config.yaml (${OPTIONS.length} опции в options: и schema:)`);
}

module.exports = { blocks, yamlValue, sectionOf, commentsOf, trailingOf, render };

if (require.main === module) main();
