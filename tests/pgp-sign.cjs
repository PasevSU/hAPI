'use strict';
// ПОДПИСВАНЕ НА ПАПКА И НА МНОЖЕСТВО ФАЙЛОВЕ — С КЛЮЧА, КОЙТО ВЕЧЕ Е ЗАДАДЕН.
//
// Договорът, който този тест пази:
//   • `POST /admin/api/pgp/sign` НЕ иска нито ключ, нито парола: ключът идва от опциите
//     (`pgp_path_secret` + `pgp_key_pass`), а заявката носи само КАКВО да се подпише;
//   • ПАПКА → каноничен манифест (`FOLDER_MANIFEST.json`) с път/размер/SHA-256 на всеки файл,
//     подпис върху манифеста и (по подразбиране) по един detached подпис на всеки файл;
//   • МНОЖЕСТВО ФАЙЛОВЕ → по един подпис на файл, без манифест;
//   • всеки подпис в ZIP-а се проверява САМОСТОЯТЕЛНО с публичния ключ;
//   • пътищата са ограничени до /share и /media (символни връзки и „..“ не се приемат);
//   • в отговора няма частен ключ (INV-P7);
//   • без зададен ключ отговорът е 400 `NO_SIGNING_KEY` с указание къде се задава.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, stopChild } = require('./helpers.cjs');
const pgp = require('../hapi_enterprise/pgp.js');
const ooxml = require('../hapi_enterprise/ooxml.js');

const FIX = path.join(__dirname, 'fixtures/pgp');
const PUBLIC = path.join(FIX, 'public.asc');
const SECRET = path.join(FIX, 'secret.asc');
const PASS = 'fx-pass-2026';
const TOKEN = 'pgp-sign-token-0123456789abcdef';
const PUBLIC_ARMORED = fs.readFileSync(PUBLIC, 'utf8');
const cases = [];
const ok = (label) => cases.push(label);

/** Стартира сървър и връща `call` + `stop`. `extraEnv` позволява среда БЕЗ ключ. */
async function boot(extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-pgp-sign-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    // `cwd` е системният диск, за да сочи „/share“ към <root>/share, а не към UNC път.
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      ADMIN_PORT: '0',
      PUBLIC_GATEWAY_PORT: '0',
      ADMIN_TOKEN: TOKEN,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c.toString() });
  const call = async (p, method = 'GET', data, auth = true) => {
    const r = await fetch('http://127.0.0.1:' + port + p, {
      method,
      headers: { ...(auth ? { Authorization: 'Bearer ' + TOKEN } : {}), ...(typeof data === 'string' ? { 'Content-Type': 'application/json' } : {}) },
      body: data,
    });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, value, headers: r.headers };
  };
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      if ((await call('/health')).status === 200) { ready = true; break }
    } catch {
      /* още не слуша */
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.ok(ready, 'сървърът стартира' + (stderr ? ' · ' + stderr : ''));
  return { call, stop: () => stopChild(child), dir };
}

/** ZIP → Map(име → Buffer), за да се проверява съдържанието, а не само списъкът. */
function unzip(buf) {
  const out = new Map();
  for (const [name, read] of ooxml.unzip(Buffer.from(buf))) out.set(name, read());
  return out;
}

