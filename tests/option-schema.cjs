'use strict';
// `options:` И `schema:` СЕ ГЕНЕРИРАТ ОТ ДЕСКРИПТОРА (O-02 от `DOCS_AND_OPTIONS_STRUCTURE.md` §7).
//
// Защо има тест: `config.yaml` е картата, която Home Assistant показва на потребителя. Досега
// двете секции се пишеха на ръка и се разминаваха с кода — липсваща опция не се виждаше никъде,
// а подразбиране в картата можеше да е различно от това в `start.js`.
//
// Тестът пази четири неща:
//   1. живият `config.yaml` е точно това, което генераторът би написал (`--check` минава);
//   2. КОМЕНТАРИТЕ не се губят при генериране — те са единственото обяснение за човека, който
//      отваря картата в Home Assistant;
//   3. стойностите се пишат четливо (низ в кавички, число/булево без), а `schema:` се цитира
//      само когато съдържа `|`, защото иначе YAML би го прочел като блоков скалар;
//   4. генераторът НАИСТИНА хваща разминаване (негативна проба).
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CFG = path.join(ROOT, 'hapi_enterprise', 'config.yaml');
const gen = require(path.join(ROOT, 'scripts', 'option-schema.cjs'));
const { OPTIONS } = require(path.join(ROOT, 'hapi_enterprise', 'option-spec.js'));

// ── 1. Живата карта е актуална (едно и също с генерираното) ────────────────
const live = fs.readFileSync(CFG, 'utf8');
assert.equal(gen.render(live), live, 'config.yaml се разминава с дескриптора — пусни node scripts/option-schema.cjs');
const cli = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'option-schema.cjs'), '--check'], { encoding: 'utf8' });
assert.match(cli, /актуален/, 'генераторът с --check потвърждава: ' + cli.trim());

// ── 2. Коментарите оцеляват ────────────────────────────────────────────────
const commentLines = (text) => text.split('\n').filter((line) => line.trim().startsWith('#')).length;
assert.equal(commentLines(live) > 5, true, 'картата носи обяснителни коментари: ' + commentLines(live));
const synthetic = [
  'options:',
  '  # това обяснение трябва да остане',
  '  token: ""',
  '  min_free_mb: 1000',
  'schema:',
  '  token: password?',
  '  min_free_mb: int(0,1048576)',
  '',
].join('\n');
const rendered = gen.render(synthetic);
assert.match(rendered, /# това обяснение трябва да остане/, 'коментарът пред опция остава на мястото си');
assert.equal(commentLines(rendered), commentLines(synthetic), 'броят на коментарите не се променя');

// ── 3. Стойностите се пишат четливо ────────────────────────────────────────
assert.equal(gen.yamlValue(''), '""', 'празен низ се пише като кавички');
assert.equal(gen.yamlValue('simple'), '"simple"', 'низът се пише в кавички');
assert.equal(gen.yamlValue('a|b'), '"a|b"', 'низът с `|` се пази в кавички');
assert.equal(gen.yamlValue(1024), '1024', 'числото е без кавички');
assert.equal(gen.yamlValue(false), 'false', 'булевото е без кавички');
const schemaSection = rendered.split(/\nschema:/)[1] || '';
assert.equal(schemaSection.length > 0, true, 'генерираното съдържа секция `schema:`');
const unquotedPipe = schemaSection.split('\n').filter((line) => /^ {2}\w+: [^"].*\|/.test(line));
assert.deepEqual(unquotedPipe, [], 'всеки тип с `|` е в кавички: ' + unquotedPipe.join(' | '));
assert.equal(
  schemaSection.split('\n').filter((line) => /^ {2}\w+: "/.test(line)).length >= 2,
  true,
  'има поне два цитирани типа (list/match)',
);
const liveSchema = live.split(/\nschema:/)[1] || '';
const liveUnquoted = liveSchema.split('\n').filter((line) => /^ {2}\w+: [^"].*\|/.test(line));
assert.deepEqual(liveUnquoted, [], 'типовете с `|` в `schema:` са цитирани, иначе YAML ги реже: ' + liveUnquoted.join(' | '));
assert.equal(
  liveSchema.split('\n').filter((line) => /^ {2}\w+: ".*\|.*"$/.test(line)).length >= 3,
  true,
  'живата карта има поне три цитирани типа с `|`',
);
for (const option of OPTIONS) {
  assert.ok(live.includes(`  ${option.key}:`), 'опцията влиза и в двете секции: ' + option.key);
}

// ── 4. Негативна проба: разминаване се хваща ───────────────────────────────
const drifted = live.replace(/(\n {2}min_free_mb: )\d+/, '$11500');
assert.notEqual(drifted, live, 'пробата наистина е сменена');
assert.notEqual(gen.render(drifted), drifted, 'сменено подразбиране се връща към стойността от дескриптора');

console.log(
  `PASS option-schema: ${OPTIONS.length} опции · config.yaml съвпада с дескриптора · ` +
    'коментарите оцеляват · низ/число/булево се пишат четливо · разминаване се хваща',
);
