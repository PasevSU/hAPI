'use strict';
// Core hierarchical store (DOCFLOW Phases 1). Own SQLite file, additive to the legacy
// metadata store. Canonical variable key: {prefix}-{ID_db}-{id_gruppe}-{field}.
// Orphan-first: records may exist without a group and be associated later (re-keys vars).
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const err = (m, status = 400) => Object.assign(new Error(m), { status });

function hex(n) { return crypto.randomBytes(n).toString('hex') }
const now = () => new Date().toISOString();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups(
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 description TEXT DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records(
 id TEXT PRIMARY KEY,
 prefix TEXT NOT NULL,
 group_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS variables(
 key TEXT PRIMARY KEY,
 record_id TEXT NOT NULL,
 field TEXT NOT NULL,
 value_text TEXT,
 value_number REAL,
 value_bool INTEGER,
 value_json TEXT,
 is_encrypted INTEGER DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS links(
 id TEXT PRIMARY KEY,
 record_id TEXT NOT NULL,
 group_id TEXT NOT NULL,
 relation TEXT DEFAULT 'member',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta(
 k TEXT PRIMARY KEY,
 v TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_group ON records(group_id);
CREATE INDEX IF NOT EXISTS idx_records_prefix ON records(prefix);
CREATE INDEX IF NOT EXISTS idx_variables_record ON variables(record_id);
CREATE INDEX IF NOT EXISTS idx_variables_field ON variables(field);
CREATE INDEX IF NOT EXISTS idx_variables_value_text ON variables(value_text);
CREATE INDEX IF NOT EXISTS idx_links_group ON links(group_id);
CREATE INDEX IF NOT EXISTS idx_links_record ON links(record_id);
`;

function create(opts = {}) {
  const path = opts.path || 'core.sqlite';
  const dbId = opts.dbId || '1';
  const secret = opts.secret || '';
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);

  const encKey = secret ? crypto.createHash('sha256').update('hapi-core:' + secret).digest() : null;
  function enc(v) {
    if (!encKey) throw err('No encryption secret configured', 500);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const ct = Buffer.concat([c.update(v, 'utf8'), c.final()]);
    return 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }
  function dec(s) {
    if (!encKey) throw err('No encryption secret configured', 500);
    if (!s || !s.startsWith('enc:v1:')) return s;
    const buf = Buffer.from(s.slice(7), 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }

  const stmt = {
    insGroup: db.prepare('INSERT INTO groups(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)'),
    updGroup: db.prepare('UPDATE groups SET name=?,description=?,updated_at=? WHERE id=?'),
    delGroup: db.prepare('DELETE FROM groups WHERE id=?'),
    getGroup: db.prepare('SELECT * FROM groups WHERE id=?'),
    listGroups: db.prepare('SELECT * FROM groups ORDER BY name COLLATE NOCASE'),
    insRecord: db.prepare('INSERT INTO records(id,prefix,group_id,created_at,updated_at) VALUES(?,?,?,?,?)'),
    updRecordGroup: db.prepare('UPDATE records SET group_id=?,updated_at=? WHERE id=?'),
    getRecord: db.prepare('SELECT * FROM records WHERE id=?'),
    listRecords: db.prepare('SELECT * FROM records ORDER BY created_at DESC'),
    listRecordsGroup: db.prepare('SELECT * FROM records WHERE group_id=? ORDER BY created_at DESC'),
    delRecord: db.prepare('DELETE FROM records WHERE id=?'),
    delVarsRecord: db.prepare('DELETE FROM variables WHERE record_id=?'),
    insLink: db.prepare('INSERT INTO links(id,record_id,group_id,relation,created_at) VALUES(?,?,?,?,?)'),
    delLink: db.prepare('DELETE FROM links WHERE record_id=? AND group_id=?'),
    delLinksRecord: db.prepare('DELETE FROM links WHERE record_id=?'),
    delLinksGroup: db.prepare('DELETE FROM links WHERE group_id=?'),
    insVar: db.prepare(`INSERT INTO variables(key,record_id,field,value_text,value_number,value_bool,value_json,is_encrypted,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_text=excluded.value_text,value_number=excluded.value_number,value_bool=excluded.value_bool,value_json=excluded.value_json,is_encrypted=excluded.is_encrypted,updated_at=excluded.updated_at`),
    delVar: db.prepare('DELETE FROM variables WHERE key=?'),
    delVarsPrefix: db.prepare('DELETE FROM variables WHERE key LIKE ?'),
    getVar: db.prepare('SELECT * FROM variables WHERE key=?'),
    varsRecord: db.prepare('SELECT * FROM variables WHERE record_id=? ORDER BY field'),
    varsGroupPrefix: db.prepare('SELECT * FROM variables WHERE key LIKE ?'),
  };

  function scopeKey(prefix, groupOrRec, field) {
    return [prefix, dbId, groupOrRec, field].join('-');
  }

  /**
   * Еднократно пренареждане на ключовете по ТЕКУЩОТО правило за област. Стар запис, писан
   * когато областта беше групата, се пре-изчислява към ключа с идентификатора на записа —
   * иначе старите редове остават сираци (и, по-лошо, продължават да делят един ключ).
   * Минава при отваряне, за да не иска ръчна стъпка при обновяване.
   */
  function migrateScopes() {
    const recs = stmt.listRecords.all();
    if (!recs.length) return;
    db.exec('BEGIN');
    try { for (const r of recs) rekey(r); db.exec('COMMIT') }
    catch (e) { db.exec('ROLLBACK'); throw e }
  }
  function recordScope(record) {
    // Областта на променливата е ЗАПИСЪТ, не групата. Дотук групата беше област: два записа в
    // една група с едно и също поле получаваха ЕДИН ключ, `ON CONFLICT(key)` презаписваше
    // стойността на първия, а `record_id` си оставаше негов — тоест стойността се местеше
    // безшумно между записи и вторият запис четеше празно. Групата остава в ключа (за да се чете
    // и пре-изчислява при преместване), но след нея стои идентификаторът на записа.
    return (record.group_id ? String(record.group_id) + '.' : 'ORPHAN-') + record.id;
  }
  function rekey(record) {
    // Rewrite every variable of a record to match its current group scope.
    // Assumes the caller has already opened a transaction.
    const scope = recordScope(record);
    const vars = stmt.varsRecord.all(record.id);
    for (const v of vars) {
      const nk = scopeKey(record.prefix, scope, v.field);
      // `created_at` СЕ ПАЗИ. Дотук тук се подаваше `v.updated_at` и преместването на запис
      // между групи пренаписваше кога е създадена стойността с кога е последно променена —
      // тоест колоната твърдеше „създадена“, а носеше „последна промяна“. Преместването сменя
      // само КЛЮЧА (областта), не стойността: и двете времена остават тези на стойността.
      if (nk !== v.key) { stmt.delVar.run(v.key); stmt.insVar.run(nk, v.record_id, v.field, v.value_text, v.value_number, v.value_bool, v.value_json, v.is_encrypted, v.created_at, v.updated_at); }
    }
  }

  function createGroup({ name, description = '', autoRecords = true, registry }) {
    name = (name || '').trim(); if (!name) throw err('Group name required');
    const id = hex(8), ts = now();
    db.exec('BEGIN');
    try {
      stmt.insGroup.run(id, name, description, ts, ts);
      if (autoRecords && registry) {
        for (const prefix of registry.prefixes) {
          const rid = hex(12);
          stmt.insRecord.run(rid, prefix, id, ts, ts);
          stmt.insLink.run(hex(12), rid, id, 'member', ts);
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e }
    return stmt.getGroup.get(id);
  }
  function updateGroup(id, { name, description }) {
    const g = stmt.getGroup.get(id); if (!g) throw err('Group not found', 404);
    if (name !== undefined && !String(name).trim()) throw err('Group name required');
    stmt.updGroup.run(name === undefined ? g.name : String(name).trim(), description === undefined ? g.description : String(description || ''), now(), id);
    return stmt.getGroup.get(id);
  }
  function deleteGroup(id) {
    const g = stmt.getGroup.get(id); if (!g) throw err('Group not found', 404);
    const recs = stmt.listRecordsGroup.all(id);
    db.exec('BEGIN');
    try {
      for (const r of recs) { stmt.delVarsRecord.run(r.id); stmt.delRecord.run(r.id) }
      stmt.delLinksGroup.run(id); stmt.delGroup.run(id); db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e }
    return true;
  }
  function listGroups() { return stmt.listGroups.all() }
  function getGroup(id) { return stmt.getGroup.get(id) || null }

  function createRecord({ prefix, group_id = null, fields = {}, registry }) {
    if (registry && !registry.getProfile(prefix)) throw err('Unknown profile', 404);
    let clean = {};
    if (registry) { clean = registry.validateRecord(prefix, fields); }
    else { for (const [k, v] of Object.entries(fields)) clean[k] = v }
    const id = hex(12), ts = now();
    db.exec('BEGIN');
    try {
      stmt.insRecord.run(id, prefix, group_id, ts, ts);
      if (group_id) { if (!stmt.getGroup.get(group_id)) throw err('Group not found', 404); stmt.insLink.run(hex(12), id, group_id, 'member', ts); }
      for (const [f, v] of Object.entries(clean)) { const def = registry ? registry.fieldsFor(prefix).find(x => x.name === f) : null; writeVar({ record: { id, prefix, group_id }, field: f, value: v, created_at: ts }, def); }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e }
    return hydrate(stmt.getRecord.get(id));
  }
  function associateRecord(recordId, groupId) {
    const r = stmt.getRecord.get(recordId); if (!r) throw err('Record not found', 404);
    if (!stmt.getGroup.get(groupId)) throw err('Group not found', 404);
    db.exec('BEGIN');
    try {
      stmt.delLink.run(recordId, r.group_id || '');
      stmt.updRecordGroup.run(groupId, now(), recordId);
      r.group_id = groupId; rekey(r);
      stmt.insLink.run(hex(12), recordId, groupId, 'member', now());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e }
    return hydrate(stmt.getRecord.get(recordId));
  }
  function detachRecord(recordId) {
    const r = stmt.getRecord.get(recordId); if (!r) throw err('Record not found', 404);
    if (!r.group_id) return hydrate(r);
    db.exec('BEGIN');
    try {
      stmt.delLink.run(recordId, r.group_id);
      stmt.updRecordGroup.run(null, now(), recordId);
      r.group_id = null; rekey(r);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e }
    return hydrate(stmt.getRecord.get(recordId));
  }
  function getRecord(id) { const r = stmt.getRecord.get(id); return r ? hydrate(r) : null }
  function listRecords(groupId) { return (groupId ? stmt.listRecordsGroup.all(groupId) : stmt.listRecords.all()).map(hydrate) }
  function deleteRecord(id) {
    const r = stmt.getRecord.get(id); if (!r) throw err('Record not found', 404);
    db.exec('BEGIN');
    try { stmt.delVarsRecord.run(id); stmt.delLinksRecord.run(id); stmt.delRecord.run(id); db.exec('COMMIT') }
    catch (e) { db.exec('ROLLBACK'); throw e }
    return true;
  }

  function encodeValue(v, fieldDef) {
    if (fieldDef && fieldDef.type === 'encrypted') return { value_text: enc(String(v)), is_encrypted: 1 };
    if (fieldDef && fieldDef.type === 'list') { const arr = Array.isArray(v) ? v : String(v).split(',').map(s => s.trim()).filter(Boolean); return { value_text: arr.join(','), value_json: JSON.stringify(arr) } }
    if (fieldDef && fieldDef.type === 'bool') { const b = String(v) === 'true' || v === true; return { value_text: b ? 'true' : 'false', value_bool: b ? 1 : 0 } }
    if (fieldDef && fieldDef.type === 'number') {
      // Числото се разбира така, както го пише човек на български: „1 234,50“, „1.234,56“, „1,5“.
      // Дотук тук стоеше `Number(String(v).replace(',','.'))` — една замяна на ЕДНА запетая и без
      // махане на интервалите. Затова „1 234,50“ (интервал) и „1.234,56“ (две точки) даваха NaN,
      // а NaN се записваше мълчаливо: колоната `value_number` оставаше празна, а стойността се
      // четеше после като текст „NaN“. Число, което не може да се разбере, е грешка на входа (400),
      // а не стойност, която се пази и после лъже.
      const n = parseNumber(String(v == null ? '' : v));
      if (!Number.isFinite(n)) throw err(`Полето „${fieldDef.name || ''}“ не е число: ${String(v)}`, 400);
      return { value_text: String(n), value_number: n };
    }
    return { value_text: String(v) };
  }

  /**
   * Разчита число, написано както се пише на български или на английски.
   * Правило: интервалите и апострофите са разделители на хиляди и се махат; ако има и „,“ и „.“,
   * десетичен е ПОСЛЕДНИЯТ; ако има само „,“, той е десетичен. Празното е 0, както `Number('')`.
   */
  function parseNumber(text) {
    let t = String(text).replace(/[\s\u00a0\u202f']/g, '');
    if (!t) return 0;
    const comma = t.lastIndexOf(','), dot = t.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      if (comma > dot) t = t.replace(/\./g, '').replace(',', '.');
      else t = t.replace(/,/g, '');
    } else if (comma >= 0) {
      const parts = t.split(',');
      // „1,234“ с точно три знака след запетая е хиляди, не десетична дроб.
      t = parts.length === 2 && parts[1].length === 3 ? t.replace(/,/g, '') : t.replace(',', '.');
    }
    return Number(t);
  }
  function writeVar({ record, field, value, created_at }, fieldDef) {
    const ts = created_at || now();
    const scope = recordScope(record);
    const key = scopeKey(record.prefix, scope, field);
    const encv = encodeValue(value, fieldDef);
    stmt.insVar.run(key, record.id, field, encv.value_text ?? null, encv.value_number ?? null, encv.value_bool ?? null, encv.value_json ?? null, encv.is_encrypted || 0, ts, now());
  }
  function setVariable(recordId, field, value, fieldDef) {
    const r = stmt.getRecord.get(recordId); if (!r) throw err('Record not found', 404);
    const scope = recordScope(r), key = scopeKey(r.prefix, scope, field);
    const encv = encodeValue(value, fieldDef);
    stmt.insVar.run(key, recordId, field, encv.value_text ?? null, encv.value_number ?? null, encv.value_bool ?? null, encv.value_json ?? null, encv.is_encrypted || 0, now(), now());
    return stmt.getVar.get(key);
  }
  function decodeVar(v) {
    if (v.is_encrypted) return { key: v.key, field: v.field, value: dec(v.value_text), encrypted: true };
    if (v.value_json != null) { try { return { key: v.key, field: v.field, value: JSON.parse(v.value_json) } } catch { return { key: v.key, field: v.field, value: v.value_text } } }
    if (v.value_bool != null) return { key: v.key, field: v.field, value: !!v.value_bool };
    if (v.value_number != null) return { key: v.key, field: v.field, value: v.value_number };
    return { key: v.key, field: v.field, value: v.value_text };
  }
  function hydrate(record) {
    const vars = stmt.varsRecord.all(record.id).map(decodeVar);
    const out = { ...record, fields: {} };
    for (const v of vars) out.fields[v.field] = v.value;
    return out;
  }
  function search(prefix, q) {
    q = (q || '').trim();
    if (!q) return [];
    const like = '%' + q + '%';
    const recs = stmt.listRecords.all().filter(r => !prefix || r.prefix === prefix);
    const out = [];
    for (const r of recs) {
      const vars = stmt.varsRecord.all(r.id);
      const hit = vars.some(v => !v.is_encrypted && v.value_text != null && v.value_text.toLowerCase().includes(q.toLowerCase()));
      if (hit) out.push(hydrate(r));
    }
    return out;
  }

  // Ключовете се пренареждат по текущото правило, преди модулът да е върнал API-то си.
  migrateScopes();
  return {
    db, createGroup, updateGroup, deleteGroup, listGroups, getGroup,
    createRecord, associateRecord, detachRecord, getRecord, listRecords, deleteRecord,
    setVariable, getVariable: k => { const v = stmt.getVar.get(k); return v ? decodeVar(v) : null },
    search, encrypt: enc, decrypt: dec,
    getMeta: k => { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : null },
    setMeta: (k, v) => { db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v)) },
    close: () => db.close()
  };
}
module.exports = { create };
