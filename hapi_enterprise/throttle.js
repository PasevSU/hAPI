'use strict';
// Ограничаване на скоростта на ПОТОКА (bandwidth pacing).
//
// Защо Transform, а не брояч: „ограничение на скоростта“ трябва да се усеща от
// получателя. Брояч, който само отчита колко байта са минали, не ограничава нищо.
// Тук всеки блок се подава едва когато изтече времето, за което той „се полага“ при
// зададената скорост — тоест средната скорост наистина е ограничена, а паметта не
// расте (backpressure от `pipe`).
const { Transform } = require('node:stream');

// 0 = без ограничение. 1 KiB/s е долна граница, 1 GiB/s — горна: извън тях е печатна
// грешка, а не намерение, затова се връща 400, вместо да се подразбира стойност.
const MIN_KBPS = 1;
const MAX_KBPS = 1024 * 1024;

const bad = (message) => Object.assign(new Error(message), { status: 400 });

/** Превежда стойност от настройка/заявка в байтове в секунда (0 = без ограничение). */
function spec(value) {
  if (value === undefined || value === null || value === '' || value === false) return 0;
  const kbps = Number(value);
  if (!Number.isFinite(kbps) || kbps < 0 || kbps > MAX_KBPS) {
    throw bad(`Ограничението на скоростта е от 0 до ${MAX_KBPS} KB/s`);
  }
  if (kbps === 0) return 0;
  if (kbps < MIN_KBPS) throw bad(`Ограничението на скоростта е минимум ${MIN_KBPS} KB/s`);
  return Math.round(kbps * 1024);
}

/**
 * Transform, който подава блоковете с постоянна средна скорост.
 * `bytesPerSec` <= 0 → връща null (без ограничение, без излишен stream в конвейера).
 */
function paced(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return null;
  let startedAt = 0;
  let sent = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!startedAt) startedAt = Date.now();
      sent += chunk.length;
      // Колко „се полага“ да е изминало за вече подаденото — и чакаме разликата.
      const due = Math.round((sent / bytesPerSec) * 1000) - (Date.now() - startedAt);
      if (due > 0) setTimeout(() => cb(null, chunk), due);
      else cb(null, chunk);
    },
  });
}

/**
 * Свързва източник към получател с ограничение. Връща true, ако е включен ограничител —
 * така тестът и диагностиката виждат дали ограничението е активно, а не го предполагат.
 */
function paceStream(source, target, bytesPerSec) {
  const limiter = paced(bytesPerSec);
  if (!limiter) {
    source.pipe(target);
    return false;
  }
  source.pipe(limiter).pipe(target);
  return true;
}

module.exports = { spec, paced, paceStream, MIN_KBPS, MAX_KBPS };
