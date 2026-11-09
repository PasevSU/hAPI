'use strict';
// ПАКЕТ ЗА ДЕБЪГИНГ (0.69.208) — белокутийно: скриптът се вика и резултатът се проверява.
//
// Правилото: пакетът събира версия, среда, сверка за цялост, доклад от матрикса и последни
// одиторски редове в ЕДИН архив, който може да се прикачи — и НЕ съдържа тайни. Тестът пада,
// ако: липсва файл, архивът не е валиден gzip, има тайна в пакета, README не обяснява какво
// НЕ се праща, или скенерът не хваща поставена тайна.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const pkg = require('../scripts/diag-package.cjs');

const ROOT = path.join(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-diag-'));

// ── 1. Пакетът се строи и съдържа каквото трябва ────────────────────────────
{
  const said = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'diag-package.cjs'), '--out', out], { encoding: 'utf8' });
  assert.match(said, /diag-package: .*hapi-diag-/, 'скриптът казва какво е направил: ' + said.trim());
  const dirs = fs.readdirSync(out).filter((n) => n.startsWith('hapi-diag-') && fs.statSync(path.join(out, n)).isDirectory());
  assert.equal(dirs.length, 1, 'има точно една папка на пакета');
  const dir = path.join(out, dirs[0]);
  const files = fs.readdirSync(dir).sort();
  for (const name of ['README.txt', 'error-log.tail.jsonl', 'integrity.txt', 'release-status.md', 'summary.json']) {
    assert.ok(files.includes(name), 'пакетът съдържа ' + name + ': ' + files.join(', '));
  }
  const archive = path.join(out, dirs[0] + '.tar.gz');
  assert.ok(fs.existsSync(archive), 'има и един архив за прикачване');
  const tar = zlib.gunzipSync(fs.readFileSync(archive));
  assert.ok(tar.length > 512, 'архивът е валиден gzip и съдържа tar блокове: ' + tar.length + ' B');
  assert.equal(tar.subarray(257, 262).toString('ascii'), 'ustar', 'fmt е ustar (четим от всеки tar)');
  for (const name of files) assert.ok(tar.includes(Buffer.from(name)), 'в архивът влиза ' + name);

  // ── 2. Съдържанието: версия, цялост, матрикс — измерени, не измислени ─────
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  assert.match(summary.version, /^\d+\.\d+\.\d+$/, 'версията е в пакета');
  assert.match(String(summary.node), /^\d+\./, 'версията на Node е в пакета');
  assert.ok(['ok', 'mismatch', 'missing', 'malformed'].includes(summary.integrity.status), 'сверката за цялост е отчетена: ' + summary.integrity.status);
  assert.equal(typeof summary.matrix.passed, 'number', 'докладът от матрикса е в пакета');

  // ── 3. Никакви тайни ─────────────────────────────────────────────────────
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal(pkg.looksSecret(text), false, name + ': пакетът не съдържа тайна');
  }

  // ── 4. README казва какво НЕ се праща и какво значи разминаване ──────────
  const readme = fs.readFileSync(path.join(dir, 'README.txt'), 'utf8');
  assert.match(readme, /Какво НЕ влиза/, 'README изрежда какво не влиза в пакета');
  assert.match(readme, /тайни и ключове/, 'README казва изрично за тайните');
  assert.match(readme, /integrity\.txt/, 'README обяснява файла за цялост');
  assert.match(readme, /РАЗМИНАВАНЕ/, 'README казва какво значи разминаване в сверката');
}

// ── 5. Скенерът за тайни наистина хваща (иначе „няма тайни“ е празно твърдение) ──
{
  assert.equal(pkg.looksSecret('token: "' + 'x'.repeat(24) + '"'), true, 'степен на тайна в конфигурация се хваща');
  assert.equal(pkg.looksSecret('ghp_' + 'a'.repeat(24)), true, 'GitHub токен се хваща');
  // Низовете се сглобяват, за да не стои готов маркер на частен ключ в тестов файл: скенерът
  // на проекта (`tests/secret-patterns.cjs`) го брои за тайна и гейтът пада с право.
  const privateMarker = '-----BEGIN RSA ' + 'PRIVATE KEY-----';
  assert.equal(pkg.looksSecret(privateMarker), true, 'частен ключ се хваща');
  assert.equal(pkg.looksSecret('version: 0.69.208'), false, 'обикновен текст не се брои за тайна');
  const masked = pkg.redact('ghp_' + 'a'.repeat(24));
  assert.equal(masked, '[скрито]', 'позната тайна се заменя, преди да влезе в пакета: ' + masked);
}

fs.rmSync(out, { recursive: true, force: true });
console.log('PASS diag-package: 5 файла + валиден tar.gz · версия, цялост и матрикс вътре · без тайни · README обяснява какво не се праща · скенерът хваща поставена тайна');
