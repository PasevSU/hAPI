'use strict';
// Поточното изтегляне (`download-stream.js`) досега нямаше нито един тест: 128 реда с брой
// едновременни слотове, Range заявки и ограничение на скоростта. Точно там грешката се вижда
// само когато файл липсва или е заключен — тоест в момента, в който човекът чака файла си.
//
// Проверява се:
//   1. слот: изчерпан лимит → изчакване → 503 след `waitMs`, а освободен слот пуска опашката;
//   2. файл, който НЕ може да се отвори, получава код (404/500) и НЕ получава заглавка 200 —
//      това е поправката: преди заглавките се пишеха преди отварянето и оставаше само
//      скъсана връзка;
//   3. цял файл: 200, точен `Content-Length`, байтовете съвпадат;
//   4. Range: 206 с точен `Content-Range` и само поисканите байтове; невалиден диапазон → 416;
//   5. If-Range с чужда стойност → целият файл отначало (200), както иска HTTP;
//   6. ограничение на скоростта: `X-RateLimit-BytesPerSec` се обявява, а потокът пак стига цял.
const assert = require('node:assert/strict');
const fsReal = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const download = require('../hapi_enterprise/download-stream');

const dir = fsReal.mkdtempSync(path.join(os.tmpdir(), 'hapi-dl-'));
const filePath = path.join(dir, 'документ.txt');
const CONTENT = Buffer.from('Здравей, това е файл за изтегляне.\n'.repeat(40), 'utf8');

/** Фалшив отговор: Writable, който помни какво е писал и какви заглавки е получил. */
function fakeRes() {
  const chunks = [];
  const headers = {};
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() },
  });
  res.statusCode = 200;
  res.headersSent = false;
  res.body = null;
  res.setHeader = (k, v) => { headers[k.toLowerCase()] = v };
  res.getHeader = (k) => headers[k.toLowerCase()];
  res.writeHead = (status, extra) => {
    res.statusCode = status;
    for (const [k, v] of Object.entries(extra || {})) headers[k.toLowerCase()] = v;
    res.headersSent = true;
  };
  // ВАЖНО: пазим оригиналния `destroy` — иначе override-ът вика себе си и стекът прелива.
  const originalDestroy = res.destroy.bind(res);
  res.destroy = (e) => { if (e) res.destroyedByStream = e; originalDestroy(e) };
  // Обещанието се създава ВЕДНАГА: малък файл може да приключи в същия тик и късно
  // закачен слушател за 'finish' не би се задействал никога (тестът щеше да виси).
  res.done = new Promise((resolve) => {
    res.on('finish', () => { res.body = Buffer.concat(chunks); resolve('finish') });
    res.on('close', () => resolve('close'));
  });
  return res;
}

const failures = [];
function fail(res, status, message) {
  failures.push({ status, message });
  res.statusCode = status;
  res.headersSent = true;
  res.end(message);
}

function makeLoadControl(effective = 4) {
  return { effective, recalc() { }, recordError() { this.errors = (this.errors || 0) + 1 } };
}

function makeStreamer(overrides = {}) {
  return download.create({
    fail,
    fs: fsReal,
    loadControl: makeLoadControl(),
    errorLog: { append: async () => { } },
    log: { error() { }, warn() { }, info() { } },
    waitMs: 60,
    ...overrides,
  });
}

const statOf = async (fp) => await fsp.stat(fp);

