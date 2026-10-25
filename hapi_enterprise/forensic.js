'use strict';
// FORENSIC АНАЛИЗ (план 18, панел 07) — файлът се проверява по СЪДЪРЖАНИЕТО, не по разширението.
//
// ЗАЩО СЪЩЕСТВУВА
// Разширението е твърдение на този, който е копирал файла. За доказателство трябва това, което
// байтовете казват: истински тип (по магически числа), ентропия (криптирано/архивирано ли е),
// структура (счупен ли е контейнерът), метаданни (кой, кога, с какво) и разминаване между
// разширение и съдържание. Точно това е „файлов и метаданни анализ“ от плана.
//
// КАКВО ПРАВИ
//   • `sniff` — тип по магически числа (PDF, ZIP/OOXML, JPEG, PNG, GIF, TIFF, PGP, ELF, PE, …).
//   • `entropy` — Shannon ентропия на байтовете: ~8 бита значи криптирано/компресирано.
//   • `structure` — бързи проверки за счупване: JPEG маркери, ZIP централна директория,
//     PDF trailer, PNG IEND.
//   • `analyze` — всичко наведнъж + находки с код и обяснение, годни за одит и отчет.
//
// КАКВО НЕ ПРАВИ
//   • Не отваря файла за изпълнение и не го разархивира — само чете байтове.
//   • Не назовава „злонамерен“: находките са ФАКТИ („разширение != съдържание“), а заключението
//     е на човека. Иначе инструментът би твърдял повече, отколкото знае.
const path = require('node:path');
const exif = require('./exif');

// Магически числа: първите байтове → истински тип.
const MAGIC = [
  { ext: 'pdf', mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46], label: 'PDF' },
  { ext: 'zip', mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04], label: 'ZIP/OOXML' },
  { ext: 'zip', mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06], label: 'ZIP (празен)' },
  { ext: 'jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], label: 'JPEG' },
  { ext: 'png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47], label: 'PNG' },
  { ext: 'gif', mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38], label: 'GIF' },
  { ext: 'tif', mime: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00], label: 'TIFF (little endian)' },
  { ext: 'tif', mime: 'image/tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a], label: 'TIFF (big endian)' },
  { ext: 'pgp', mime: 'application/pgp-encrypted', bytes: [0x85, 0x01], label: 'OpenPGP (стар формат)' },
  { ext: 'pgp', mime: 'application/pgp-encrypted', bytes: [0xc1], label: 'OpenPGP (нов формат)' },
  { ext: 'exe', mime: 'application/vnd.microsoft.portable-executable', bytes: [0x4d, 0x5a], label: 'PE/DOS изпълним' },
  { ext: 'elf', mime: 'application/x-elf', bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'ELF изпълним' },
  { ext: 'gz', mime: 'application/gzip', bytes: [0x1f, 0x8b], label: 'gzip' },
  { ext: '7z', mime: 'application/x-7z-compressed', bytes: [0x37, 0x7a, 0xbc, 0xaf], label: '7-Zip' },
  { ext: 'rar', mime: 'application/vnd.rar', bytes: [0x52, 0x61, 0x72, 0x21], label: 'RAR' },
  { ext: 'sqlite', mime: 'application/vnd.sqlite3', bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65], label: 'SQLite' },
];

// Разширения, които ЗАКОННО може да носят даден истински тип (иначе е находка).
const EXPECTED = {
  pdf: ['pdf'],
  zip: ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'jar'],
  jpg: ['jpg', 'jpeg', 'jpe'],
  png: ['png'],
  gif: ['gif'],
  tif: ['tif', 'tiff'],
  pgp: ['pgp', 'asc', 'gpg', 'enc'],
  exe: ['exe', 'dll'],
  elf: ['so', 'bin', 'elf'],
  gz: ['gz', 'tgz'],
  '7z': ['7z'],
  rar: ['rar'],
  sqlite: ['sqlite', 'sqlite3', 'db'],
};

/** Тип по магически числа. `null`, когато нищо не пасва (тогава се казва „непознат“). */
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return null;
  for (const entry of MAGIC) {
    if (buffer.length < entry.bytes.length) continue;
    let hit = true;
    for (let i = 0; i < entry.bytes.length; i += 1) {
      if (buffer[i] !== entry.bytes[i]) { hit = false; break }
    }
    if (hit) return { ext: entry.ext, mime: entry.mime, label: entry.label, byBytes: entry.bytes.length };
  }
  // Текстов файл: валиден UTF-8 без NUL в първите 4 KiB.
  const head = buffer.subarray(0, Math.min(4096, buffer.length));
  if (!head.includes(0) && !head.includes(0x0d)) {
    const text = head.toString('utf8');
    if (!text.includes('\ufffd')) return { ext: 'txt', mime: 'text/plain', label: 'текст (UTF-8)', byBytes: 0 };
  }
  return null;
}

