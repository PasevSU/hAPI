'use strict';
// Настройките по подразбиране трябва да са (а) реални при инсталация и (б) публикувани.
//
// Правилата, които този тест пази:
//   • таблицата в README-тата се генерира от `config.yaml` и е актуална (иначе се разминава
//     тихо — точно това се случи с ръчно писаните таблици, които описваха `db_name` като
//     име на файла на базата);
//   • ВСЯКА опция от `options:` има ред в таблицата и обяснение какво значи празната ѝ
//     стойност — нова опция без обяснение спира генератора;
//   • при първи старт `config/settings.json` се записва с ЦЕЛИЯ набор настройки, тоест
//     няма състояние „нищо не е зададено“;
//   • втори старт не презаписва вече запазени стойности.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtimeConfig = require('../hapi_enterprise/runtime-config');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── 1. Генераторът е актуален ────────────────────────────────────────────────
const check = spawnSync(process.execPath, [path.join(root, 'scripts', 'settings-defaults.cjs'), '--check'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(check.status, 0, 'таблицата с подразбиранията е актуална: ' + (check.stderr || check.stdout));

// ── 2. Всяка опция от config.yaml има ред в README-тата ─────────────────────
const cfg = read('hapi_enterprise/config.yaml');
const optionsBlock = (() => {
  const start = cfg.indexOf('\noptions:\n');
  const rest = cfg.slice(start + 'options:\n'.length);
  const end = rest.search(/\n[a-z_]+:\n/);
  return rest.slice(0, end === -1 ? undefined : end);
})();
const optionKeys = [...optionsBlock.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
assert.ok(optionKeys.length >= 30, 'намерени са поне 30 опции, а са ' + optionKeys.length);

for (const [file, heading] of [
  ['hapi_enterprise/README.md', '| Setting | Key | Default | What the default means |'],
  ['BG.md', '| Настройка | Ключ | По подразбиране | Какво следва от него |'],
]) {
  const text = read(file);
  assert.ok(text.includes('SETTINGS-DEFAULTS:START'), file + ': липсва маркерът на генерираната таблица');
  assert.ok(text.includes(heading), file + ': липсва заглавният ред на таблицата');
  const missing = optionKeys.filter((key) => !text.includes('`' + key + '`'));
  assert.deepEqual(missing, [], file + ': тези опции липсват в таблицата: ' + missing.join(', '));
  // Подразбиранията от config.yaml се виждат в таблицата, а не са преразказани.
  for (const key of ['db_name', 'visitor_ip_mode', 'visitor_retention_days', 'storage_subdirectory']) {
    const row = text.split('\n').find((line) => line.startsWith('| ') && line.includes('`' + key + '`'));
    assert.ok(row, file + ': липсва ред за ' + key);
    assert.match(row, /\|/, file + ': редът за ' + key + ' не е табличен');
  }
  assert.equal(/\| `[a-z_]+` \| — \| *\|/.test(text), false, file + ': празно обяснение в таблицата');
}

// ── 3. Първият старт записва целия набор настройки ──────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-defaults-'));
try {
  const fresh = runtimeConfig.create(dir);
  const file = path.join(dir, 'config', 'settings.json');
  assert.ok(fs.existsSync(file), 'първият старт създава config/settings.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const expected = Object.keys(runtimeConfig.DEFAULT).sort();
  assert.deepEqual(Object.keys(saved).sort(), expected, 'файлът съдържа ВСИЧКИ настройки, не само променените');
  for (const key of expected) {
    assert.deepEqual(saved[key], runtimeConfig.DEFAULT[key], 'стойността по подразбиране е записана: ' + key);
  }
  assert.equal(fresh.settings.organization, runtimeConfig.DEFAULT.organization, 'модулът чете същите стойности');
  // Сензорите остават `null` („наследи от опцията“) — записана стойност би отменила опцията.
  assert.equal(saved.sensors.ipMode, null, 'режимът на IP наследява, вместо да заключва поведението');

  // ── 4. Втори старт не пипа запазеното ─────────────────────────────────────
  const changed = { ...saved, organization: 'Друга организация' };
  fs.writeFileSync(file, JSON.stringify(changed, null, 2));
  const again = runtimeConfig.create(dir);
  assert.equal(again.settings.organization, 'Друга организация', 'вторият старт чете запазеното, не го презаписва');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).organization, 'Друга организация', 'файлът не е презаписан');

  console.log(
    'PASS settings-defaults: ' + optionKeys.length + ' опции в две README-та · първи старт записва целия settings.json · ' +
    expected.length + ' настройки · втори старт не презаписва',
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
