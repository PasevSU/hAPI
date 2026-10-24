'use strict';
// SQLite is the authoritative metadata store. The legacy JSON file is retained
// as a best-effort, human-readable compatibility snapshot, never read once SQLite exists.
const fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
function open(jsonPath) {
  const sqlitePath = jsonPath.replace(/\.json$/i, '') + '.sqlite';
  if (sqlitePath === jsonPath) throw Error('Expected a .json metadata filename');
  if (fs.existsSync(sqlitePath) && fs.lstatSync(sqlitePath).isSymbolicLink()) throw Error('Refusing symlink SQLite database');
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  const integrity = db.prepare('PRAGMA quick_check').get();
  if (!integrity || integrity.quick_check !== 'ok') { db.close(); throw Error('SQLite integrity check failed; refusing to start'); }
  db.exec(`CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS portal_index (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS file_index (id TEXT PRIMARY KEY, portal_id TEXT NOT NULL REFERENCES portal_index(id) ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS file_portal_idx ON file_index(portal_id);
 CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '["read","download"]', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT);
 CREATE INDEX IF NOT EXISTS sessions_username_idx ON sessions(username);
 -- Stage D: публичен токен за ЕДИН портал. Пази се само SHA-256 отпечатъкът — самият
 -- токен съществува един път, в отговора на издаването. Няма FOREIGN KEY към
 -- portal_index, защото индексът се пресъздава при всеки запис на метаданните
 -- (ON DELETE CASCADE би изтрил токените). Порталите се проверяват в JS.
 CREATE TABLE IF NOT EXISTS portal_tokens (id TEXT PRIMARY KEY, portal_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT);
 CREATE INDEX IF NOT EXISTS portal_tokens_portal_idx ON portal_tokens(portal_id);
 -- Краткотрайна бисквитка, издадена СЛЕД отваряне на /t/<token>. Живее само докато
 -- токенът е валиден: отнемането му трие и сесиите (без да се чака срокът).
 CREATE TABLE IF NOT EXISTS portal_sessions (token_hash TEXT PRIMARY KEY, portal_token_id TEXT NOT NULL REFERENCES portal_tokens(id) ON DELETE CASCADE, portal_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS portal_sessions_token_idx ON portal_sessions(portal_token_id);
 -- ACL на потребителски акаунт: кои портали вижда. Празно = всички (старото поведение).
 CREATE TABLE IF NOT EXISTS user_portals (username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE, portal_id TEXT NOT NULL, PRIMARY KEY(username, portal_id));`);
  const get = db.prepare('SELECT payload FROM metadata WHERE id=1');
  const getSnapshot = db.prepare('SELECT payload, revision FROM metadata WHERE id=1');
  const getRevision = db.prepare('SELECT revision FROM metadata WHERE id=1');
  const insert = db.prepare('INSERT INTO metadata(id,payload,revision) VALUES(1,?,0)');
  const replace = db.prepare('UPDATE metadata SET payload=?, revision=revision+1 WHERE id=1');
  // Записът е сравнение-и-размяна: ревизията, която сме прочели, трябва да е още същата.
  // Така втори процес, който е записал между нашето четене и нашето писане, не се губи.
  const replaceIf = db.prepare('UPDATE metadata SET payload=?, revision=revision+1 WHERE id=1 AND revision=?');
  const insertPortal = db.prepare('INSERT INTO portal_index(id,slug,title) VALUES(?,?,?)');
  const insertFile = db.prepare('INSERT INTO file_index(id,portal_id,name,size) VALUES(?,?,?,?)');
  const insertUser = db.prepare('INSERT INTO users(username,password_hash,scopes,active,created_at) VALUES(?,?,?,1,?)');
  const selectUser = db.prepare('SELECT username,password_hash,scopes,active,created_at FROM users WHERE username=?');
  const selectUsers = db.prepare('SELECT username,scopes,active,created_at FROM users ORDER BY username');
  const updateUserStmt = db.prepare('UPDATE users SET password_hash=?,scopes=?,active=? WHERE username=?');
  const deleteUserStmt = db.prepare('DELETE FROM users WHERE username=?');
  const insertSession = db.prepare('INSERT INTO sessions(token_hash,username,created_at,expires_at) VALUES(?,?,?,?)');
  const selectSession = db.prepare('SELECT s.token_hash,s.username,s.created_at,s.expires_at,u.scopes,u.active FROM sessions s JOIN users u ON u.username=s.username WHERE s.token_hash=?');
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token_hash=?');
  const deleteUserSessionsStmt = db.prepare('DELETE FROM sessions WHERE username=?');
  const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at<=?');
  const insertPortalToken = db.prepare('INSERT INTO portal_tokens(id,portal_id,token_hash,scopes,label,created_at,expires_at) VALUES(?,?,?,?,?,?,?)');
  const selectPortalTokenByHash = db.prepare('SELECT id,portal_id,scopes,label,created_at,expires_at,revoked_at FROM portal_tokens WHERE token_hash=?');
  const selectPortalTokens = db.prepare('SELECT id,portal_id,scopes,label,created_at,expires_at,revoked_at FROM portal_tokens WHERE portal_id=? ORDER BY created_at DESC');
  const revokePortalTokenStmt = db.prepare('UPDATE portal_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL');
  const insertPortalSession = db.prepare('INSERT INTO portal_sessions(token_hash,portal_token_id,portal_id,created_at,expires_at) VALUES(?,?,?,?,?)');
  // Сесията се чете ЗАЕДНО с токена: отнемане или смяна на правата важи веднага, без
  // да се чака срокът на бисквитката.
  const selectPortalSession = db.prepare('SELECT s.token_hash,s.portal_id,s.expires_at,t.id AS token_id,t.scopes,t.expires_at AS token_expires_at,t.revoked_at FROM portal_sessions s JOIN portal_tokens t ON t.id=s.portal_token_id WHERE s.token_hash=?');
  const deletePortalSessionStmt = db.prepare('DELETE FROM portal_sessions WHERE token_hash=?');
  const deletePortalSessionsByToken = db.prepare('DELETE FROM portal_sessions WHERE portal_token_id=?');
  const deleteExpiredPortalSessions = db.prepare('DELETE FROM portal_sessions WHERE expires_at<=?');
  const countPortalSessions = db.prepare('SELECT COUNT(*) AS n FROM portal_sessions WHERE expires_at>?');
  const insertUserPortal = db.prepare('INSERT OR IGNORE INTO user_portals(username,portal_id) VALUES(?,?)');
  const deleteUserPortalsStmt = db.prepare('DELETE FROM user_portals WHERE username=?');
  const deletePortalUsersStmt = db.prepare('DELETE FROM user_portals WHERE portal_id=?');
  const selectUserPortals = db.prepare('SELECT portal_id FROM user_portals WHERE username=? ORDER BY portal_id');
  const selectPortalUsers = db.prepare('SELECT username FROM user_portals WHERE portal_id=? ORDER BY username');
  const parseScopes = v => { try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter(s => s === 'read' || s === 'download') : ['read', 'download'] } catch { return ['read', 'download'] } };
  const nowIso = () => new Date().toISOString();
  function validate(v) { if (!v || !Array.isArray(v.portals)) throw Error('Invalid metadata payload'); if (!Array.isArray(v.qrArtifacts)) v.qrArtifacts = []; return v }
  // Повредени метаданни не бива да излизат като гол `SyntaxError` от JSON.parse:
  // операторът трябва да види КОЕ е повредено и какво да направи, иначе add-on-ът просто
  // не стартира с неразбираемо съобщение.
  function parseStored(text, where) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw Object.assign(
        new Error(`${where}: метаданните не са валиден JSON (${e.message}). Възстанови от архив или изтрий ${where === 'SQLite' ? 'базата' : 'файла'} и качи порталите наново.`),
        { status: 500, code: 'CORRUPT_METADATA' },
      );
    }
  }
  function load() { const row = get.get(); if (row) return validate(parseStored(row.payload, 'SQLite')); let initial = { portals: [], qrArtifacts: [] }; if (fs.existsSync(jsonPath)) initial = validate(parseStored(fs.readFileSync(jsonPath, 'utf8'), jsonPath)); db.exec('BEGIN IMMEDIATE'); try { insert.run(JSON.stringify(initial)); reindex(initial); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e } return initial }
  function reindex(v) { db.exec('DELETE FROM file_index; DELETE FROM portal_index'); for (const p of v.portals) { insertPortal.run(p.id, p.slug, p.title); for (const f of p.files || []) insertFile.run(f.id, p.id, f.name, f.size || 0) } }
  // `save(payload)` — безусловен запис (възстановяване от архив, начален seed).
  // `save(payload, revision)` — запис САМО ако ревизията е още `revision`; иначе
  // `STORE_CONFLICT` (код 409), за да може извикващият да прочете наново и да опита пак.
  function save(v, expectedRevision) {
    validate(v); db.exec('BEGIN IMMEDIATE');
    try {
      if (expectedRevision === undefined || expectedRevision === null) replace.run(JSON.stringify(v));
      else if (replaceIf.run(JSON.stringify(v), Number(expectedRevision)).changes !== 1) throw Object.assign(new Error('Метаданните са променени от друг процес (очаквана ревизия ' + Number(expectedRevision) + '). Прочети наново и опитай пак.'), { status: 409, code: 'STORE_CONFLICT', expectedRevision: Number(expectedRevision) });
      reindex(v); db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    // A failed JSON mirror cannot undo a committed SQLite transaction.
    try {
      // Never follow a pre-existing snapshot symlink. Use a unique, exclusive temporary
      // file and fsync its bytes before atomic replacement of the compatibility mirror.
      if (fs.existsSync(jsonPath) && fs.lstatSync(jsonPath).isSymbolicLink()) throw Error('Refusing symlink JSON snapshot');
      const tmp = jsonPath + '.' + require('node:crypto').randomBytes(12).toString('hex') + '.snapshot.tmp';
      let fd;
      try {
        fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
        fs.writeFileSync(fd, JSON.stringify(v, null, 2)); fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        fs.renameSync(tmp, jsonPath);
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        try { fs.unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') console.error('Snapshot cleanup failed:', e.message) }
      }
    } catch (e) { console.error('JSON SNAPSHOT FAILED:', e.message) }
    return revision()
  }
  // Колко е голяма ревизията в базата — една подготвена заявка, без payload. Служи за
  // „има ли нови данни?“ проверка преди всяка заявка, без да се чете целият JSON.
  function revision() { const row = getRevision.get(); return row ? Number(row.revision) || 0 : 0 }
  // Данните и ревизията им в ЕДНА заявка — така читането не може да хване половин състояние.
  function snapshot() {
    const row = getSnapshot.get();
    if (!row) return { payload: load(), revision: revision() };
    return { payload: validate(parseStored(row.payload, 'SQLite')), revision: Number(row.revision) || 0 };
  }
  function stats() { const sizes = [sqlitePath, sqlitePath + '-wal', sqlitePath + '-shm'].map(p => { try { return fs.statSync(p).size } catch (e) { if (e.code === 'ENOENT') return 0; throw e } }); return { engine: 'sqlite', sqlitePath, bytes: sizes.reduce((a, b) => a + b, 0), databaseBytes: sizes[0], walBytes: sizes[1], sharedMemoryBytes: sizes[2], revision: db.prepare('SELECT revision FROM metadata WHERE id=1').get()?.revision || 0 } }
  // Бърза проверка на цялата база (PRAGMA quick_check): открива повредени страници,
  // които не пречат на отварянето, но правят записа опасен. Read-only, безопасна за
  // извикване от /ready — не пипа данните и не блокира записа за дълго.
  function quickCheck() {
    try {
      const row = db.prepare('PRAGMA quick_check').get();
      const value = row ? Object.values(row)[0] : 'failed';
      return { ok: String(value) === 'ok', result: String(value == null ? 'failed' : value) };
    } catch (e) {
      return { ok: false, result: e.message || 'quick_check failed' };
    }
  }
  function backup(destination) {
    if (typeof destination !== 'string' || !destination.endsWith('.sqlite')) throw Error('Backup destination must be .sqlite');
    if (fs.existsSync(destination)) throw Error('Backup destination already exists');
    const parent = path.dirname(destination);
    fs.mkdirSync(parent, { recursive: true });
    if (fs.lstatSync(parent).isSymbolicLink()) throw Error('Backup parent cannot be a symlink');
    const temp = destination + '.' + require('node:crypto').randomBytes(8).toString('hex') + '.tmp.sqlite';
    try {
      const escaped = temp.replace(/'/g, "''");
      db.exec("VACUUM INTO '" + escaped + "'");
      const check = new DatabaseSync(temp, { readOnly: true });
      try { if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw Error('Backup integrity check failed') } finally { check.close() }
      // Exclusive destination creation prevents silently overwriting an existing backup.
      fs.linkSync(temp, destination);
      const bytes = fs.statSync(destination).size;
      return { destination, bytes };
    } finally { try { fs.unlinkSync(temp) } catch (e) { if (e.code !== 'ENOENT') console.error('Backup temporary cleanup failed:', e.message) } }
  }

  // Restore metadata from a previously created .sqlite backup. The backup is opened
  // read-only and integrity-checked, then its validated metadata payload is committed
  // through the normal transactional save path (which also reindexes and mirrors JSON).
  function restoreFrom(source) {
    if (typeof source !== 'string' || !source.endsWith('.sqlite')) throw Error('Restore source must be a .sqlite backup');
    if (!fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink()) throw Error('Restore source missing or unsafe');
    const src = new DatabaseSync(source, { readOnly: true });
    let payload;
    try {
      if (src.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw Error('Backup integrity check failed');
      const row = src.prepare('SELECT payload FROM metadata WHERE id=1').get();
      if (!row) throw Error('Backup contains no metadata payload');
      payload = validate(JSON.parse(row.payload));
    } finally { src.close() }
    save(payload);
    return { restored: true, portals: payload.portals.length, qrArtifacts: (payload.qrArtifacts || []).length, revision: stats().revision };
  }

  function createUser(username, passwordHash, scopes) { insertUser.run(username, passwordHash, JSON.stringify(scopes || ['read', 'download']), nowIso()) }
  function listUsers() { return selectUsers.all().map(u => ({ username: u.username, scopes: parseScopes(u.scopes), active: !!u.active, createdAt: u.created_at })) }
  function getUser(username) { const u = selectUser.get(username); return u ? { username: u.username, passwordHash: u.password_hash, scopes: parseScopes(u.scopes), active: !!u.active, createdAt: u.created_at } : null }
  function updateUser(username, { passwordHash, scopes, active }) { const cur = getUser(username); if (!cur) return false; updateUserStmt.run(passwordHash === undefined ? cur.passwordHash : passwordHash, JSON.stringify(scopes === undefined ? cur.scopes : scopes), active === undefined ? (cur.active ? 1 : 0) : (active ? 1 : 0), username); return true }
  function deleteUser(username) { return deleteUserStmt.run(username).changes > 0 }
  function createSession(tokenHash, username, expiresAt) { insertSession.run(tokenHash, username, nowIso(), expiresAt || null) }
  function getSession(tokenHash) { const s = selectSession.get(tokenHash); if (!s) return null; if (s.expires_at && Date.parse(s.expires_at) <= Date.now()) { deleteSessionStmt.run(tokenHash); return null } if (!s.active) return null; return { tokenHash: s.token_hash, username: s.username, createdAt: s.created_at, expiresAt: s.expires_at || null, scopes: parseScopes(s.scopes) } }
  function deleteSession(tokenHash) { return deleteSessionStmt.run(tokenHash).changes > 0 }
  function deleteUserSessions(username) { deleteUserSessionsStmt.run(username) }
  function purgeExpiredSessions() { deleteExpiredStmt.run(nowIso()) }

  // ── Stage D: публични токени за конкретен портал ───────────────────────────
  const tokenView = (row) => (row ? { id: row.id, portalId: row.portal_id, scopes: parseScopes(row.scopes), label: row.label || '', createdAt: row.created_at, expiresAt: row.expires_at || null, revokedAt: row.revoked_at || null } : null);
  function createPortalToken({ id, portalId, tokenHash, scopes, label, expiresAt }) { insertPortalToken.run(id, portalId, tokenHash, JSON.stringify(scopes || ['read']), label || '', nowIso(), expiresAt || null) }
  function getPortalTokenByHash(tokenHash) { return tokenView(selectPortalTokenByHash.get(tokenHash)) }
  function listPortalTokens(portalId) { return selectPortalTokens.all(portalId).map(tokenView) }
  /** Отнемане: токенът спира и ВСИЧКИ сесии, произлезли от него — веднага. */
  function revokePortalToken(id) { const changed = revokePortalTokenStmt.run(nowIso(), id).changes > 0; if (changed) deletePortalSessionsByToken.run(id); return changed }
  function createPortalSession(tokenHash, { tokenId, portalId, expiresAt }) { insertPortalSession.run(tokenHash, tokenId, portalId, nowIso(), expiresAt) }
  function getPortalSession(tokenHash) {
    const row = selectPortalSession.get(tokenHash);
    if (!row) return null;
    const now = Date.now();
    const dead = row.revoked_at || Date.parse(row.expires_at) <= now || (row.token_expires_at && Date.parse(row.token_expires_at) <= now);
    if (dead) { deletePortalSessionStmt.run(tokenHash); return null }
    return { tokenHash: row.token_hash, portalId: row.portal_id, tokenId: row.token_id, scopes: parseScopes(row.scopes), expiresAt: row.expires_at };
  }
  function deletePortalSession(tokenHash) { return deletePortalSessionStmt.run(tokenHash).changes > 0 }
  /** Изчиства изтеклите сесии и изтеклите (неотнети) токени връща като списък за одит. */
  function purgeExpiredPortalAccess() {
    const now = nowIso();
    deleteExpiredPortalSessions.run(now);
    deleteExpiredStmt.run(now);
    return { sessions: countPortalSessions.get(now).n };
  }
  function setUserPortals(username, portalIds) {
    deleteUserPortalsStmt.run(username);
    for (const portalId of portalIds || []) insertUserPortal.run(username, String(portalId));
    return getUserPortals(username);
  }
  function getUserPortals(username) { return selectUserPortals.all(username).map((r) => r.portal_id) }
  /** ACL откъм портала: кой вижда ТОЗИ портал (правото се дава на потребителя). */
  function setPortalUsers(portalId, usernames) {
    deletePortalUsersStmt.run(portalId);
    for (const username of usernames || []) insertUserPortal.run(String(username), portalId);
    return getPortalUsers(portalId);
  }
  function getPortalUsers(portalId) { return selectPortalUsers.all(portalId).map((r) => r.username) }

  return { load, save, revision, snapshot, stats, quickCheck, backup, restoreFrom, createUser, listUsers, getUser, updateUser, deleteUser, createSession, getSession, deleteSession, deleteUserSessions, purgeExpiredSessions, createPortalToken, getPortalTokenByHash, listPortalTokens, revokePortalToken, createPortalSession, getPortalSession, deletePortalSession, purgeExpiredPortalAccess, setUserPortals, getUserPortals, setPortalUsers, getPortalUsers, close: () => db.close() };
}
module.exports = { open };