(async () => {
  try {
    fsReal.writeFileSync(filePath, CONTENT);

    // ── 1. Слот и опашка ────────────────────────────────────────────────────
    const st = await statOf(filePath);
    const one = makeStreamer({ loadControl: makeLoadControl(1) });
    assert.equal(await one.acquire(), true, 'първата заявка взима слота');
    // Таймерът на опашката е `unref()`-нат (сървърът не бива да държи процеса жив заради
    // чакащ клиент), затова в тест без сокет процесът излиза преди изчакването. Държим
    // цикълът жив, докато мерим самото изчакване.
    const keepAlive = setInterval(() => { }, 1000);
    const waiting = one.acquire();
    const timedOut = await waiting;
    clearInterval(keepAlive);
    assert.equal(timedOut, false, 'втората изчаква и пада по изчакване');
    assert.equal(one.active(), 1, 'слотът е един');
    // Слотът от началото се освобождава, иначе следващите проверки биха чакали него.
    one.release();
    assert.equal(one.active(), 0, 'слотът се освобождава');
    const two = makeStreamer({ loadControl: makeLoadControl(1) });
    assert.equal(await two.acquire(), true);
    const queued = two.acquire();
    two.release();
    assert.equal(await queued, true, 'освободен слот пуска опашката');
    two.release();

    // ── 2. Файл, който не може да се отвори: код, не 200 ───────────────────
    failures.length = 0;
    const missing = fakeRes();
    await one.stream({ headers: {} }, missing, path.join(dir, 'няма-такъв-файл'), { size: 10 }, 'x.txt');
    assert.equal(missing.headersSent, true, 'отговорът е приключен');
    assert.equal(missing.statusCode, 404, 'липсващ файл е 404, не 200 с празно тяло');
    assert.deepEqual(failures.map((f) => f.status), [404], 'грешката минава през fail, не през destroy');
    assert.equal(missing.destroyedByStream, undefined, 'връзката не се къса, за да стигне причината');
    assert.equal(one.active(), 0, 'слотът се освобождава при неуспех');

    // ── 3. Целият файл ─────────────────────────────────────────────────────
    const full = fakeRes();
    await one.stream({ headers: {} }, full, filePath, st, 'документ.txt');
    await full.done;
    assert.equal(full.statusCode, 200);
    assert.equal(full.getHeader('content-length'), CONTENT.length, 'дължината е точно размера');
    assert.equal(full.getHeader('accept-ranges'), 'bytes', 'възобновяването се обявява');
    assert.ok(String(full.getHeader('content-disposition')).includes(encodeURIComponent('документ.txt')), 'името е кодирано');
    assert.deepEqual(Buffer.from(full.body), CONTENT, 'байтовете са същите');

    // ── 4. Range: 206 и 416 ────────────────────────────────────────────────
    const part = fakeRes();
    await one.stream({ headers: { range: 'bytes=5-9' } }, part, filePath, st, 'документ.txt');
    await part.done;
    assert.equal(part.statusCode, 206, 'част от файла е 206');
    assert.equal(part.getHeader('content-range'), `bytes 5-9/${CONTENT.length}`, 'диапазонът е обявен');
    assert.deepEqual(Buffer.from(part.body), CONTENT.subarray(5, 10), 'точно поисканите байтове');

    failures.length = 0;
    const bad = fakeRes();
    await one.stream({ headers: { range: 'bytes=999999-' } }, bad, filePath, st, 'документ.txt');
    assert.equal(bad.statusCode, 416, 'невалиден диапазон е 416');
    assert.equal(bad.getHeader('content-range'), `bytes */${CONTENT.length}`, '416 казва размера');

    // ── 5. If-Range с чужда стойност → целият файл ─────────────────────────
    const stale = fakeRes();
    await one.stream({ headers: { range: 'bytes=5-9', 'if-range': 'чужда' } }, stale, filePath, st, 'документ.txt', null, { etag: 'sha256-верен' });
    await stale.done;
    assert.equal(stale.statusCode, 200, 'чуждият If-Range не позволява частичен отговор');
    assert.deepEqual(Buffer.from(stale.body), CONTENT, 'файлът идва отначало');

    // ── 6. Ограничение на скоростта се обявява и потокът стига цял ─────────
    const paced = fakeRes();
    await one.stream({ headers: {} }, paced, filePath, st, 'документ.txt', null, { bytesPerSec: 512 * 1024, budgetKey: 'p1' });
    await paced.done;
    assert.equal(paced.getHeader('x-ratelimit-bytespersec'), String(512 * 1024), 'ограничението не е скрито');
    assert.deepEqual(Buffer.from(paced.body), CONTENT, 'ограничаването не губи байтове');

    console.log('PASS download-stream: слот и опашка · липсващ файл → 404 (не 200 с празно тяло) · цял файл с точен размер · Range 206/416 · чужди If-Range → 200 · ограничение на скоростта');
  } finally {
    fsReal.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
