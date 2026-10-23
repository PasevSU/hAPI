'use strict';
// Фаза 11 / RS-01: манифест на отчет (Report Studio).
//
// Правило (ADR-0025): отчетът винаги е в криптографски обхват —
//   rfc3161-start е първи, rfc3161-stop е последен и двата са заключени.
// Манифестът описва САМО оформление. Той не съдържа издадени TSA токени,
// сертификати или подписи — те се появяват само при реално изпълнение,
// никога в preview или демо данни.
//
// Модулът работи и в браузър: `require` се ползва само ако съществува,
// а API-то се публикува като `globalThis.HapiReportManifest`.

let nodeCrypto = null;
try {
  if (typeof require === 'function') nodeCrypto = require('node:crypto');
} catch {
  nodeCrypto = null;
}

const SCHEMA_VERSION = 1;
const START = 'rfc3161-start';
const STOP = 'rfc3161-stop';
const SYSTEM_TYPES = [START, STOP];
const ELEMENT_TYPES = [
  'title',
  'subtitle',
  'text',
  'legal',
  'data-block',
  'table',
  'image',
  'qr',
  'separator',
  'pagebreak',
  'signature',
  'metadata',
  'hash-table',
  'logo',
  'certificate',
  'columns',
  'dynamic',
];
const HASH_ALGORITHMS = ['CRC32', 'MD5', 'SHA1', 'SHA256', 'SHA512'];
const PAGE_FORMATS = ['A4', 'A5', 'LETTER'];
const ORIENTATIONS = ['portrait', 'landscape'];
// Ключове, които биха представили издаден сертификат/подпис като част от оформлението.
const FORBIDDEN_KEYS = ['tsaToken', 'tsaTime', 'tsaTimestamp', 'signature', 'signatureValue', 'certificate'];
const BLOCK_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const TABLE_SOURCE = /^(records|variables|group):[A-Za-z0-9_-]{1,64}$/;
const MAX_BLOCKS = 200;
const MAX_COLUMNS = 32;
// Лого: изображението Е част от оформлението, затова е в манифеста като base64.
// Таванът е изричен — 512 000 знака base64 (~384 KB картинка), за да остане отчетът
// преносим, а заявката да се събере в лимита на тялото.
const MAX_LOGO_CHARS = 512000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,/i;
// Сертификатът НЕ се съхранява в манифеста (виж FORBIDDEN_KEYS) — блокът само
// посочва име, по което сървърът подава реалния сертификат при генериране.
const CERT_REF = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LAYOUT_COLUMNS = 4;
const MAX_COLUMN_TEXT = 4000;
const AGGREGATES = ['count', 'sum', 'min', 'max', 'avg'];

const DEFAULT_PAGE = { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] };
const DEFAULT_BRANDING = { organization: '', logo: '', qr: false };
const DEFAULT_PRINT = { pageNumbers: true, headerFooter: false, footerNote: '' };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// Детерминистичен JSON: сортирани ключове, за да е стабилен хешът на манифеста.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function normalizeBlock(block, index) {
  const b = isObject(block) ? clone(block) : {};
  b.id = text(b.id) || `b${index + 1}`;
  b.type = text(b.type);
  if (b.type === START || b.type === STOP) b.locked = b.locked !== false;
  return b;
}

