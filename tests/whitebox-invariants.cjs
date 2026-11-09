'use strict';
// БЕЛОКУТИЙНИ ТЕСТОВЕ (0.69.208): инварианти на модулите, викани ДИРЕКТНО.
//
// Докато чернокутийният тест съди само онова, което се вижда по HTTP, тук се влиза вътре:
// замразени дефиниции, fail-closed поведение, граници на журнала, покритие на решенията.
// Всяка проверка е за НЕЩО, което не се вижда отвън, но би се счупило тихо:
//   1. `paths` е единственият източник и е замразен (никой не може да го пренапише по време);
//   2. `paths.logicalRoot` отказва непознат корен вместо да строи път от корена на диска;
//   3. `storage-preflight` се проваля ЗАТВОРНО, когато коренът липсва;
//   4. `error-log` се реже до тавана и чете най-новите първи;
//   5. законът `balanced-groups` е свързан с решение в протокола (иначе находката е без изход);
//   6. `integrity` е чист модул: без мрежа, без записи — само чете и сравнява.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const addon = (name) => require(path.join(ADDON, name));

const checks = [];
const ok = (label) => checks.push(label);

// ── 1. paths: един източник, замразен ──────────────────────────────────────
{
  const paths = addon('paths');
  assert.equal(Object.isFrozen(paths.LOGICAL_ROOTS), true, 'логическите корени са замразени');
  assert.equal(Object.isFrozen(paths.CONFIG_ROOTS), true, 'конфигурационните корени са замразени');
  assert.throws(() => { 'use strict'; paths.LOGICAL_ROOTS.share = '/not-share'; }, 'опит за подмяна на корен хвърля');
  assert.equal(paths.LOGICAL_ROOTS.share, '/share', 'коренът не е променен');
  assert.deepEqual(Object.keys(paths.LOGICAL_ROOTS).sort(), ['config', 'data', 'media', 'share'], 'корените са точно четирите от контракта');
  assert.deepEqual([...paths.CONFIG_ROOTS], ['/config', '/homeassistant'], 'конфигурационните корени са два (standalone и add-on)');
  ok('paths е замразен и съдържа точно четирите логически корена');
}

// ── 2. logicalRoot: непознат корен е грешка, не път ────────────────────────
{
  const paths = addon('paths');
  assert.throws(() => paths.logicalRoot('nope'), /Unknown storage location/, 'непознат корен се отказва с ясно съобщение');
  assert.equal(paths.isLogicalRoot(''), true, 'празното е „коренът по подразбиране“');
  assert.equal(paths.isLogicalRoot('/share/x'), false, 'подпът не е логически корен');
  const resolved = paths.resolveRoot('share');
  assert.equal(path.isAbsolute(resolved), true, 'резолвнатият път е абсолютен');
  assert.equal(paths.resolveRoot('share'), resolved, 'резолвнатият път е стабилен между извикванията');
  ok('непознат корен се отказва, а резолюцията е стабилна');
}

// ── 3. storage-preflight: проваля се затворено ─────────────────────────────
{
  const preflight = addon('storage-preflight');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-preflight-'));
  fs.mkdirSync(path.join(tmp, 'share'));
  const good = preflight.check({ location: 'share' }, { STORAGE_ROOT_OVERRIDE: tmp });
  assert.equal(typeof good, 'string', 'check() връща избрания корен като път');
  assert.match(good, /share/, 'пътят е под избрания корен: ' + good);
  // Родителят е ФАЙЛ → коренът не може да съществува → отказ, а не измислен път.
  fs.writeFileSync(path.join(tmp, 'blocked'), 'x');
  assert.throws(
    () => preflight.check({ location: 'share' }, { STORAGE_ROOT_OVERRIDE: path.join(tmp, 'blocked') }),
    /Storage (?:mount|root) (?:unavailable|not available)|not a directory|ENOTDIR|EEXIST|ENOENT/,
    'липсващ корен не се подменя тихо — preflight отказва',
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  ok('preflight минава при реален корен и отказва при невъзможен');
}

// ── 4–6. Асинхронната част: журнал, закон↔решение, чистота на integrity ────
(async () => {
  const errorLog = addon('error-log');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-elog-'));
  const log = errorLog.create(tmp, { maxEntries: 5 });
  for (let i = 0; i < 12; i += 1) await log.append('error', 'test', 'запис ' + i, { i });
  const all = await log.list({ limit: 100 });
  assert.ok(all.length <= 5, 'журналът се реже до тавана: ' + all.length);
  assert.equal(all[0].details.i, 11, 'най-новият запис е първи при четене');
  assert.equal(all[all.length - 1].message, 'запис 7', 'остават последните пет, не първите');
  fs.rmSync(tmp, { recursive: true, force: true });
  ok('error-log се реже до тавана и чете най-новите първи');

  const ledger = fs.readFileSync(path.join(ADDON, 'ui', 'debug-ledger.js'), 'utf8');
  const laws = fs.readFileSync(path.join(ADDON, 'ui', 'debug-objects.js'), 'utf8');
  assert.match(laws, /id: 'balanced-groups'/, 'законът съществува в инструмента');
  assert.match(ledger, /'balanced-groups': \{/, 'законът има ред в протокола');
  assert.match(ledger, /guard: 'tests\/ui-nav-symmetry\.cjs'/, 'решението сочи защитата си');
  ok('законът за менюто е свързан с решение и защита');

  const src = fs.readFileSync(path.join(ADDON, 'integrity.js'), 'utf8');
  assert.equal(/require\('node:https?'\)|require\('node:net'\)|fetch\(/.test(src), false, 'integrity не прави мрежови заявки');
  assert.equal(/writeFileSync|appendFileSync|mkdirSync|unlinkSync/.test(src), false, 'integrity не пише на диска');
  const integrity = addon('integrity');
  const res = integrity.create({ root: ADDON }).verify();
  assert.equal(res.status, 'ok', 'работещото дърво минава сверката: ' + res.status);
  ok('integrity не пипа диска и не ходи в мрежата');

  console.log('PASS whitebox-invariants: ' + checks.length + ' инварианта — ' + checks.join(' · '));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
