'use strict';
// ЛИСТЪТ НА `/statik/` ЛИНКОВЕТЕ (ADR-0028, D4/D5).
//
// Защо съществува: отчетът с едно натискане трябва да даде „твърдогенериран“ адрес, който
// се изпраща на проверяващ и се цитира в преписка. Затова всеки отчет получава запис в
// `<DATA_DIR>/statik/index.json`, а `/statik/<id>/<име>` сервира САМО файла на записа.
//
// Правилата, които модулът налага:
//   1. `id` е 24 случайни байта в base64url (32 знака), тоест не се познава и не се брои
//      подред — адресът е capability, не автентикация;
//   2. пътят от URL-а НЕ се ползва за достъп до диска: файлът се намира по `id` в листа,
//      затова няма изход с `../` (проверява го `tests/statik-links.cjs`);
//   3. записът е атомарен (temp + rename) — половин JSON не бива да оставя листа без линкове;
//   4. четенето е толерантно: счупен лист дава празен списък и предупреждение в лога, а не
//      срив на маршрута (панелът не бива да пада заради листа);
//   5. чистенето маха само ИЗТЕКЛИ записи и файловете им; ръчното триене е отделен път.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// Един четец на JSON (DEF-67): счупен лист не бива да хвърля и да събаря маршрута.
const { parseJson } = require('./parse-json');

const INDEX_NAME = 'index.json';
// Същата политика като `portal-archive.js`: доказателството живее 183 дни, после се маха.
const RETENTION_DAYS = 183;
const ID = /^[A-Za-z0-9_-]{32}$/;
const NAME = /^[A-Za-z0-9._-]{1,120}$/;

const dayMs = 24 * 60 * 60 * 1000;

/** Нов идентификатор на линк: 24 байта → 32 знака base64url (без „=“). */
function newId() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * @param {{dir: string, log?: object, now?: () => number, retentionDays?: number}} opts
 *   `dir` е папката `statik/` (файловете и листът живеят заедно, за да се чистят наведнъж).
 */
