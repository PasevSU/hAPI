'use strict';
// Опциите на add-on-а се виждат от потребителя през `hapi_enterprise/translations/{bg,en}.yaml`
// (Supervisor рисува `configuration.<опция>.name/description`). Ако се добави опция в
// `config.yaml` без превод, интерфейсът показва суровото име на ключа; ако се махне опция, а
// преводът остане, файловете лъжат, че има настройка, която вече не съществува. Нищо не
// проверяваше нито едната посока — а преводите са 43 опции × 2 езика × 2 полета.
//
// Затова тук се сверява ВРЪЗКАТА, не текстът:
//   1. всяка опция от `options:` в `config.yaml` има запис и в двата езика;
//   2. всеки запис има и `name`, и `description` (половин превод е също толкова счупен);
//   3. няма превод за опция, която не е в `options:` (нито в `schema:`);
//   4. двата езика покриват ЕДНО и също множество от опции — иначе единият потребител вижда
//      повече от другия.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const addon = path.join(root, 'hapi_enterprise');
const configLines = fs.readFileSync(path.join(addon, 'config.yaml'), 'utf8').split(/\r?\n/);

// Ключовете на секция от config.yaml: редове с точно два интервала под `име:`.
const sectionKeys = (name) => {
  const keys = [];
  let inside = false;
  for (const line of configLines) {
    if (/^\S/.test(line)) {
      inside = new RegExp(`^${name}:\\s*$`).test(line);
      continue;
    }
    if (!inside) continue;
    const match = line.match(/^ {2}([a-z0-9_]+):/);
    if (match) keys.push(match[1]);
  }
  return keys;
};
const options = sectionKeys('options');
const schema = sectionKeys('schema');
assert.ok(options.length >= 40, `config.yaml трябва да има поне 40 опции (намерени ${options.length})`);

// Записите в превода: `configuration:` → 2 интервала ключ → 4 интервала `name:`/`description:`.
const readTranslation = (file) => {
  const lines = fs.readFileSync(path.join(addon, 'translations', file), 'utf8').split(/\r?\n/);
  const entries = new Map(); // ключ → Set от полетата
  let inConfiguration = false;
  let current = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inConfiguration = /^configuration:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inConfiguration) continue;
    const key = line.match(/^ {2}([a-z0-9_]+):\s*$/);
    if (key) {
      current = key[1];
      entries.set(current, new Set());
      continue;
    }
    const field = line.match(/^ {4}(name|description):/);
    if (field && current) entries.get(current).add(field[1]);
  }
  return entries;
};

const translations = { bg: readTranslation('bg.yaml'), en: readTranslation('en.yaml') };
const knownOptions = new Set([...options, ...schema]);

const problems = [];
for (const [lang, entries] of Object.entries(translations)) {
  assert.ok(entries.size >= 40, `${lang}.yaml трябва да има поне 40 записа (намерени ${entries.size})`);

  // 1. Всяка опция има превод.
  const missing = options.filter((option) => !entries.has(option));
  if (missing.length) problems.push(`${lang}: без превод → ${missing.join(', ')}`);

  // 2. Всеки запис е пълен.
  const incomplete = [...entries].filter(([, fields]) => !fields.has('name') || !fields.has('description'));
  if (incomplete.length) {
    problems.push(`${lang}: непълен запис (нужни name и description) → ${incomplete.map(([k, f]) => `${k} (${[...f].join('+') || 'нищо'})`).join(', ')}`);
  }

  // 3. Няма превод за несъществуваща опция.
  const orphan = [...entries.keys()].filter((key) => !knownOptions.has(key));
  if (orphan.length) problems.push(`${lang}: превод за несъществуваща опция → ${orphan.join(', ')}`);
}

// 4. Двата езика покриват едно и също множество.
const onlyOneLanguage = options.filter((option) => translations.bg.has(option) !== translations.en.has(option));
if (onlyOneLanguage.length) problems.push(`само на един език → ${onlyOneLanguage.join(', ')}`);

assert.deepEqual(problems, [], 'преводите на опциите не бива да се разминават с config.yaml');

const pairs = Object.values(translations).reduce((sum, entries) => sum + [...entries.values()].reduce((s, f) => s + f.size, 0), 0);
console.log(`addon-translations: ${options.length} опции · bg ${translations.bg.size} · en ${translations.en.size} · ${pairs} полета — наред`);