(async () => {
  const withKey = await boot({ PGP_PATH_PUBLIC: PUBLIC, PGP_PATH_SECRET: SECRET, PGP_KEY_PASS: PASS });
  const shareBase = path.join(path.parse(os.tmpdir()).root, 'share');
  const folderAbs = path.join(shareBase, 'hapi-sign-' + process.pid + '-' + Math.random().toString(16).slice(2, 8));
  const folder = '/share/' + path.basename(folderAbs);
  try {
    // ── 1. ПАПКА: манифест + подпис на всеки файл ──────────────────────────
    fs.mkdirSync(path.join(folderAbs, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(folderAbs, 'b.txt'), 'втори файл', 'utf8');
    fs.writeFileSync(path.join(folderAbs, 'sub', 'a.txt'), 'първи файл', 'utf8');
    fs.writeFileSync(path.join(folderAbs, '.hidden'), 'не се подписва', 'utf8');

    const signed = await withKey.call('/admin/api/pgp/sign', 'POST', JSON.stringify({ folder }));
    assert.equal(signed.status, 201, 'папката се подписва: ' + JSON.stringify(signed.value));
    const info = signed.value;
    assert.equal(info.folder.files, 2, 'скритите файлове не влизат в манифеста: ' + JSON.stringify(info.folder));
    assert.equal(info.files.length, 2, 'два файла с по един подпис');
    assert.equal(info.keySource, 'options', 'ключът идва от опциите, не от заявката');
    assert.match(String(info.download), /^\/admin\/api\/pgp\/signatures\/[a-f0-9]+$/, 'има адрес за изтегляне');
    assert.deepEqual(info.files.map((f) => f.path), ['b.txt', 'sub/a.txt'], 'пътищата са относителни и подредени');
    assert.equal(JSON.stringify(info).includes('PRIVATE KEY'), false, 'в отговора няма частен ключ (INV-P7)');
    ok('папка: манифест, два подписа, ключ от опциите, без частен ключ');

    const zip = unzip((await withKey.call(info.download)).value);
    for (const name of ['FOLDER_MANIFEST.json', 'FOLDER_MANIFEST.json.asc', 'SIGNATURES.json', 'SIGNATURES.json.asc', 'b.txt.asc', 'sub/a.txt.asc']) {
      assert.ok(zip.has(name), 'ZIP-ът съдържа ' + name + ': ' + [...zip.keys()].join(', '));
    }
    assert.equal(zip.has('.hidden.asc'), false, 'скритият файл няма подпис');
    const manifest = zip.get('FOLDER_MANIFEST.json');
    const manifestJson = JSON.parse(manifest.toString('utf8'));
    assert.equal(manifestJson.files.length, 2, 'манифестът изброява двата файла');
    assert.equal(manifestJson.files.find((f) => f.path === 'b.txt').size, Buffer.byteLength('втори файл'), 'манифестът носи размера');
    const manifestCheck = pgp.verifyDetached(manifest, zip.get('FOLDER_MANIFEST.json.asc').toString('utf8'), PUBLIC_ARMORED);
    assert.equal(manifestCheck.valid, true, 'подписът на манифеста се проверява: ' + JSON.stringify(manifestCheck));
    const fileCheck = pgp.verifyDetached(zip.get('b.txt.asc') && fs.readFileSync(path.join(folderAbs, 'b.txt')), zip.get('b.txt.asc').toString('utf8'), PUBLIC_ARMORED);
    assert.equal(fileCheck.valid, true, 'подписът на файла се проверява самостоятелно: ' + JSON.stringify(fileCheck));
    const index = JSON.parse(zip.get('SIGNATURES.json').toString('utf8'));
    assert.equal(index.files.length, 2, 'индексът изброява подписаните файлове');
    assert.equal(index.keyId, info.keyId, 'индексът носи същия keyId');
    const indexCheck = pgp.verifyDetached(zip.get('SIGNATURES.json'), zip.get('SIGNATURES.json.asc').toString('utf8'), PUBLIC_ARMORED);
    assert.equal(indexCheck.valid, true, 'индексът също е подписан');
    ok('ZIP: манифест, индекс и по един подпис на файл — всички се проверяват');

    // ── 2. МНОЖЕСТВО ФАЙЛОВЕ поотделно ─────────────────────────────────────
    const list = [
      '/share/' + path.basename(folderAbs) + '/sub/a.txt',
      '/share/' + path.basename(folderAbs) + '/b.txt',
    ];
    const multi = await withKey.call('/admin/api/pgp/sign', 'POST', JSON.stringify({ paths: list, armor: false }));
    assert.equal(multi.status, 201, 'файловете се подписват поотделно: ' + JSON.stringify(multi.value));
    assert.equal(multi.value.folder, null, 'без папка няма манифест');
    assert.equal(multi.value.files.length, 2, 'два отделни подписа');
    assert.equal(multi.value.armor, false, 'поискан е .sig вместо .asc');
    const multiZip = unzip((await withKey.call(multi.value.download)).value);
    assert.deepEqual([...multiZip.keys()].sort(), ['SIGNATURES.json', 'SIGNATURES.json.sig', 'a.txt.sig', 'b.txt.sig'], 'ZIP-ът е само подписи: ' + [...multiZip.keys()].join(', '));
    assert.equal(pgp.verifyDetached(fs.readFileSync(path.join(folderAbs, 'sub', 'a.txt')), multiZip.get('a.txt.sig').toString('utf8'), PUBLIC_ARMORED).valid, true, 'подписът на a.txt се проверява');
    ok('много файлове: по един .sig на файл, без манифест, всеки се проверява');

    // ── 3. Граници: извън хранилището, липсващ път, празна заявка ───────────
    // Папка ИЗВЪН /share, която съществува (иначе отговорът е 404 и проверката е безпредметна).
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-outside-'));
    const escape = await withKey.call('/admin/api/pgp/sign', 'POST', JSON.stringify({ folder: outside }));
    assert.equal(escape.status, 403, 'път извън /share се отказва: ' + JSON.stringify(escape.value));
    assert.match(String(escape.value.error), /PATH_OUTSIDE_STORAGE/, 'причината е ясна: ' + JSON.stringify(escape.value));
    fs.rmSync(outside, { recursive: true, force: true });
    const traversal = await withKey.call('/admin/api/pgp/sign', 'POST', JSON.stringify({ folder: '/share/../' + path.basename(outside) }));
    assert.ok([403, 404].includes(traversal.status), '„..“ не извежда извън хранилището: ' + JSON.stringify(traversal.value));
    const missing = await withKey.call('/admin/api/pgp/sign', 'POST', JSON.stringify({ folder: '/share/hapi-missing-' + process.pid }));
    assert.equal(missing.status, 404, 'липсваща папка = 404: ' + JSON.stringify(missing.value));
    const empty = await withKey.call('/admin/api/pgp/sign', 'POST', JSON.stringify({}));
    assert.equal(empty.status, 400, 'празна заявка = 400: ' + JSON.stringify(empty.value));
    assert.match(String(empty.value.error), /NOTHING_TO_SIGN/, 'причината е ясна: ' + JSON.stringify(empty.value));
    ok('граници: 403 извън хранилището, 404 липсващ път, 400 празна заявка');
  } finally {
    await withKey.stop();
    fs.rmSync(folderAbs, { recursive: true, force: true });
  }

  // ── 4. БЕЗ ключ в опциите: ясна причина, а не мълчалив отказ ────────────
  const noKey = await boot({ PGP_PATH_PUBLIC: '', PGP_PATH_SECRET: '' });
  try {
    const refused = await noKey.call('/admin/api/pgp/sign', 'POST', JSON.stringify({ folder: '/share' }));
    assert.equal(refused.status, 400, 'без ключ = 400: ' + JSON.stringify(refused.value));
    assert.match(String(refused.value.error), /NO_SIGNING_KEY/, 'кодът е NO_SIGNING_KEY');
    assert.match(String(refused.value.error), /pgp_path_secret/, 'съобщението казва къде се задава ключът');
    ok('без зададен ключ: 400 NO_SIGNING_KEY с указание къде се задава');
  } finally {
    await noKey.stop();
    fs.rmSync(noKey.dir, { recursive: true, force: true });
  }

  console.log('PASS pgp-sign: ' + cases.length + ' проверки · ' + cases.join(' · '));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