function create({ dir, log = null, now = () => Date.now(), retentionDays = RETENTION_DAYS } = {}) {
  if (!dir) throw new Error('statik-index: липсва папка');
  const indexPath = path.join(dir, INDEX_NAME);
  const ttlMs = Math.max(1, Number(retentionDays) || RETENTION_DAYS) * dayMs;
  let state = null; // { version, updatedAt, links: { id: record } }
  let dirty = false;

  const empty = () => ({ version: 1, updatedAt: new Date(now()).toISOString(), links: {} });

  function ensure() {
    if (state) return state;
    let raw;
    try {
      raw = fs.readFileSync(indexPath, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') log?.warn?.('statik.index.unreadable', { ns: 'statik', err: e.message });
      state = empty();
      return state;
    }
    const decoded = parseJson(raw);
    if (!decoded.ok) {
      // Счупен лист → празен списък и предупреждение: панелът не бива да пада заради листа.
      log?.warn?.('statik.index.unreadable', { ns: 'statik', err: String(decoded.error && decoded.error.message) });
      state = empty();
      return state;
    }
    const parsed = decoded.value && typeof decoded.value === 'object' ? decoded.value : {};
    const links = parsed.links && typeof parsed.links === 'object' ? parsed.links : {};
    // Запис без `id`/`url` не може да се сервира — маха се, вместо да дава 500 по-късно.
    for (const [id, record] of Object.entries(links)) {
      if (!ID.test(id) || !record || typeof record !== 'object' || !record.file) delete links[id];
    }
    state = { version: 1, updatedAt: parsed.updatedAt ? String(parsed.updatedAt) : new Date(now()).toISOString(), links };
    return state;
  }

  function save() {
    const s = ensure();
    s.updatedAt = new Date(now()).toISOString();
    fs.mkdirSync(dir, { recursive: true });
    const tmp = indexPath + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, indexPath);
    dirty = false;
  }

  // Файлът на диска е `<id>.pdf`, а `file` в листа е ИМЕТО за показване (то влиза в адреса).
  // Двете са различни нарочно: едно и също име за два отчета не бива да се презаписва, а
  // пътят от URL-а никога не се използва за достъп до диска — само `id`.
  const diskNameOf = (id) => String(id) + '.pdf';
  const filePathOf = (record) => path.join(dir, diskNameOf(record.id));

  /** Пътят на файла по `id` — `null`, ако записът липсва или е изтекъл. */
  function locate(id) {
    const key = String(id || '');
    if (!ID.test(key)) return null;
    const record = ensure().links[key];
    if (!record) return null;
    if (Date.parse(record.expiresAt) <= now()) return null;
    return { record, file: filePathOf(record) };
  }

  return {
    dir,
    indexPath,
    newId,

    /** Пише байтовете като `<id>.pdf` (вътрешното име) и връща дисковото име. */
    put(id, buffer) {
      const key = String(id || '');
      if (!ID.test(key)) throw new Error('statik-index: невалиден id');
      fs.mkdirSync(dir, { recursive: true });
      const file = diskNameOf(key);
      fs.writeFileSync(path.join(dir, file), buffer, { mode: 0o600 });
      return file;
    },

    /** Добавя запис. Задължителни са `id`, `file`, `url` — останалото е описание. */
    add(record) {
      const key = String((record && record.id) || '');
      if (!ID.test(key)) throw new Error('statik-index: невалиден id');
      if (!NAME.test(String((record && record.file) || ''))) throw new Error('statik-index: невалидно име на файл');
      const at = record.createdAt || new Date(now()).toISOString();
      const saved = { ...record, id: key, createdAt: at, expiresAt: record.expiresAt || new Date(Date.parse(at) + ttlMs).toISOString(), hits: 0, lastHitAt: null };
      ensure().links[key] = saved;
      save();
      return saved;
    },

    /** Записът по `id` — `null`, ако липсва, е изтекъл или файлът му е изчезнал. */
    get(id) {
      const found = locate(id);
      if (!found) return null;
      if (!fs.existsSync(found.file)) {
        delete ensure().links[String(id)];
        dirty = true;
        return null;
      }
      return found.record;
    },

    /** Брояч на изтеглянията — в паметта; записва се при следващия `add`/`prune`. */
    touch(id) {
      const found = locate(id);
      if (!found) return null;
      found.record.hits = Number(found.record.hits || 0) + 1;
      found.record.lastHitAt = new Date(now()).toISOString();
      dirty = true;
      return found.record;
    },

    /** Маха запис И файла му. Връща `true`, ако е имало какво да се махне. */
    remove(id) {
      const key = String(id || '');
      const record = ensure().links[key];
      if (!record) return false;
      try {
        fs.unlinkSync(filePathOf(record));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      delete ensure().links[key];
      save();
      return true;
    },

    /** Всички живи записи, най-новите първи; `portalId` филтрира по портал. */
    list({ portalId = null } = {}) {
      const out = [];
      for (const record of Object.values(ensure().links)) {
        if (portalId && record.portalId !== portalId) continue;
        if (Date.parse(record.expiresAt) <= now()) continue;
        out.push(record);
      }
      return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    /** Чистене: изтекли записи и записи, чийто файл е изчезнал. Връща броя махнати. */
    prune() {
      const s = ensure();
      let removed = 0;
      for (const [id, record] of Object.entries(s.links)) {
        const expired = Date.parse(record.expiresAt) <= now();
        const missing = !fs.existsSync(filePathOf(record));
        if (!expired && !missing) continue;
        if (!missing) {
          try {
            fs.unlinkSync(filePathOf(record));
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        }
        delete s.links[id];
        removed += 1;
      }
      if (removed || dirty) save();
      return removed;
    },

    /** Колко записа има (за отчетите и тестовете). */
    size() {
      return Object.keys(ensure().links).length;
    },
  };
}

module.exports = { create, newId, RETENTION_DAYS, INDEX_NAME, ID };