/** Shannon ентропия в бита на байт (0…8). */
function entropy(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 0;
  const counts = new Array(256).fill(0);
  const limit = Math.min(buffer.length, 1024 * 1024); // таван, за да не се обхожда гигабайт
  for (let i = 0; i < limit; i += 1) counts[buffer[i]] += 1;
  let bits = 0;
  for (const n of counts) {
    if (!n) continue;
    const p = n / limit;
    bits -= p * Math.log2(p);
  }
  return Math.round(bits * 1000) / 1000;
}

/** Структурни проверки — само евтини, за да не се чете файлът многократно. */
function structure(buffer, format) {
  const notes = [];
  if (format === 'zip') {
    // Централната директория трябва да е в края: без нея архивът е „отрязан“.
    const tail = buffer.subarray(Math.max(0, buffer.length - 66000));
    notes.push(tail.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ? { code: 'zip-central-directory', ok: true } : { code: 'zip-central-directory', ok: false, note: 'липсва централна директория — архивът е отрязан или повреден' });
  } else if (format === 'pdf') {
    const tail = buffer.subarray(Math.max(0, buffer.length - 2048));
    notes.push(tail.includes(Buffer.from('%%EOF', 'latin1')) ? { code: 'pdf-eof', ok: true } : { code: 'pdf-eof', ok: false, note: 'липсва %%EOF — PDF-ът е непълен' });
  } else if (format === 'png') {
    const tail = buffer.subarray(Math.max(0, buffer.length - 12));
    notes.push(tail.includes(Buffer.from('IEND', 'latin1')) ? { code: 'png-end', ok: true } : { code: 'png-end', ok: false, note: 'липсва IEND — PNG-то е отрязано' });
  } else if (format === 'jpg') {
    const tail = buffer.subarray(Math.max(0, buffer.length - 4));
    notes.push(tail.includes(Buffer.from([0xff, 0xd9])) ? { code: 'jpeg-eoi', ok: true } : { code: 'jpeg-eoi', ok: false, note: 'липсва EOI маркер — JPEG-ът е отрязан' });
  }
  return notes;
}

/**
 * Пълен анализ. `declaredName` е името (за разширението), `buffer` — байтовете.
 * Връща факти + находки с код; заключението не се прави тук.
 */
function analyze(buffer, { declaredName = '', includeGps = false } = {}) {
  const type = sniff(buffer);
  const bits = entropy(buffer);
  const declaredExt = path.extname(String(declaredName || '')).replace(/^\./, '').toLowerCase();
  const findings = [];

  if (!type) {
    findings.push({ code: 'TYPE_UNKNOWN', severity: 'info', note: 'съдържанието не съвпада с известен тип — не се твърди какво е' });
  } else if (declaredExt && EXPECTED[type.ext] && !EXPECTED[type.ext].includes(declaredExt)) {
    // Това е ФАКТЪТ „разширение != съдържание“, не присъда.
    findings.push({
      code: 'EXTENSION_MISMATCH',
      severity: 'high',
      note: `разширение „.${declaredExt}“, а съдържанието е ${type.label}`,
      declaredExt,
      actual: type.ext,
    });
  }

  for (const note of structure(buffer, type && type.ext)) {
    if (!note.ok) findings.push({ code: note.code.toUpperCase().replace(/-/g, '_'), severity: 'high', note: note.note });
  }

  // Ентропия: над 7.9 бита/байт е практически неразличимо от криптирано/компресирано.
  // Най-подозрителният случай е точно обратният на „известен архивен формат“: висока ентропия
  // при НЕПОЗНАТ тип (или при тип, който по начало не е компресиран) — затова тук `type` може
  // да е и `null`, вместо находката да се губи мълчаливо.
  const compressedByNature = ['zip', 'gz', '7z', 'rar', 'jpg', 'png', 'gif', 'pdf'];
  if (bits >= 7.9 && !(type && compressedByNature.includes(type.ext))) {
    findings.push({ code: 'HIGH_ENTROPY', severity: 'medium', note: `ентропия ${bits} бита/байт — съдържанието изглежда криптирано или компресирано`, entropy: bits });
  }

  // Метаданни: за изображения се четат EXIF/TIFF; за останалите се казва „няма“.
  let metadata = { format: 'none', fields: {}, gps: null };
  if (type && ['jpg', 'tif', 'png'].includes(type.ext)) {
    metadata = exif.extract(buffer, { includeGps });
    if (type.ext !== 'png' && !Object.keys(metadata.fields).length) {
      findings.push({ code: 'EXIF_ABSENT', severity: 'info', note: 'изображението няма EXIF — възможно е преработено или изнесено' });
    }
  }

  return {
    size: buffer.length,
    sha256: require('node:crypto').createHash('sha256').update(buffer).digest('hex'),
    declaredExt,
    type: type ? { ext: type.ext, mime: type.mime, label: type.label } : null,
    entropy: bits,
    metadata,
    findings,
    // Нивото се вдига само от находките, не от „предположение“.
    severity: findings.some((f) => f.severity === 'high') ? 'high' : findings.some((f) => f.severity === 'medium') ? 'medium' : 'none',
  };
}

module.exports = { analyze, sniff, entropy, structure, MAGIC, EXPECTED };