// Попълва подразбиращи се стойности. Не поправя семантични грешки —
// те остават за validate(), за да не се „оправдае“ невалиден манифест.
function normalize(input) {
  const src = isObject(input) ? clone(input) : {};
  const page = isObject(src.page) ? clone(src.page) : {};
  const margins = Array.isArray(page.marginsMm) && page.marginsMm.length === 4
    ? page.marginsMm.slice(0, 4)
    : DEFAULT_PAGE.marginsMm.slice();
  const branding = isObject(src.branding) ? clone(src.branding) : {};
  const print = isObject(src.print) ? clone(src.print) : {};
  return {
    schemaVersion: src.schemaVersion === undefined ? SCHEMA_VERSION : src.schemaVersion,
    profile: text(src.profile) || 'default',
    page: {
      format: text(page.format) || DEFAULT_PAGE.format,
      orientation: text(page.orientation) || DEFAULT_PAGE.orientation,
      marginsMm: margins.map((n) => (isNumber(n) ? n : Number(n))),
    },
    branding: {
      organization: text(branding.organization),
      logo: text(branding.logo),
      qr: branding.qr === true,
    },
    print: {
      pageNumbers: print.pageNumbers !== false,
      headerFooter: print.headerFooter === true,
      footerNote: text(print.footerNote),
    },
    blocks: Array.isArray(src.blocks) ? src.blocks.map(normalizeBlock) : [],
  };
}

function findForbidden(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => findForbidden(item, `${path}[${i}]`, errors));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.includes(key) && child !== undefined && child !== null && child !== '') {
      errors.push({
        path: here,
        code: 'FORBIDDEN_FIELD',
        message: `Манифестът не може да съдържа „${key}“: издадени TSA/подпис стойности не са част от оформлението.`,
      });
    }
    findForbidden(child, here, errors);
  }
}

