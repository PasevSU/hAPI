'use strict';
// EXIF / МЕТАДАННИ — извличане и СРАВНЕНИЕ (план 18, панел 08).
//
// ЗАЩО СЪЩЕСТВУВА
// `preview.js` даваше само размер, тип и текст. За доказателствен файл това не стига: снимка
// носи време на снимане, апарат, геолокация и наличие на редакция — все факти, които съдът
// пита, а интерфейсът не можеше да покаже. Тук метаданните се ЧЕТАТ от самите байтове.
//
// КАКВО ПРАВИ
//   • JPEG: APP1 сегмент `Exif\0\0` → TIFF (little/big endian) → IFD0, ExifIFD, GPS IFD.
//   • TIFF: директно IFD.
//   • PNG: `tEXt`/`iTXt`/`zTXt` (само tEXt се декодира) + размери от IHDR.
//   • Сравнение на два файла по избрани полета: кои са еднакви, кои се различават.
//
// КАКВО НЕ ПРАВИ
//   • Не „поправя“ и не пренаписва метаданни — само чете.
//   • Не показва GPS координати по подразбиране: те са лични данни. Връщат се само ако
//     извикващият поиска (`includeGps`), защото иначе всеки преглед би разкривал местоположение.
//   • Не се доверява на дължини от файла: всяко четене е с проверка на границите, за да не
//     може „експлойт чрез EXIF“ да обърка разбора или да зацикли.
const MAX_IFD_ENTRIES = 512;
const MAX_VALUE_BYTES = 65536;

// Колко байта заема един компонент от типа (TIFF §Type).
const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

// Полетата, които наистина се показват. Останалите се броят, но не се изнасят: списък от
// сто неща не е информация, а шум.
const NAMED_TAGS = {
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0112: 'Orientation',
  0x011a: 'XResolution',
  0x011b: 'YResolution',
  0x0128: 'ResolutionUnit',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x8769: 'ExifIFDPointer',
  0x8825: 'GPSInfoIFDPointer',
  0x9003: 'DateTimeOriginal',
  0x9004: 'DateTimeDigitized',
  0x9010: 'OffsetTime',
  0x9011: 'OffsetTimeOriginal',
  0x9291: 'SubSecTimeOriginal',
  0xa002: 'PixelXDimension',
  0xa003: 'PixelYDimension',
  0xa430: 'CameraOwnerName',
  0xa431: 'BodySerialNumber',
  0xa432: 'LensSpecification',
  0xa433: 'LensMake',
  0xa434: 'LensModel',
  0xa435: 'LensSerialNumber',
};

const GPS_TAGS = {
  0: 'GPSVersionID',
  1: 'GPSLatitudeRef',
  2: 'GPSLatitude',
  3: 'GPSLongitudeRef',
  4: 'GPSLongitude',
  5: 'GPSAltitudeRef',
  6: 'GPSAltitude',
  7: 'GPSTimeStamp',
  29: 'GPSDateStamp',
};

/**
 * Чете TIFF структура (използва се и от JPEG, и от TIFF).
 * Връща `{ fields, ifds }` — полетата са с четими стойности, `ifds` е броят намерени.
 */
function parseTiff(buf, base = 0) {
  if (base + 8 > buf.length) return null;
  const order = buf.toString('latin1', base, base + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(base + 2) !== 42) return null;
  const fields = {};
  let ifds = 0;

  const readValue = (type, count, valueOffset) => {
    const size = TYPE_SIZES[type];
    if (!size) return null;
    const total = size * count;
    if (total <= 0 || total > MAX_VALUE_BYTES) return null;
    // Стойността е „на място“, ако се побира в 4-те байта на полето.
    const at = total <= 4 ? valueOffset : base + u32(valueOffset);
    if (at < 0 || at + total > buf.length) return null;
    if (type === 2) return buf.toString('utf8', at, at + total).replace(/\0+$/, '');
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const o = at + i * size;
      if (type === 1 || type === 7) values.push(buf[o]);
      else if (type === 3) values.push(u16(o));
      else if (type === 4) values.push(u32(o));
      else if (type === 9) values.push(le ? buf.readInt32LE(o) : buf.readInt32BE(o));
      else if (type === 5 || type === 10) {
        const num = type === 5 ? u32(o) : (le ? buf.readInt32LE(o) : buf.readInt32BE(o));
        const den = type === 5 ? u32(o + 4) : (le ? buf.readInt32LE(o + 4) : buf.readInt32BE(o + 4));
        values.push(den === 0 ? null : num / den);
      } else if (type === 8) values.push(le ? buf.readInt16LE(o) : buf.readInt16BE(o));
      else return null;
    }
    return count === 1 ? values[0] : values;
  };

  const readIfd = (offset, names, into) => {
    if (ifds >= 8) return null; // защита от верига от IFD-та
    const at = base + offset;
    if (at + 2 > buf.length) return null;
    ifds += 1;
    const count = Math.min(u16(at), MAX_IFD_ENTRIES);
    for (let i = 0; i < count; i += 1) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > buf.length) break;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      if (n > MAX_VALUE_BYTES) continue;
      const value = readValue(type, n, entry + 8);
      if (value === null) continue;
      const name = names[tag];
      if (name) into[name] = value;
    }
    const next = at + 2 + count * 12;
    return next + 4 <= buf.length ? u32(next) : 0;
  };

  const exifStart = readIfd(u32(base + 4), NAMED_TAGS, fields) || 0;
  void exifStart;
  // ExifIFD и GPS IFD се намират по указателите от IFD0.
  if (typeof fields.ExifIFDPointer === 'number') {
    const sub = readIfd(fields.ExifIFDPointer, NAMED_TAGS, fields);
    void sub;
  }
  if (typeof fields.GPSInfoIFDPointer === 'number') {
    const gps = {};
    readIfd(fields.GPSInfoIFDPointer, GPS_TAGS, gps);
    if (Object.keys(gps).length) fields.gps = gps;
  }
  delete fields.ExifIFDPointer;
  delete fields.GPSInfoIFDPointer;
  return { fields, ifds };
}

