'use strict';
// СПРАВОЧНИК НА ГЛОБАЛНИТЕ ОПЦИИ — ГЕНЕРИРАН (D3 от `DOCS_AND_OPTIONS_STRUCTURE.md` §5, §9).
//
// Защо: 44 опции живеят на пет места (config.yaml `options:` и `schema:`, три превода, таблиците
// в `start.js`, README-то и панела). Нито един документ не събира на едно място какво е опцията,
// каква е променливата ѝ, откъде се чете и какво значи празната ѝ стойност. Този генератор строи
// точно това — от ЕДИНСТВЕНИЯ източник (`config.yaml`) и преводите, за да не може да изостане.
//
// Той не решава D3 докрай: `start.js` още мапва опциите в 4 стила (това е O2). Затова тук
// преименуванията са ИЗРИЧНА таблица — тя е и документацията на дълга, и входът за бъдещия
// дескриптор `option-spec.js`.
//
//   node scripts/options-reference.cjs            # записва документа
//   node scripts/options-reference.cjs --check    # само проверява (код 1 при разлика)
const fs = require('node:fs');
const path = require('node:path');
const { lineFor } = require('./docs-class.cjs');
const { OPTIONS: SPEC, RENAMED } = require('../hapi_enterprise/option-spec.js');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const OUT = path.join(ROOT, 'documentation', '02_TO_BE_ARCHITECTURE', 'OPTIONS_REFERENCE.md');

/** Секция от `config.yaml` (същият прост подход като в `scripts/settings-defaults.cjs`). */
function section(text, name) {
  const start = text.indexOf('\n' + name + ':\n');
  if (start < 0) throw new Error('config.yaml: липсва секция ' + name);
  const rest = text.slice(start + name.length + 2);
  const end = rest.search(/\n[a-z_]+:\n/);
  return rest.slice(0, end === -1 ? undefined : end);
}