function validateBlock(block, index, seen) {
  const errors = [];
  const at = `blocks[${index}]`;
  if (!isObject(block)) {
    errors.push({ path: at, code: 'INVALID_BLOCK', message: 'Блокът трябва да е обект.' });
    return errors;
  }
  const id = text(block.id);
  const type = text(block.type);
  if (!id) {
    errors.push({ path: `${at}.id`, code: 'MISSING_BLOCK_ID', message: 'Липсва id на блока.' });
  } else if (!BLOCK_ID.test(id)) {
    errors.push({
      path: `${at}.id`,
      code: 'INVALID_BLOCK_ID',
      message: 'id трябва да е [a-z][a-z0-9_-]{0,63}.',
    });
  } else if (seen.has(id)) {
    errors.push({ path: `${at}.id`, code: 'DUPLICATE_BLOCK_ID', message: `Повторен id „${id}“.` });
  } else {
    seen.add(id);
  }
  if (!type) {
    errors.push({ path: `${at}.type`, code: 'MISSING_BLOCK_TYPE', message: 'Липсва type на блока.' });
  } else if (!ELEMENT_TYPES.includes(type) && !SYSTEM_TYPES.includes(type)) {
    errors.push({
      path: `${at}.type`,
      code: 'UNKNOWN_BLOCK_TYPE',
      message: `Непознат тип „${type}“. Позволени: ${ELEMENT_TYPES.join(', ')}.`,
    });
  }
  if (type === 'table') {
    if (!TABLE_SOURCE.test(text(block.source))) {
      errors.push({
        path: `${at}.source`,
        code: 'INVALID_TABLE_SOURCE',
        message: 'Източникът на таблица трябва да е records:<id> | variables:<id> | group:<id>.',
      });
    }
    const cols = block.columns;
    if (!Array.isArray(cols) || cols.length === 0 || cols.length > MAX_COLUMNS || !cols.every((c) => text(c))) {
      errors.push({
        path: `${at}.columns`,
        code: 'INVALID_TABLE_COLUMNS',
        message: `Колоните трябва да са 1–${MAX_COLUMNS} непразни имена.`,
      });
    }
  }
  if (type === 'logo') {
    // Логото е или вградено изображение, или нищо. Адрес във `branding.logo` не е
    // изображение — рендерът го казва честно, вместо да нарисува празно място.
    const raw = block.data !== undefined ? block.data : block.dataUrl;
    if (raw !== undefined && raw !== null && raw !== '') {
      if (typeof raw !== 'string') {
        errors.push({ path: `${at}.data`, code: 'INVALID_LOGO_DATA', message: 'Логото трябва да е base64 низ.' });
      } else if (raw.length > MAX_LOGO_CHARS) {
        errors.push({ path: `${at}.data`, code: 'LOGO_TOO_LARGE', message: `Логото е над ${MAX_LOGO_CHARS} знака (base64).` });
      } else if (raw.startsWith('data:') && !IMAGE_DATA_URL.test(raw)) {
        errors.push({ path: `${at}.data`, code: 'INVALID_LOGO_DATA', message: 'Приемат се само data:image/jpeg или data:image/png.' });
      }
    }
    for (const key of ['widthMm', 'heightMm']) {
      if (block[key] === undefined || block[key] === null) continue;
      if (!isNumber(block[key]) || block[key] < 5 || block[key] > 500) {
        errors.push({ path: `${at}.${key}`, code: 'INVALID_LOGO_SIZE', message: `${key} е число между 5 и 500 (мм).` });
      }
    }
  }
  if (type === 'certificate') {
    if (!CERT_REF.test(text(block.ref))) {
      errors.push({
        path: `${at}.ref`,
        code: 'INVALID_CERT_REF',
        message: 'Посочи ref на сертификата (A–Z, a–z, 0–9, „_“, „-“; до 64 знака).',
      });
    }
  }
  if (type === 'columns') {
    const cols = block.columns;
    if (!Array.isArray(cols) || cols.length < 1 || cols.length > MAX_LAYOUT_COLUMNS) {
      errors.push({
        path: `${at}.columns`,
        code: 'INVALID_COLUMNS',
        message: `Колоните са 1–${MAX_LAYOUT_COLUMNS} на брой.`,
      });
    } else {
      cols.forEach((col, ci) => {
        const okShape = isObject(col) && text(col.text) && text(col.text).length <= MAX_COLUMN_TEXT && (!col.title || text(col.title).length <= 80);
        if (!okShape) {
          errors.push({
            path: `${at}.columns[${ci}]`,
            code: 'INVALID_COLUMNS',
            message: `Всяка колона има текст (до ${MAX_COLUMN_TEXT} знака) и по избор заглавие (до 80).`,
          });
        }
      });
    }
  }
  if (type === 'dynamic') {
    if (!TABLE_SOURCE.test(text(block.source))) {
      errors.push({
        path: `${at}.source`,
        code: 'INVALID_DYNAMIC_SOURCE',
        message: 'Източникът на динамичния блок е records:<id> | variables:<id> | group:<id>.',
      });
    }
    const aggregate = text(block.aggregate) || 'count';
    if (!AGGREGATES.includes(aggregate)) {
      errors.push({
        path: `${at}.aggregate`,
        code: 'INVALID_DYNAMIC_AGGREGATE',
        message: `Агрегатът е един от: ${AGGREGATES.join(', ')}.`,
      });
    } else if (aggregate !== 'count') {
      // Без номер на колона „сума“ не значи нищо — отказва се, вместо да се познае.
      const field = block.field;
      if (!Number.isInteger(field) || field < 0 || field >= MAX_COLUMNS) {
        errors.push({
          path: `${at}.field`,
          code: 'INVALID_DYNAMIC_FIELD',
          message: `За „${aggregate}“ посочи колона field (0–${MAX_COLUMNS - 1}).`,
        });
      }
    }
  }
  if (type === 'hash-table') {
    const algs = block.algorithms;
    if (!Array.isArray(algs) || algs.length === 0) {
      errors.push({
        path: `${at}.algorithms`,
        code: 'UNKNOWN_ALGORITHM',
        message: `Посочи поне един алгоритъм: ${HASH_ALGORITHMS.join(', ')}.`,
      });
    } else {
      for (const alg of algs) {
        if (!HASH_ALGORITHMS.includes(String(alg).toUpperCase())) {
          errors.push({
            path: `${at}.algorithms`,
            code: 'UNKNOWN_ALGORITHM',
            message: `Непознат алгоритъм „${alg}“. Позволени: ${HASH_ALGORITHMS.join(', ')}.`,
          });
        }
      }
    }
  }
  return errors;
}

