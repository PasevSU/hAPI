'use strict';
// ПРАВИЛО ЗА ЦЯЛОСТ ПРИ СТАРТИРАНЕ (0.69.208) — белокутийно: модулът се вика директно.
//
// Правилото: при старт критичните файлове се сверяват с `integrity-manifest.json`; липсващ
// манифест само се съобщава, разминаване се съобщава с ИМЕНА и спира само при
// `HAPI_INTEGRITY_STRICT=1`. Тестът пада, ако: манифестът остарее, подправен файл не се
// хване, липсващ файл не се хване, правилото мълчи, или `start.js` не го вика.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const integrity = require('../hapi_enterprise/integrity');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');

// ── 1. Манифестът е пресен: генераторът минава в режим --check ──────────────
{
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'integrity-manifest.cjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /критични файла съвпадат/, 'манифестът е пресен: ' + out.trim());
  const manifest = JSON.parse(fs.readFileSync(path.join(ADDON, integrity.MANIFEST_NAME), 'utf8'));
  assert.equal(Object.keys(manifest.files).length, integrity.CRITICAL.length, 'всеки критичен файл е в манифеста');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'манифестът носи версията на изданието');
  for (const rel of integrity.CRITICAL) {
    assert.ok(fs.existsSync(path.join(ADDON, rel)), 'критичният файл ' + rel + ' съществува');
  }
  // DEF-80: глобалният слой е в сверката, не само интерфейсът. През него минават всеки QR и
  // всеки публичен адрес — подмяната му трябва да се види при старт, не при оплакване.
  for (const rel of ['core.js', 'core_module/qr.js', 'core_module/address.js', 'core_module/api-docs.js']) {
    assert.ok(integrity.CRITICAL.includes(rel), 'CRITICAL пази глобалната функция: ' + rel);
  }
}

// ── 2. Здравото дърво минава ────────────────────────────────────────────────
const reader = integrity.create({ root: ADDON });
const read = reader.readManifest();
assert.ok(read.manifest && read.manifest.files, 'манифестът се чете през `readManifest()`: ' + read.reason);
assert.equal(read.reason, '', 'валидният манифест не връща причина за отказ');
const good = reader.verify();
assert.equal(good.status, 'ok', 'работещото дърво съвпада с манифеста: ' + JSON.stringify({ changed: good.changed, missing: good.missing }));
assert.equal(good.checked, integrity.CRITICAL.length, 'сверени са всички критични файлове');

// ── 3. Подправен файл се хваща (и НЕ се показва съдържанието му) ───────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-integrity-'));
  for (const rel of integrity.CRITICAL) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.copyFileSync(path.join(ADDON, rel), path.join(tmp, rel));
  }
  fs.copyFileSync(path.join(ADDON, integrity.MANIFEST_NAME), path.join(tmp, integrity.MANIFEST_NAME));
  const clean = integrity.create({ root: tmp }).verify();
  assert.equal(clean.status, 'ok', 'копие на дървото също минава (иначе тестът мери нещо друго)');

  fs.appendFileSync(path.join(tmp, 'server.js'), '\n// подправка\n');
  const tampered = integrity.create({ root: tmp }).verify();
  assert.equal(tampered.status, 'mismatch', 'подправеният файл се хваща');
  assert.deepEqual(tampered.changed, ['server.js'], 'посочва се ТОЧНО подправеният файл: ' + tampered.changed.join(', '));
  const text = integrity.create({ root: tmp }).describe(tampered);
  assert.match(text, /РАЗМИНАВАНЕ/, 'човешкият текст казва, че има разминаване');
  assert.equal(/подправка/.test(text), false, 'съдържанието на файла НЕ влиза в текста');

  // Липсващ критичен файл: също разминаване, но с ясно „липсва“.
  fs.unlinkSync(path.join(tmp, 'ui', 'app.js'));
  const missing = integrity.create({ root: tmp }).verify();
  assert.equal(missing.status, 'mismatch');
  assert.deepEqual(missing.missing, ['ui/app.js'], 'липсващият файл се посочва: ' + missing.missing.join(', '));

  // Подправката се хваща и от генератора (иначе изданието може да излезе със стар хеш).
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 4. Липсващ манифест: сверката се пропуска СЪС съобщение, не тихо ──────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-integrity-empty-'));
  const said = [];
  const log = { info: (m) => said.push(['info', m]), warn: (m) => said.push(['warn', m]), error: (m) => said.push(['error', m]) };
  const result = integrity.create({ root: tmp }).verifyAtStartup({ log, strict: false });
  assert.equal(result.status, 'missing', 'без манифест статусът е „missing“');
  assert.equal(said.length, 1, 'има точно едно съобщение, не мълчание');
  assert.equal(said[0][0], 'warn', 'съобщението е предупреждение');
  assert.match(said[0][1], /integrity\.manifest\.missing/, 'съобщението е с машинен код: ' + said[0][1]);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 5. Строг режим: разминаването СПИРА старта (fail-closed) ───────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-integrity-strict-'));
  for (const rel of integrity.CRITICAL) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.copyFileSync(path.join(ADDON, rel), path.join(tmp, rel));
  }
  fs.copyFileSync(path.join(ADDON, integrity.MANIFEST_NAME), path.join(tmp, integrity.MANIFEST_NAME));
  fs.appendFileSync(path.join(tmp, 'paths.js'), '\n// подправка\n');
  const log = { info() {}, warn() {}, error() {} };
  assert.equal(integrity.create({ root: tmp }).verifyAtStartup({ log, strict: false }).status, 'mismatch', 'по подразбиране не спира');
  assert.throws(
    () => integrity.create({ root: tmp }).verifyAtStartup({ log, strict: true }),
    /INTEGRITY_MISMATCH/,
    'при HAPI_INTEGRITY_STRICT=1 разминаването е фатално',
  );
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 6. Правилото е включено в САМИЯ старт, не само в тест ──────────────────
{
  const start = fs.readFileSync(path.join(ADDON, 'start.js'), 'utf8');
  assert.match(start, /require\('\.\/integrity'\)/, 'entrypoint-ът зарежда модула');
  assert.match(start, /verifyAtStartup\(\{ log: console \}\)/, 'entrypoint-ът вика сверката при старт');
  assert.match(start, /INTEGRITY_MISMATCH/, 'при строг режим стартът отказва с ясен код');
  const docker = fs.readFileSync(path.join(ADDON, 'Dockerfile'), 'utf8');
  assert.match(docker, /COPY integrity\.js/, 'модулът влиза в образа');
  assert.match(docker, /COPY integrity-manifest\.json/, 'манифестът влиза в образа (иначе сверката все е пропусната)');
  assert.match(docker, /CMD \["node", "\/app\/start\.js"\]|CMD \["node","\/app\/start\.js"\]/, 'стартът минава през entrypoint-а, който сверява');
}

console.log('PASS integrity-startup: ' + integrity.CRITICAL.length + ' критични файла · подправка и липса се хващат · липсващ манифест се съобщава · строгият режим спира · entrypoint-ът и образът го включват');
