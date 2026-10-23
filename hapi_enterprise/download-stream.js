'use strict';
// Поточно изтегляне на файл с ограничен брой едновременни потоци и (по избор)
// ограничение на скоростта. Извадено от server.js, за да не расте монолитът: тук живее
// ЦЯЛАТА механика на слота и на Range заявките.
//
// `create({ fail, loadControl, errorLog, log, fs })` връща `{ stream, acquire, release, active }`.
const throttle = require('./throttle');

function create(deps) {
  // Зависимостите се четат при ВСЯКО ползване (`deps.x`), а не се разопаковат в началото:
  // server.js ги дефинира след този require и getter-ите още не са готови.
  const { loadControl, fs } = deps;
  const waitMs = Number(deps.waitMs) || 15000;
  const maxWaiters = 4096;
  let active = 0;
  // Бюджетите са ПО ЕДИН на пакет (ключ), за да не се заобикаля ограничението с паралелни
  // Range заявки. Нова стойност на ограничението → нов бюджет.
  const budgets = new Map();
  function budgetFor(key, bytesPerSec) {
    if (!bytesPerSec) return null;
    const current = budgets.get(key);
    if (current && current.bytesPerSec === bytesPerSec && Date.now() - current.createdAt < 300000) return current.budget;
    const budget = throttle.createBudget(bytesPerSec);
    budgets.set(key, { budget, bytesPerSec, createdAt: Date.now() });
    if (budgets.size > 512) {
      for (const [k, v] of budgets) if (Date.now() - v.createdAt >= 300000) budgets.delete(k);
    }
    return budget;
  }
  // Краткотрайна опашка: 2–3 едновременни линка не получават 503, а изчакват слот.
  // 503 се връща само ако опашката не бъде обслужена в рамките на `waitMs`.
  const waiters = [];

  function release() {
    if (active > 0) active--;
    while (waiters.length && active < loadControl.effective) {
      const next = waiters.shift();
      clearTimeout(next.timer);
      active++;
      next.resolve(true);
    }
  }

  function acquire() {
    loadControl.recalc(deps.requests ? deps.requests() : 0);
    if (active < loadControl.effective) { active++; return Promise.resolve(true) }
    if (waiters.length >= maxWaiters) return Promise.resolve(false);
    return new Promise((resolve) => {
      const entry = { resolve };
      entry.timer = setTimeout(() => {
        const index = waiters.indexOf(entry);
        if (index >= 0) waiters.splice(index, 1);
        resolve(false);
      }, waitMs);
      if (entry.timer.unref) entry.timer.unref();
      waiters.push(entry);
    });
  }

  /**
   * Изтегля файл по HTTP. `opts.bytesPerSec` (0 = без ограничение) включва ускорение/забавяне
   * на самия поток — това е „ограничаване на скоростта“, което получателят усеща.
   */
  async function stream(req, res, fp, stat, name, onStart, opts) {
    const bytesPerSec = (opts && opts.bytesPerSec) || 0;
    const budget = opts && opts.budgetKey ? budgetFor(opts.budgetKey, bytesPerSec) : null;
    if (!(await acquire())) {
      res.setHeader('Retry-After', '3');
      return deps.fail(res, 503, 'Download capacity reached');
    }
    let released = false;
    const releaseOnce = () => { if (!released) { released = true; release() } };
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    // ETag описва СЪДЪРЖАНИЕТО (sha256), не времето: при възобновяване трябва да е ясно,
    // че продължаваме същия файл, а не парче от друг.
    const etag = (opts && opts.etag) || '';
    const ifRange = String(req.headers['if-range'] || '').trim();
    // If-Range с чужда стойност означава „файлът е друг“ — тогава Range НЕ се прилага и
    // клиентът получава цялия файл отначало (точно както иска HTTP).
    const rangeAllowed = !ifRange || !etag || ifRange === etag;
    const rm = rangeAllowed ? /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '')) : null;
    if (rm && (rm[1] || rm[2]) && stat.size > 0) {
      if (rm[1] === '') { start = Math.max(0, stat.size - Number(rm[2])) } else { start = Number(rm[1]); if (rm[2] !== '') end = Math.min(end, Number(rm[2])) }
      if (start > end || start >= stat.size) { releaseOnce(); res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); return res.end() }
      status = 206;
    }
    const stream = fs.createReadStream(fp, stat.size ? { highWaterMark: 64 * 1024, start, end } : { highWaterMark: 64 * 1024 });
    stream.once('error', (e) => {
      releaseOnce();
      loadControl.recordError();
      void deps.errorLog.append('error', 'download-stream', e.code || e.message);
      deps.log.error('download.stream.failed', { ns: 'download', err: e.code || e.message });
      if (!res.headersSent) deps.fail(res, 500, 'Download failed');
      else res.destroy(e);
    });
    stream.once('close', releaseOnce);
    res.once('close', () => { if (!stream.destroyed) stream.destroy(); releaseOnce() });
    const rh = status === 206 ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size } : {};
    res.writeHead(status, {
      ...rh,
      'Accept-Ranges': 'bytes',
      ...(etag ? { ETag: etag } : {}),
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name.replace(/[\r\n]/g, '')),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Ограничението се обявява в отговора, за да не е „скрито“ поведение.
      ...(bytesPerSec > 0 ? { 'X-RateLimit-BytesPerSec': String(bytesPerSec) } : {}),
      ...(opts && opts.parallelChunks ? { 'X-Parallel-Chunks': String(opts.parallelChunks) } : {}),
    });
    if (onStart) onStart();
    // Бюджетът се включва само за реални трансфери: малък Range (проба) не бива да чака
    // опашката на голямо теглене.
    const budgetForThis = budget && end - start + 1 > 64 * 1024 ? budget : null;
    throttle.paceStream(stream, res, bytesPerSec, budgetForThis);
  }

  return { stream, acquire, release, active: () => active };
}

// Проверка на настройката за скорост (0 = без ограничение); невалидна стойност е 400.
const rateSpec = (value) => throttle.spec(value);

module.exports = { create, rateSpec };