function validate(input) {
  const errors = [];
  if (!isObject(input)) {
    return {
      ok: false,
      errors: [{ path: '', code: 'INVALID_MANIFEST', message: 'Манифестът трябва да е JSON обект.' }],
    };
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    errors.push({
      path: 'schemaVersion',
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Поддържа се само schemaVersion ${SCHEMA_VERSION}.`,
    });
  }
  if (!text(input.profile)) {
    errors.push({ path: 'profile', code: 'INVALID_PROFILE', message: 'Липсва profile.' });
  }
  const page = input.page;
  if (!isObject(page)) {
    errors.push({ path: 'page', code: 'INVALID_PAGE', message: 'Липсва page.' });
  } else {
    if (!PAGE_FORMATS.includes(text(page.format))) {
      errors.push({ path: 'page.format', code: 'INVALID_PAGE', message: `Формат: ${PAGE_FORMATS.join(', ')}.` });
    }
    if (!ORIENTATIONS.includes(text(page.orientation))) {
      errors.push({ path: 'page.orientation', code: 'INVALID_PAGE', message: `Ориентация: ${ORIENTATIONS.join(', ')}.` });
    }
    const margins = page.marginsMm;
    if (!Array.isArray(margins) || margins.length !== 4 || !margins.every((m) => isNumber(m) && m >= 0 && m <= 50)) {
      errors.push({
        path: 'page.marginsMm',
        code: 'INVALID_PAGE',
        message: 'Полетата са 4 числа (мм) между 0 и 50.',
      });
    }
  }

  const blocks = input.blocks;
  if (!Array.isArray(blocks) || blocks.length < 2) {
    errors.push({
      path: 'blocks',
      code: 'INVALID_BLOCKS',
      message: 'Нужни са поне два блока: rfc3161-start и rfc3161-stop.',
    });
  } else {
    if (blocks.length > MAX_BLOCKS) {
      errors.push({ path: 'blocks', code: 'INVALID_BLOCKS', message: `Максимум ${MAX_BLOCKS} блока.` });
    }
    const first = isObject(blocks[0]) ? text(blocks[0].type) : '';
    const last = isObject(blocks[blocks.length - 1]) ? text(blocks[blocks.length - 1].type) : '';
    if (first !== START) {
      errors.push({ path: 'blocks[0]', code: 'START_NOT_FIRST', message: 'Първият блок трябва да е rfc3161-start.' });
    } else if (blocks[0].locked !== true) {
      errors.push({ path: 'blocks[0].locked', code: 'START_NOT_LOCKED', message: 'rfc3161-start трябва да е заключен.' });
    }
    if (last !== STOP) {
      errors.push({
        path: `blocks[${blocks.length - 1}]`,
        code: 'STOP_NOT_LAST',
        message: 'Последният блок трябва да е rfc3161-stop.',
      });
    } else if (blocks[blocks.length - 1].locked !== true) {
      errors.push({
        path: `blocks[${blocks.length - 1}].locked`,
        code: 'STOP_NOT_LOCKED',
        message: 'rfc3161-stop трябва да е заключен.',
      });
    }
    if (!SYSTEM_TYPES.includes(first)) {
      errors.push({ path: 'blocks', code: 'MISSING_START', message: 'Липсва rfc3161-start.' });
    }
    if (!SYSTEM_TYPES.includes(last)) {
      errors.push({ path: 'blocks', code: 'MISSING_STOP', message: 'Липсва rfc3161-stop.' });
    }
    const seen = new Set();
    blocks.forEach((block, i) => {
      const type = isObject(block) ? text(block.type) : '';
      const isBoundary = (i === 0 && type === START) || (i === blocks.length - 1 && type === STOP);
      if (!isBoundary && SYSTEM_TYPES.includes(type)) {
        errors.push({
          path: `blocks[${i}]`,
          code: 'SYSTEM_BLOCK_IN_MIDDLE',
          message: 'rfc3161-* е позволен само като първи и последен блок.',
        });
      }
      errors.push(...validateBlock(block, i, seen));
    });
  }

  findForbidden(input, '', errors);
  return { ok: errors.length === 0, errors };
}

function check(input) {
  const manifest = normalize(input);
  const result = validate(manifest);
  return { ...result, manifest };
}

function assertValid(input) {
  const result = check(input);
  if (!result.ok) {
    const first = result.errors[0];
    const error = new Error(`${first.code}: ${first.message}`);
    error.code = first.code;
    error.status = 400;
    error.errors = result.errors;
    throw error;
  }
  return result.manifest;
}

function digest(input) {
  if (!nodeCrypto) return null;
  const manifest = normalize(input);
  return nodeCrypto.createHash('sha256').update(canonical(manifest)).digest('hex');
}

// Браузърна версия на digest(): WebCrypto е асинхронен, затова е отделна функция.
async function digestAsync(input) {
  const manifest = normalize(input);
  const sync = digest(manifest);
  if (sync) return sync;
  const bytes = new TextEncoder().encode(canonical(manifest));
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function template(profile = 'default') {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile,
    page: { ...DEFAULT_PAGE, marginsMm: DEFAULT_PAGE.marginsMm.slice() },
    branding: { ...DEFAULT_BRANDING },
    print: { ...DEFAULT_PRINT },
    blocks: [
      { id: 'start', type: START, locked: true, label: 'RFC 3161 START' },
      { id: 'stop', type: STOP, locked: true, label: 'RFC 3161 STOP' },
    ],
  };
}

// Минимален JSON Schema (2020-12) за договор/документация; пълната семантика
// (заключени граници, уникални id, забранени полета) е във validate().
function schema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://hapi-enterprise/report-manifest.schema.json',
    title: 'hAPI Enterprise report manifest',
    type: 'object',
    required: ['schemaVersion', 'profile', 'page', 'blocks'],
    additionalProperties: true,
    properties: {
      schemaVersion: { const: SCHEMA_VERSION },
      profile: { type: 'string', minLength: 1, maxLength: 64 },
      page: {
        type: 'object',
        required: ['format', 'orientation', 'marginsMm'],
        properties: {
          format: { enum: PAGE_FORMATS },
          orientation: { enum: ORIENTATIONS },
          marginsMm: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 50 } },
        },
      },
      branding: {
        type: 'object',
        properties: {
          organization: { type: 'string' },
          logo: { type: 'string' },
          qr: { type: 'boolean' },
        },
      },
      print: {
        type: 'object',
        properties: {
          pageNumbers: { type: 'boolean' },
          headerFooter: { type: 'boolean' },
          footerNote: { type: 'string' },
        },
      },
      blocks: {
        type: 'array',
        minItems: 2,
        maxItems: MAX_BLOCKS,
        items: {
          type: 'object',
          required: ['id', 'type'],
          properties: {
            id: { type: 'string', pattern: BLOCK_ID.source },
            type: { enum: [...ELEMENT_TYPES, ...SYSTEM_TYPES] },
            locked: { type: 'boolean' },
          },
        },
      },
    },
  };
}

const API = {
  SCHEMA_VERSION,
  START,
  STOP,
  SYSTEM_TYPES,
  ELEMENT_TYPES,
  HASH_ALGORITHMS,
  AGGREGATES,
  PAGE_FORMATS,
  ORIENTATIONS,
  FORBIDDEN_KEYS,
  MAX_LAYOUT_COLUMNS,
  MAX_LOGO_CHARS,
  normalize,
  validate,
  check,
  assertValid,
  digest,
  digestAsync,
  canonical,
  template,
  schema,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof globalThis !== 'undefined') globalThis.HapiReportManifest = API;
