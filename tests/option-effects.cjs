'use strict';
// ЕФЕКТЪТ НА ОПЦИЯТА Е ПРОВЕРЕН, НЕ ОБЕЩАН (O-10/O-11 · `DOCS_AND_OPTIONS_STRUCTURE.md` §7).
//
// Три неща се проверяват тук, защото всяко от тях вече е било счупено:
//
// 1. ОБЯВАТА СЪВПАДА С КОДА. Дескрипторът казва кой файл чете опцията (`readBy`). Тестът иска
//    файлът да съществува и наистина да чете стойността — по име на променлива (`\bENV\b`) или
//    по достъп до ключа (`.key`, `['key']`). Споменаване в коментар не е четене.
// 2. ЕФЕКТЪТ СЕ ВИЖДА. `min_free_mb`, `storage_mode` + `storage_mount_name`, `portal_skin` се
//    подават реално и се гледа резултатът. Опция без видим ефект е декорация.
// 3. ОПИСАНИЕТО НЕ ЛЪЖЕ. Трите опции, които се четат само при първи старт, не бива да се
//    описват като „никой код не ги чете“ — точно това твърдяха преводите до 0.69.228 (DEF-90).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { OPTIONS } = require(path.join(ROOT, 'hapi_enterprise', 'option-spec.js'));
const preflight = require(path.join(ROOT, 'hapi_enterprise', 'storage-preflight.js'));
const portalSkin = require(path.join(ROOT, 'hapi_enterprise', 'portal-skin.js'));

// ── 1. Обявеният читател наистина чете ─────────────────────────────────────
const problems = [];
for (const option of OPTIONS) {
  const readers = option.readBy || [];
  if (!readers.length) {
    problems.push(`${option.key}: няма обявен читател`);
    continue;
  }
  for (const rel of readers) {
    const abs = path.join(ROOT, 'hapi_enterprise', rel);
    if (!fs.existsSync(abs)) {
      problems.push(`${option.key}: обявеният файл ${rel} не съществува`);
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    const readsEnv = new RegExp('\\b' + option.env + '\\b').test(text);
    const readsKey = new RegExp('(?:\\.|\\[\'|\\["|\'|")' + option.key + '(?:\'|"|\\b)').test(text);
    if (!readsEnv && !readsKey) problems.push(`${option.key}: ${rel} не чете нито ${option.env}, нито ключа`);
  }
}
assert.deepEqual(problems, [], 'обявата в дескриптора се разминава с кода: ' + problems.join(' | '));

// ── 2. Ефектът се вижда ────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-opt-'));
try {
  for (const kind of ['share', 'media', 'config']) {
    fs.mkdirSync(path.join(tmp, kind), { recursive: true });
  }
  const rootEnv = { STORAGE_ROOT_OVERRIDE: tmp };
  const base = (extra = {}) =>
    preflight.check(
      { storage_location: 'share', storage_subdirectory: 'hAPI/probe', storage_mode: 'local', min_free_mb: 0, ...extra },
      { ...rootEnv },
    );

  // min_free_mb: праг над реално свободното място трябва да откаже старт.
  assert.ok(base().includes('hAPI'), 'preflight приема хранилището');
  const freeMb = Math.floor((Number(fs.statfsSync(tmp).bavail) * Number(fs.statfsSync(tmp).bsize)) / (1024 * 1024));
  const schemaMax = 1048576;
  if (freeMb + 1024 <= schemaMax) {
    assert.throws(
      () => base({ min_free_mb: freeMb + 1024 }),
      /Insufficient free storage space/,
      'min_free_mb над свободното място спира старта',
    );
  }

  // storage_mode + storage_mount_name: мрежовото хранилище влиза в пътя.
  const mount = 'nas-hapi';
  fs.mkdirSync(path.join(tmp, 'share', mount), { recursive: true });
  const networked = base({ storage_mode: 'ha_network', storage_mount_name: mount });
  assert.ok(networked.includes(mount), 'storage_mount_name влиза в пътя на хранилището: ' + networked);
  assert.throws(
    () => base({ storage_mode: 'ha_network', storage_mount_name: '' }),
    /Invalid Home Assistant network storage name/,
    'storage_mode=ha_network без име на монтиране се отказва',
  );
  assert.throws(() => base({ storage_mode: 'cloud' }), /Unsupported storage mode/, 'непознат storage_mode се отказва');

  // portal_skin: двете стойности от схемата дават различен резултат, трета не съществува.
  const classic = portalSkin.skin({ PORTAL_SKIN: 'classic' });
  const modern = portalSkin.skin({ PORTAL_SKIN: 'modern' });
  assert.notEqual(classic, modern, 'portal_skin сменя кожата на портала');
  assert.ok(Object.values(portalSkin.SKINS).includes(classic), 'classic е позната кожа');
  assert.ok(Object.values(portalSkin.SKINS).includes(modern), 'modern е позната кожа');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 3. Описанието на опциите „само при първи старт“ не лъже ────────────────
const firstRun = OPTIONS.filter((o) => o.firstRunOnly);
assert.ok(firstRun.length >= 3, 'поне три опции се четат само при първи старт: ' + firstRun.length);
const lie = /никой код не|kein code liest|no code reads/i;
for (const option of firstRun) {
  for (const lang of ['bg', 'de', 'en']) {
    const yaml = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'translations', lang + '.yaml'), 'utf8');
    const block = yaml.split(/\n {2}(?=\S)/).find((part) => part.startsWith(option.key + ':'));
    assert.ok(block, `${option.key} има превод на ${lang}`);
    assert.equal(lie.test(block), false, `${option.key} (${lang}) не твърди, че кодът не го чете`);
    assert.match(block, /първи|ersten|first/i, `${option.key} (${lang}) казва, че се чете при първи старт`);
  }
}

console.log(
  `PASS option-effects: ${OPTIONS.length} опции с обявен и проверен читател · ` +
    `min_free_mb/storage_mode/storage_mount_name/portal_skin с видим ефект · ` +
    `${firstRun.length} опции „само при първи старт“ с вярно описание на трите езика`,
);