/** `options:` → [{ key, value }] в реда на файла. */
function readOptions(text) {
  const out = [];
  for (const line of section(text, 'options').split('\n')) {
    const m = /^ {2}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m) out.push({ key: m[1], value: m[2].replace(/\s+#.*$/, '').trim() });
  }
  return out;
}

/** `schema:` → Map(key → тип), напр. `int(0,8192)?`, `list(a|b)`. */
function readSchema(text) {
  const out = new Map();
  for (const line of section(text, 'schema').split('\n')) {
    const m = /^ {2}([A-Za-z0-9_]+):\s*(.+)$/.exec(line);
    if (m) out.set(m[1], m[2].trim().replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

/**
 * Мини-четец на `translations/<lang>.yaml` — само `configuration.<key>.name|description`.
 * Поддържа едноредови стойности и блокове `>-`/`|` (те са половината файл).
 */
function readTranslations(text) {
  const out = new Map();
  const lines = text.split('\n');
  let inside = false;
  let key = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^configuration:\s*$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (/^\S/.test(line) && !/^#/.test(line)) { inside = false; continue; }
    const keyMatch = /^ {2}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (keyMatch) { key = keyMatch[1]; continue; }
    const fieldMatch = /^ {4}(name|description):\s*(.*)$/.exec(line);
    if (!fieldMatch || !key) continue;
    const field = fieldMatch[1];
    const raw = fieldMatch[2].trim();
    if (/^[>|]-?$/.test(raw)) {
      // Блок: следващите по-дълбоко отстъпени редове са стойността. Отстъпът е 5+ интервала
      // (`    description: >-` + `      текст`), затова се сравнява с отстъпа на САМИЯ ред,
      // а не с твърдо число — иначе блокът се приема за следващо поле.
      const indent = /^ */.exec(line)[0].length;
      const parts = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === '') { parts.push(''); i = j; continue; }
        if (!/^ */.test(next) || /^ */.exec(next)[0].length <= indent) break;
        parts.push(next.trim());
        i = j;
      }
      setField(out, key, field, parts.join(' ').replace(/\s+/g, ' ').trim());
    } else {
      setField(out, key, field, raw.replace(/^"(.*)"$/, '$1'));
    }
  }
  return out;
}

function setField(map, key, field, value) {
  const entry = map.get(key) || {};
  entry[field] = value;
  map.set(key, entry);
}

/** Типът, преведен на човешки: `str?` → „низ (по избор)“, `int(0,8192)?` → „цяло 0…8192 (по избор)“. */
function describeType(raw) {
  const optional = raw.endsWith('?');
  const base = optional ? raw.slice(0, -1) : raw;
  let text = base;
  const list = /^list\((.*)\)$/.exec(base);
  const int = /^int\((-?\d+),(-?\d+)\)$/.exec(base);
  const match = /^match\((.*)\)$/.exec(base);
  if (list) text = 'едно от: ' + list[1].split('|').join(' · ');
  else if (int) text = 'цяло ' + int[1] + '…' + int[2];
  else if (match) text = 'шаблон `' + match[1] + '`';
  else if (base === 'str') text = 'низ';
  else if (base === 'bool') text = 'вкл/изкл';
  else if (base === 'password') text = 'тайна (низ)';
  return optional ? text + ', по избор' : text + ', **задължителна**';
}

const envOf = (key) => {
  const found = SPEC.find((o) => o.key === key);
  return found ? found.env : key.toUpperCase();
};

function compose({ options, schema, translations, version }) {
  const rows = [];
  const blocks = [];
  for (const { key, value } of options) {
    const type = schema.get(key);
    if (!type) throw new Error('schema: липсва тип за опцията ' + key);
    const tr = translations.get ? translations.get(key) : translations[key];
    if (!tr || !tr.name || !tr.description) throw new Error('преводът липсва за опцията ' + key + ' (name и description са задължителни)');
    const env = envOf(key);
    const alias = RENAMED[key];
    const secret = /password/.test(type);
    rows.push(`| \`${key}\` | \`${env}\`${alias ? ' †' : ''} | ${describeType(type)} | \`${value === '' ? '""' : value}\` | ${secret ? 'да' : '—'} |`);
    blocks.push(
      [
        `### \`${key}\``,
        '',
        `- **Тип:** ${describeType(type)} · **По подразбиране:** \`${value === '' ? '""' : value}\``,
        `- **Променлива:** \`${env}\`${alias ? ' — **преименувана** (' + alias + ')' : ' (по правилото `UPPER(ключ)`)'}`,
        `- **Име в картата на add-on-а:** ${tr.name}`,
        `- **Описание:** ${tr.description}`,
        secret ? '- **Тайна:** да — не се логва, не се връща от `api-info`, не влиза в диагностичния пакет' : null,
        '',
      ].filter((line) => line !== null).join('\n'),
    );
  }
  const aliases = Object.keys(RENAMED)
    .map((key) => `| \`${key}\` | \`${envOf(key)}\` | ${RENAMED[key]} |`)
    .join('\n');

  return [
    '# Справочник на глобалните опции',
    '',
    `_Генериран от \`hapi_enterprise/config.yaml\` и \`translations/bg.yaml\`: **${options.length}** опции.`,
    'Пише се от `node scripts/options-reference.cjs`, проверява се от `tests/options-reference.cjs`.',
    'Ръчна редакция се губи при следващото генериране._',
    '',
    '## 1. Общ изглед',
    '',
    '| Опция | Променлива | Тип | По подразбиране | Тайна |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '† — името на променливата е преименувано; виж §3.',
    '',
    '## 2. Опция по опция',
    '',
    ...blocks,
    '## 3. Преименувания (дълг, който се вижда)',
    '',
    'Правилото е `UPPER(ключ)`. Всяко изключение е записано тук с причина — така статичната',
    'проверка „всяка опция има читател“ (O-11 от плана) става възможна.',
    '',
    '| Опция | Променлива | Защо |',
    '| --- | --- | --- |',
    aliases,
    '',
    '## 4. Какво този документ НЕ твърди',
    '',
    '- Не твърди, че всяка опция има **читател** — това е гейтът `option-coverage` (O3) и днес',
    '  `username`/`password` са описани в превода като „никой код не ги чете“ (съзнателно).',
    '- Не твърди, че валидацията е на едно място — днес `runtime-config.js` пази втори списък с',
    '  граници (`maxUploadMb`, `maxJobs` …). Това е O-06 и още не е затворено.',
    '',
    `_Версия на изданието при генериране: ${version}._`,
    '',
  ].join('\n');
}

function readAll() {
  const cfg = fs.readFileSync(path.join(ADDON, 'config.yaml'), 'utf8');
  const version = (/^version:\s*"([^"]+)"/m.exec(cfg) || [])[1] || '';
  const translations = readTranslations(fs.readFileSync(path.join(ADDON, 'translations', 'bg.yaml'), 'utf8'));
  return { options: readOptions(cfg), schema: readSchema(cfg), translations, version };
}

function main() {
  const check = process.argv.includes('--check');
  const { options, schema, translations, version } = readAll();
  const body = compose({ options, schema, translations, version });
  // Редът за клас идва от НОРМАТА (`docs-class.js`), не от втора версия на същото правило.
  const lines = body.split('\n');
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  lines.splice(h1 + 1, 0, '', lineFor('02_TO_BE_ARCHITECTURE/OPTIONS_REFERENCE.md'));
  const text = lines.join('\n');
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (check) {
    if (current !== text) {
      console.error('options-reference: документът е остарял — пусни `node scripts/options-reference.cjs`');
      process.exit(1);
    }
    console.log(`options-reference: актуален (${options.length} опции · ${Object.keys(RENAMED).length} преименувания)`);
    return;
  }
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(`options-reference: записан ${path.relative(ROOT, OUT)} (${options.length} опции · ${Object.keys(RENAMED).length} преименувания)`);
}

module.exports = { readOptions, readSchema, readTranslations, describeType, compose, envOf, RENAMED, OUT };

if (require.main === module) main();