/** Намира APP1 Exif сегмента в JPEG и чете TIFF от него. */
function parseJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) { at += 1; continue }
    const marker = buf[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue }
    if (marker === 0xda || marker === 0xd9) break; // начало на данните — повече метаданни няма
    const length = buf.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > buf.length) break;
    if (marker === 0xe1 && buf.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
      return parseTiff(buf, at + 10);
    }
    at += 2 + length;
  }
  return null;
}

/** Размери от PNG IHDR (винаги първият chunk). */
function pngInfo(buf) {
  if (buf.length < 33 || buf[0] !== 0x89 || buf.toString('latin1', 1, 4) !== 'PNG') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const text = {};
  let at = 8;
  while (at + 12 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    if (length < 0 || at + 12 + length > buf.length) break;
    if (type === 'tEXt') {
      const body = buf.subarray(at + 8, at + 8 + length).toString('latin1');
      const zero = body.indexOf('\0');
      if (zero > 0 && zero < 79) text[body.slice(0, zero)] = body.slice(zero + 1);
    }
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return { width, height, text };
}

/**
 * Извлича метаданни. `includeGps: false` (по подразбиране) оставя GPS извън резултата:
 * координатите са лични данни и не бива да излизат при обикновен преглед.
 */
function extract(buffer, { includeGps = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { format: 'unknown', fields: {}, gps: null, note: 'празен файл' };
  const jpeg = parseJpeg(buffer);
  if (jpeg) {
    const gps = jpeg.fields.gps || null;
    if (!includeGps) delete jpeg.fields.gps;
    return { format: 'jpeg', fields: jpeg.fields, gps: includeGps ? gps : (gps ? '[скрито]' : null), ifds: jpeg.ifds };
  }
  const tiff = parseTiff(buffer, 0);
  if (tiff) {
    const gps = tiff.fields.gps || null;
    if (!includeGps) delete tiff.fields.gps;
    return { format: 'tiff', fields: tiff.fields, gps: includeGps ? gps : (gps ? '[скрито]' : null), ifds: tiff.ifds };
  }
  const png = pngInfo(buffer);
  if (png) {
    return { format: 'png', fields: png.text, dimensions: { width: png.width, height: png.height }, gps: null, ifds: 0 };
  }
  return { format: 'unknown', fields: {}, gps: null, note: 'няма EXIF/TIFF структура' };
}

/**
 * Сравнява два файла по полета. Връща `{ same, different, onlyA, onlyB }` — така човек вижда
 * „снимките са от един апарат, но времената се различават“, вместо да сравнява на ръка.
 */
function compare(a, b, { includeGps = false } = {}) {
  const left = extract(a, { includeGps });
  const right = extract(b, { includeGps });
  const same = [];
  const different = [];
  const onlyA = [];
  const onlyB = [];
  const keys = new Set([...Object.keys(left.fields), ...Object.keys(right.fields)]);
  for (const key of [...keys].sort()) {
    const inA = Object.prototype.hasOwnProperty.call(left.fields, key);
    const inB = Object.prototype.hasOwnProperty.call(right.fields, key);
    if (inA && !inB) { onlyA.push(key); continue }
    if (!inA && inB) { onlyB.push(key); continue }
    const va = left.fields[key];
    const vb = right.fields[key];
    if (JSON.stringify(va) === JSON.stringify(vb)) same.push(key);
    else different.push({ field: key, a: va, b: vb });
  }
  return { a: left.format, b: right.format, same, different, onlyA, onlyB };
}

module.exports = { extract, compare, parseTiff, parseJpeg, NAMED_TAGS, GPS_TAGS };
