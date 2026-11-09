'use strict';
// ПРАВИЛО ЗА ЦЯЛОСТ ПРИ СТАРТИРАНЕ (0.69.208).
//
// Защо съществува: контейнерът се сглобява от много файлове, а add-on-ът се обновява от
// Supervisor/HACS и се разклонява в хранилища на потребители. Досега нищо не казваше дали
// РАБОТЕЩИЯТ код е този, който е издаден: частично копие, стар файл от предишен опит за
// обновяване или човешка намеса в контейнера изглеждат в лога като „странно поведение“, а не
// като „различен файл“. Затова при старт се сверява SHA-256 на КРИТИЧНИТЕ файлове срещу
// манифест, който се генерира при изданието (`scripts/integrity-manifest.cjs`).
//
// Правилата, които модулът налага:
//   1. Липсващ манифест НЕ е фатал — така се работи в дървото за разработка и в тестовете.
//      Казва се в лога като `integrity.manifest.missing`, за да не е тихо.
//   2. Разминаване се СЪОБЩАВА с имената на файловете (не със съдържанието им) и НЕ спира
//      старта — освен при `HAPI_INTEGRITY_STRICT=1`, където спира (fail-closed за строги
//      инсталации).
//   3. Съдържанието на файловете не влиза в лога, нито в отговори: само име, очакван и
//      намерен хеш (първите 12 знака), за да може да се сравни на око.
//   4. Модулът не пише нищо на диска и не прави мрежови заявки — само чете и сравнява.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_NAME = 'integrity-manifest.json';

/** Критичните файлове: маршрутизация, хранилище, публично лице, дебъгинг и дебъг протокол. */
const CRITICAL = [
  'start.js',
  'server.js',
  'paths.js',
  'storage-preflight.js',
  'integrity.js',
  'ui/index.html',
  'ui/app.js',
  'ui/settings-panel.js',
  'ui/field-labels.js',
  'ui/debug-objects.js',
  'ui/debug-ledger.js',
  'ui/i18n.js',
];

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function create({ root = __dirname } = {}) {
  const manifestPath = path.join(root, MANIFEST_NAME);

  /** Чете манифеста; липсващ/счупен се връща като `null` с причина, не като изключение. */
  function readManifest() {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.files || typeof parsed.files !== 'object') {
        return { manifest: null, reason: 'malformed' };
      }
      return { manifest: parsed, reason: '' };
    } catch (error) {
      return { manifest: null, reason: error && error.code === 'ENOENT' ? 'missing' : 'unreadable' };
    }
  }

  /**
   * Сверява дървото с манифеста.
   * Връща `{ status, checked, missing, changed, untracked, mismatches }`, където `status` е
   * `ok` · `missing` (няма манифест) · `malformed` · `mismatch`.
   */
  function verify() {
    const { manifest, reason } = readManifest();
    if (!manifest) return { status: reason === 'missing' ? 'missing' : 'malformed', checked: 0, missing: [], changed: [], untracked: [], mismatches: [] };

    const missing = [];
    const changed = [];
    const mismatches = [];
    let checked = 0;
    for (const [rel, expected] of Object.entries(manifest.files)) {
      const file = path.join(root, rel);
      let actual;
      try {
        actual = sha256(file);
      } catch {
        missing.push(rel);
        continue;
      }
      checked += 1;
      if (actual !== expected) {
        changed.push(rel);
        mismatches.push({ file: rel, expected: String(expected).slice(0, 12), actual: actual.slice(0, 12) });
      }
    }
    // Файл, който е в списъка на критичните, но липсва в манифеста: манифестът е остарял.
    const untracked = CRITICAL.filter((rel) => !(rel in manifest.files));
    return {
      status: missing.length || changed.length || untracked.length ? 'mismatch' : 'ok',
      checked,
      missing,
      changed,
      untracked,
      mismatches,
      generatedAt: manifest.generatedAt || '',
      version: manifest.version || '',
    };
  }

  /**
   * Правилото при старт: сверява и говори в лога. Връща резултата, за да може викащият да
   * реши дали да продължи (по подразбиране — да).
   */
  function verifyAtStartup({ strict = String(process.env.HAPI_INTEGRITY_STRICT || '') === '1', log = console } = {}) {
    const result = verify();
    const say = (level, message, details) => {
      // Логерът може да е частичен (в тестове) — липсващото ниво се пропуска, без да гърми.
      if (!log || typeof log[level] !== 'function') return;
      log[level](message, details || {});
    };
    if (result.status === 'ok') {
      say('info', 'integrity.ok: ' + result.checked + ' критични файла съвпадат с манифеста');
      return result;
    }
    if (result.status === 'missing' || result.status === 'malformed') {
      say('warn', 'integrity.manifest.' + result.status + ': няма валиден ' + MANIFEST_NAME + ' — стартът продължава');
      return result;
    }
    // Разминаване: имена, не съдържание. Хешовете са съкратени, за да се сравнят на око.
    say('error', 'integrity.mismatch: ' + result.mismatches.length + ' файла се различават от изданието', {
      files: result.mismatches.map((m) => m.file + ' (' + m.expected + ' → ' + m.actual + ')'),
      missing: result.missing,
      untracked: result.untracked,
    });
    if (strict) {
      const error = new Error('INTEGRITY_MISMATCH: ' + result.mismatches.map((m) => m.file).join(', '));
      error.integrity = result;
      throw error;
    }
    return result;
  }

  /** Текстът за човек (логове, диагностичен пакет) — без съдържание на файлове. */
  function describe(result) {
    const r = result || verify();
    if (r.status === 'ok') return 'цялост: ' + r.checked + ' файла съвпадат с манифеста' + (r.version ? ' (' + r.version + ')' : '');
    if (r.status === 'missing') return 'цялост: няма ' + MANIFEST_NAME + ' — сверката е пропусната';
    if (r.status === 'malformed') return 'цялост: ' + MANIFEST_NAME + ' е невалиден — сверката е пропусната';
    const parts = [];
    if (r.mismatches.length) parts.push('различни: ' + r.mismatches.map((m) => m.file).join(', '));
    if (r.missing.length) parts.push('липсват: ' + r.missing.join(', '));
    if (r.untracked.length) parts.push('не са в манифеста: ' + r.untracked.join(', '));
    return 'цялост: РАЗМИНАВАНЕ — ' + parts.join(' · ');
  }

  return { verify, verifyAtStartup, describe, readManifest, manifestPath };
}

module.exports = { create, CRITICAL, MANIFEST_NAME, sha256 };
