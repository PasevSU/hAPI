'use strict';
const http = require('node:http'), fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(process.env.DATA_DIR || '/data'), port = Number(process.env.PORT || 8099), adminToken = process.env.ADMIN_TOKEN;
// Една жива инстанция на data директория (виж instance-lock.js). Попълва се в start().
const instanceId = String(process.env.INSTANCE_ID || '').trim() || crypto.randomBytes(6).toString('hex');
let instanceState = { id: instanceId, acquired: false, tookOver: false };
const ingressMode = process.env.INGRESS_MODE === 'true', adminPort = Number(process.env.ADMIN_PORT || 8098), adminBindHost = process.env.ADMIN_BIND_HOST || '0.0.0.0';
// Supervisor address(es) allowed to hand out the Ingress auto-login token. The
// default is the standard hassio bridge peer; override with SUPERVISOR_PEER=a,b on
// installations that run Docker on a custom network.
const supervisorPeers = new Set(String(process.env.SUPERVISOR_PEER || '172.30.32.2').split(',').map(s => s.trim()).filter(Boolean));
// The admin (ingress) listener accepts only the Supervisor proxy and loopback. Home
// Assistant requires it: no other peer on the Docker network may reach the panel.
// ADMIN_PEERS overrides the list (custom Docker network, local reverse proxy, tests).
const adminPeers = new Set(String(process.env.ADMIN_PEERS || ['127.0.0.1', '::1', ...supervisorPeers].join(',')).split(',').map(s => s.trim()).filter(Boolean));
const runtime = require('./runtime-config').create(root); const eff = runtime.effective(); const requirePortalToken = eff.requirePortalToken;
const publicHost = process.env.PUBLIC_BIND_HOST || '127.0.0.1';
const corsOrigin = eff.corsOrigin;
if (!adminToken || adminToken.length < 24 || adminToken === 'CHANGE_TO_RANDOM_SECRET_AT_LEAST_24_CHARACTERS' || /^(.{1,8})\1{3,}$/.test(adminToken)) { console.error('ADMIN_TOKEN must be a unique random secret (at least 24 characters), not the default placeholder'); process.exit(1) }
const jobManager = require('./job-manager').create({
  dir: path.join(root, 'jobs'), concurrency: eff.maxJobs, resolveHandler: (type, params) => {
    if (type !== 'integrity-scan') throw Error('Unknown job type');
    const portalId = params && params.portalId;
    return async ctx => { const current = db.portals.find(x => x.id === portalId); if (!current) throw Object.assign(new Error('Portal removed'), { status: 404 }); const out = await verifyPortalFiles(current, ctx); if (!ctx.signal.aborted) void audit('integrity.verify', { portalId, summary: out.summary, job: true }); return out };
  }
});
const operatorToken = process.env.OPERATOR_TOKEN || null, viewerToken = process.env.VIEWER_TOKEN || null;
const parseRoles = v => { if (!v) return {}; if (typeof v === 'object' && !Array.isArray(v)) return v; try { const o = JSON.parse(v); if (!o || typeof o !== 'object' || Array.isArray(o)) return {}; return o } catch { return {} } };
// Роли за Ingress потребители: env (USER_ROLES) или опции на add-on-а (user_roles).
const addonOptions = (() => { try { return JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')) || {} } catch { return {} } })();
// Крипто опции: env (от start.js) има приоритет, после options.json, после default.
// Така същите стойности важат и при ръчен старт без Supervisor.
const optionValue = (envKey, optionKey, fallback) => { const env = process.env[envKey]; if (env !== undefined && String(env).trim() !== '') return String(env).trim(); const value = addonOptions[optionKey]; return value === undefined || value === null ? fallback : String(value).trim() };
const isEnabled = value => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
const cryptoOptions = {
  tsaEnabled: isEnabled(optionValue('TSA_ENABLED', 'tsa_enabled', 'false')),
  tsaStart: optionValue('TSA_START_URL', 'tsa_start_url', 'https://zeitstempel.dfn.de/'),
  tsaStop: optionValue('TSA_STOP_URL', 'tsa_stop_url', 'http://timestamp.digicert.com'),
  signPackages: isEnabled(optionValue('SIGN_PACKAGES', 'sign_packages', 'false')),
  signingKey: optionValue('SIGNING_KEY', 'signing_key', ''),
  encryptFiles: isEnabled(optionValue('ENCRYPT_FILES', 'encrypt_files', 'false')),
  tlsCert: optionValue('TLS_CERT', 'tls_cert', ''),
  tlsKey: optionValue('TLS_KEY', 'tls_key', ''),
};
const rbac = require('./rbac').create({ adminToken, operatorToken, viewerToken, userRoles: parseRoles(process.env.USER_ROLES || addonOptions.user_roles), groupRoles: parseRoles(process.env.GROUP_ROLES || addonOptions.group_roles), defaultRole: process.env.DEFAULT_ROLE || 'admin' });
const errorLog = require('./error-log').create(root);
// Сензори: комуникация, файлове, извиквания, изтегляния, посещения. Агрегати без
// лични данни; състоянието се записва в <DATA_DIR>/sensors.json и оцелява рестарт.
const observer = require('./observer').create({ dir: root });
// Structured debug log: option `log_level`, overridable with LOG_LEVEL for troubleshooting.
const log = require('./logger').create({ dir: root, level: process.env.LOG_LEVEL || addonOptions.log_level || 'info', maxBytes: process.env.LOG_MAX_BYTES, maxFiles: process.env.LOG_MAX_FILES, maxEntries: process.env.LOG_MAX_ENTRIES });
// Правилата за достъп се зареждат от директория (виж gateway-api.js); логерът се
// подава, за да не остава незабелязан fallback към вградените стойности.
const gatewayApi = require('./gateway-api');
gatewayApi.setLogger(log);
const configProfiles = require('./config-profiles').create(root);
const storageCheck = require('./storage-check');
const apiVersion = require('./api-version');
const signer = require('./signer');
const pgp = require('./pgp');
const packager = require('./packager').create({ root });
const fileCrypto = require('./file-crypto');
const sendLite = require('./send');
// Тайни връзки (zero-knowledge): сървърът пази само шифротекст, ключът е във фрагмента.
const secretLinks = require('./secret-links');
const secretPage = require('./secret-page');
// Последователен достъп на тайна по id: два едновременни прегледа не бива да минат
// и двата покрай лимита за прегледи (add-on-ът е един процес, значи това е достатъчно).
const secretLocks = new Map();
const withSecretLock = async (id, fn) => {
  const previous = secretLocks.get(id) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve });
  secretLocks.set(id, previous.then(() => current));
  await previous;
  try { return await fn() } finally { release(); if (secretLocks.get(id) === current) secretLocks.delete(id) }
};
const preview = require('./preview').create();
const versioning = require('./versioning').create();
const notify = require('./notify').create();
async function verifyPortalFiles(p, ctx) {
  const results = []; ctx.setTotal(p.files.length);
  for (const f of [...p.files]) {
    if (ctx.signal.aborted) break;
    if (ctx.throwIfPaused) ctx.throwIfPaused();
    const filePath = path.join(filesRoot, p.id, f.id); let actual = null, status = 'MISSING';
    try {
      const stat = await fsp.lstat(filePath); if (stat.isFile()) {
        if (f.encrypted) { const plain = fileCrypto.decrypt(fs.readFileSync(filePath), adminToken); actual = crypto.createHash('sha256').update(plain).digest('hex'); status = actual === f.sha256 && plain.length === f.size ? 'VERIFIED' : 'MISMATCH'; }
        else {
          const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(filePath)) { if (ctx.signal.aborted) break; hash.update(chunk) }
          if (ctx.signal.aborted) break;
          actual = hash.digest('hex'); status = actual === f.sha256 && stat.size === f.size ? 'VERIFIED' : 'MISMATCH';
        }
      } else status = 'INVALID_TYPE';
    } catch (e) { if (e.code !== 'ENOENT') status = 'ERROR' }
    results.push({ fileId: f.id, name: f.name, expectedSha256: f.sha256, actualSha256: actual, status }); ctx.advance();
  }
  const summary = { VERIFIED: 0, MISMATCH: 0, MISSING: 0, INVALID_TYPE: 0, ERROR: 0 }; for (const r of results) summary[r.status]++;
  return { portalId: p.id, summary, files: results, verified: summary.VERIFIED === results.length && results.length === p.files.length };
}
const dbPath = runtime.databasePath, filesRoot = path.join(root, 'files'), internalRoot = path.join(root, 'internal'); let db = { portals: [], qrArtifacts: [] }; let queue = Promise.resolve(); const metadataStore = require('./sqlite-store').open(dbPath);
const id = () => crypto.randomBytes(12).toString('hex');
// --- DOCFLOW core (Phase 1): hierarchical variable store, additive to legacy metadata ---
const coreDbId = (() => { const v = String(process.env.DB_ID || '1').trim(); return /^[A-Za-z0-9_-]{1,32}$/.test(v) ? v : '1' })();
const profilesConfig = (() => { const s = String(process.env.PROFILES || '').trim(); if (!s) return null; try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : null } catch { return null } })();
let docflowRegistry = null, coreStore = null;
try { docflowRegistry = require('./registry').create(profilesConfig); coreStore = require('./core-store').create({ path: path.join(root, 'core.sqlite'), dbId: coreDbId, secret: adminToken }); } catch (e) { log.error('docflow.init.failed', { ns: 'core', err: e.message }) }
const coreReady = () => { if (!docflowRegistry || !coreStore) throw Object.assign(new Error('Core unavailable'), { status: 503 }); return { registry: docflowRegistry, store: coreStore } };
const backupsDir = (() => { const v = String(process.env.BACKUP_DIR || '').trim(); if (!v) return path.join(root, 'backups'); const abs = path.isAbsolute(v) ? path.resolve(v) : path.resolve('/share', v); if (!['/share', '/media', '/config', '/data'].some(p => abs === p || abs.startsWith(p + '/')) && !process.env.BACKUP_DIR_ANY) throw Error('backup_folder must be inside /share, /media or /config'); return abs })();
// Втори таргет за копията на базата (друго устройство/споделена папка). Празен = без
// огледало. Всяко копие се проверява с SHA-256; при разлика копието се трие, за да не
// остане „изглеждащ валиден“ архив.
const backupsMirrorDir = (() => { const v = String(optionValue('BACKUP_MIRROR', 'backup_mirror', '')).trim(); if (!v) return ''; const abs = path.isAbsolute(v) ? path.resolve(v) : path.resolve('/share', v); if (!['/share', '/media', '/config', '/data'].some(p => abs === p || abs.startsWith(p + '/')) && !process.env.BACKUP_MIRROR_ANY) throw Error('backup_mirror must be inside /share, /media or /config'); if (abs === backupsDir) throw Error('backup_mirror must differ from backup_folder'); return abs })();
const auditChain = require('./audit-chain').createAuditChain(root);
const scopesAllowed = ['read', 'download'];
const htmlProjectsRoot = path.join(root, 'html-projects');
const accessModes = ['FREE', 'KEY_REQUIRED', 'DISABLED'];
const fileMode = f => f.accessMode || 'FREE';
const validExpiry = v => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) > Date.now();
// „Бърз линк“ (Send-lite): използваните билети живеят само докато не изтекат, а
// опитите с грешна парола се броят на двойка (линк, отсрещна страна).
const usedSendTickets = new Map(), sendFailures = new Map();
const SEND_MAX_FAILURES = 5, SEND_WINDOW_MS = 15 * 60 * 1000;
function sendGate(sendId, req) {
  const peer = req.socket.remoteAddress || 'unknown', key = sendId + '|' + peer, now = Date.now(), s = sendFailures.get(key);
  if (!s || now - s.since >= SEND_WINDOW_MS) return true;
  return s.count < SEND_MAX_FAILURES;
}
function registerSendFailure(sendId, req) {
  const peer = req.socket.remoteAddress || 'unknown', key = sendId + '|' + peer, now = Date.now();
  let s = sendFailures.get(key);
  if (!s || now - s.since >= SEND_WINDOW_MS) { s = { since: now, count: 0 }; sendFailures.set(key, s) }
  s.count++;
  if (sendFailures.size > 2048) sendFailures.delete(sendFailures.keys().next().value);
}
const pruneSendTickets = () => { const now = Date.now(); for (const [k, exp] of usedSendTickets) if (exp <= now) usedSendTickets.delete(k) };
const tokenMatch = (items, secret) => { if (!secret) return false; const digest = keyDigest(secret); return (items || []).some(k => safeEqual(k.hash, digest) && (!k.expiresAt || Date.parse(k.expiresAt) > Date.now())); };
const auditPath = path.join(root, 'audit.jsonl');
const retention = require('./retention').create({ filesRoot, auditPath, getSettings: () => runtime.settings });
const audit = (event, details = {}) => { void auditChain.append(event, details).catch(e => console.error('AUDIT CHAIN FAILURE', e)); return fsp.appendFile(auditPath, JSON.stringify({ at: new Date().toISOString(), event, ...details }) + '\n', { mode: 0o600 }).catch(e => console.error('AUDIT FAILURE', e)) };
const counters = { requests: 0, errors: 0, downloads: 0 };
const telemetryFile = path.join(root, 'telemetry.jsonl');
const telemetry = { visits: 0, downloads: 0, byPortal: {}, byFile: {}, byToken: {}, ratings: {}, recent: [] };
const rawIpEnabled = eff.storeRawIp;
const visitorIp = req => { const raw = req.socket.remoteAddress || 'unknown'; return rawIpEnabled ? raw : crypto.createHash('sha256').update(adminToken + ':' + raw).digest('hex').slice(0, 20) };
const tokenId = (req, url) => { const secret = (req.headers.authorization || '').replace(/^Bearer /i, '') || (url && url.searchParams.get('portal_token')) || ''; return secret ? keyDigest(secret).slice(0, 16) : 'anonymous' };
let telemetryQueue = Promise.resolve();
function recordTelemetry(event, req, p, f, url, extra = {}) {
  const entry = { at: new Date().toISOString(), event, portalId: p.id, fileId: f?.id || null, tokenId: tokenId(req, url), visitor: visitorIp(req), ...extra };
  telemetryQueue = telemetryQueue.then(() => fsp.appendFile(telemetryFile, JSON.stringify(entry) + '\n', { mode: 0o600 })).catch(e => console.error('TELEMETRY WRITE FAILED', e.code || e.message));
  applyTelemetry(entry); return telemetryQueue;
}
function applyTelemetry(e) {
  if (e.event === 'visit') telemetry.visits++;
  if (e.event === 'download') telemetry.downloads++;
  const portal = telemetry.byPortal[e.portalId] ??= { visits: 0, downloads: 0 };
  if (e.event === 'visit') portal.visits++;
  if (e.event === 'download') portal.downloads++;
  const token = telemetry.byToken[e.tokenId] ??= { visits: 0, downloads: 0 };
  if (e.event === 'visit') token.visits++;
  if (e.event === 'download') token.downloads++;
  if (e.fileId) {
    const file = telemetry.byFile[e.fileId] ??= { downloads: 0 }; if (e.event === 'download') file.downloads++;
    if (e.event === 'rating') { const rating = telemetry.ratings[e.fileId] ??= { count: 0, sum: 0 }; rating.count++; rating.sum += e.stars; }
  }
  telemetry.recent.push(e); if (telemetry.recent.length > 100) telemetry.recent.shift();
}

// A bounded number of active file streams prevents slow clients from exhausting
// file descriptors and memory. Streams use Node's native backpressure.
const maxDownloadStreams = eff.maxDownloadStreams;
const loadControl = require('./load-control').create({ base: maxDownloadStreams, min: Math.max(1, Math.min(maxDownloadStreams, 2)) });
let activeDownloadStreams = 0;
// Краткотрайна опашка: 2-3 едновременни линка не получават 503, а изчакват слот.
// 503 се връща само ако опашката не бъде обслужена в рамките на DOWNLOAD_WAIT_MS.
const downloadWaiters = [];
const DOWNLOAD_WAIT_MS = Number(process.env.DOWNLOAD_WAIT_MS) || 15000;
function releaseDownloadSlot() {
  if (activeDownloadStreams > 0) activeDownloadStreams--;
  while (downloadWaiters.length && activeDownloadStreams < loadControl.effective) {
    const next = downloadWaiters.shift();
    clearTimeout(next.timer);
    activeDownloadStreams++;
    next.resolve(true);
  }
}
function acquireDownloadSlot() {
  loadControl.recalc(counters.requests);
  if (activeDownloadStreams < loadControl.effective) { activeDownloadStreams++; return Promise.resolve(true) }
  return new Promise(resolve => {
    const entry = { resolve };
    entry.timer = setTimeout(() => {
      const index = downloadWaiters.indexOf(entry);
      if (index >= 0) downloadWaiters.splice(index, 1);
      resolve(false);
    }, DOWNLOAD_WAIT_MS);
    if (entry.timer.unref) entry.timer.unref();
    downloadWaiters.push(entry);
  });
}
async function streamDownload(req, res, fp, stat, name, onStart) {
  if (!(await acquireDownloadSlot())) { res.setHeader('Retry-After', '3'); return fail(res, 503, 'Download capacity reached') }
  let released = false;
  const release = () => { if (!released) { released = true; releaseDownloadSlot() } };
  let start = 0, end = stat.size - 1, status = 200;
  const rm = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (rm && (rm[1] || rm[2]) && stat.size > 0) {
    if (rm[1] === '') { start = Math.max(0, stat.size - Number(rm[2])) } else { start = Number(rm[1]); if (rm[2] !== '') end = Math.min(end, Number(rm[2])) }
    if (start > end || start >= stat.size) { release(); res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); return res.end() }
    status = 206;
  }
  const stream = fs.createReadStream(fp, stat.size ? { highWaterMark: 64 * 1024, start, end } : { highWaterMark: 64 * 1024 });
  stream.once('error', e => { release(); loadControl.recordError(); void errorLog.append('error', 'download-stream', e.code || e.message); log.error('download.stream.failed', { ns: 'download', err: e.code || e.message }); if (!res.headersSent) fail(res, 500, 'Download failed'); else res.destroy(e) });
  stream.once('close', release);
  res.once('close', () => { if (!stream.destroyed) stream.destroy(); release() });
  const rh = status === 206 ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size } : {};
  res.writeHead(status, { ...rh, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name.replace(/[\r\n]/g, '')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (onStart) onStart();
  stream.pipe(res);
}
// Encrypted files cannot support byte-range requests (AES-GCM is not seekable), so the
// plaintext is decrypted into memory and served whole. Opt-in and intended for documents,
// not large media.
async function serveEncryptedFile(req, res, fp, f, onStart) {
  if (!(await acquireDownloadSlot())) { res.setHeader('Retry-After', '3'); return fail(res, 503, 'Download capacity reached') }
  let released = false;
  const release = () => { if (!released) { released = true; releaseDownloadSlot() } };
  let buf; try { buf = fs.readFileSync(fp) } catch { release(); return fail(res, 404, 'File unavailable') }
  let plain; try { plain = fileCrypto.decrypt(buf, adminToken) } catch (e) { release(); log.error('file.decrypt.failed', { ns: 'download', err: e.message }); return fail(res, 500, 'Decryption failed') }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': plain.length, 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(f.name.replace(/[\r\n]/g, '')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (onStart) onStart();
  res.end(plain, release);
}
// Reads a file's plaintext into memory (decrypting when stored encrypted).
// Returns null when the physical file is missing or undecryptable.
// Огледало на файловете: второ копие на всяко качване (друго устройство/споделена
// папка). Пази се СЪЩИТЕ байтове като оригинала (вкл. шифровани), за да е сверката
// е просто равенство; при липса на оригинала четенето минава към копието и то се
// връща на място (самолекуване).
const storageMirrorDir = (() => {
  const v = String(optionValue('STORAGE_MIRROR', 'storage_mirror', '')).trim();
  if (!v) return '';
  const abs = path.isAbsolute(v) ? path.resolve(v) : path.resolve('/share', v);
  if (!['/share', '/media', '/config', '/data'].some(p => abs === p || abs.startsWith(p + '/')) && !process.env.STORAGE_MIRROR_ANY) throw Error('storage_mirror must be inside /share, /media or /config');
  if (abs === root || abs === path.join(root, 'files')) throw Error('storage_mirror must differ from the data directory');
  return abs;
})();
const mirrorFilePath = (portalId, fileId) => path.join(storageMirrorDir, 'files', portalId, fileId);
const mirrorPortalDir = portalId => path.join(storageMirrorDir, 'files', portalId);
async function storeMirrored(portalId, fileId, data) {
  if (!storageMirrorDir) return null;
  const target = mirrorFilePath(portalId, fileId);
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fsp.writeFile(target, data, { flag: 'wx', mode: 0o600 });
    const check = await fsp.readFile(target);
    const same = check.length === data.length && crypto.createHash('sha256').update(check).digest('hex') === crypto.createHash('sha256').update(data).digest('hex');
    if (!same) {
      await fsp.rm(target, { force: true }).catch(() => { });
      log.error('file.mirror.mismatch', { ns: 'storage', portalId, fileId });
      void audit('file.mirror.failed', { portalId, fileId, reason: 'sha256 mismatch' });
      return 'failed';
    }
    return 'ok';
  } catch (e) {
    log.error('file.mirror.failed', { ns: 'storage', portalId, fileId, err: e.message });
    void audit('file.mirror.failed', { portalId, fileId, reason: e.code || e.message });
    return 'failed';
  }
}
async function removeMirrored(portalId, fileId) {
  if (!storageMirrorDir) return;
  await fsp.rm(mirrorFilePath(portalId, fileId), { force: true }).catch(() => { });
}
function readPlainBuffer(p, f) {
  const fp = path.join(filesRoot, p.id, f.id);
  let buf, fromMirror = false;
  try { buf = fs.readFileSync(fp) } catch {
    if (!storageMirrorDir) return null;
    try { buf = fs.readFileSync(mirrorFilePath(p.id, f.id)) } catch { return null }
    fromMirror = true;
    // Самолекуване: връщаме копието на мястото на оригинала.
    try { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.copyFileSync(mirrorFilePath(p.id, f.id), fp); log.warn('file.mirror.restored', { ns: 'storage', portalId: p.id, fileId: f.id }); void audit('file.mirror.restored', { portalId: p.id, fileId: f.id }) } catch {/* само четене */ }
  }
  if (fromMirror && f.encrypted) { try { return fileCrypto.decrypt(buf, adminToken) } catch { return null } }
  if (f.encrypted) { try { return fileCrypto.decrypt(buf, adminToken) } catch { return null } }
  return buf;
}
const keyDigest = v => crypto.createHash('sha256').update(v).digest('hex');
// Сравнение на тайни в постоянно време. Приема низ или буфер (scrypt сравнява
// Buffer), а липсваща/празна стойност НЕ е равна на нищо — иначе неконфигуриран
// токен би пропуснал заявка без Authorization.
const toCompare = (v) => (Buffer.isBuffer(v) ? v : typeof v === 'string' ? Buffer.from(v, 'utf8') : null);
const safeEqual = (a, b) => {
  const x = toCompare(a), y = toCompare(b);
  return !!x && !!y && x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashPassword = pw => { const salt = crypto.randomBytes(16); const hash = crypto.scryptSync(pw, salt, 64, SCRYPT); return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex') };
const verifyPassword = (pw, stored) => { const parts = String(stored || '').split('$'); if (parts.length !== 3 || parts[0] !== 'scrypt') return false; const salt = Buffer.from(parts[1], 'hex'), expected = Buffer.from(parts[2], 'hex'); if (!salt.length || !expected.length) return false; return safeEqual(crypto.scryptSync(pw, salt, expected.length, SCRYPT), expected) };
const newSessionToken = () => 'pu_' + crypto.randomBytes(32).toString('base64url');
const normalizeScopes = scopes => { if (scopes === undefined) return ['read', 'download']; if (!Array.isArray(scopes) || !scopes.length || scopes.some(s => !scopesAllowed.includes(s))) throw Object.assign(new Error('Invalid scopes'), { status: 400 }); return [...new Set(scopes)] };

// Backups are generated inside a fixed, private application directory.
// Never accept a user-supplied destination or expose its absolute path.
let backupQueue = Promise.resolve();
// Колко TSA доказателства да пазим (най-старите се трият по двойки .tsr/.json).
const tsaKeep = () => { const n = Number(process.env.TSA_KEEP || '200'); return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : 200 };
async function pruneTsaRecords() {
  const dir = path.join(root, 'tsa');
  let names = [];
  try { names = (await fsp.readdir(dir)).filter(n => n.endsWith('.json')).sort() } catch (e) { if (e.code === 'ENOENT') return 0; throw e }
  const keep = tsaKeep();
  if (names.length <= keep) return 0;
  const drop = names.slice(0, names.length - keep);
  for (const name of drop) {
    const base = name.replace(/\.json$/, '');
    await fsp.rm(path.join(dir, base + '.json'), { force: true }).catch(() => { });
    await fsp.rm(path.join(dir, base + '.tsr'), { force: true }).catch(() => { });
  }
  log.info('tsa.pruned', { ns: 'tsa', removed: drop.length, keep });
  void audit('rfc3161.pruned', { removed: drop.length, keep });
  return drop.length;
}

// RS-05: токените от отчет стават .tsr + .json до останалите доказателства, за да ги
// покрие `POST /rfc3161/verify`. Записва се само това, което TSA е върнал — без токен
// няма файл, така че „имам времеви печат“ винаги сочи проверим артефакт.
async function persistTsaRecords(records) {
  const dir = path.join(root, 'tsa');
  const written = [];
  for (const record of records) {
    if (!record || !record.tokenDer) continue;
    await fsp.mkdir(dir, { recursive: true });
    const at = new Date().toISOString(), stamp = at.replace(/[:.]/g, '-');
    const base = 'report-' + record.phase + '-' + stamp + '-' + String(record.digest || '').slice(0, 12);
    const file = base + '.tsr';
    await fsp.writeFile(path.join(dir, file), record.tokenDer, { flag: 'wx', mode: 0o600 });
    const stored = { phase: record.phase, source: 'report', at, url: record.url, attempts: record.attempts, algorithm: record.algorithm, digest: record.digest, closingDigest: record.closingDigest || null, file, status: record.status, statusText: record.statusText, token: record.token };
    await fsp.writeFile(path.join(dir, base + '.json'), JSON.stringify(stored, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    written.push(file);
  }
  if (written.length) await pruneTsaRecords().catch(e => log.warn('tsa.prune.failed', { ns: 'tsa', err: e.message }));
  return written;
}

function updateBackup() {
  const job = backupQueue.then(async () => {
    const dir = backupsDir; await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await fsp.lstat(dir)).isSymbolicLink()) throw Error('Unsafe backup directory');
    const name = 'metadata-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex') + '.sqlite';
    const destination = path.join(dir, name);
    try {
      const info = metadataStore.backup(destination);
      const digest = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(destination)) digest.update(chunk);
      const sha256 = digest.digest('hex');
      let mirror = null;
      if (backupsMirrorDir) {
        const target = path.join(backupsMirrorDir, name);
        try {
          await fsp.mkdir(backupsMirrorDir, { recursive: true, mode: 0o700 });
          if ((await fsp.lstat(backupsMirrorDir)).isSymbolicLink()) throw Error('Unsafe backup mirror directory');
          await fsp.copyFile(destination, target, fs.constants.COPYFILE_EXCL);
          const check = crypto.createHash('sha256');
          for await (const chunk of fs.createReadStream(target)) check.update(chunk);
          const mirrorSha = check.digest('hex');
          mirror = { dir: backupsMirrorDir, name, sha256: mirrorSha, verified: mirrorSha === sha256 };
          if (!mirror.verified) {
            await fsp.rm(target, { force: true }).catch(() => { });
            mirror.removed = true;
            log.error('backup.mirror.mismatch', { ns: 'backup', name });
            void audit('backup.mirror.mismatch', { name, expected: sha256, actual: mirrorSha });
          } else {
            void audit('backup.mirror.created', { name, dir: backupsMirrorDir, sha256: mirrorSha });
          }
        } catch (e) {
          mirror = { dir: backupsMirrorDir, name, verified: false, error: e.code || e.message };
          log.error('backup.mirror.failed', { ns: 'backup', name, err: e.message });
        }
      }
      return { name, bytes: info.bytes, sha256, createdAt: new Date().toISOString(), ...(mirror ? { mirror } : {}) };
    } catch (e) { await fsp.rm(destination, { force: true }).catch(() => { }); throw e }
  }); backupQueue = job.catch(() => { }); return job;
}
const DEFAULT_BACKUP_SCHEDULE = { enabled: false, intervalMinutes: 1440, maxBackups: 10 };
let backupScheduleTimer = null, backupScheduleNext = null;
async function listBackupFiles() {
  const dir = backupsDir; let entries = [];
  try { entries = (await fsp.readdir(dir)).filter(n => n.endsWith('.sqlite')) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const out = []; for (const name of entries) { try { const st = await fsp.stat(path.join(dir, name)); out.push({ name, mtime: st.mtimeMs }) } catch { /* файл, изчезнал между readdir и stat, се прескача */ } }
  out.sort((a, b) => a.mtime - b.mtime); return out;
}
async function pruneBackups(maxKeep) {
  if (!Number.isInteger(maxKeep) || maxKeep < 1) return;
  const files = await listBackupFiles(); if (files.length <= maxKeep) return;
  for (const f of files.slice(0, files.length - maxKeep)) await fsp.rm(path.join(backupsDir, f.name), { force: true }).catch(() => { });
}
function applyBackupSchedule() {
  if (backupScheduleTimer) { clearInterval(backupScheduleTimer); backupScheduleTimer = null }
  backupScheduleNext = null;
  const s = runtime.settings.backupSchedule || DEFAULT_BACKUP_SCHEDULE;
  if (s && s.enabled && Number.isInteger(s.intervalMinutes) && s.intervalMinutes > 0) {
    backupScheduleNext = Date.now() + s.intervalMinutes * 60000;
    backupScheduleTimer = setInterval(() => {
      void (async () => {
        backupScheduleNext = Date.now() + s.intervalMinutes * 60000;
        try { await updateBackup(); await pruneBackups(s.maxBackups); void audit('backup.schedule.run', { maxBackups: s.maxBackups }) }
        catch (e) { void errorLog.append('error', 'backup-schedule', e && e.message || 'Scheduled backup failed') }
      })()
    }, s.intervalMinutes * 60000);
  }
}
const json = (res, status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(obj)) };
const fail = (res, status, message) => json(res, status, { error: message });
// Bounded authentication failures per peer. Never trust forwarded IP headers.
// The limit applies only to administrative API routes and does not lock out
// legitimate public downloads or the Home Assistant ingress UI.
const authFailures = new Map();
const AUTH_WINDOW_MS = 60_000, AUTH_MAX_FAILURES = 12;
function adminGate(req, res, capability, method) {
  const peer = req.socket.remoteAddress || 'unknown', now = Date.now();
  let state = authFailures.get(peer);
  if (state && now - state.since >= AUTH_WINDOW_MS) { authFailures.delete(peer); state = null }
  if (state && state.count >= AUTH_MAX_FAILURES) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((AUTH_WINDOW_MS - (now - state.since)) / 1000))));
    return fail(res, 429, 'Too many authentication attempts');
  }
  const role = rbac.resolve(req);
  if (role) {
    authFailures.delete(peer);
    if (!rbac.allowed(role, capability || '*', method || req.method)) return fail(res, 403, 'Insufficient role');
    return true;
  }
  if (!state) { state = { since: now, count: 0 }; authFailures.set(peer, state) }
  state.count++;
  if (authFailures.size > 4096) {
    for (const [ip, v] of authFailures) { if (now - v.since >= AUTH_WINDOW_MS) authFailures.delete(ip) }
    if (authFailures.size > 4096) authFailures.delete(authFailures.keys().next().value)
  }
  fail(res, 401, 'Unauthorized'); return false;
}
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 60_000, LOGIN_MAX_FAILURES = 10;
function loginGate(req, res) {
  const peer = req.socket.remoteAddress || 'unknown', now = Date.now();
  let s = loginFailures.get(peer);
  if (s && now - s.since >= LOGIN_WINDOW_MS) { loginFailures.delete(peer); s = null }
  if (s && s.count >= LOGIN_MAX_FAILURES) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - s.since)) / 1000)))); fail(res, 429, 'Too many login attempts'); return false }
  return true;
}
function registerLoginFailure(req) { const peer = req.socket.remoteAddress || 'unknown', now = Date.now(); let s = loginFailures.get(peer); if (!s || now - s.since >= LOGIN_WINDOW_MS) { s = { since: now, count: 0 }; loginFailures.set(peer, s) } s.count++; if (loginFailures.size > 4096) loginFailures.delete(loginFailures.keys().next().value) }
function clearLoginFailures(req) { loginFailures.delete(req.socket.remoteAddress || 'unknown') }
const clean = x => typeof x === 'string' ? x.trim() : '';
const htmlEsc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validSlug = x => /^[a-z0-9][a-z0-9-]{0,62}$/.test(x);
const body = async (req, limit = 65536) => { let parts = [], size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 }); parts.push(chunk) } return Buffer.concat(parts) };
const parse = async req => { try { return JSON.parse((await body(req)).toString('utf8')) } catch (e) { if (e.status) throw e; throw Object.assign(new Error('Invalid JSON'), { status: 400 }) } };
const update = (fn, onFailure) => {
  const run = queue.then(async () => {
    const previous = structuredClone(db); let result;
    try { result = await fn(); metadataStore.save(db); return result }
    catch (e) { db = previous; if (result !== undefined && onFailure) { try { await onFailure(result) } catch (cleanupError) { console.error('ROLLBACK CLEANUP FAILED', cleanupError) } } throw e }
  }); queue = run.catch(() => { }); return run
};
// Публичен контакт на издателя: само имена/канали за връзка (без вътрешни id и extras).
const publicContact = id => { const c = contactById(db, id); if (!c) return null; const out = { name: c.name, organization: c.organization, department: c.department, email: c.email, phone: c.phone, city: c.city, country: c.country }; return Object.values(out).some(Boolean) ? out : null };
// Публичният изглед на портала: това, което вижда landing страницата (QR кодът води там).
const publicPortal = p => ({
  id: p.id, slug: p.slug, title: p.title, description: p.description, notes: p.notesText || '', category: p.category || '', subject: p.subject || '', flag: p.flag || 'none', storage_root: p.storage_root || '/share', visibility: p.visibility, branding: p.branding || {}, createdAt: p.createdAt,
  // Броят е само на видимите файлове — скритите не се броят в публичния изглед.
  fileCount: p.files.filter(f => f.listed !== false).length,
  contact: publicContact(p.contactId),
  urls: {
    landing: portalLandingUrl(p, ''), api: portalApiUrl(p, ''), manifest: portalApiUrl(p, '') + '/manifest', openapi: portalApiUrl(p, '') + '/openapi.json', qr: portalApiUrl(p, '') + '/qr.svg',
    // Какво точно кодира QR кодът — публичната страница, не JSON API-то.
    qrTarget: portalLandingUrl(p, '')
  }
});
// Флаг на портала: само от фиксиран списък (иначе 'none').
const PORTAL_FLAGS = ['none', 'info', 'important', 'urgent', 'archive'];
const portalFlag = v => (PORTAL_FLAGS.includes(String(v || '')) ? String(v) : 'none');
// Папка с файлове: само под разрешените корени, без „..“ и контролни знаци.
const portalRoot = v => { const s = String(v == null ? '' : v).trim(); if (!s) return '/share'; if (!/^\/(share|media)(\/[^\\\r\n\0]*)?$/.test(s) || s.includes('..')) throw Object.assign(new Error('Invalid storage_root'), { status: 400 }); return s.replace(/\/+$/, '') || '/share' };
// Контакт към портала: трябва да съществува в контактите (или празно).
const portalContact = (db, v) => { const s = String(v == null ? '' : v).trim(); if (!s) return ''; if (!db.directory || !(db.directory.contacts || []).some(c => c.id === s)) throw Object.assign(new Error('Unknown contact'), { status: 400 }); return s };
const contactById = (db, id) => { const c = id && db.directory && (db.directory.contacts || []).find(x => x.id === id); return c ? { id: c.id, email: c.email, name: (c.fields && c.fields.name) || '', organization: (c.fields && c.fields.organization) || '', department: (c.fields && c.fields.department) || '', phone: (c.fields && c.fields.phone) || '', city: (c.fields && c.fields.city) || '', country: (c.fields && c.fields.country) || '', extras: Array.isArray(c.extras) ? c.extras.map(x => ({ key: x.key, value: x.value })) : [] } : null };
// Дело към портала: трябва да съществува в делата (или празно).
const portalCase = (db, v) => { const s = String(v == null ? '' : v).trim(); if (!s) return ''; if (!require('./cases').caseById(db, s)) throw Object.assign(new Error('Unknown case'), { status: 400 }); return s };
const taxonomyFields = ['topic', 'category', 'group'];
const normalizeTaxonomy = (input, base = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid metadata'), { status: 400 });
  const out = { topic: base.topic || '', category: base.category || '', group: base.group || '', tags: [...(base.tags || [])] };
  for (const key of taxonomyFields) if (Object.hasOwn(input, key)) {
    if (typeof input[key] !== 'string' || input[key].length > 120) throw Object.assign(new Error('Invalid ' + key), { status: 400 }); out[key] = input[key].trim();
    if (runtime.settings.data.strictTaxonomy && out[key] && key !== 'topic' && out[key] !== base[key]) { const lst = ((db.taxonomy || {})[key === 'category' ? 'categories' : 'groups'] || []); if (!lst.some(x => x.toLowerCase() === out[key].toLowerCase())) throw Object.assign(new Error('Unknown ' + key + ' (select from the list)'), { status: 400 }) }
  }
  if (Object.hasOwn(input, 'tags')) {
    if (!Array.isArray(input.tags) || input.tags.length > runtime.settings.data.maxTags || input.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 80)) throw Object.assign(new Error('Invalid tags'), { status: 400 });
    out.tags = [...new Set(input.tags.map(t => t.trim()))];
  }
  return out;
};
const publicFile = f => ({ id: f.id, name: f.name, size: f.size, sha256: f.sha256, version: Number(f.version) || 1, uploadedAt: f.uploadedAt, createdAt: f.createdAt || f.uploadedAt || '', modifiedAt: f.modifiedAt || f.uploadedAt || '', locked: !!f.locked, lockedBy: f.lockedBy || '', accessMode: fileMode(f), listed: f.listed !== false, encrypted: !!f.encrypted, notes: f.notes || '', ...normalizeTaxonomy({}, f) });
const filePage = (files, url) => {
  const q = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  const rawLimit = url.searchParams.get('limit') || '50', rawOffset = url.searchParams.get('offset') || '0';
  if (q.length > 200 || !/^[0-9]{1,4}$/.test(rawLimit) || !/^[0-9]{1,9}$/.test(rawOffset) || Number(rawLimit) < 1 || Number(rawLimit) > 500) throw Object.assign(new Error('Invalid pagination or search'), { status: 400 });
  const order = url.searchParams.get('order') || 'name';
  if (!['name', 'uploadedAt', 'size'].includes(order)) throw Object.assign(new Error('Invalid sort'), { status: 400 });
  const direction = url.searchParams.get('direction') || 'asc';
  if (!['asc', 'desc'].includes(direction)) throw Object.assign(new Error('Invalid direction'), { status: 400 });
  const filters = Object.fromEntries(['topic', 'category', 'group', 'tag'].map(k => [k, (url.searchParams.get(k) || '').trim().toLocaleLowerCase()]));
  if (Object.values(filters).some(v => v.length > 120)) throw Object.assign(new Error('Invalid taxonomy filter'), { status: 400 });
  const filtered = files.filter(f => f.name.toLocaleLowerCase().includes(q) &&
    ['topic', 'category', 'group'].every(k => !filters[k] || (f[k] || '').toLocaleLowerCase() === filters[k]) &&
    (!filters.tag || (f.tags || []).some(t => t.toLocaleLowerCase() === filters.tag)));
  filtered.sort((a, b) => { const v = order === 'name' ? a.name.localeCompare(b.name) : order === 'size' ? a.size - b.size : a.uploadedAt.localeCompare(b.uploadedAt); return (v || a.id.localeCompare(b.id)) * (direction === 'desc' ? -1 : 1) });
  const offset = Number(rawOffset), limit = Number(rawLimit);
  return { files: filtered.slice(offset, offset + limit).map(publicFile), total: filtered.length, limit, offset, hasMore: offset + limit < filtered.length };
};
const getPortal = s => db.portals.find(p => p.slug === s);
// Публичните адреси приемат и slug, и id: `/p/<id>` е каноничният адрес на QR кода,
// а `/p/<slug>` остава валиден (стари връзки и познаваеми адреси).
const resolvePortal = key => { const k = String(key || ''); if (!k) return null; return db.portals.find(p => p.slug === k) || db.portals.find(p => p.id === k) || null };
const adminPortal = p => ({ ...publicPortal(p), contactId: p.contactId || '', contact: contactById(db, p.contactId), caseId: p.caseId || '', case: require('./cases').caseView(db, p.caseId), htmlProjects: (p.htmlProjects || []).map(x => ({ ...x })), files: p.files.map(f => ({ ...publicFile(f), accessKeys: (f.accessKeys || []).map(k => ({ id: k.id, createdAt: k.createdAt, expiresAt: k.expiresAt || null })), sends: (f.sends || []).map(s => sendLite.adminView(s)) })) });
const bearerToken = req => ((req.headers.authorization || '').replace(/^Bearer\s+/i, '')).trim();
const resolveSession = (req, url) => { const token = bearerToken(req) || ((url && url.searchParams.get('portal_token')) || ''); if (!token) return null; return metadataStore.getSession(keyDigest(token)) };
const portalAuthorized = (req, p, scope = 'read', url) => { const s = resolveSession(req, url); return !!(s && (s.scopes || []).includes(scope)) };
const signedValid = (url, p, f) => { const expires = Number(url.searchParams.get('expires')), sig = url.searchParams.get('sig') || ''; if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 86400 || !/^[a-f0-9]{64}$/.test(sig)) return false; const expected = crypto.createHmac('sha256', p.signingSecret || adminToken).update(`${p.id}:${f.id}:${expires}`).digest('hex'); return safeEqual(sig, expected) };

const apiRoot = path.join(root, 'api'); const cabinet = require('./cabinet').create({ root, maxBytes: () => runtime.effective().maxUploadBytes, localOpen: process.env.HAPI_LOCAL_OPEN === '1' }); const isLoopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress); const fileNameHeader = req => { const v = String(req.headers['x-file-name'] || ''); try { return clean(decodeURIComponent(v)) } catch { return clean(v) } };
function baseUrl(req) { const env = runtime.effective().publicBaseUrl; if (env) return env; const h = req && (req.headers['x-forwarded-host'] || req.headers.host); if (!h || !/^[A-Za-z0-9.\-:\[\]]{1,255}$/.test(String(h).split(',')[0].trim())) return ''; const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim(); return (proto === 'https' ? 'https' : 'http') + '://' + String(h).split(',')[0].trim() }
function portalApiUrl(p, base) { return (base || '') + '/api/v1/p/' + encodeURIComponent(p.slug) }
// Публичната страница се адресира с ИДЕНТИФИКАТОРА на портала (не с името/slug):
// QR кодът не издава „говорещото“ име, а и връзката остава валидна при смяна на slug.
function portalLandingUrl(p, base) { return (base || '') + '/p/' + encodeURIComponent(p.id || p.slug) }
function fileDownloadUrl(p, f, base) { return portalApiUrl(p, base) + '/files/' + encodeURIComponent(f.id) + '/download' }
// Търсене на „Бърз линк“ по id без значение от портала и файла.
const findSend = sendId => {
  for (const p of (db && db.portals ? db.portals : [])) {
    for (const f of p.files) {
      const s = (f.sends || []).find(x => x.id === sendId);
      if (s) return { portal: p, file: f, send: s };
    }
  }
  return null;
};
const humanBytes = n => { const b = Number(n) || 0; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'; return (b / 1073741824).toFixed(2) + ' GB' };
// Публичната страница на един „Бърз линк“. Без JS и без външни ресурси, за да
// работи под строга CSP; паролата (ако има) се подава с обикновена форма.
function sendLandingHtml({ file, send }) {
  const protectedLink = sendLite.isProtected(send);
  const left = Number(send.maxAccess) > 0 ? Math.max(0, Number(send.maxAccess) - Number(send.accessCount || 0)) : null;
  const meta = [
    humanBytes(file.size),
    send.expiresAt ? 'Валиден до ' + String(send.expiresAt).slice(0, 10) : 'Безсрочна връзка',
    left === null ? 'Без ограничение на свалянията' : 'Оставащи сваляния: ' + left,
  ].join(' · ');
  return '<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Споделен файл · hAPI Enterprise</title><style>' +
    ':root{color-scheme:light}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f6fa;color:#151a2d;display:grid;place-items:center;min-height:100vh}' +
    'main{width:min(92vw,460px);background:#fff;border:1px solid #e2e5f0;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(20,25,60,.08)}' +
    '.brand{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7c8299;margin-bottom:14px}' +
    'h1{font-size:20px;margin:0 0 6px}.file{font-size:16px;font-weight:600;margin:0 0 4px;word-break:break-all}' +
    '.meta{font-size:13px;color:#67708c;margin:0 0 18px}' +
    'label{display:block;font-size:13px;color:#39415e;margin:0 0 6px}' +
    'input[type=password]{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #d5dae8;border-radius:10px;font-size:15px;margin-bottom:14px}' +
    'button{width:100%;padding:12px 14px;border:0;border-radius:10px;background:#2f5bea;color:#fff;font-size:15px;font-weight:600;cursor:pointer}' +
    'button:hover{background:#2449c4}.note{margin:16px 0 0;font-size:12px;color:#8a90a6;line-height:1.5}' +
    '</style></head><body><main><div class="brand">hAPI Enterprise</div><h1>Споделен файл</h1>' +
    '<p class="file">' + htmlEsc(file.name) + '</p><p class="meta">' + htmlEsc(meta) + '</p>' +
    '<form method="POST" action="/api/v1/sends/' + encodeURIComponent(send.id) + '/access">' +
    (protectedLink ? '<label for="p">Парола за достъп</label><input id="p" name="passphrase" type="password" autocomplete="off" required>' : '') +
    '<button type="submit">Изтегли файла</button></form>' +
    '<p class="note">Връзката е лична и не показва кой я е споделил. Ако не очаквате този файл, затворете страницата.</p>' +
    '</main></body></html>';
}
const SEND_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; img-src 'none'";
// Страницата на тайна връзка пуска само собствения си скрипт (декриптирането е в
// браузъра), затова `script-src 'self'` и нищо външно.
const SECRET_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; img-src 'none'";
function qrSvg(text) { const q = require('./qrcode')(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true }) }
// Единствен записвач на api/<slug>/: api-registry (атомарен запис, сериализиран по slug).
// QR кодът сочи към публичната страница на портала, не към JSON API-то.
const apiRegistry = require('./api-registry').create({ root: apiRoot, qrSvg: text => qrSvg(text), qrPayload: (record, portal, base) => portalLandingUrl(portal, base) });
async function writeApiDir(p, base) { try { return await apiRegistry.ensure(p, { baseUrl: base || '' }) } catch (e) { log.error('api.dir.failed', { ns: 'api', slug: p.slug, err: e.message }) } }
// Един източник на истина за договора: api-spec.js (същият модул, който пише api.json).
function spec(p, base) { return require('./api-spec').buildOpenApi(p, { baseUrl: base || '' }) }
let lastStorageCheck = null, lastStorageCheckTime = 0;
const storageCheckIntervalMs = eff.storageCheckIntervalMs;
async function runStorageCheck(reason) {
  const result = await storageCheck.check([root, filesRoot, internalRoot, htmlProjectsRoot]);
  lastStorageCheck = result; lastStorageCheckTime = Date.now();
  for (const loc of result.locations) { if (!loc.available || !loc.writable) void errorLog.append('error', 'storage-check', loc.error || 'UNAVAILABLE', { location: loc.name }) }
  if (!result.healthy) void audit('storage.check.failed', { reason, locations: result.locations });
  return result;
}
async function handler(req, res) {
  try {
    if (req.url.startsWith('//')) req.url = req.url.replace(/^\/{2,}/, '/'); const url = new URL(req.url, 'http://localhost');
    // Request correlation: reuse a sane X-Request-Id or mint one, expose it on the response
    // and log the outcome at debug level (visible only with log_level=debug/trace).
    const startedAt = process.hrtime.bigint(); let reqId = req.headers['x-request-id'];
    if (typeof reqId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(reqId)) reqId = crypto.randomBytes(8).toString('hex');
    req.log = log.child({ ns: 'http', reqId });
    try { res.setHeader('X-Request-Id', reqId) } catch { /* заглавките може вече да са изпратени — логът не бива да чупи отговора */ }
    res.on('finish', () => {
      try {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        req.log.debug('request', { method: req.method, path: String(req.url || '').split('?')[0], status: res.statusCode, ms: Math.round(ms) });
        // Сензор за комуникацията: listener + клас на статуса + байтове + латентност.
        const listener = isAdminListener ? 'admin' : req.hapiPublicOnly ? 'gateway' : 'public';
        const declared = Number(res.getHeader && (res.getHeader('content-length') || 0)) || 0;
        observer.observe({ method: req.method, path: String(req.url || '/'), status: res.statusCode, ms, bytesIn: Number(req.headers['content-length'] || 0) || 0, bytesOut: declared, listener });
      } catch { /* логът на заявката не бива да чупи отговора */ }
    });
    const isAdminListener = ingressMode && req.socket.localPort === adminPort; req.ingress = isAdminListener;
    // Peer allowlist before any routing: the ingress listener trusts only the Supervisor
    // proxy (172.30.32.2 by default) and loopback. Everything else gets 403 — an
    // add-on container on the shared Docker network cannot reach the admin API.
    if (isAdminListener) { const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''); if (!adminPeers.has(peer) && !adminPeers.has(String(req.socket.remoteAddress || ''))) return fail(res, 403, 'Forbidden') }
    let hasIngressPath = false;
    if (isAdminListener) {
      let ingressPath = req.headers['x-ingress-path'];
      if (typeof ingressPath !== 'string') {
        const match = /^(\/api\/hassio_ingress\/[A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
        if (match) ingressPath = match[1];
      }
      if (typeof ingressPath === 'string' && /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+\/?$/.test(ingressPath)) {
        hasIngressPath = true;
        const prefix = ingressPath.replace(/\/+$/, '');
        if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
          const remainder = url.pathname.slice(prefix.length);
          url.pathname = remainder ? '/' + remainder.replace(/^\/+/, '') : '/';
          req.url = url.pathname + url.search;
        }
      }
    }
    if (isAdminListener && corsOrigin) { res.setHeader('Access-Control-Allow-Origin', corsOrigin); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-File-Name,X-File-Encrypt'); res.setHeader('Access-Control-Max-Age', '600'); res.setHeader('Vary', 'Origin') }
    if (ingressMode) { const adminPath = url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname === '/' || url.pathname === '/ui' || url.pathname.startsWith('/ui/') || url.pathname.startsWith('/hapi_enterprise/') || (hasIngressPath && url.pathname.startsWith('/site/')); if (isAdminListener && !adminPath) return fail(res, 404, 'Not found'); if (!isAdminListener && adminPath) return fail(res, 404, 'Not found'); if (isAdminListener && url.pathname === '/') { url.pathname = '/ui/index.html'; req.url = url.pathname + url.search; } }
    if (isAdminListener && url.pathname === '/admin/api/ingress-login' && req.method === 'GET') {
      const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const fromSupervisor = supervisorPeers.has(peer) && typeof req.headers['x-ingress-path'] === 'string';
      const localOnly = ['127.0.0.1', '::1'].includes(peer) && ['127.0.0.1', '::1', 'localhost'].includes(adminBindHost);
      if (!fromSupervisor && !localOnly) return fail(res, 403, 'Forbidden');
      res.setHeader('Cache-Control', 'no-store');
      // Под Home Assistant Ingress НЯМА токен за хора: самоличността идва от HA
      // (X-Remote-User-*) и ролята се определя от user_roles/group_roles, а ако няма
      // съответствие — от default_role (по подразбиране admin, т.е. този, който е
      // инсталирал add-on-а, е администратор). Заявката връща само сесия, не ключ.
      if (req.ingress === true) {
        const role = rbac.role(req);
        if (!role) return fail(res, 403, 'No Home Assistant identity — open the panel through the ingress link');
        return json(res, 200, {
          role,
          ingress: true,
          user: String(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || req.headers['x-remote-user'] || '').trim(),
          defaultRole: rbac.defaultRole,
          mapped: rbac.configured
        });
      }
      // Standalone (Docker без Supervisor) няма HA самоличност — там ключът остава
      // единственият начин за достъп и се дава само на loopback.
      return json(res, 200, { role: 'admin', ingress: false, user: '', defaultRole: rbac.defaultRole, mapped: rbac.configured, token: adminToken });
    }
    if (req.method === 'OPTIONS') { res.writeHead(isAdminListener && corsOrigin ? 204 : 404, { 'Content-Length': '0' }); return res.end() }
    const parts = url.pathname.split('/').filter(Boolean); const method = req.method; counters.requests++; if (req.hapiPublicOnly && (parts[0] === 'admin' || parts[0] === 'ui')) return fail(res, 404, 'Not found'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); if (!isAdminListener) res.setHeader('X-Frame-Options', 'DENY');
    for (const [k, v] of Object.entries(apiVersion.headers(url))) res.setHeader(k, v);
    if (url.pathname === '/api/v1/auth/login' && method === 'POST') {
      if (!loginGate(req, res)) return;
      const b = await parse(req); const username = clean(b.username), password = String(b.password || '');
      if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(username) || !password || password.length > 200) return fail(res, 400, 'Username or password required');
      const user = metadataStore.getUser(username);
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) { registerLoginFailure(req); void audit('auth.login_failed', { username }); return fail(res, 401, 'Invalid credentials') }
      let expiresAt = null; const ttl = Number(b.ttlSeconds); if (Number.isFinite(ttl) && ttl > 0) { if (ttl > 31536000) return fail(res, 400, 'TTL exceeds maximum'); expiresAt = new Date(Date.now() + ttl * 1000).toISOString() }
      const token = newSessionToken(); metadataStore.createSession(keyDigest(token), username, expiresAt); clearLoginFailures(req);
      void audit('auth.login', { username });
      return json(res, 200, { token, username, scopes: user.scopes, expiresAt });
    }
    if (url.pathname === '/api/v1/auth/logout' && method === 'POST') {
      const token = bearerToken(req); if (!token) return fail(res, 401, 'Token required');
      metadataStore.deleteSession(keyDigest(token));
      return json(res, 200, { loggedOut: true });
    }
    if (url.pathname === '/api/v1/auth/me' && method === 'GET') {
      const s = resolveSession(req, url); if (!s) return fail(res, 401, 'Token required');
      return json(res, 200, { username: s.username, scopes: s.scopes, expiresAt: s.expiresAt });
    }
    if (url.pathname === '/admin/api/users' && method === 'GET') {
      if (!adminGate(req, res, 'users', method)) return;
      return json(res, 200, { users: metadataStore.listUsers() });
    }
    if (url.pathname === '/admin/api/users' && method === 'POST') {
      if (!adminGate(req, res, 'users', method)) return;
      const b = await parse(req); const username = clean(b.username), password = String(b.password || '');
      if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(username)) return fail(res, 400, 'Invalid username');
      if (password.length < 8 || password.length > 200) return fail(res, 400, 'Password must be 8-200 characters');
      let scopes; try { scopes = normalizeScopes(b.scopes) } catch (e) { return fail(res, e.status, e.message) }
      if (metadataStore.getUser(username)) return fail(res, 409, 'Username exists');
      metadataStore.createUser(username, hashPassword(password), scopes);
      void audit('user.create', { username });
      return json(res, 201, { user: metadataStore.getUser(username) });
    }
    const userMatch = url.pathname.match(/^\/admin\/api\/users\/([^\/]+)$/);
    if (userMatch) {
      let username; try { username = decodeURIComponent(userMatch[1]) } catch { return fail(res, 400, 'Invalid username') }
      if (method === 'PATCH') {
        if (!adminGate(req, res, 'users', method)) return;
        const cur = metadataStore.getUser(username); if (!cur) return fail(res, 404, 'User not found');
        const b = await parse(req); const patch = {};
        if (b.password !== undefined) { const pw = String(b.password || ''); if (pw.length < 8 || pw.length > 200) return fail(res, 400, 'Password must be 8-200 characters'); patch.passwordHash = hashPassword(pw) }
        if (b.scopes !== undefined) { try { patch.scopes = normalizeScopes(b.scopes) } catch (e) { return fail(res, e.status, e.message) } }
        if (b.active !== undefined) { if (typeof b.active !== 'boolean') return fail(res, 400, 'active must be boolean'); patch.active = b.active }
        metadataStore.updateUser(username, patch);
        void audit('user.update', { username });
        return json(res, 200, { user: metadataStore.getUser(username) });
      }
      if (method === 'DELETE') {
        if (!adminGate(req, res, 'users', method)) return;
        if (!metadataStore.deleteUser(username)) return fail(res, 404, 'User not found');
        void audit('user.delete', { username });
        return json(res, 200, { deleted: username });
      }
    }
    if (url.pathname === '/admin/api/settings' && method === 'GET') {
      if (!adminGate(req, res, 'settings', method)) return;
      return json(res, 200, { settings: runtime.settings, effective: runtime.effective(), databasePath: runtime.databaseRelative, requiresRestartForDatabaseChange: true });
    }
    if (url.pathname === '/admin/api/settings' && method === 'PATCH') {
      if (!adminGate(req, res, 'settings', method)) return;
      const data = await parse(req); let saved; try { saved = await runtime.save(data) } catch (e) { return fail(res, 400, String(e.message || 'Invalid settings').slice(0, 160)) }
      applyBackupSchedule();
      await audit('settings_changed', { keys: Object.keys(data) });
      const now = runtime.effective(), startupKeys = ['maxDownloadStreams', 'maxJobs', 'storageCheckIntervalMs', 'corsOrigin', 'requirePortalToken', 'storeRawIp']; return json(res, 200, { settings: saved, effective: now, restartRequired: path.join(saved.databaseDirectory, saved.databaseFile) !== runtime.databaseRelative || startupKeys.some(k => now[k] !== eff[k]) });
    }
    if (url.pathname === '/admin/api/qr-artifacts' && method === 'POST') {
      if (!adminGate(req, res, 'qr', method)) return;
      const data = await parse(req);
      // Serialize artifact creation and DB persistence as one application operation.
      // On metadata write failure remove only the directory created by this request.
      const artifact = await update(async () => {
        if ((db.qrArtifacts || []).some(a => a.qrId === data.qrId)) throw Object.assign(new Error('QR ID already registered'), { status: 409 });
        const created = await runtime.createArtifacts(data);
        db.qrArtifacts ??= []; db.qrArtifacts.push(created);
        return created;
      }, async created => { await runtime.removeArtifacts(created) });
      await audit('qr_artifact_created', { qrId: artifact.qrId }); return json(res, 201, { artifact });
    }
    if (url.pathname === '/admin/api/qr-artifacts' && method === 'GET') {
      if (!adminGate(req, res, 'qr', method)) return; return json(res, 200, { artifacts: db.qrArtifacts || [] });
    }
    {
      const m = /^\/admin\/api\/qr-artifacts\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
      if (m && method === 'DELETE') {
        if (!adminGate(req, res, 'qr', method)) return;
        const qrId = m[1];
        const existing = (db.qrArtifacts || []).find(a => a.qrId === qrId);
        if (!existing) return fail(res, 404, 'Artifact not found');
        // Serialize removal with rollback: if the metadata write fails, restore the record.
        await update(async () => {
          await runtime.removeArtifacts(existing);
          db.qrArtifacts = (db.qrArtifacts || []).filter(a => a.qrId !== qrId);
        });
        await audit('qr_artifact_revoked', { qrId });
        return json(res, 200, { revoked: true, qrId });
      }
    }
    if (url.pathname === '/admin/api/notify/dispatch' && method === 'POST') {
      if (!adminGate(req, res, 'qr', method)) return;
      if (!notify.enabled()) return fail(res, 503, 'Notify dispatch disabled (SUPERVISOR_TOKEN not configured)');
      const b = await parse(req);
      const service = String(b.service || '');
      let link = '';
      if (typeof b.link === 'string' && b.link.trim()) link = b.link.trim();
      else if (b.portalId) {
        const p = db.portals.find(x => x.id === b.portalId);
        if (!p) return fail(res, 404, 'Portal not found');
        if (b.fileId) { const f = p.files.find(x => x.id === b.fileId); if (!f) return fail(res, 404, 'File not found'); link = fileDownloadUrl(p, f, baseUrl(req)); }
        else link = portalLandingUrl(p, baseUrl(req));
      } else return fail(res, 400, 'link or portalId required');
      if (link.length > 2048) return fail(res, 400, 'Link too long');
      const title = String(b.title || '').slice(0, 200);
      const message = String(b.message || '').slice(0, 2000);
      try {
        const status = await notify.send(service, b.target, { title, message: (message ? message + '\n' : '') + link });
        void audit('notify.dispatch', { service, portalId: b.portalId || null, fileId: b.fileId || null, status });
        return json(res, 200, { sent: true, status });
      } catch (e) { return fail(res, e.status || 502, e.message || 'Notify failed') }
    }
    // Текстов експорт за мониторинг (Prometheus / Home Assistant scrape): същите
    // агрегати като /admin/api/sensors, но във формат за директно консумиране.
    if (url.pathname === '/admin/api/sensors/prometheus' && method === 'GET') {
      if (!adminGate(req, res, 'sensors', method)) return;
      const metricsText = observer.prometheus();
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Content-Length': Buffer.byteLength(metricsText), 'Cache-Control': 'no-store' });
      return res.end(metricsText);
    }
    if (url.pathname === '/admin/api/sensors' && method === 'GET') {
      if (!adminGate(req, res, 'sensors', method)) return;
      const database = await fsp.stat(dbPath).catch(() => ({ size: 0 }));
      const telemetryStat = await fsp.stat(telemetryFile).catch(() => ({ size: 0 }));
      const portals = db.portals.map(p => ({ id: p.id, slug: p.slug, files: p.files.length, bytes: p.files.reduce((n, f) => n + f.size, 0), ...telemetry.byPortal[p.id] }));
      // `observer` е агрегатът без лични данни (комуникация/файлове/извиквания/изтегляния/
      // посещения); `portals`/`recent` остават съвместими със стария формат.
      const observed = observer.snapshot();
      return json(res, 200, { generatedAt: observed.generatedAt, databaseBytes: database.size, telemetryBytes: telemetryStat.size, files: portals.reduce((n, p) => n + p.files, 0), fileBytes: portals.reduce((n, p) => n + p.bytes, 0), visits: telemetry.visits, downloads: telemetry.downloads, portals, tokenActivity: telemetry.byToken, fileDownloads: telemetry.byFile, ratings: Object.fromEntries(Object.entries(telemetry.ratings).map(([k, v]) => [k, { count: v.count, average: v.sum / v.count }])), recent: telemetry.recent, ipMode: rawIpEnabled ? 'raw' : 'hashed', observer: observed });
    }
    if (url.pathname === '/admin/api/database/backup' && method === 'POST') {
      if (!adminGate(req, res, 'backup', method)) return;
      const result = await updateBackup();
      await audit('database_backup_created', { name: result.name, bytes: result.bytes, sha256: result.sha256 });
      return json(res, 201, { backup: result });
    }
    if (url.pathname === '/admin/api/jobs' && method === 'GET') { if (!adminGate(req, res, 'jobs', method)) return; return json(res, 200, { jobs: jobManager.list(), ...jobManager.stats() }) }
    {
      const m = /^\/admin\/api\/jobs\/([0-9a-f-]{36})\/(cancel|pause|resume)$/.exec(url.pathname);
      if (m && method === 'POST') {
        if (!adminGate(req, res, 'jobs', method)) return;
        const job = m[2] === 'cancel' ? jobManager.cancel(m[1]) : m[2] === 'pause' ? jobManager.pause(m[1]) : jobManager.resume(m[1]);
        return job ? json(res, 200, job) : fail(res, 404, 'Job not found');
      }
    }
    {
      const m = /^\/admin\/api\/jobs\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (m && method === 'GET') {
        if (!adminGate(req, res, 'jobs', method)) return;
        const job = jobManager.get(m[1]);
        return job ? json(res, 200, job) : fail(res, 404, 'Job not found');
      }
    }
    if (url.pathname === '/admin/api/diagnostics' && method === 'GET') {
      if (!adminGate(req, res, 'diagnostics', method)) return;
      const mem = process.memoryUsage();
      const storage = await Promise.all([root, filesRoot, internalRoot].map(async location => {
        try { const st = await fsp.stat(location); return { name: path.basename(location), available: st.isDirectory(), writable: !!(await fsp.access(location, fs.constants.W_OK).then(() => true).catch(() => false)) } }
        catch (e) { return { name: path.basename(location), available: false, writable: false, error: e.code || 'UNAVAILABLE' } }
      }));
      return json(res, 200, { generatedAt: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()), runtime: { node: process.version, pid: process.pid, rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, heapTotalBytes: mem.heapTotal }, traffic: { ...counters, activeDownloadStreams, maxDownloadStreams, effectiveDownloadStreams: loadControl.effective, load: loadControl.snapshot(counters.requests) }, catalog: { portals: db.portals.length, files: db.portals.reduce((n, p) => n + p.files.length, 0) }, storage });
    }
    if (url.pathname === '/admin/api/load' && method === 'GET') { if (!adminGate(req, res, 'load', method)) return; return json(res, 200, loadControl.snapshot(counters.requests)) }
    if (url.pathname === '/admin/api/errors' && method === 'GET') {
      if (!adminGate(req, res, 'errors', method)) return;
      const limitRaw = url.searchParams.get('limit') || '100';
      if (!/^[0-9]{1,4}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 500) return fail(res, 400, 'Invalid limit');
      const level = url.searchParams.get('level'), source = url.searchParams.get('source');
      if (level && !['error', 'warn', 'info'].includes(level)) return fail(res, 400, 'Invalid level');
      const events = await errorLog.list({ limit: Number(limitRaw), level: level || undefined, source: source || undefined });
      return json(res, 200, { events, count: events.length, order: 'newest-first' });
    }
    // Debug log access: read the in-memory ring buffer and change the level at runtime.
    if (url.pathname === '/admin/api/logs' && method === 'GET') {
      if (!adminGate(req, res, 'logs', method)) return;
      const limitRaw = url.searchParams.get('limit') || '100';
      if (!/^[0-9]{1,4}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 500) return fail(res, 400, 'Invalid limit');
      const levelFilter = url.searchParams.get('level');
      if (levelFilter && !log.levels().includes(levelFilter)) return fail(res, 400, 'Invalid level');
      return json(res, 200, { level: log.level(), stats: log.stats(), files: log.files(), entries: log.entries({ limit: Number(limitRaw), level: levelFilter || undefined }), order: 'newest-first' });
    }
    if (url.pathname === '/admin/api/logs/level' && method === 'POST') {
      if (!adminGate(req, res, 'logs', method)) return;
      let payload; try { payload = await parse(req) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
      let next; try { next = log.setLevel(payload && payload.level) } catch (e) { return fail(res, e.status || 400, e.message) }
      return json(res, 200, { level: next });
    }
    if (url.pathname === '/admin/api/rules' && method === 'GET') {
      if (!adminGate(req, res, 'settings', method)) return;
      return json(res, 200, gatewayApi.status());
    }
    if (url.pathname === '/admin/api/rules/reload' && method === 'POST') {
      if (!adminGate(req, res, 'settings', method)) return;
      const status = gatewayApi.reload();
      return json(res, 200, { reloaded: true, ...status });
    }
    if (url.pathname === '/admin/api/config-profiles' && method === 'GET') { if (!adminGate(req, res, 'profiles', method)) return; return json(res, 200, { profiles: await configProfiles.list() }) }
    if (url.pathname === '/admin/api/config-profiles' && method === 'POST') {
      if (!adminGate(req, res, 'profiles', method)) return;
      const data = await parse(req); const name = clean(data.name);
      const settings = data && data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? data.settings : runtime.settings;
      const profile = await configProfiles.save(name, settings);
      await audit('config.profile.saved', { profile: name });
      return json(res, 201, { profile });
    }
    {
      const m = /^\/admin\/api\/config-profiles\/([a-z0-9][a-z0-9_-]{0,63})\/apply$/.exec(url.pathname);
      if (m && method === 'POST') {
        if (!adminGate(req, res, 'profiles', method)) return;
        const profile = await configProfiles.get(m[1]); if (!profile) return fail(res, 404, 'Profile not found');
        const saved = await runtime.save(profile.settings);
        const restartRequired = path.join(saved.databaseDirectory, saved.databaseFile) !== runtime.databaseRelative;
        await audit('config.profile.applied', { profile: m[1], restartRequired });
        return json(res, 200, { profile: m[1], settings: saved, restartRequired });
      }
    }
    {
      const m = /^\/admin\/api\/config-profiles\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(url.pathname);
      if (m && method === 'DELETE') {
        if (!adminGate(req, res, 'profiles', method)) return;
        const removed = await configProfiles.remove(m[1]); if (!removed) return fail(res, 404, 'Profile not found');
        await audit('config.profile.deleted', { profile: m[1] });
        return json(res, 200, { deleted: m[1] });
      }
    }
    if (url.pathname === '/admin/api/database/backups' && method === 'GET') {
      if (!adminGate(req, res, 'backup', method)) return;
      const dir = backupsDir; let entries = [];
      try { entries = (await fsp.readdir(dir)).filter(n => n.endsWith('.sqlite')) } catch (e) { if (e.code !== 'ENOENT') throw e }
      const backups = [];
      for (const name of entries) { try { const st = await fsp.stat(path.join(dir, name)); backups.push({ name, bytes: st.size, createdAt: st.mtime.toISOString() }) } catch { /* архив, изчезнал между readdir и stat, се прескача */ } }
      backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(res, 200, { backups, mirror: backupsMirrorDir ? { dir: backupsMirrorDir } : null });
    }
    // Проверка на архивите: преизчислява SHA-256 на всеки файл и (при зададено
    // огледало) сравнява копието с оригинала. „Имам backup“ става доказан факт.
    if (url.pathname === '/admin/api/database/backups/verify' && method === 'POST') {
      if (!adminGate(req, res, 'backup', method)) return;
      const shaOf = async file => { const h = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex') };
      let names = [];
      try { names = (await fsp.readdir(backupsDir)).filter(n => n.endsWith('.sqlite')).sort() } catch (e) { if (e.code !== 'ENOENT') throw e }
      const files = [];
      for (const name of names) {
        try {
          const primarySha = await shaOf(path.join(backupsDir, name));
          const st = await fsp.stat(path.join(backupsDir, name));
          const item = { name, bytes: st.size, sha256: primarySha, primary: 'ok', mirror: backupsMirrorDir ? 'checked' : 'disabled' };
          if (backupsMirrorDir) {
            try {
              const mirrorSha = await shaOf(path.join(backupsMirrorDir, name));
              item.mirror = mirrorSha === primarySha ? 'ok' : 'mismatch';
              item.mirrorSha256 = mirrorSha;
            } catch (e) { item.mirror = e.code === 'ENOENT' ? 'missing' : 'unreadable' }
          }
          files.push(item);
        } catch (e) { files.push({ name, primary: 'unreadable', error: e.code || e.message }) }
      }
      const bad = files.filter(x => x.primary !== 'ok' || ['mismatch', 'missing', 'unreadable'].includes(x.mirror));
      return json(res, 200, { dir: backupsDir, mirror: backupsMirrorDir || null, checked: files.length, mismatched: bad.length, files });
    }

    // Проверка и възстановяване на файловете срещу огледалото: за всяко качване се
    // сравнява SHA-256 на оригинала и на копието. „repair:true“ връща липсващата страна
    // от здравата (копие → оригинал или обратно), така че една повредена страна не е загуба.
    if (url.pathname === '/admin/api/storage/mirror/verify' && method === 'POST') {
      if (!adminGate(req, res, 'storage', method)) return;
      if (!storageMirrorDir) return fail(res, 409, 'storage_mirror is not configured');
      // Празно тяло е валидно (само проверка без repair); невалиден JSON не се приема.
      let payload = {};
      const rawVerify = await body(req, 64 * 1024).catch(() => Buffer.alloc(0));
      if (rawVerify && rawVerify.length) { try { payload = JSON.parse(rawVerify.toString('utf8')) || {} } catch { return fail(res, 400, 'Invalid JSON') } }
      const repair = payload && payload.repair === true;
      const shaOf = async file => { const h = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) h.update(chunk); return h.digest('hex') };
      const files = []; let repaired = 0;
      for (const p of db.portals) {
        for (const f of p.files) {
          const primary = path.join(filesRoot, p.id, f.id);
          const mirror = mirrorFilePath(p.id, f.id);
          const item = { portalId: p.id, fileId: f.id, name: f.name, status: 'lost', repaired: false };
          let primarySha = null, mirrorSha = null;
          try { primarySha = await shaOf(primary) } catch (e) { if (e.code !== 'ENOENT') item.primaryError = e.code }
          try { mirrorSha = await shaOf(mirror) } catch (e) { if (e.code !== 'ENOENT') item.mirrorError = e.code }
          item.sha256 = primarySha || mirrorSha || '';
          item.equal = Boolean(primarySha && mirrorSha && primarySha === mirrorSha);
          if (primarySha && mirrorSha) item.status = item.equal ? 'ok' : 'mismatch';
          else if (primarySha) item.status = 'mirrorMissing';
          else if (mirrorSha) item.status = 'primaryMissing';
          if (repair && item.status !== 'ok' && item.status !== 'lost') {
            try {
              if (item.status === 'primaryMissing') { await fsp.mkdir(path.dirname(primary), { recursive: true }); await fsp.copyFile(mirror, primary) }
              else { await fsp.mkdir(path.dirname(mirror), { recursive: true, mode: 0o700 }); await fsp.copyFile(primary, mirror) }
              const afterPrimary = await shaOf(primary).catch(() => null);
              const afterMirror = await shaOf(mirror).catch(() => null);
              item.repaired = Boolean(afterPrimary && afterMirror && afterPrimary === afterMirror);
              item.status = item.repaired ? 'ok' : item.status;
              if (item.repaired) repaired++;
            } catch (e) { item.repairError = e.code || e.message }
          }
          files.push(item);
        }
      }
      const problems = files.filter(x => x.status !== 'ok');
      void audit('storage.mirror.verify', { checked: files.length, problems: problems.length, repaired });
      return json(res, problems.length ? 409 : 200, { dir: storageMirrorDir, checked: files.length, ok: files.length - problems.length, problems: problems.length, repaired, files });
    }

    if (url.pathname === '/admin/api/database/backup-schedule' && method === 'GET') {
      if (!adminGate(req, res, 'backup', method)) return;
      return json(res, 200, { schedule: runtime.settings.backupSchedule || DEFAULT_BACKUP_SCHEDULE, nextRunAt: backupScheduleNext ? new Date(backupScheduleNext).toISOString() : null });
    }
    if (url.pathname === '/admin/api/database/backup-schedule' && method === 'PUT') {
      if (!adminGate(req, res, 'backup', method)) return;
      const data = await parse(req);
      const current = runtime.settings.backupSchedule || DEFAULT_BACKUP_SCHEDULE;
      const next = { enabled: data.enabled !== undefined ? !!data.enabled : current.enabled, intervalMinutes: data.intervalMinutes !== undefined ? Number(data.intervalMinutes) : current.intervalMinutes, maxBackups: data.maxBackups !== undefined ? Number(data.maxBackups) : current.maxBackups };
      const saved = await runtime.save({ backupSchedule: next });
      applyBackupSchedule();
      await audit('backup.schedule.updated', { ...saved.backupSchedule });
      return json(res, 200, { schedule: saved.backupSchedule, nextRunAt: backupScheduleNext ? new Date(backupScheduleNext).toISOString() : null });
    }
    {
      const m = /^\/admin\/api\/database\/backups\/([a-zA-Z0-9._-]+\.sqlite)\/restore$/.exec(url.pathname);
      if (m && method === 'POST') {
        if (!adminGate(req, res, 'backup', method)) return;
        const name = m[1]; if (name !== path.basename(name)) return fail(res, 400, 'Invalid backup name');
        const source = path.join(backupsDir, name);
        let stat; try { stat = await fsp.stat(source) } catch { return fail(res, 404, 'Backup not found') }
        if (!stat.isFile()) return fail(res, 404, 'Backup not found');
        // Restore runs on the same metadata queue as updates so it cannot interleave
        // with a partial write; validation happens before any commit.
        let result;
        try {
          result = await new Promise((resolve, reject) => { const run = queue.then(() => { try { const r = metadataStore.restoreFrom(source); db = metadataStore.load(); resolve(r) } catch (e) { reject(e) } }); queue = run.catch(() => { }) });
        } catch (e) {
          void errorLog.append('error', 'backup-restore', e && e.message || 'Restore failed', { name });
          return fail(res, 422, 'Restore failed: invalid or incompatible backup');
        }
        await audit('database_restored', { name, portals: result.portals, qrArtifacts: result.qrArtifacts, revision: result.revision });
        return json(res, 200, { restored: result });
      }
    }
    if (url.pathname === '/admin/api/storage/status' && method === 'GET') {
      if (!adminGate(req, res, 'storage', method)) return;
      return json(res, 200, { locations: [root, filesRoot, internalRoot, htmlProjectsRoot].map(l => path.basename(l)), lastCheck: lastStorageCheck, intervalMs: storageCheckIntervalMs, nextCheckAt: storageCheckIntervalMs && lastStorageCheckTime ? new Date(lastStorageCheckTime + storageCheckIntervalMs).toISOString() : null });
    }
    if (url.pathname === '/admin/api/storage/check' && method === 'POST') {
      if (!adminGate(req, res, 'storage', method)) return;
      return json(res, 200, await runStorageCheck('manual'));
    }
    // Evidence View порталът: къде е публикуван и повторно публикуване по заявка.
    if (url.pathname === '/admin/api/evidence-portal/status' && method === 'GET') {
      if (!adminGate(req, res, 'storage', method)) return;
      return json(res, 200, require('./evidence-portal').status());
    }
    if (url.pathname === '/admin/api/evidence-portal/deploy' && method === 'POST') {
      if (!adminGate(req, res, 'storage', method)) return;
      const deployed = require('./evidence-portal').deploy();
      void audit('evidence-portal.deploy', { ok: deployed.ok, dir: deployed.dir || '', error: deployed.error || '' });
      return json(res, deployed.ok ? 200 : 409, deployed);
    }
    if (url.pathname === '/admin/api/whoami' && method === 'GET') { if (!adminGate(req, res, 'whoami', method)) return; return json(res, 200, { role: rbac.role(req), ingress: req.ingress === true, defaultRole: rbac.defaultRole, mapped: rbac.configured }) }
    // Връзка за GUI-я: роля, режим и публичен адрес за API/QR (без секрети).
    if (url.pathname === '/admin/api/connection' && method === 'GET') {
      if (!adminGate(req, res, 'whoami', method)) return;
      return json(res, 200, { role: rbac.role(req), ingress: req.ingress === true, publicBaseUrl: runtime.effective().publicBaseUrl || '', requestBase: baseUrl(req), apiVersion: apiVersion.VERSION.CURRENT });
    }
    if (url.pathname === '/health' && method === 'GET') return json(res, 200, { status: 'ok' });
    if (url.pathname === '/ready' && method === 'GET') {
      // Readiness (не liveness): проверява реалните зависимости, за да не се праща трафик към счупен процес.
      const checks = { storage: false, db: false, rules: false };
      try { const probe = path.join(root, '.ready-' + process.pid); await fsp.writeFile(probe, 'ok', { flag: 'wx' }); await fsp.unlink(probe); checks.storage = true } catch { /* недостъпно за запис хранилище е валиден резултат (checks.storage=false) */ }
      // Дълбока проверка: PRAGMA quick_check хваща повредени страници, които не пречат
      // на отварянето, но правят записа опасен. Състоянието е отделно поле (db.state),
      // за да остане `checks` стабилен договор за probe-овете: ok | degraded | failed.
      const verdict = require('./readiness').evaluate({ storageOk: checks.storage, metadata: db, quickCheck: metadataStore.quickCheck });
      checks.db = verdict.checks.db;
      try { checks.rules = gatewayApi.status().missing.length === 0 } catch { checks.rules = false }
      return json(res, verdict.ready ? 200 : 503, { ready: verdict.ready, checks, db: { state: verdict.dbState, detail: verdict.dbDetail }, instance: { id: instanceState.id, pid: process.pid, since: instanceState.startedAt || null }, dataDir: root, uptime: Math.round(process.uptime()) });
    } if (url.pathname === '/admin/api/metrics' && method === 'GET') { if (!adminGate(req, res, 'metrics', method)) return; return json(res, 200, { ...counters, portals: db.portals.length }) }
    if (url.pathname === '/admin/api/audit/verify' && method === 'GET') { if (!adminGate(req, res, 'audit', method)) return; const result = await auditChain.verify(); return json(res, result.valid ? 200 : 409, { ...result, integrity: result.valid ? 'HASH_CHAIN_VALID' : 'FAILED', note: 'Hash chaining detects changes but is not externally anchored or tamper-proof against an administrator who can rewrite the entire chain.' }) }
    if (url.pathname === '/admin/api/audit' && method === 'GET') {
      if (!adminGate(req, res, 'audit', method)) return;
      const limitRaw = url.searchParams.get('limit') || '100';
      if (!/^[0-9]{1,4}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 500) return fail(res, 400, 'Invalid limit');
      const portalId = url.searchParams.get('portalId');
      if (portalId && !/^[a-f0-9]{24}$/.test(portalId)) return fail(res, 400, 'Invalid portalId');
      let lines = [];
      try { lines = (await fsp.readFile(auditPath, 'utf8')).split('\n').filter(Boolean) } catch (e) { if (e.code !== 'ENOENT') throw e }
      const events = [];
      for (let i = lines.length - 1; i >= 0 && events.length < Number(limitRaw); i--) { let event; try { event = JSON.parse(lines[i]) } catch { continue } if (!portalId || event.portalId === portalId) events.push(event) }
      return json(res, 200, { events, count: events.length, integrity: 'UNVERIFIED', order: 'newest-first' });
    }
    if (url.pathname === '/admin/api/audit/export' && method === 'GET') {
      if (!adminGate(req, res, 'audit', method)) return;
      const format = (url.searchParams.get('format') || 'json').toLowerCase();
      if (!['json', 'csv'].includes(format)) return fail(res, 400, 'Invalid format');
      const portalId = url.searchParams.get('portalId');
      if (portalId && !/^[a-f0-9]{24}$/.test(portalId)) return fail(res, 400, 'Invalid portalId');
      const since = url.searchParams.get('since'), until = url.searchParams.get('until');
      if (since && !Number.isFinite(Date.parse(since))) return fail(res, 400, 'Invalid since');
      if (until && !Number.isFinite(Date.parse(until))) return fail(res, 400, 'Invalid until');
      const inRange = t => { const d = Date.parse(t); if (!Number.isFinite(d)) return false; if (since && d < Date.parse(since)) return false; if (until && d > Date.parse(until)) return false; return true };
      let lines = []; try { lines = (await fsp.readFile(auditPath, 'utf8')).split('\n').filter(Boolean) } catch (e) { if (e.code !== 'ENOENT') throw e }
      const events = []; for (const line of lines) { let e; try { e = JSON.parse(line) } catch { continue } if (portalId && e.portalId !== portalId) continue; if (!inRange(e.at)) continue; events.push(e) }
      const byEvent = {}; for (const e of events) byEvent[e.event] = (byEvent[e.event] || 0) + 1;
      if (format === 'csv') {
        const cols = ['at', 'event', 'portalId', 'fileId', 'actor', 'ip', 'details'];
        const esc = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s };
        const rows = events.map(e => { const d = e.details && typeof e.details === 'object' ? e.details : {}; return [e.at, e.event, e.portalId || '', e.fileId || '', e.actor || '', e.ip || '', esc(JSON.stringify(d))].map(esc).join(',') });
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit-export.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end('\ufeff' + [cols.join(','), ...rows].join('\r\n'));
      }
      void audit('audit.export', { format, count: events.length });
      return json(res, 200, { generatedAt: new Date().toISOString(), count: events.length, firstAt: events[0]?.at || null, lastAt: events[events.length - 1]?.at || null, byEvent, order: 'oldest-first', events });
    }
    if (url.pathname === '/admin/api/retention' && method === 'GET') {
      if (!adminGate(req, res, 'retention', method)) return;
      return json(res, 200, await retention.preview(db.portals));
    }
    if (url.pathname === '/admin/api/retention' && method === 'POST') {
      if (!adminGate(req, res, 'retention', method)) return;
      const result = await update(async () => { const r = await retention.apply(db.portals); void audit('retention.run', { fileAction: r.fileAction, disabled: r.disabled, deleted: r.deleted, auditLinesPruned: r.auditLinesPruned }); return r });
      return json(res, 200, result);
    }
    // Старият панел (admin.html/admin.js) е премахнат: входът е Enterprise Control Center.
    // Старите отметки /admin стигат до него с пренасочване, за да не се губи навикът.
    if ((url.pathname === '/admin' || url.pathname === '/admin/') && method === 'GET') { res.writeHead(302, { Location: '/ui/index.html', 'Cache-Control': 'no-store' }); return res.end() }
    // Enterprise Control Center GUI (Фаза 10/11). Публичен като /admin: данните са ДЕМО,
    // а административните API-та си изискват Bearer токен. Allowlist — без произволни пътища.
    const UI_FILES = (() => {
      const files = { '/ui': ['ui/index.html', 'text/html; charset=utf-8'], '/ui/': ['ui/index.html', 'text/html; charset=utf-8'], '/ui/index.html': ['ui/index.html', 'text/html; charset=utf-8'], '/ui/styles.css': ['ui/styles.css', 'text/css; charset=utf-8'], '/ui/manifest.example.json': ['ui/manifest.example.json', 'application/json; charset=utf-8'] };
      for (const f of ['bootstrap.js', 'app.js', 'icons.js', 'data.js', 'report-objects.js', 'report-studio.js', 'portals.js', 'portal-control.js', 'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js', 'dashboard-panel.js', 'settings-panel.js', 'secret-share.js', 'export-center.js', 'public-gateway.js']) files['/ui/' + f] = ['ui/' + f, 'text/javascript; charset=utf-8'];
      for (const f of ['report-manifest.js', 'api-spec.js', 'virtual-storage.js', 'storage-tree.js', 'export-rules.js', 'export-manager.js', 'download-access.js', 'public-gateway.js', 'qrcode.js']) files['/hapi_enterprise/' + f] = ['hapi_enterprise/' + f, 'text/javascript; charset=utf-8'];
      // Публичната страница на тайна връзка отваря този скрипт от корена: `/hapi_enterprise/`
      // е достъпен само на административния listener (ingress), а прегледът е публичен.
      files['/secret-view.js'] = ['secret-view.js', 'text/javascript; charset=utf-8'];
      return files;
    })();
    // Статиката се търси първо до server.js (така е в контейнера: /app/ui, /app/*.js),
    // после в родителската папка (така е при разработка от repo root). Липсващ файл
    // връща 404, а не 500 — иначе UI-ят „гърми" само в add-on-а.
    const uiFile = rel => { const candidates = [path.join(__dirname, rel)]; const prefix = 'hapi_enterprise/'; if (rel.startsWith(prefix)) candidates.push(path.join(__dirname, rel.slice(prefix.length))); candidates.push(path.join(__dirname, '..', rel)); for (const candidate of candidates) { try { if (fs.statSync(candidate).isFile()) return candidate } catch { /* кандидатът просто не съществува — търсим следващия */ } } return null };
    if (method === 'GET' && UI_FILES[url.pathname]) {
      const [rel, type] = UI_FILES[url.pathname]; const file = uiFile(rel);
      if (!file) { req.log.warn('ui.asset.missing', { ns: 'ui', asset: rel }); return fail(res, 404, 'Not found') }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src blob:; object-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      return res.end(fs.readFileSync(file));
    }
    if (url.pathname === '/' && method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); return res.end('<!doctype html><html lang="bg"><meta charset="utf-8"><title>hAPI Enterprise</title><style>body{font:16px system-ui;background:#101827;color:#fff;max-width:800px;margin:5rem auto;padding:1rem}a{color:#7dd3fc}</style><h1>hAPI Enterprise</h1><p>Public API: <a href="/api/v1/portals">/api/v1/portals</a></p><p>Административните операции изискват Bearer токен.</p></html>') }
    // Isolated static HTML project hosting. Only folders inside DATA_DIR/html-projects
    // can be registered. Every served file is checked with realpath to prevent symlink escapes.
    if (parts[0] === 'site' && parts.length >= 3 && method === 'GET') {
      const p = getPortal(parts[1]); if (!p) return fail(res, 404, 'Not found');
      const project = (p.htmlProjects || []).find(x => x.id === parts[2]); if (!project || !project.enabled) return fail(res, 404, 'Not found');
      const prefix = '/site/' + encodeURIComponent(p.slug) + '/' + project.id;
      const cookieName = 'pe_site_' + project.id;
      const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => { const i = v.indexOf('='); return i < 0 ? ['', ''] : [v.slice(0, i).trim(), v.slice(i + 1).trim()] }));
      const verifySession = () => { const token = cookies[cookieName]; if (!token) return false; const s = metadataStore.getSession(keyDigest(token)); return !!(s && (s.scopes || []).includes('read')) };
      if (requirePortalToken || p.visibility !== 'public') {
        if (!verifySession()) {
          const token = url.searchParams.get('portal_token'); const s = token && metadataStore.getSession(keyDigest(token));
          if (!s || !(s.scopes || []).includes('read')) return fail(res, 404, 'Not found');
          res.writeHead(302, { 'Location': prefix + '/', 'Set-Cookie': `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${prefix}/; Max-Age=2592000`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end();
        }
      }
      const segments = parts.slice(3); if (segments.some(x => x === '.' || x === '..' || x.includes('\\') || x.includes('\0'))) return fail(res, 404, 'Not found');
      const relative = segments.length ? segments.join('/') : 'index.html';
      const base = path.join(htmlProjectsRoot, project.folder); let baseReal, targetReal, st;
      try { baseReal = await fsp.realpath(base); targetReal = await fsp.realpath(path.join(base, relative)); st = await fsp.stat(targetReal); if (st.isDirectory()) { targetReal = await fsp.realpath(path.join(targetReal, 'index.html')); st = await fsp.stat(targetReal) } } catch { return fail(res, 404, 'Not found') }
      if (!targetReal.startsWith(baseReal + path.sep) || !st.isFile()) return fail(res, 404, 'Not found');
      const ext = path.extname(targetReal).toLowerCase(); const mime = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
      if (!mime[ext]) return fail(res, 415, 'File type not supported');
      res.writeHead(200, { 'Content-Type': mime[ext], 'Content-Length': st.size, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(targetReal).pipe(res);
    }
    if (parts[0] === 'qr' && parts.length === 2 && method === 'GET') {
      const a = (db.qrArtifacts || []).find(x => x.qrId === parts[1]);
      if (!a) return fail(res, 404, 'Not found');
      observer.visit({ portalId: a.portalId || '', qr: true });
      let manifest = {};
      try { manifest = JSON.parse(fs.readFileSync(path.join(root, a.relativeDirectory, 'manifest.json'), 'utf8')) } catch { /* липсващ или повреден манифест значи празен обект */ }
      const org = htmlEsc(manifest.organization || ''), project = htmlEsc(manifest.project || ''), campaign = htmlEsc(manifest.campaign || '');
      const files = Array.isArray(manifest.files) ? manifest.files : [];
      const rows = files.map(f => '<tr><td>' + htmlEsc(f.name || f.id || '') + '</td><td>' + htmlEsc(String(f.sha256 || '').slice(0, 12)) + '</td></tr>').join('');
      const created = htmlEsc(manifest.createdAt || a.createdAt || '');
      const html = '<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + htmlEsc(org || project || 'QR') + '</title><style>body{font-family:system-ui,sans-serif;margin:2rem;color:#1a1a2e;background:#f6f7fb}main{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e3e6f0;border-radius:12px;padding:2rem;box-shadow:0 4px 16px rgba(0,0,0,.06)}h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.1rem;margin:1.5rem 0 .5rem;color:#333}p{margin:.25rem 0}table{width:100%;border-collapse:collapse;margin-top:.5rem}th,td{border-bottom:1px solid #eee;text-align:left;padding:.5rem .25rem}th{font-size:.8rem;text-transform:uppercase;color:#888}.meta{color:#666;font-size:.9rem}footer{margin-top:1.5rem;font-size:.8rem;color:#999}</style></head><body><main><h1>' + org + '</h1><div class="meta">' + project + (campaign ? ' · ' + campaign : '') + '</div><h2>Официални документи</h2>' + (rows ? '<table><thead><tr><th>Документ</th><th>Отпечатък</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="meta">Няма регистрирани файлове.</p>') + '<footer>Регистриран на ' + created + ' · QR № ' + htmlEsc(parts[1]) + '</footer></main></body></html>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      return res.end(html);
    }
    // Публична страница на портала — адресът, който QR кодът отваря: /p/<id портала>[/]
    // (приема се и /p/<slug> за стари връзки).
    if (parts[0] === 'p' && (parts.length === 2 || (parts.length === 3 && parts[2] === '')) && method === 'GET') {
      const portal = resolvePortal(parts[1]); if (!portal) return fail(res, 404, 'Not found');
      if ((requirePortalToken || portal.visibility !== 'public') && !portalAuthorized(req, portal, 'read', url)) return fail(res, 404, 'Not found');
      void recordTelemetry('visit', req, portal, null, url);
      const html = fs.readFileSync(path.join(__dirname, 'portal.html'));
      // inline стилове не се allow-ват; QR кодът е локален SVG (img-src 'self').
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      return res.end(html);
    }
    if (url.pathname === '/portal.js' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(path.join(__dirname, 'portal.js')));
    }
    if (url.pathname === '/portal.css' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(path.join(__dirname, 'portal.css')));
    }
    if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'portals' && parts.length === 3 && method === 'GET') return requirePortalToken ? fail(res, 404, 'Not found') : json(res, 200, { portals: db.portals.filter(p => p.visibility === 'public').map(publicPortal) });
    // Public API Gateway (PG-6): отделен канал, отделна токен схема и централни правила за достъп.
    if (parts[0] === 'api' && parts[1] === 'public' && parts[2] === 'v1') {
      const gwApi = require('./gateway-api');
      if (parts[3] === 'portals' && parts[4] && method === 'GET') {
        const gp = getPortal(parts[4]); if (!gp) return fail(res, 404, 'Not found');
        const gwCfg = gwApi.config(), view = gwApi.portalView(gp, gwCfg);
        if (view.status !== 'active') return fail(res, 404, 'Not found');
        if (parts.length === 5) return json(res, 200, { portal: view, urls: gwApi.urlsFor(view, gwCfg) });
        if (parts[5] === 'files' && parts.length === 6) return json(res, 200, { files: gp.files.filter(f => f.listed !== false).map(f => gwApi.fileView(gp, f, gwCfg)).filter(f => f.visibility === 'public') });
        return fail(res, 404, 'Not found');
      }
      if (parts[3] === 'files' && parts[4]) {
        const owner = db.portals.find(p => p.files.some(f => f.id === parts[4])), f = owner && owner.files.find(x => x.id === parts[4]);
        if (!owner || !f) return fail(res, 404, 'Not found');
        const headerKey = String(req.headers['x-portal-key'] || '').trim(), queryKey = String(url.searchParams.get('key') || '').trim(), key = headerKey || queryKey || null;
        const legacyOk = !!(key && f.accessKeys && tokenMatch(f.accessKeys, headerKey || queryKey));
        const session = resolveSession(req, url);
        const perms = session ? ((session.scopes || []).includes('download') ? ['files.read', 'files.download'] : ['files.read']) : [];
        const decision = gwApi.decideFile({ portal: owner, file: f, key, keyOk: legacyOk, user: session ? { id: session.id || 'session', roles: [], permissions: perms } : null, session: { ip: req.socket.remoteAddress }, permission: 'files.download' });
        if (parts[5] === 'access' && parts.length === 6) return json(res, 200, { allowed: decision.allowed, reason: decision.reason, detail: decision.detail, checks: decision.checks, mode: decision.mode, visibility: decision.visibility, behaviour: decision.behaviour, url: decision.url });
        if (parts[5] === 'download' && parts.length === 6 && method === 'GET') {
          if (!decision.allowed) { void audit('gateway.download.denied', { portalId: owner.id, fileId: f.id, reason: decision.reason }); return json(res, 403, { error: 'Access denied', reason: decision.reason, detail: decision.detail }) }
          const fp = path.join(filesRoot, owner.id, f.id); let stat; try { stat = await fsp.lstat(fp) } catch { return fail(res, 404, 'File unavailable') }
          if (!stat.isFile()) return fail(res, 404, 'File unavailable');
          void audit('gateway.download', { portalId: owner.id, fileId: f.id });
          if (f.encrypted) return serveEncryptedFile(req, res, fp, f, () => { counters.downloads++; observer.download({ ok: true, bytes: f.size || 0 }); void recordTelemetry('download', req, owner, f, url) });
          return streamDownload(req, res, fp, stat, f.name, () => { counters.downloads++; observer.download({ ok: true, bytes: f.size || 0 }); void recordTelemetry('download', req, owner, f, url) });
        }
        return fail(res, 404, 'Not found');
      }
      return fail(res, 404, 'Not found');
    }
    // ── Тайни връзки (zero-knowledge, модел като scrt.link v2) ────────────────
    // ЦЯЛАТА информация е във фрагмента (`/secret#<id><ключ>`), който браузърът не
    // изпраща. Затова в пътя няма идентификатор: сървърът вижда само `sha256(id)`
    // в API заявката и пази непрозрачен плик с шифротекст.
    // `/secret/<нещо>` се сервира със същата черупка, за да не дава 404 на
    // подрязан или стар линк — идентификаторът и без това идва само от фрагмента.
    if (parts[0] === 'secret' && parts.length <= 2 && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': SECRET_CSP, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' });
      return res.end(secretPage.secretPageHtml());
    }
    // Проба: казва колко прегледа остават и дали трябва парола, БЕЗ да отваря тайната
    // и без да брои преглед. Така получателят знае какво го чака, преди да го изразходва.
    if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'secrets' && parts.length === 4 && method === 'GET') {
      if (!secretLinks.isValidHash(parts[3])) return fail(res, 404, 'Secret not found');
      const rec = await secretLinks.read(root, parts[3]);
      const state = secretLinks.inspectRecord(rec);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!state.ok) {
        if (rec) await secretLinks.remove(root, rec.idHash).catch(() => { });
        return fail(res, state.reason === 'missing' ? 404 : 410, state.reason === 'missing' ? 'Secret not found' : 'Secret is gone (' + state.reason + ')');
      }
      return json(res, 200, {
        remainingViews: Math.max(0, Number(rec.maxViews || 0) - Number(rec.views || 0)),
        maxViews: Number(rec.maxViews || 0),
        expiresAt: rec.expiresAt || null,
        requiresPassword: Boolean(rec.requiresPassword),
        // Само параметрите на KDF — `check` НЕ се дава: той е за сравнение при reveal.
        pwd: rec.requiresPassword && rec.envelope && rec.envelope.pwd
          ? { alg: rec.envelope.pwd.alg, iterations: rec.envelope.pwd.iterations, salt: rec.envelope.pwd.salt }
          : null,
        hint: rec.hint || '',
      });
    }
    if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'secrets' && parts.length === 5 && parts[4] === 'reveal' && method === 'POST') {
      if (!secretLinks.isValidHash(parts[3])) return fail(res, 404, 'Secret not found');
      const body = await parse(req).catch(() => ({}));
      const out = await withSecretLock(parts[3], async () => {
        const rec = await secretLinks.read(root, parts[3]);
        const state = secretLinks.inspectRecord(rec);
        if (!state.ok) {
          // Изтекло/прегледано/отменено: файлът се маха, за да не остане шифротекст.
          if (rec) await secretLinks.remove(root, rec.idHash).catch(() => { });
          return { code: state.reason === 'missing' ? 404 : 410, reason: state.reason };
        }
        // Паролата се проверява по `sha256(ключ от паролата)`, изчислен В БРАУЗЪРА. Сгрешен
        // proof НЕ изразходва преглед — иначе една сгрешена парола „изяжда“ тайната.
        if (rec.requiresPassword) {
          const expected = String((rec.envelope && rec.envelope.pwd && rec.envelope.pwd.check) || '');
          if (!expected || !safeEqual(String(body.proof || ''), expected)) return { code: 403, reason: 'password' };
        }
        rec.views = Number(rec.views || 0) + 1;
        rec.lastViewAt = new Date().toISOString();
        const left = Math.max(0, Number(rec.maxViews || 0) - rec.views);
        if (left <= 0) await secretLinks.remove(root, rec.idHash);
        else await secretLinks.save(root, rec);
        void audit('secret.reveal', { receipt: rec.receipt || null, idHash: String(rec.idHash).slice(0, 12), views: rec.views, maxViews: rec.maxViews });
        // `check` остава на сървъра: той е само за проверка на паролата и не бива да излиза
        // към получателя (иначе е офлайн оракул за паролата, без да е нужен ключът от линка).
        const envelope = rec.envelope ? { v: rec.envelope.v, iv: rec.envelope.iv, ct: rec.envelope.ct } : null;
        if (rec.envelope && rec.envelope.pwd) envelope.pwd = { alg: rec.envelope.pwd.alg, iterations: rec.envelope.pwd.iterations, salt: rec.envelope.pwd.salt };
        return { code: 200, body: { envelope, hint: rec.hint || '', viewsLeft: left, expiresAt: rec.expiresAt || null } };
      });
      if (out.code === 403) return fail(res, 403, 'Password required or wrong');
      if (out.code !== 200) return fail(res, out.code, out.reason === 'missing' ? 'Secret not found' : 'Secret is gone (' + out.reason + ')');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      return json(res, 200, out.body);
    }
    // ── „Бърз линк“ (Send-lite): публичен канал без портал, акаунт и ключ ──────
    if (parts[0] === 's' && parts.length === 2 && method === 'GET') {
      const hit = findSend(parts[1]);
      if (!hit || !sendLite.canAccess(hit.send).ok) return fail(res, 404, 'Link not found or expired');
      void recordTelemetry('visit', req, hit.portal, hit.file, url);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': SEND_CSP, 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' });
      return res.end(sendLandingHtml(hit));
    }
    if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'sends' && parts.length === 5 && parts[4] === 'access' && method === 'POST') {
      const sendId = parts[3];
      const wantsJson = String(req.headers['content-type'] || '').includes('application/json') || String(req.headers.accept || '').includes('application/json');
      const deny = (code, message) => {
        if (wantsJson) return fail(res, code, message);
        res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.end(message);
      };
      const hit = findSend(sendId);
      if (!hit || !sendLite.canAccess(hit.send).ok) return deny(404, 'Link not found or expired');
      if (!sendGate(sendId, req)) return deny(429, 'Too many attempts');
      let payload = {};
      try {
        if (String(req.headers['content-type'] || '').includes('application/json')) payload = await parse(req);
        else { const raw = (await body(req, 8192)).toString('utf8'); payload = Object.fromEntries(new URLSearchParams(raw)) }
      } catch (e) { return deny(e && e.status ? e.status : 400, 'Invalid request') }
      if (!sendLite.verifyPassphrase(payload.passphrase, hit.send)) {
        registerSendFailure(sendId, req);
        void audit('file.send.denied', { portalId: hit.portal.id, fileId: hit.file.id, sendId });
        return deny(403, 'Wrong passphrase');
      }
      // Броячът се вдига при успешен достъп (както при Vaultwarden), преди билета.
      const consumed = await update(() => {
        const current = findSend(sendId);
        if (!current || !sendLite.canAccess(current.send).ok) return null;
        current.send.accessCount = Number(current.send.accessCount || 0) + 1;
        current.send.lastAccessAt = new Date().toISOString();
        void audit('file.send.access', { portalId: current.portal.id, fileId: current.file.id, sendId, accessCount: current.send.accessCount });
        return current;
      });
      if (!consumed) return deny(404, 'Link not found or expired');
      const minted = sendLite.mintTicket({ sendId, fileId: consumed.file.id, secret: adminToken });
      const target = '/api/v1/sends/' + encodeURIComponent(sendId) + '/file?ticket=' + encodeURIComponent(minted.ticket);
      if (wantsJson) return json(res, 200, { ticket: minted.ticket, url: target, expiresAt: minted.expiresAt });
      res.writeHead(303, { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      return res.end();
    }
    if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'sends' && parts.length === 5 && parts[4] === 'file' && method === 'GET') {
      pruneSendTickets();
      const claims = sendLite.verifyTicket(url.searchParams.get('ticket') || '', adminToken);
      if (!claims || claims.sendId !== parts[3]) return fail(res, 404, 'Link not found or expired');
      const nonceKey = claims.nonce || claims.sendId;
      if (usedSendTickets.has(nonceKey)) return fail(res, 404, 'Link not found or expired');
      usedSendTickets.set(nonceKey, claims.expiresAt);
      const hit = findSend(claims.sendId);
      if (!hit || hit.file.id !== claims.fileId || hit.send.disabled || sendLite.isExpired(hit.send)) return fail(res, 404, 'File unavailable');
      const fp = path.join(filesRoot, hit.portal.id, hit.file.id);
      let stat; try { stat = await fsp.lstat(fp) } catch { return fail(res, 404, 'File unavailable') }
      if (!stat.isFile()) return fail(res, 404, 'File unavailable');
      res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
      const onDownload = () => { counters.downloads++; observer.download({ ok: true, bytes: hit.file.size || 0 }); void recordTelemetry('download', req, hit.portal, hit.file, url); void audit('file.send.download', { portalId: hit.portal.id, fileId: hit.file.id, sendId: claims.sendId }) };
      if (hit.file.encrypted) return serveEncryptedFile(req, res, fp, hit.file, onDownload);
      return streamDownload(req, res, fp, stat, hit.file.name, onDownload);
    }
    if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'p') {
      const p = resolvePortal(parts[3]); if (!p) return fail(res, 404, 'Not found'); const tail = parts.slice(4); const downloadRoute = tail[0] === 'files' && tail[2] === 'download'; const fileForSigned = downloadRoute ? p.files.find(f => f.id === tail[1]) : null; const signed = !!(fileForSigned && fileMode(fileForSigned) === 'FREE' && signedValid(url, p, fileForSigned)); if ((requirePortalToken || p.visibility !== 'public') && (!signed || requirePortalToken) && !portalAuthorized(req, p, downloadRoute ? 'download' : 'read', url)) return fail(res, 404, 'Not found');
      if (!tail.length && method === 'GET') { observer.visit({ portalId: p.id }); void recordTelemetry('visit', req, p, null, url); return json(res, 200, publicPortal(p)); }
      if (tail[0] === 'openapi.json' && tail.length === 1 && method === 'GET') { try { return json(res, 200, JSON.parse(await fsp.readFile(path.join(apiRoot, p.slug, 'openapi.json'), 'utf8'))) } catch { return json(res, 200, spec(p, baseUrl(req))) } }
      // QR кодът води към ПУБЛИЧНАТА СТРАНИЦА на портала (/p/<slug>), не към JSON API-то:
      // сканиран с телефон, той отваря готовия списък с файлове, а не суров JSON.
      if (tail[0] === 'qr.svg' && tail.length === 1 && method === 'GET') { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); return res.end(qrSvg(portalLandingUrl(p, baseUrl(req)))) }
      // Legacy: portal QR без разширение пренасочва към каноничния .svg (Фаза 3.1).
      if (tail[0] === 'qr' && tail.length === 1 && method === 'GET') { res.writeHead(301, { 'Location': portalApiUrl(p, baseUrl(req)) + '/qr.svg', 'Cache-Control': 'no-store' }); return res.end() }
      if (tail[0] === 'manifest' && tail.length === 1 && method === 'GET') {
        // Манифестът води към виртуалното хранилище: всеки файл носи виртуален път,
        // а не физически път на диска. Пътят идва от дървото (`pathsOf`), защото то
        // решава дубликатите с „ (2)“ — иначе два еднакви имена получават един адрес.
        const vs = require('./virtual-storage'), tree = vs.buildTree(p.files), paths = vs.pathsOf(p.files);
        return json(res, 200, { portal: publicPortal(p), storage: { virtual: true, root: '/', url: portalApiUrl(p, baseUrl(req)) + '/storage', scheme: '/<topic>/<category>/<group>/<name>', folderCount: tree.folderCount, fileCount: tree.fileCount }, files: p.files.filter(f => f.listed !== false).map(f => ({ ...publicFile(f), accessMode: fileMode(f), path: paths[f.id] || vs.virtualPath(f) })) });
      }
      // Виртуално хранилище (Фаза 8): дърво topic → category → group → файл.
      // `path` е виртуален (/Тема/Категория); физически пътища никога не се показват.
      if (tail[0] === 'storage' && tail.length === 1 && method === 'GET') {
        const vs = require('./virtual-storage'), tree = vs.buildTree(p.files);
        const node = vs.resolve(tree, url.searchParams.get('path') || '/');
        if (!node) return fail(res, 404, 'Path not found');
        return json(res, 200, { virtual: true, root: '/', path: node.path, type: node.type, name: node.name, folders: node.folders || [], files: node.files || [], folderCount: tree.folderCount, fileCount: tree.fileCount });
      }
      // Папките от хранилището на портала (storage_root) като дърво с API за всяка папка.
      // Само за отделена папка на портала: коренът /share или /media не се публикува.
      if (tail[0] === 'tree' && (tail.length === 1 || (tail.length === 2 && (tail[1] === 'api.json' || tail[1] === 'qr.svg'))) && method === 'GET') {
        const root = portalRoot(p.storage_root || '/share');
        if (root === '/share' || root === '/media') return fail(res, 403, 'Folder API requires a dedicated folder (storage_root must be a subfolder)');
        const st = require('./storage-tree');
        const rel = st.normRel(url.searchParams.get('path') || '');
        if (rel === null) return fail(res, 400, 'Invalid path');
        let out; try { out = await collectStorageTree(root) } catch (e) { return fail(res, e.status || 500, e.message) }
        if (!out.exists) return fail(res, 404, 'Folder not found');
        // Скритите папки (флаг „видима“) не се показват в публичния API.
        const publicMeta = folderMetaOf(p);
        if (Object.values(publicMeta).some(f => f.visible === false)) { pruneHiddenFolders(out.tree, publicMeta); st.recount(out.tree); out.folderCount = out.tree.folderCount; out.fileCount = out.tree.fileCount }
        const node = st.resolve(out.tree, rel);
        if (!node) return fail(res, 404, 'Path not found');
        const apiRoot2 = portalApiUrl(p, baseUrl(req)) + '/tree';
        const folderUrl = folder => `${apiRoot2}?path=${encodeURIComponent('/' + folder)}`;
        const apiUrl = folderUrl(rel);
        const folderView = {
          portal: { slug: p.slug, title: p.title },
          folder: { path: '/' + rel, name: node.name, parent: rel ? ('/' + rel.split('/').slice(0, -1).join('/')) : '/', folderCount: node.folderCount, fileCount: node.fileCount, bytes: node.bytes },
          urls: { listing: apiUrl, apiJson: apiRoot2 + '/api.json?path=' + encodeURIComponent('/' + rel), qr: apiRoot2 + '/qr.svg?path=' + encodeURIComponent('/' + rel) },
        };
        if (tail.length === 2 && tail[1] === 'qr.svg') {
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
          return res.end(qrSvg(apiUrl));
        }
        if (tail.length === 2 && tail[1] === 'api.json') {
          void audit('folder.api', { portalId: p.id, path: '/' + rel });
          return json(res, 200, { schema_version: '1.0', kind: 'storage-folder', ...folderView, apiUrl, folders: (node.folders || []).map(f => ({ name: f.name, path: '/' + f.path, folderCount: f.folderCount, fileCount: f.fileCount, bytes: f.bytes, apiUrl: folderUrl(f.path) })), files: (node.files || []).map(f => ({ name: f.name, path: '/' + f.path, size: f.size, modifiedAt: f.modifiedAt || '' })), generatedAt: new Date().toISOString() });
        }
        void recordTelemetry('visit', req, p, null, url);
        return json(res, 200, { storage: true, root: '/', ...folderView, apiUrl, folders: (node.folders || []).map(f => ({ name: f.name, path: '/' + f.path, folderCount: f.folderCount, fileCount: f.fileCount, bytes: f.bytes, apiUrl: folderUrl(f.path) })), files: (node.files || []).map(f => ({ name: f.name, path: '/' + f.path, size: f.size, modifiedAt: f.modifiedAt || '' })) });
      }
      if (tail[0] === 'files' && tail.length === 1 && method === 'GET') return json(res, 200, filePage(p.files.filter(f => f.listed !== false), url));
      if (tail[0] === 'files' && tail[1] && tail[2] === 'rating' && tail.length === 3 && method === 'POST') {
        const f = p.files.find(x => x.id === tail[1]); if (!f || f.listed === false || fileMode(f) === 'DISABLED') return fail(res, 404, 'Not found');
        const b = await parse(req); if (!Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) return fail(res, 400, 'Rating must be 1-5');
        if (!resolveSession(req, url)) return fail(res, 401, 'Login required for rating');
        const key = tokenId(req, url);
        const already = telemetry.recent.some(e => e.event === 'rating' && e.fileId === f.id && e.tokenId === key);
        if (already) return fail(res, 409, 'Already rated in recent activity');
        await recordTelemetry('rating', req, p, f, url, { stars: b.stars }); return json(res, 201, { rated: true });
      }
      if (tail[0] === 'files' && tail[1]) { const f = p.files.find(x => x.id === tail[1]); if (!f || f.listed === false) return fail(res, 404, 'Not found'); if (tail.length === 2 && method === 'GET') return json(res, 200, publicFile(f)); if (tail.length === 3 && tail[2] === 'qr.svg' && method === 'GET') { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); return res.end(qrSvg(fileDownloadUrl(p, f, baseUrl(req)))) } if (tail.length === 3 && tail[2] === 'qr' && method === 'GET') { res.writeHead(301, { 'Location': portalApiUrl(p, baseUrl(req)) + '/files/' + encodeURIComponent(f.id) + '/qr.svg', 'Cache-Control': 'no-store' }); return res.end() } if (tail.length === 3 && tail[2] === 'download' && method === 'GET') { if (fileMode(f) === 'DISABLED') return fail(res, 403, 'Download disabled'); if (fileMode(f) === 'KEY_REQUIRED' && !tokenMatch(f.accessKeys, req.headers['x-file-key'])) return fail(res, 403, 'File key required'); const fp = path.join(filesRoot, p.id, f.id); let stat; try { stat = await fsp.lstat(fp) } catch { return fail(res, 404, 'File unavailable') } if (!stat.isFile()) return fail(res, 404, 'File unavailable'); if (f.encrypted) return serveEncryptedFile(req, res, fp, f, () => { counters.downloads++; observer.download({ ok: true, bytes: f.size || 0 }); void recordTelemetry('download', req, p, f, url); void audit('file.download', { portalId: p.id, fileId: f.id, encrypted: true }) }); return streamDownload(req, res, fp, stat, f.name, () => { counters.downloads++; observer.download({ ok: true, bytes: f.size || 0 }); void recordTelemetry('download', req, p, f, url); void audit('file.download', { portalId: p.id, fileId: f.id }) }) } if (tail.length === 3 && tail[2] === 'preview' && method === 'GET') { if (fileMode(f) === 'DISABLED') return fail(res, 403, 'Preview disabled'); if (fileMode(f) === 'KEY_REQUIRED' && !tokenMatch(f.accessKeys, req.headers['x-file-key'])) return fail(res, 403, 'File key required'); if (!runtime.settings.preview.enabled) return fail(res, 503, 'Preview disabled'); const buf = readPlainBuffer(p, f); if (!buf) return fail(res, 404, 'File unavailable'); const pv = preview.preview(buf, f.name); if (pv.kind === 'inline') { res.writeHead(200, { 'Content-Type': pv.mime, 'Content-Length': buf.length, 'Content-Disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(f.name.replace(/[\r\n]/g, '')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(buf) } if (pv.kind === 'html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); return res.end(preview.wrap(f.name, pv.html)) } res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(pv.text) } if (tail.length === 3 && tail[2] === 'thumbnail.svg' && method === 'GET') { if (fileMode(f) === 'DISABLED') return fail(res, 403, 'Thumbnail disabled'); if (!runtime.settings.preview.thumbnails) return fail(res, 503, 'Thumbnails disabled'); const th = preview.thumbnail(f.name); res.writeHead(200, { 'Content-Type': th.mime, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); return res.end(th.data) } } return fail(res, 404, 'Not found')
    }
    // FD-6: правилата за експорт и preflight — само за административния канал.
    if (parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'v2' && parts[3] === 'export') {
      if (!adminGate(req, res, '*', method)) return;
      const gwApi = require('./gateway-api');
      if (parts[4] === 'rules' && parts.length === 5 && method === 'GET') return json(res, 200, gwApi.exportRulesPayload());
      if (parts[4] === 'preflight' && parts.length === 5 && method === 'POST') { const b = await parse(req); return json(res, 200, gwApi.exportPreflight(b)) }
      return fail(res, 404, 'Not found');
    }
    // PGP ключове и автоподписване на експортни пакети.
    const packageSettings = () => { const s = db.packageSettings || {}; return { autoSign: s.autoSign === true, signKeyId: String(s.signKeyId || ''), ttlHours: Number.isFinite(s.ttlHours) ? s.ttlHours : 72, maxKept: Number.isFinite(s.maxKept) ? s.maxKept : 50 } };
    const pgpKeyView = k => ({ id: k.id, label: k.label, userId: k.userId, algorithm: k.algorithm, bits: k.bits, version: Number(k.version) || 4, keyId: k.keyId, fingerprint: k.fingerprint, createdAt: k.createdAt, addedAt: k.addedAt, hasSecret: Boolean(k.secretEnc), source: k.source || 'console', roles: Array.isArray(k.roles) ? k.roles : [] });
    const pgpKeyById = id => (db.pgpKeys || []).find(k => k.id === id) || null;
    const signerFor = (keyId) => { const list = db.pgpKeys || []; const wanted = String(keyId || '').trim().toLowerCase(); const key = wanted ? list.find(k => k.id === keyId || k.keyId === keyId || String(k.fingerprint || '').toLowerCase() === wanted) : list[0]; return key || null };
    const decryptSecret = key => { if (!key || !key.secretEnc) return ''; return fileCrypto.decrypt(Buffer.from(key.secretEnc, 'base64'), adminToken).toString('utf8') };
    /**
     * Всички файлове от папката на портала (storage_root), с относителен път.
     * Само реални файлове: без символни връзки и без скрити имена. Има твърди лимити.
     * `storagePath` стеснява обхвата до една подпапка (пакет на папка), но пътищата в
     * пакета остават пълни (`storage/<подпапка>/<файл>`), за да е еднозначно.
     */
    async function collectStorageFiles(storageRoot, { maxFiles = 500, maxBytes = 64 * 1024 * 1024, storagePath = '' } = {}) {
      const base = portalRoot(storageRoot); const out = []; let bytes = 0;
      const storageTree = require('./storage-tree');
      const sub = storagePath ? storageTree.normRel(storagePath) : '';
      if (sub === null) throw Object.assign(new Error('Invalid storage path'), { status: 400 });
      async function walk(dir, rel) {
        let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return; throw e }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (entry.isSymbolicLink()) continue;
          const full = path.join(dir, entry.name); const next = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) { await walk(full, next); continue }
          if (!entry.isFile()) continue;
          if (out.length >= maxFiles) throw Object.assign(new Error(`Твърде много файлове в хранилището (макс. ${maxFiles})`), { status: 413 });
          const stat = await fsp.stat(full); bytes += stat.size;
          if (bytes > maxBytes) throw Object.assign(new Error(`Хранилището надвишава ${Math.round(maxBytes / 1048576)} MB`), { status: 413 });
          out.push({ name: entry.name, path: `storage/${next}`, data: await fsp.readFile(full), source: 'storage' });
        }
      }
      await walk(sub ? path.join(base, ...sub.split('/')) : base, sub);
      return out;
    }
    /** Флагове на папките (видима/медийна/заключена), нормализирани; липсващ = по подразбиране. */
    function folderMetaOf(p) {
      const src = p.folderMeta && typeof p.folderMeta === 'object' ? p.folderMeta : {};
      const out = {};
      for (const [key, value] of Object.entries(src)) {
        if (!value || typeof value !== 'object') continue;
        if (!key.startsWith('/')) continue;
        out[key] = { visible: value.visible !== false, media: value.media === true, locked: value.locked === true };
      }
      return out;
    }
    /** Заключена ли е папката (или някой неин родител)? Връща пътя на заключената или ''. */
    function lockedAncestor(meta, rel) {
      const parts = String(rel || '').split('/').filter(Boolean).slice(0, -1);
      for (let i = 0; i <= parts.length; i++) {
        const key = '/' + parts.slice(0, i).join('/');
        if (meta[key] && meta[key].locked) return key;
      }
      return '';
    }
    /** Маха скритите папки (visible:false) от дърво — за публичния API. */
    function pruneHiddenFolders(node, meta, prefix) {
      const base = prefix || '';
      const kept = [];
      for (const child of node.folders || []) {
        const childPath = base ? `${base}/${child.name}` : child.name;
        const flags = meta['/' + childPath];
        if (flags && flags.visible === false) continue;
        pruneHiddenFolders(child, meta, childPath);
        kept.push(child);
      }
      node.folders = kept;
      return node;
    }
    /**
     * Дървото на папката на портала (storage_root): само метаданни, без съдържание.
     * Скритите файлове и символните връзки се пропускат; има твърди лимити, за да
     * не блокира голяма папка. Връща и броячи, за да не се смятат в GUI-я.
     */
    async function collectStorageTree(storageRoot, { maxEntries = 2000, maxDepth = 12 } = {}) {
      const base = portalRoot(storageRoot); const entries = []; const dirs = []; let truncated = false, exists = false;
      try { const stat = await fsp.stat(base); exists = stat.isDirectory() } catch { exists = false }
      async function walk(dir, rel, depth) {
        if (entries.length >= maxEntries) { truncated = true; return }
        if (depth > maxDepth) { truncated = true; return }
        let list; try { list = await fsp.readdir(dir, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EACCES' || e.code === 'EPERM') return; throw e }
        list.sort((a, b) => a.name.localeCompare(b.name, 'bg'));
        for (const entry of list) {
          if (entry.name.startsWith('.')) continue;
          if (entry.isSymbolicLink()) continue;
          const next = rel ? `${rel}/${entry.name}` : entry.name;
          // Папките се запомнят и когато са празни (за да се виждат в експлорера).
          if (entry.isDirectory()) { dirs.push(next); await walk(path.join(dir, entry.name), next, depth + 1); continue }
          if (!entry.isFile()) continue;
          if (entries.length >= maxEntries) { truncated = true; return }
          const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null);
          entries.push({ path: next, size: stat ? stat.size : 0, modifiedAt: stat ? stat.mtime.toISOString() : '' });
        }
      }
      await walk(base, '', 0);
      const storageTree = require('./storage-tree');
      const tree = storageTree.build(entries);
      // Празните папки също се показват (build създава само папки, в които има файлове).
      if (dirs.length) { for (const rel of dirs) storageTree.addFolder(tree, rel); storageTree.sortTree(tree); storageTree.recount(tree) }
      return { storageRoot: base, exists, truncated, tree, folderCount: tree.folderCount, fileCount: tree.fileCount, bytes: tree.bytes };
    }
    if (parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'pgp' && parts[3] === 'keys') {
      if (!adminGate(req, res, 'pgp', method)) return;
      if (parts.length === 4 && method === 'GET') return json(res, 200, { keys: (db.pgpKeys || []).map(pgpKeyView), settings: packageSettings() });
      if (parts.length === 4 && method === 'POST') {
        // Само ПРИКАЧАНЕ на готов ключ — сървърът не генерира ключове.
        const b = await parse(req); const label = clean(b.label).slice(0, 80) || 'PGP ключ';
        const secretInput = typeof b.secretArmored === 'string' ? b.secretArmored.trim() : '';
        if (!secretInput) return fail(res, 400, 'Прикачи PGP ключ (armored PRIVATE KEY BLOCK)');
        let material;
        try {
          const parsed = pgp.parseKeyBlock(secretInput); const info = pgp.describe(parsed);
          if (!info.hasSecret) throw Object.assign(new Error('Липсва секретен ключ — прикачи PRIVATE KEY BLOCK'), { status: 400 });
          material = { secretArmored: secretInput, info, publicArmored: pgp.publicKeyOf(secretInput) };
        } catch (e) { return fail(res, e.status || 400, e.message || 'Invalid PGP key') }
        const dup = (db.pgpKeys || []).find(k => k.keyId === material.info.keyId);
        if (dup) return fail(res, 409, 'Този ключ вече е добавен');
        const enc = fileCrypto.encrypt(Buffer.from(material.secretArmored, 'utf8'), adminToken).toString('base64');
        const record = { id: id(), label, userId: material.info.userId || '', algorithm: material.info.algorithm, bits: material.info.bits || 0, version: Number(material.info.version) || 4, keyId: material.info.keyId, fingerprint: material.info.fingerprint, createdAt: material.info.createdAt, addedAt: new Date().toISOString(), publicArmored: material.publicArmored, secretEnc: enc };
        return json(res, 201, await update(() => { db.pgpKeys = [...(db.pgpKeys || []), record]; if (!packageSettings().signKeyId) db.packageSettings = { ...packageSettings(), signKeyId: record.id }; void audit('pgp.key.add', { id: record.id, keyId: record.keyId, algorithm: record.algorithm }); return pgpKeyView(record) }));
      }
      if (parts.length === 5 && parts[4] === 'import' && method === 'POST') { const result = await importKeyBundles(); void audit('pgp.bundle.import', { imported: result.imported.length, skipped: result.skipped.length }); return json(res, 200, result) }
      if (parts.length === 6 && parts[5] === 'public' && method === 'GET') { const key = pgpKeyById(parts[4]); if (!key) return fail(res, 404, 'Not found'); return json(res, 200, { id: key.id, keyId: key.keyId, fingerprint: key.fingerprint, publicArmored: key.publicArmored }) }
      if (parts.length === 5 && method === 'DELETE') return json(res, 200, await update(() => { const key = pgpKeyById(parts[4]); if (!key) throw Object.assign(new Error('Not found'), { status: 404 }); db.pgpKeys = (db.pgpKeys || []).filter(k => k.id !== key.id); const s = packageSettings(); const rest = db.pgpKeys; const signKeyId = s.signKeyId === key.id ? ((rest[0] || {}).id || '') : (rest.some(k => k.id === s.signKeyId) ? s.signKeyId : ((rest[0] || {}).id || '')); db.packageSettings = { ...s, signKeyId, autoSign: rest.length ? s.autoSign : false }; void audit('pgp.key.remove', { id: key.id, keyId: key.keyId }); return { removed: key.id, autoSign: db.packageSettings.autoSign, keys: rest.length } }));
      return fail(res, 404, 'Not found');
    }
    // Експортни пакети: ZIP + манифест + хешове + незадължителен PGP подпис.
    if (parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'packages') {
      if (!adminGate(req, res, 'packages', method)) return;
      const settings = packageSettings();
      if (parts.length === 3 && method === 'GET') { await packager.prune({ maxAgeHours: settings.ttlHours, maxCount: settings.maxKept }).catch(() => { }); return json(res, 200, { packages: await packager.list(), settings, limits: packager.limits }) }
      if (parts.length === 3 && method === 'POST') {
        const b = await parse(req); const portalId = clean(b.portalId); const p = db.portals.find(x => x.id === portalId);
        if (!p) return fail(res, 404, 'Portal not found');
        const wanted = Array.isArray(b.fileIds) && b.fileIds.length ? new Set(b.fileIds.map(x => String(x))) : null;
        const chosen = p.files.filter(f => !wanted || wanted.has(f.id));
        const includeStorage = b.includeStorage === true;
        // Пакет на една папка от хранилището („Изтегли пакета“ на папка).
        const storagePath = clean(b.storagePath);
        if (!chosen.length && !includeStorage && !storagePath) return fail(res, 400, 'Няма избрани файлове');
        const files = []; const missing = [];
        for (const f of chosen) { const buf = readPlainBuffer(p, f); if (!buf) { missing.push(f.id); continue } files.push({ name: f.name, data: buf, source: 'portal' }) }
        if (missing.length) return fail(res, 409, 'Липсващи или недешифрируеми файлове: ' + missing.join(', '));
        if (includeStorage || storagePath) {
          let storage = [];
          try { storage = await collectStorageFiles(p.storage_root || '/share', { storagePath }) } catch (e) { return fail(res, e.status || 500, e.message) }
          files.push(...storage);
          if (!files.length) return fail(res, 404, storagePath ? `Папката ${storagePath} е празна или липсва` : `Папката на портала е празна или липсва: ${p.storage_root || '/share'}`);
        }
        const wantSign = b.sign === false ? false : b.sign === true ? true : (settings.autoSign || cryptoOptions.signPackages);
        let sign = null; const keyId = clean(b.keyId) || cryptoOptions.signingKey || settings.signKeyId;
        let signFallback = null;
        if (wantSign) {
          let key = signerFor(keyId);
          // Ако конфигурираният ключ е изтрит или сменен, пакетът не спира: взимаме друг
          // ключ със секретна част и го отбелязваме изрично (fallback) в метаданните.
          if (!key && keyId) {
            const alternate = (db.pgpKeys || []).find(k => k.secretEnc);
            if (alternate) {
              key = alternate;
              signFallback = { requested: keyId, used: alternate.keyId, reason: 'configured signing key not found' };
              log.warn('package.signing.fallback', { ns: 'packages', requested: keyId, used: alternate.keyId });
              void audit('package.signing.fallback', { requested: keyId, used: alternate.keyId });
            }
          }
          if (!key) return fail(res, 400, 'Няма PGP ключ за автоподписване — прикачи ключ в „Настройки“');
          const secretArmored = decryptSecret(key);
          if (!secretArmored) return fail(res, 400, 'Ключът няма секретна част');
          sign = { secretArmored, keyId: key.keyId, label: key.label };
        }
        let meta;
        try { meta = await packager.build({ portal: p, files, sign, ttlHours: settings.ttlHours }) } catch (e) { return fail(res, e.status || 500, e.message) }
        if (signFallback) meta.signingFallback = signFallback;
        await packager.prune({ maxAgeHours: settings.ttlHours, maxCount: settings.maxKept }).catch(() => { });
        void audit('package.build', { portalId: p.id, packageId: meta.id, files: meta.files, signed: meta.hasSignature, sha256: meta.sha256, signingFallback: signFallback ? signFallback.used : null });
        return json(res, 201, meta);
      }
      if (parts.length === 4 && parts[3] === 'settings' && method === 'PATCH') {
        const b = await parse(req);
        const next = { ...packageSettings() };
        if (b.autoSign !== undefined) {
          // Автоподписване има смисъл само след прикачен ключ.
          if (b.autoSign === true && !(db.pgpKeys || []).length) return fail(res, 400, 'Няма прикачен PGP ключ — прикачи ключ в „Настройки“');
          next.autoSign = b.autoSign === true;
        }
        if (b.signKeyId !== undefined) { const keyId = clean(b.signKeyId); if (keyId && !pgpKeyById(keyId)) return fail(res, 400, 'Unknown PGP key'); next.signKeyId = keyId }
        if (b.ttlHours !== undefined) { const ttl = Number(b.ttlHours); if (!Number.isFinite(ttl) || ttl < 1 || ttl > 24 * 365) return fail(res, 400, 'Invalid TTL'); next.ttlHours = ttl }
        if (b.maxKept !== undefined) { const max = Number(b.maxKept); if (!Number.isInteger(max) || max < 1 || max > 1000) return fail(res, 400, 'Invalid maxKept'); next.maxKept = max }
        return json(res, 200, await update(() => { db.packageSettings = next; void audit('package.settings', next); return next }));
      }
      if (parts.length === 4 && method === 'GET') {
        let meta; try { meta = await packager.readMeta(parts[3]) } catch (e) { return fail(res, e.status || 400, e.message) }
        if (!meta) return fail(res, 404, 'Not found');
        return json(res, 200, meta);
      }
      if (parts.length === 5 && parts[4] === 'download' && method === 'GET') {
        const a = await packager.artifact(parts[3], 'zip'); if (!a) return fail(res, 404, 'Not found');
        return streamDownload(req, res, a.file, a.stat, a.name, () => { void audit('package.download', { packageId: a.meta.id, size: a.meta.size }) });
      }
      if (parts.length === 5 && parts[4] === 'signature' && method === 'GET') {
        const a = await packager.artifact(parts[3], 'signature'); if (!a) return fail(res, 404, 'Not found');
        const text = await fsp.readFile(a.file, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/pgp-signature; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(a.name), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(text);
      }
      if (parts.length === 5 && parts[4] === 'verify' && method === 'POST') {
        const a = await packager.artifact(parts[3], 'zip'); if (!a) return fail(res, 404, 'Not found');
        const sigArtifact = await packager.artifact(parts[3], 'signature');
        const b = await parse(req);
        let publicArmored = clean(b.publicArmored);
        if (!publicArmored) { const key = (db.pgpKeys || []).find(k => k.keyId === a.meta.signature.keyId) || null; publicArmored = key ? key.publicArmored : '' }
        if (!sigArtifact) return json(res, 200, { valid: false, reason: 'NO_SIGNATURE' });
        if (!publicArmored) return fail(res, 400, 'Липсва публичен ключ за проверка');
        const zipBuf = await fsp.readFile(a.file);
        const armored = await fsp.readFile(sigArtifact.file, 'utf8');
        const out = pgp.verifyDetached(zipBuf, armored, publicArmored);
        void audit('package.verify', { packageId: a.meta.id, valid: out.valid, reason: out.reason || '' });
        return json(res, 200, { ...out, packageId: a.meta.id, sha256: a.meta.sha256 });
      }
      if (parts.length === 4 && method === 'DELETE') return json(res, 200, await packager.remove(parts[3]));
      return fail(res, 404, 'Not found');
    }
    if (parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'cases') {
      if (!adminGate(req, res, 'cases', method)) return;
      const C = require('./cases');
      if (parts.length === 3 && method === 'GET') return json(res, 200, C.list(db));
      if (parts.length === 3 && method === 'POST') { const b = await parse(req); return json(res, 201, await update(() => { const c = C.addCase(db, b); void audit('case.add', { id: c.id, number: c.number }); return c })) }
      if (parts.length === 4 && method === 'PATCH') { const b = await parse(req); return json(res, 200, await update(() => { const c = C.patchCase(db, parts[3], b); void audit('case.update', { id: c.id }); return c })) }
      if (parts.length === 4 && method === 'DELETE') return json(res, 200, await update(() => { const r = C.removeCase(db, parts[3]); void audit('case.remove', { id: parts[3] }); return r }));
      return fail(res, 404, 'Not found');
    }
    if (parts[0] === 'admin' && parts[1] === 'api' && (parts[2] === 'variables' || parts[2] === 'directory')) {
      if (!adminGate(req, res, 'directory', method)) return;
      const D = require('./directory');
      if (parts[2] === 'variables') {
        if (parts.length === 3 && method === 'GET') { D.state(db); return json(res, 200, { types: D.TYPES, variables: D.listVariables(db) }) }
        if (parts.length === 3 && method === 'POST') { const b = await parse(req); return json(res, 201, await update(() => { const v = D.addVariable(db, b); void audit('variable.add', { key: v.key }); return v })) }
        if (parts.length === 4 && method === 'PATCH') { const b = await parse(req); return json(res, 200, await update(() => { const v = D.patchVariable(db, parts[3], b); void audit('variable.update', { key: parts[3] }); return v })) }
        if (parts.length === 4 && method === 'DELETE') return json(res, 200, await update(() => { const r = D.removeVariable(db, parts[3]); void audit('variable.remove', { key: parts[3] }); return r }));
        return fail(res, 404, 'Not found');
      }
      if (parts.length === 3 && method === 'GET') return json(res, 200, D.view(db));
      if (parts[3] === 'ingest' && method === 'POST') { const b = await parse(req); return json(res, 200, await update(() => { const r = D.ingest(db, b.emails, runtime.settings.data); void audit('directory.ingest', { created: r.created.length, conflicts: r.conflicts }); return r })) }
      if (parts[3] === 'rules' && parts.length === 4 && method === 'POST') { const b = await parse(req); return json(res, 201, await update(() => { const r = D.addRule(db, b, runtime.settings.data); void audit('directory.rule.add', { pattern: r.rule.pattern }); return r })) }
      if (parts[3] === 'rules' && parts.length === 5 && method === 'DELETE') return json(res, 200, await update(() => { const r = D.removeRule(db, parts[4]); void audit('directory.rule.remove', { id: parts[4] }); return r }));
      if (parts[3] === 'contacts' && parts.length === 4 && method === 'POST') { const b = await parse(req); return json(res, 201, await update(() => { const c = D.addContact(db, b); void audit('directory.contact.add', { id: c.id }); return c })) }
      if (parts[3] === 'contacts' && parts.length === 5 && method === 'PATCH') { const b = await parse(req); return json(res, 200, await update(() => D.patchContact(db, parts[4], b.fields, b.extras, b))) }
      if (parts[3] === 'contacts' && parts.length === 5 && method === 'DELETE') return json(res, 200, await update(() => D.removeContact(db, parts[4])));
      if (parts[3] === 'organizations' && parts.length === 4 && method === 'POST') { const b = await parse(req); return json(res, 201, await update(() => { const r = D.addOrganization(db, b); void audit('directory.organization.add', { id: r.organization.id, employees: r.employees.length }); return r })) }
      if (parts[3] === 'organizations' && parts.length === 5 && method === 'PATCH') { const b = await parse(req); return json(res, 200, await update(() => { const o = D.patchOrganization(db, parts[4], b); void audit('directory.organization.update', { id: parts[4] }); return o })) }
      if (parts[3] === 'organizations' && parts.length === 5 && method === 'DELETE') { const detach = url.searchParams.get('detach') === '1'; return json(res, 200, await update(() => { const r = D.removeOrganization(db, parts[4], { detach }); void audit('directory.organization.remove', { id: parts[4], detached: r.detached }); return r })) }
      if (parts[3] === 'conflicts' && parts[5] === 'resolve' && method === 'POST') { const b = await parse(req); return json(res, 200, await update(() => { const r = D.resolveConflict(db, parts[4], b.value); void audit('directory.conflict.resolve', { id: parts[4] }); return r })) }
      return fail(res, 404, 'Not found');
    }
    if (parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'cabinet') {
      if (!adminGate(req, res, 'cabinet', method)) return;
      const rel = url.searchParams.get('path') || '', act = parts[3] || '';
      if (act === 'info' && method === 'GET') return json(res, 200, { ...cabinet.capabilities, localOpen: cabinet.capabilities.localOpen && isLoopback(req) });
      if (act === 'list' && method === 'GET') return json(res, 200, await cabinet.list(rel));
      if (act === 'folder' && method === 'POST') { const b = await parse(req); void audit('cabinet.folder', { path: clean(b.path) }); return json(res, 201, await cabinet.mkdir(clean(b.path), b.name)) }
      if (act === 'create' && method === 'POST') { const b = await parse(req); void audit('cabinet.create', { path: clean(b.path), type: b.type }); return json(res, 201, await cabinet.createFile(clean(b.path), b.name, b.type)) }
      if (act === 'upload' && method === 'POST') { const fn = fileNameHeader(req); if (!fn) return fail(res, 400, 'Invalid X-File-Name'); const data = await body(req, cabinet.capabilities.maxBytes); void audit('cabinet.upload', { path: rel }); return json(res, 201, await cabinet.upload(rel, fn, data)) }
      if (act === 'save' && method === 'POST') { const data = await body(req, 5 * 1024 * 1024); void audit('cabinet.save', { path: rel }); return json(res, 200, await cabinet.saveText(rel, data)) }
      if (act === 'file' && method === 'GET') { const f = await cabinet.file(rel); res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Disposition': (f.inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(f.name) }); return fs.createReadStream(f.abs).on('error', () => res.destroy()).pipe(res) }
      if (act === 'entry' && method === 'DELETE') { void audit('cabinet.delete', { path: rel }); return json(res, 200, await cabinet.remove(rel)) }
      if (act === 'rename' && method === 'POST') { const b = await parse(req); void audit('cabinet.rename', { path: clean(b.path) }); return json(res, 200, await cabinet.rename(clean(b.path), b.name)) }
      if (act === 'convert' && method === 'POST') { const b = await parse(req); void audit('cabinet.convert', { path: clean(b.path), to: b.to }); return json(res, 201, await cabinet.convert(clean(b.path), b.to)) }
      if (act === 'open' && method === 'POST') { if (!isLoopback(req)) return fail(res, 404, 'Not found'); const b = await parse(req); return json(res, 200, await cabinet.open(clean(b.path))) }
      return fail(res, 404, 'Not found');
    }
    // --- DOCFLOW core API (Phase 1) ---
    if (parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'v2') {
      if (!adminGate(req, res, 'core', method)) return;
      const { registry, store } = coreReady();
      // Тайни връзки: администраторът качва САМО плика (ключът и идентификаторът се
      // раждат и остават в браузъра му), вижда кога изтича и колко прегледа остават, и
      // може да отмени по `sha256(id)` или по чека.
      if (parts[3] === 'secrets') {
        if (parts.length === 4 && method === 'GET') {
          await secretLinks.sweep(root).catch(() => { });
          return json(res, 200, { secrets: await secretLinks.list(root) });
        }
        if (parts.length === 4 && method === 'POST') {
          const b = await parse(req);
          // `idHash` идва от браузъра: идентификаторът и ключът се раждат ТАМ и сървърът
          // никога не ги вижда — нито за да създаде записа, нито след това.
          const created = secretLinks.createRecord({ envelope: b.envelope, idHash: b.idHash, hint: b.hint, expiresIn: b.expires_in, maxViews: b.max_views });
          if (created.error) return fail(res, 400, created.error);
          await secretLinks.save(root, created.record);
          void secretLinks.sweep(root).catch(() => { });
          void audit('secret.create', { receipt: created.record.receipt, idHash: String(created.record.idHash).slice(0, 12), maxViews: created.record.maxViews, requiresPassword: created.record.requiresPassword, expiresAt: created.record.expiresAt });
          // Линкът се сглобява от браузъра: тоя отговор не съдържа нито идентификатор,
          // нито ключ, защото сървърът не ги знае.
          return json(res, 201, secretLinks.adminView(created.record));
        }
        if (parts.length === 5 && method === 'DELETE') {
          const key = String(parts[4] || '');
          if (!secretLinks.isValidHash(key)) return fail(res, 404, 'Secret not found');
          if (!(await secretLinks.remove(root, key))) return fail(res, 404, 'Secret not found');
          void audit('secret.revoke', { idHash: key.slice(0, 12) });
          return json(res, 200, { deleted: key });
        }
      }
      if (parts[3] === 'profiles' && parts.length === 4 && method === 'GET') return json(res, 200, { profiles: registry.listProfiles() });
      if (parts[3] === 'groups') {
        if (parts.length === 4 && method === 'GET') { return json(res, 200, { groups: store.listGroups().map(g => ({ ...g, recordCount: store.listRecords(g.id).length })) }) }
        if (parts.length === 4 && method === 'POST') { const b = await parse(req); const g = store.createGroup({ name: clean(b.name), description: clean(b.description), autoRecords: b.autoRecords !== false, registry }); void audit('core.group.create', { groupId: g.id }); return json(res, 201, g) }
        if (parts.length === 5) {
          if (method === 'GET') { const g = store.getGroup(parts[4]); if (!g) return fail(res, 404, 'Group not found'); return json(res, 200, { ...g, records: store.listRecords(g.id) }) }
          if (method === 'PATCH') { const b = await parse(req); const g = store.updateGroup(parts[4], { name: b.name, description: b.description }); void audit('core.group.update', { groupId: g.id }); return json(res, 200, g) }
          if (method === 'DELETE') { store.deleteGroup(parts[4]); void audit('core.group.delete', { groupId: parts[4] }); return json(res, 200, { deleted: parts[4] }) }
        }
      }
      if (parts[3] === 'records') {
        if (parts.length === 4 && method === 'GET') { const groupId = url.searchParams.get('group_id') || null, prefix = url.searchParams.get('prefix') || null; let recs = store.listRecords(groupId); if (prefix) recs = recs.filter(r => r.prefix === prefix); return json(res, 200, { records: recs }) }
        if (parts.length === 4 && method === 'POST') { const b = await parse(req); const r = store.createRecord({ prefix: String(b.prefix), group_id: b.group_id || null, fields: b.fields || {}, registry }); void audit('core.record.create', { recordId: r.id, prefix: r.prefix }); return json(res, 201, r) }
        if (parts.length === 5) {
          const r = store.getRecord(parts[4]); if (!r) return fail(res, 404, 'Record not found');
          if (method === 'GET') return json(res, 200, r);
          if (method === 'PATCH') { const b = await parse(req); const defs = registry.fieldsFor(r.prefix); for (const [f, v] of Object.entries(b.fields || {})) { const def = defs.find(x => x.name === f); store.setVariable(r.id, f, registry.validateField(r.prefix, f, v), def) } void audit('core.record.update', { recordId: r.id }); return json(res, 200, store.getRecord(r.id)) }
          if (method === 'DELETE') { store.deleteRecord(parts[4]); void audit('core.record.delete', { recordId: parts[4] }); return json(res, 200, { deleted: parts[4] }) }
        }
        if (parts.length === 6 && parts[5] === 'associate' && method === 'POST') { const b = await parse(req); const r = store.associateRecord(parts[4], String(b.groupId || '')); void audit('core.record.associate', { recordId: r.id, groupId: r.group_id }); return json(res, 200, r) }
        if (parts.length === 6 && parts[5] === 'detach' && method === 'POST') { const r = store.detachRecord(parts[4]); void audit('core.record.detach', { recordId: r.id }); return json(res, 200, r) }
      }
      if (parts[3] === 'search' && parts.length === 4 && method === 'GET') { const prefix = url.searchParams.get('prefix') || null, q = url.searchParams.get('q') || ''; return json(res, 200, { results: store.search(prefix, q) }) }
      if (parts[3] === 'migrate' && parts.length === 4 && method === 'GET') { const bridge = require('./migration-bridge').create({ root, store, registry }); return json(res, 200, await bridge.analyze(db)) }
      if (parts[3] === 'migrate' && parts.length === 4 && method === 'POST') { const b = await parse(req); const dryRun = !!b.dryRun; const bridge = require('./migration-bridge').create({ root, store, registry }); const out = await bridge.migrate(db, { dryRun }); void audit('core.migrate', { dryRun }); return json(res, 200, out) }
      // Report Studio (Фаза 11 / RS-03): манифест → PDF. Без фалшиви TSA токени:
      // манифест, съдържащ tsaToken/подпис/сертификат, се отхвърля от валидатора.
      if (parts[3] === 'reports' && parts[4] === 'render' && parts.length === 5 && method === 'POST') {
        let payload; try { payload = JSON.parse((await body(req, 1024 * 1024)).toString('utf8')) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
        try {
          const manifest = (payload && payload.manifest) || payload;
          const reportRender = require('./report-render');
          // RS-05: TSA обхватът е ИЗРИЧЕН (`tsa: true`) и изисква tsa_enabled. Отчетът
          // никога не звъни на TSA „ей така“ и без токен не си измисля такъв (ADR-0025, т. 5).
          const wantTsa = Boolean(payload && payload.tsa === true);
          let stamps = null;
          if (wantTsa) {
            if (!cryptoOptions.tsaEnabled) return fail(res, 409, 'RFC 3161 timestamps are disabled (tsa_enabled)');
            const reportStamp = require('./report-stamp');
            stamps = await reportStamp.stampReport(manifest, { startUrl: cryptoOptions.tsaStart, stopUrl: cryptoOptions.tsaStop || cryptoOptions.tsaStart });
            // Токените стават .tsr артефакти до останалите доказателства, за да ги покрие
            // GET/POST /rfc3161/verify — иначе отчетът щеше да твърди нещо непроверимо.
            if (stamps.ok) {
              await persistTsaRecords([stamps.start, { ...stamps.stop, closingDigest: stamps.closingDigest }]).catch((e) => log.warn('report.tsa.persist.failed', { ns: 'tsa', err: e.message }));
            }
            void audit('report.tsa.' + (stamps.ok ? 'ok' : 'fail'), { profile: (manifest && manifest.profile) || '', start: stamps.start && stamps.start.token ? stamps.start.token.sha256 : null, stop: stamps.stop && stamps.stop.token ? stamps.stop.token.sha256 : null, evidenceDigest: stamps.evidenceDigest, closingDigest: stamps.closingDigest, error: stamps.error });
          }
          const pdf = reportRender.renderPdf(manifest, { data: (payload && payload.data) || {}, hashes: (payload && payload.hashes) || {}, watermark: payload && payload.watermark, stamps });
          const digest = require('./report-manifest').digest(manifest) || '';
          // RS-06: отпечатък на ГОТОВИЯ PDF. Не може да стои вътре в себе си, затова се връща
          // като хедър и влиза в одита — така „този файл е този отчет“ се проверява с sha256sum.
          const pdfSha256 = crypto.createHash('sha256').update(pdf).digest('hex');
          const safeName = String((manifest && manifest.profile) || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
          void audit('report.render', { profile: (manifest && manifest.profile) || '', digest, pdfSha256, tsa: wantTsa ? (stamps && stamps.ok ? 'ok' : 'fail') : 'not requested' });
          const headers = { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Manifest-SHA256': digest, 'X-PDF-SHA256': pdfSha256, 'Content-Disposition': 'attachment; filename="report-' + safeName + '.pdf"' };
          if (wantTsa) {
            headers['X-TSA-Status'] = stamps && stamps.ok ? 'granted' : 'failed';
            if (stamps && stamps.evidenceDigest) headers['X-TSA-Evidence-SHA256'] = stamps.evidenceDigest;
            if (stamps && stamps.closingDigest) headers['X-TSA-Closing-SHA256'] = stamps.closingDigest;
          }
          res.writeHead(201, headers);
          return res.end(pdf);
        } catch (e) { return fail(res, e.status || 500, (e.code ? e.code + ': ' : '') + (e.message || 'Report render failed')) }
      }
      // RFC 3161 TSA (порт от HASH_REPORT блок „START / STOP“): START подпечатва
      // манифеста, STOP — затварящия хеш (START digest + START токен). Токените се
      // пазят като .tsr артефакти; при отказ на TSA няма запис и няма фалшив токен.
      if (parts[3] === 'rfc3161' && parts.length === 4) {
        if (!adminGate(req, res, 'settings', method)) return;
        const tsaClient = require('./tsa-client');
        const tsaDir = path.join(root, 'tsa');
        const tsaDefaults = { start: cryptoOptions.tsaStart, stop: cryptoOptions.tsaStop };
        const readRecords = async () => {
          let names = []; try { names = (await fsp.readdir(tsaDir)).filter(n => n.endsWith('.json')).sort() } catch (e) { if (e.code !== 'ENOENT') throw e }
          const out = [];
          for (const name of names.slice(-40)) {
            try { out.push(JSON.parse(await fsp.readFile(path.join(tsaDir, name), 'utf8'))) } catch { /* повреден TSA запис се прескача, останалите се показват */ }
          }
          return out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
        };
        try {
          if (method === 'GET') { const records = await readRecords(); return json(res, 200, { enabled: cryptoOptions.tsaEnabled, tsa: tsaDefaults, records, breaker: typeof tsaClient.breakerSnapshot === 'function' ? tsaClient.breakerSnapshot() : [] }) }
          if (method !== 'POST') return fail(res, 405, 'Method not allowed');
          if (!cryptoOptions.tsaEnabled) return fail(res, 409, 'RFC 3161 timestamps are disabled (tsa_enabled)');
          let payload; try { payload = await parse(req) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
          const phase = String((payload && payload.phase) || '').toLowerCase();
          if (!['start', 'stop'].includes(phase)) return fail(res, 400, 'phase must be "start" or "stop"');
          let algorithm, urls;
          try { algorithm = tsaClient.normalizeAlgorithm((payload && payload.algorithm) || 'SHA256'); urls = String((payload && payload.url) || tsaDefaults[phase]).split(',').map(s => s.trim()).filter(Boolean).map(u => tsaClient.normalizeUrl(u)) }
          catch (e) { return fail(res, 400, e.message) }
          if (!urls.length) return fail(res, 400, 'No TSA URL configured');
          let digest = String((payload && payload.digest) || '').trim().toLowerCase();
          if (payload && payload.manifest && !digest) digest = require('./report-manifest').digest(payload.manifest) || '';
          let closesDigest = null;
          if (!digest && phase === 'stop') {
            const start = (await readRecords()).find(r => r.phase === 'start' && r.token && r.token.sha256);
            if (!start) return fail(res, 409, 'No START timestamp to close');
            closesDigest = { startDigest: start.digest, startTokenSha256: start.token.sha256 };
            digest = crypto.createHash('sha256').update(start.digest + '|' + start.token.sha256).digest('hex');
          }
          if (!digest) return fail(res, 400, 'digest (or manifest) is required for START');
          try { digest = tsaClient.normalizeDigest(digest, algorithm) } catch (e) { return fail(res, 400, e.message) }
          const result = await tsaClient.stamp({ url: urls, digestHex: digest, algorithm });
          if (!result.granted || !result.token) {
            log.warn('rfc3161.rejected', { ns: 'tsa', phase, url: result.url, status: result.status, statusText: result.statusText, failInfo: result.failInfo });
            return fail(res, 502, 'TSA refused the timestamp: ' + result.statusText + (result.failInfo ? ' (' + result.failInfo + ')' : ''));
          }
          await fsp.mkdir(tsaDir, { recursive: true });
          const at = new Date().toISOString(), stamp = at.replace(/[:.]/g, '-'), base = phase + '-' + stamp + '-' + digest.slice(0, 12);
          const file = base + '.tsr';
          await fsp.writeFile(path.join(tsaDir, file), result.tokenDer, { flag: 'wx', mode: 0o600 });
          const record = { phase, at, url: result.url, attempts: result.attempts, algorithm, digest, file, requestBytes: result.requestBytes, replyBytes: result.replyBytes, status: result.status, statusText: result.statusText, token: result.token, closesDigest };
          if (closesDigest) record.token.imprintMatches = result.token.imprintMatches;
          await fsp.writeFile(path.join(tsaDir, base + '.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          // Пазим последните TSA_KEEP записа (по подразбиране 200): доказателствата не бива
          // да растат безкрайно и да изпълнят диска. Старите .tsr/.json се трият по двойки.
          await pruneTsaRecords().catch(e => log.warn('tsa.prune.failed', { ns: 'tsa', err: e.message }));
          void audit('rfc3161.' + phase, { phase, url: result.url, digest, tokenSha256: result.token.sha256, genTime: result.token.genTime });
          log.info('rfc3161.created', { ns: 'tsa', phase, url: result.url, attempts: result.attempts, digest, tokenSha256: result.token.sha256, genTime: result.token.genTime, bytes: result.token.bytes });
          return json(res, 201, record);
        } catch (e) { log.warn('rfc3161.failed', { ns: 'tsa', err: e.message }); return fail(res, e.status || 502, e.message || 'TSA request failed') }
      }
      // Проверка на съхранените доказателства: преизчислява SHA-256 на всеки .tsr и го
      // сравнява с отпечатъка от записа. Така „имам токен“ е проверен факт, а подправен
      // или изчезнал файл се вижда веднага (409), вместо да мине за валиден.
      if (parts[3] === 'rfc3161' && parts.length === 5 && parts[4] === 'verify') {
        if (!adminGate(req, res, 'settings', method)) return;
        if (!['GET', 'POST'].includes(method)) return fail(res, 405, 'Method not allowed');
        const dir = path.join(root, 'tsa');
        let names = [];
        try { names = (await fsp.readdir(dir)).filter(n => n.endsWith('.json')).sort() } catch (e) { if (e.code !== 'ENOENT') throw e }
        const files = [];
        for (const name of names.slice(-tsaKeep())) {
          let record = null;
          try { record = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8')) } catch { continue }
          const expected = record && record.token && record.token.sha256 ? String(record.token.sha256) : null;
          const item = { file: record.file || '', phase: record.phase || '', digest: record.digest || '', expected, actual: null, bytes: 0, status: 'missing' };
          if (record.file) {
            try {
              const buf = await fsp.readFile(path.join(dir, record.file));
              item.actual = crypto.createHash('sha256').update(buf).digest('hex');
              item.bytes = buf.length;
              item.status = expected && item.actual === expected ? 'valid' : 'tampered';
            } catch (e) { item.status = e.code === 'ENOENT' ? 'missing' : 'unreadable'; item.error = e.code || e.message }
          }
          files.push(item);
        }
        const invalid = files.filter(f => f.status !== 'valid');
        return json(res, invalid.length ? 409 : 200, { dir, keep: tsaKeep(), checked: files.length, valid: files.length - invalid.length, invalid: invalid.length, files });
      }

      // Публично API на портал (Фаза 8): създава хранилището api/<slug>/ и връща
      // препратките към него (api.json, openapi.json, manifest, files, qr).
      if (parts[3] === 'portals' && parts.length === 6 && parts[5] === 'api') {
        const portal = getPortal(decodeURIComponent(parts[4]));
        if (!portal) return fail(res, 404, 'Portal not found');
        const registry = require('./api-registry').create({ root: apiRoot, baseUrl: baseUrl(req), qrSvg });
        try {
          if (method === 'GET') { const record = await registry.read(portal); if (!record) return fail(res, 404, 'API not generated'); const p = registry.paths(portal); return json(res, 200, { record, references: record.links, disk: { dir: p.dir, files: require('./api-registry').FILES } }) }
          if (method === 'POST') { const out = await registry.ensure(portal); void audit('portal.api.generate', { slug: portal.slug }); return json(res, 201, out) }
          if (method === 'DELETE') { const out = await registry.remove(portal); void audit('portal.api.remove', { slug: portal.slug }); return json(res, 200, out) }
          return fail(res, 405, 'Method not allowed');
        } catch (e) { return fail(res, e.status || 500, e.message || 'API generation failed') }
      }
      return fail(res, 404, 'Not found');
    }
    if (parts[0] === 'admin' && parts[1] === 'api') {
      if (!adminGate(req, res, 'portals', method)) return; if (parts[2] === 'taxonomy' && parts.length === 3) {
        const tx = () => ({ categories: [...((db.taxonomy || {}).categories || [])], groups: [...((db.taxonomy || {}).groups || [])] });
        if (method === 'GET') return json(res, 200, tx());
        const key = k => k === 'category' ? 'categories' : k === 'group' ? 'groups' : null;
        if (method === 'POST') {
          const b = await parse(req), k = key(b.kind), nm = clean(b.name); if (!k || !nm || nm.length > 80 || /[\u0000-\u001f]/.test(nm)) return fail(res, 400, 'Invalid name');
          return json(res, 201, await update(() => { db.taxonomy ??= { categories: [], groups: [] }; db.taxonomy[k] ??= []; if (db.taxonomy[k].some(x => x.toLowerCase() === nm.toLowerCase())) throw Object.assign(new Error('Already exists'), { status: 409 }); db.taxonomy[k].push(nm); db.taxonomy[k].sort((a, c) => a.localeCompare(c)); void audit('taxonomy.add', { kind: b.kind, name: nm }); return tx() }))
        }
        if (method === 'DELETE') {
          const k = key(url.searchParams.get('kind')), nm = clean(url.searchParams.get('name')); if (!k || !nm) return fail(res, 400, 'Invalid request');
          return json(res, 200, await update(() => { const list = (db.taxonomy || {})[k] || []; if (!list.includes(nm)) throw Object.assign(new Error('Not found'), { status: 404 }); db.taxonomy[k] = list.filter(x => x !== nm); void audit('taxonomy.remove', { kind: url.searchParams.get('kind'), name: nm }); return tx() }))
        }
      }
      if (parts[2] === 'portals') {
        if (parts.length === 3 && method === 'GET') return json(res, 200, { portals: db.portals.map(adminPortal) });
        if (parts.length === 3 && method === 'POST') {
          const b = await parse(req), slug = clean(b.slug), title = clean(b.title); if (!validSlug(slug) || !title || title.length > 160) return fail(res, 400, 'Invalid title or slug');
          // Видимостта се задава още при създаването (формата я има), не само после с PATCH.
          const visibility = b.visibility === undefined ? 'private' : String(b.visibility); if (!['private', 'public'].includes(visibility)) return fail(res, 400, 'Invalid visibility');
          return json(res, 201, await update(async () => { if (getPortal(slug)) throw Object.assign(new Error('Slug exists'), { status: 409 }); const p = { id: id(), slug, title, description: clean(b.description).slice(0, 2000), notesText: clean(b.notes).slice(0, 2000), category: clean(b.category).slice(0, 120), subject: clean(b.subject).slice(0, 200), flag: portalFlag(b.flag), storage_root: portalRoot(b.storage_root), contactId: portalContact(db, b.contactId), caseId: portalCase(db, b.caseId), visibility, createdAt: new Date().toISOString(), files: [] }; await fsp.mkdir(path.join(filesRoot, p.id), { recursive: true }); db.portals.push(p); await writeApiDir(p, baseUrl(req)); void audit('portal.update', { portalId: p.id }); return adminPortal(p) }))
        }
        if (parts[3] === 'merge' && parts.length === 4 && method === 'POST') {
          const b = await parse(req);
          if (!b || typeof b.targetId !== 'string' || !Array.isArray(b.sourceIds) || !b.sourceIds.length || b.sourceIds.length > 50 || b.sourceIds.some(x => typeof x !== 'string') || new Set(b.sourceIds).size !== b.sourceIds.length || b.sourceIds.includes(b.targetId)) return fail(res, 400, 'Invalid merge request');
          const target = db.portals.find(x => x.id === b.targetId), sources = b.sourceIds.map(sid => db.portals.find(x => x.id === sid));
          if (!target || sources.some(s => !s)) return fail(res, 404, 'Portal not found');
          const merged = await update(async () => {
            const moved = []; const mv = async (from, to) => { try { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.rename(from, to); moved.push([from, to]) } catch (e) { if (e.code !== 'ENOENT') throw e } };
            try {
              for (const s of sources) {
                for (const f of s.files) { if (target.files.some(x => x.id === f.id)) throw Object.assign(new Error('File id conflict'), { status: 409 }); await mv(path.join(filesRoot, s.id, f.id), path.join(filesRoot, target.id, f.id)) }
                for (const a of s.attachments || []) await mv(path.join(internalRoot, s.id, a.id), path.join(internalRoot, target.id, a.id));
              }
            } catch (e) { for (const [from, to] of moved.reverse()) await fsp.rename(to, from).catch(() => { }); throw e }
            for (const s of sources) {
              target.files.push(...s.files); target.notesText = target.notesText || s.notesText || ''; target.notes = [...(target.notes || []), ...(s.notes || [])]; target.attachments = [...(target.attachments || []), ...(s.attachments || [])]; target.htmlProjects = [...(target.htmlProjects || []), ...(s.htmlProjects || [])];
              await fsp.rm(path.join(filesRoot, s.id), { recursive: true, force: true }); await fsp.rm(path.join(internalRoot, s.id), { recursive: true, force: true }); await fsp.rm(path.join(apiRoot, s.slug), { recursive: true, force: true });
            }
            db.portals = db.portals.filter(x => !sources.includes(x));
            await writeApiDir(target, baseUrl(req)); void audit('portal.merge', { targetId: target.id, sources: sources.map(s => s.id) }); return adminPortal(target);
          });
          return json(res, 200, merged);
        } const p = db.portals.find(x => x.id === parts[3]); if (!p) return fail(res, 404, 'Portal not found');
        if (parts.length === 4 && method === 'GET') return json(res, 200, adminPortal(p));
        if (parts[4] === 'api-info' && parts.length === 5 && method === 'GET') {
          const base = baseUrl(req), apiUrl = portalApiUrl(p, base), landingUrl = portalLandingUrl(p, base);
          // Вътрешен адрес (LAN/localhost) значи QR код, който не се отваря отвън — връщаме флаг,
          // за да го покаже административният панел вместо да остави потребителя да го открие сам.
          const isLocal = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(base);
          // Таг за Home Assistant Companion (NFC/QR) и universal link: адресите идват от
          // share-links.js, за да има едно място за формата и за автоматизацията.
          const links = require('./share-links').build({ slug: p.slug, title: p.title, landingUrl });
          return json(res, 200, { id: p.id, slug: p.slug, landingUrl, apiUrl, directory: 'api/' + p.slug, qr: qrSvg(landingUrl), qrTarget: landingUrl, baseIsLocal: isLocal, base, links })
        }
        // Дървото на папката на портала (експлорер): папки → подпапки → файлове.
        // Всяка папка има собствен адрес в API-то (виж `tree/api.json`).
        if (parts[4] === 'tree' && parts.length === 5 && method === 'GET') {
          let out; try { out = await collectStorageTree(p.storage_root || '/share') } catch (e) { return fail(res, e.status || 500, e.message) }
          const folderNotes = p.folderNotes && typeof p.folderNotes === 'object' ? p.folderNotes : {};
          const folderMeta = folderMetaOf(p);
          void audit('portal.tree', { portalId: p.id, folderCount: out.folderCount, fileCount: out.fileCount, truncated: out.truncated });
          return json(res, 200, { portal: { id: p.id, slug: p.slug, title: p.title }, storageRoot: out.storageRoot, exists: out.exists, truncated: out.truncated, folderCount: out.folderCount, fileCount: out.fileCount, bytes: out.bytes, tree: out.tree, folderNotes, folderMeta, generatedAt: new Date().toISOString() });
        }
        // Нова папка в папката на портала (само вътре в storage_root).
        if (parts[4] === 'tree' && parts[5] === 'folder' && parts.length === 6 && method === 'POST') {
          const st = require('./storage-tree'); const b = await parse(req);
          const parent = st.normRel(b.parent || '');
          if (parent === null) return fail(res, 400, 'Invalid path');
          const name = clean(b.name);
          if (!name || name === '.' || name === '..' || name.length > 100 || /[/\\\u0000-\u001f]/.test(name)) return fail(res, 400, 'Invalid folder name');
          const rel = st.normRel(parent ? `${parent}/${name}` : name);
          if (rel === null) return fail(res, 400, 'Invalid path');
          const root = portalRoot(p.storage_root || '/share');
          const full = path.resolve(root, parent, name);
          if (full !== path.resolve(root, rel) || !full.startsWith(path.resolve(root) + path.sep)) return fail(res, 400, 'Invalid path');
          try { await fsp.mkdir(full) }
          catch (e) {
            if (e.code === 'EEXIST') return fail(res, 409, 'Папката вече съществува');
            if (e.code === 'ENOENT') return fail(res, 404, 'Родителската папка липсва');
            return fail(res, 500, 'Папката не може да бъде създадена: ' + e.code);
          }
          void audit('portal.tree.folder', { portalId: p.id, path: '/' + rel });
          return json(res, 201, { path: '/' + rel, name, parent: '/' + parent, created: true });
        }
        // Флагове на папка: видима / медийна / заключване (пазят се към портала).
        if (parts[4] === 'tree' && parts[5] === 'folder' && parts.length === 6 && method === 'PATCH') {
          const st = require('./storage-tree'); const b = await parse(req);
          const rel = st.normRel(b.path || '');
          if (rel === null) return fail(res, 400, 'Invalid path');
          const current = folderMetaOf(p)['/' + rel] || { visible: true, media: false, locked: false };
          const next = { visible: current.visible !== false, media: current.media === true, locked: current.locked === true };
          for (const key of ['visible', 'media', 'locked']) {
            if (b[key] === undefined) continue;
            if (typeof b[key] !== 'boolean') return fail(res, 400, 'Invalid ' + key);
            next[key] = b[key];
          }
          const saved = await update(() => {
            p.folderMeta = p.folderMeta && typeof p.folderMeta === 'object' ? p.folderMeta : {};
            const key = '/' + rel;
            // Пази се само ако е различно от подразбирането, за да не расте базата.
            if (next.visible === false || next.media || next.locked) p.folderMeta[key] = { visible: next.visible, media: next.media, locked: next.locked };
            else delete p.folderMeta[key];
            void audit('portal.tree.folder.meta', { portalId: p.id, path: key, visible: next.visible, media: next.media, locked: next.locked });
            return { path: key, ...next };
          });
          return json(res, 200, saved);
        }
        // Прикачване на файл в папката на портала (storage_root): тялото е съдържанието,
        // пътят идва като ?path=/подпапка/файл.txt (родителските папки се създават).
        if (parts[4] === 'tree' && parts[5] === 'upload' && parts.length === 6 && method === 'POST') {
          const st = require('./storage-tree');
          const rel = st.normRel(url.searchParams.get('path') || '');
          if (rel === null || !rel) return fail(res, 400, 'Invalid path');
          const name = rel.split('/').pop() || '';
          if (!name || name.startsWith('.') || name.length > 240 || /[\u0000-\u001f]/.test(name)) return fail(res, 400, 'Invalid file name');
          const meta = folderMetaOf(p);
          const locked = lockedAncestor(meta, rel);
          if (locked) return fail(res, 409, `Папката ${locked} е заключена`);
          const data = await body(req, runtime.effective().maxUploadBytes);
          if (!data.length) return fail(res, 400, 'Празен файл');
          const root = portalRoot(p.storage_root || '/share');
          const rootAbs = path.resolve(root);
          const full = path.resolve(rootAbs, ...rel.split('/'));
          if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) return fail(res, 400, 'Invalid path');
          const overwrite = url.searchParams.get('overwrite') === '1';
          const exists = await fsp.access(full).then(() => true, () => false);
          if (exists && !overwrite) return fail(res, 409, 'Файлът вече съществува');
          try {
            await fsp.mkdir(path.dirname(full), { recursive: true });
            await fsp.writeFile(full, data);
          } catch (e) { return fail(res, 500, `Файлът не може да бъде записан: ${e.code || e.message}`) }
          void audit('portal.tree.upload', { portalId: p.id, path: '/' + rel, size: data.length, overwritten: exists });
          return json(res, 201, { path: '/' + rel, name, parent: '/' + rel.split('/').slice(0, -1).join('/'), size: data.length, overwritten: exists });
        }
        // Коментар към папка (пази се към портала; празен текст го изтрива).
        if (parts[4] === 'tree' && parts[5] === 'comment' && parts.length === 6 && method === 'POST') {
          const st = require('./storage-tree'); const b = await parse(req);
          const rel = st.normRel(b.path || '');
          if (rel === null) return fail(res, 400, 'Invalid path');
          const text = clean(b.comment).slice(0, 1000);
          if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return fail(res, 400, 'Invalid comment');
          const saved = await update(() => {
            p.folderNotes = p.folderNotes && typeof p.folderNotes === 'object' ? p.folderNotes : {};
            if (text) p.folderNotes['/' + rel] = { text, at: new Date().toISOString() };
            else delete p.folderNotes['/' + rel];
            void audit('portal.tree.comment', { portalId: p.id, path: '/' + rel, hasText: Boolean(text) });
            return { path: '/' + rel, comment: text, notes: p.folderNotes };
          });
          return json(res, 200, saved);
        }
        // Регистриране на файл от папката на портала: файлът на диска става файл в портала
        // (с id, SHA-256, версия, политика) — така картата му получава всички метаданни.
        if (parts[4] === 'tree' && parts[5] === 'register' && parts.length === 6 && method === 'POST') {
          const st = require('./storage-tree'); const b = await parse(req);
          const rel = st.normRel(b.path || '');
          if (rel === null || !rel) return fail(res, 400, 'Invalid path');
          const name = rel.split('/').pop() || '';
          if (!name || name.startsWith('.') || name.length > 240) return fail(res, 400, 'Invalid file name');
          if (p.files.some(f => String(f.name || '').toLowerCase() === name.toLowerCase())) return fail(res, 409, 'Файл с това име вече е регистриран в портала');
          const root = portalRoot(p.storage_root || '/share');
          const rootAbs = path.resolve(root);
          const full = path.resolve(rootAbs, ...rel.split('/'));
          if (!full.startsWith(rootAbs + path.sep)) return fail(res, 400, 'Invalid path');
          let stat; try { stat = await fsp.lstat(full) } catch { return fail(res, 404, 'Файлът не е намерен') }
          if (!stat.isFile()) return fail(res, 400, 'Пътят не е файл');
          if (stat.size > runtime.effective().maxUploadBytes) return fail(res, 413, 'Файлът е твърде голям за регистриране');
          const data = await fsp.readFile(full);
          return json(res, 201, await update(async () => {
            const f = { id: id(), name, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), uploadedAt: new Date().toISOString(), category: runtime.settings.data.defaultCategory, group: runtime.settings.data.defaultGroup };
            await fsp.mkdir(path.join(filesRoot, p.id), { recursive: true });
            await fsp.writeFile(path.join(filesRoot, p.id, f.id), data, { flag: 'wx', mode: 0o600 });
            p.files.push(f);
            void audit('file.register.storage', { portalId: p.id, fileId: f.id, path: '/' + rel });
            return publicFile(f);
          }, async f => { await fsp.rm(path.join(filesRoot, p.id, f.id), { force: true }) }));
        }
        // Описание (api.json) на една папка: собствени адреси, броячи и съдържание на едно ниво.
        if (parts[4] === 'tree' && parts[5] === 'api.json' && parts.length === 6 && method === 'GET') {
          const st = require('./storage-tree');
          const rel = st.normRel(url.searchParams.get('path') || '');
          if (rel === null) return fail(res, 400, 'Invalid path');
          let out; try { out = await collectStorageTree(p.storage_root || '/share') } catch (e) { return fail(res, e.status || 500, e.message) }
          const node = st.resolve(out.tree, rel);
          if (!node) return fail(res, 404, 'Path not found');
          const folderApi = folder => `${baseUrl(req)}/admin/api/portals/${encodeURIComponent(p.id)}/tree?path=${encodeURIComponent('/' + folder)}`;
          const apiUrl = folderApi(rel);
          void audit('portal.tree.api', { portalId: p.id, path: '/' + rel });
          return json(res, 200, { schema_version: '1.0', kind: 'storage-folder', portal: { id: p.id, slug: p.slug, title: p.title }, folder: { path: '/' + rel, name: node.name, parent: rel ? ('/' + rel.split('/').slice(0, -1).join('/')) : '/', folderCount: node.folderCount, fileCount: node.fileCount, bytes: node.bytes }, apiUrl, urls: { listing: apiUrl, apiJson: `${baseUrl(req)}/admin/api/portals/${encodeURIComponent(p.id)}/tree/api.json?path=${encodeURIComponent('/' + rel)}`, portal: portalApiUrl(p, baseUrl(req)) }, folders: (node.folders || []).map(f => ({ name: f.name, path: '/' + f.path, folderCount: f.folderCount, fileCount: f.fileCount, bytes: f.bytes, apiUrl: folderApi(f.path) })), files: node.type === 'file' ? [node] : (node.files || []).map(f => ({ name: f.name, path: '/' + f.path, size: f.size, modifiedAt: f.modifiedAt || '' })), generatedAt: new Date().toISOString() });
        }
        // Batch policy workflow: validate entire request before applying any changes.
        // Preview is read-only and returns the exact affected files; apply is one metadata update.
        if (parts[4] === 'files' && parts[5] === 'bulk-access' && parts.length === 6 && method === 'POST') {
          const b = await parse(req);
          if (!b || !Array.isArray(b.fileIds) || !b.fileIds.length || b.fileIds.length > 500 || b.fileIds.some(x => typeof x !== 'string') || new Set(b.fileIds).size !== b.fileIds.length || !accessModes.includes(b.mode) || typeof b.dryRun !== 'boolean' || (b.listed !== undefined && typeof b.listed !== 'boolean')) return fail(res, 400, 'Invalid bulk policy');
          const selected = b.fileIds.map(fid => p.files.find(f => f.id === fid));
          if (selected.some(f => !f)) return fail(res, 404, 'File not found; no changes applied');
          const changes = selected.map(f => ({ fileId: f.id, name: f.name, before: { mode: fileMode(f), listed: f.listed !== false }, after: { mode: b.mode, listed: b.listed === undefined ? f.listed !== false : b.listed } }));
          if (b.dryRun) return json(res, 200, { dryRun: true, count: changes.length, changes });
          const result = await update(() => { for (const f of selected) { f.accessMode = b.mode; if (b.listed !== undefined) f.listed = b.listed } void audit('file.policy.bulk', { portalId: p.id, count: changes.length, mode: b.mode }); return { dryRun: false, count: changes.length, changes } });
          return json(res, 200, result);
        }
        if (parts[4] === 'files' && parts.length === 7 && parts[6] === 'access' && method === 'PATCH') {
          const f = p.files.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'File not found'); const b = await parse(req);
          if (!accessModes.includes(b.mode) || b.listed !== undefined && typeof b.listed !== 'boolean') return fail(res, 400, 'Invalid file policy');
          return json(res, 200, await update(() => { f.accessMode = b.mode; if (b.listed !== undefined) f.listed = b.listed; void audit('file.policy', { portalId: p.id, fileId: f.id, mode: b.mode }); return { fileId: f.id, mode: f.accessMode, listed: f.listed !== false } }));
        }
        if (parts[4] === 'files' && parts.length === 7 && parts[6] === 'access-keys' && method === 'POST') {
          const f = p.files.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'File not found'); const b = await parse(req);
          if (!validExpiry(b.expiresAt === undefined ? null : b.expiresAt)) return fail(res, 400, 'Invalid expiry');
          return json(res, 201, await update(() => { const secret = 'fk_' + crypto.randomBytes(32).toString('base64url'); const k = { id: id(), hash: keyDigest(secret), createdAt: new Date().toISOString(), expiresAt: b.expiresAt || null }; f.accessKeys ??= []; f.accessKeys.push(k); void audit('file.key.create', { portalId: p.id, fileId: f.id, keyId: k.id }); return { id: k.id, key: secret, expiresAt: k.expiresAt } }));
        }
        if (parts[4] === 'files' && parts.length === 8 && parts[6] === 'access-keys' && method === 'DELETE') {
          const f = p.files.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'File not found');
          return json(res, 200, await update(() => { const n = (f.accessKeys || []).length; f.accessKeys = (f.accessKeys || []).filter(k => k.id !== parts[7]); if (f.accessKeys.length === n) throw Object.assign(new Error('Key not found'), { status: 404 }); void audit('file.key.revoke', { portalId: p.id, fileId: f.id, keyId: parts[7] }); return { revoked: parts[7] } }));
        }
        // ── „Бърз линк“ (Send-lite): публичен достъп до един файл ────────────────
        // Безсрочен по подразбиране. `expiresAt` (незадължителен), `maxAccess`
        // (0 = неограничено) и `passphrase` (по избор) се задават при създаването.
        if (parts[4] === 'files' && parts[6] === 'sends' && parts.length === 7 && method === 'POST') {
          const f = p.files.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'File not found');
          if (fileMode(f) === 'DISABLED') return fail(res, 409, 'File is disabled');
          const b = await parse(req);
          if (!validExpiry(b.expiresAt === undefined ? null : b.expiresAt)) return fail(res, 400, 'Invalid expiry');
          if (b.passphrase !== undefined && b.passphrase !== null && (typeof b.passphrase !== 'string' || b.passphrase.length > 200)) return fail(res, 400, 'Invalid passphrase');
          if (b.maxAccess !== undefined && (!Number.isInteger(Number(b.maxAccess)) || Number(b.maxAccess) < 0 || Number(b.maxAccess) > 10000)) return fail(res, 400, 'Invalid max access');
          const rec = await update(() => {
            const created = sendLite.createRecord({ expiresAt: b.expiresAt || null, maxAccess: b.maxAccess || 0, passphrase: b.passphrase || '' });
            f.sends ??= []; f.sends.push(created);
            void audit('file.send.create', { portalId: p.id, fileId: f.id, sendId: created.id, expiresAt: created.expiresAt, maxAccess: created.maxAccess, protected: Boolean(created.pass) });
            return created;
          });
          const base = String(runtime.effective().publicBaseUrl || baseUrl(req)).replace(/\/+$/, '');
          return json(res, 201, { ...sendLite.adminView(rec), url: base + '/s/' + rec.id });
        }
        if (parts[4] === 'files' && parts[6] === 'sends' && parts.length === 7 && method === 'GET') {
          const f = p.files.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'File not found');
          const base = String(runtime.effective().publicBaseUrl || baseUrl(req)).replace(/\/+$/, '');
          return json(res, 200, { sends: (f.sends || []).map(s => ({ ...sendLite.adminView(s), url: base + '/s/' + s.id })) });
        }
        if (parts[4] === 'files' && parts[6] === 'sends' && parts.length === 8 && method === 'DELETE') {
          const f = p.files.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'File not found');
          return json(res, 200, await update(() => { const n = (f.sends || []).length; f.sends = (f.sends || []).filter(s => s.id !== parts[7]); if (f.sends.length === n) throw Object.assign(new Error('Link not found'), { status: 404 }); void audit('file.send.revoke', { portalId: p.id, fileId: f.id, sendId: parts[7] }); return { revoked: parts[7] } }));
        }
        if (parts[4] === 'signing-key' && parts.length === 5 && method === 'POST') { return json(res, 200, await update(() => { p.signingSecret = crypto.randomBytes(32).toString('hex'); void audit('url.revoke-all', { portalId: p.id }); return { revokedAllSignedUrls: true } })) }
        if (parts[4] === 'files' && parts[6] === 'signed-url' && parts.length === 7 && method === 'POST') { const f = p.files.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'File not found'); if (fileMode(f) !== 'FREE') return fail(res, 403, 'Signed URL forbidden for protected file'); const b = await parse(req); const ttl = Number(b.ttlSeconds || 300); if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) return fail(res, 400, 'Invalid TTL'); const expires = Math.floor(Date.now() / 1000) + ttl; const sig = crypto.createHmac('sha256', p.signingSecret || adminToken).update(`${p.id}:${f.id}:${expires}`).digest('hex'); void audit('url.sign', { portalId: p.id, fileId: f.id }); return json(res, 201, { path: `/api/v1/p/${encodeURIComponent(p.slug)}/files/${f.id}/download?expires=${expires}&sig=${sig}`, expires }); }
        if (parts.length === 4 && method === 'PATCH') { const b = await parse(req); return json(res, 200, await update(() => { if (b.title !== undefined) { if (!clean(b.title) || clean(b.title).length > 160) throw Object.assign(new Error('Invalid title'), { status: 400 }); p.title = clean(b.title) } if (b.description !== undefined) p.description = clean(b.description).slice(0, 2000); if (b.notes !== undefined) p.notesText = clean(b.notes).slice(0, 2000); if (b.category !== undefined) p.category = clean(b.category).slice(0, 120); if (b.subject !== undefined) p.subject = clean(b.subject).slice(0, 200); if (b.flag !== undefined) p.flag = portalFlag(b.flag); if (b.storage_root !== undefined) p.storage_root = portalRoot(b.storage_root); if (b.contactId !== undefined) p.contactId = portalContact(db, b.contactId); if (b.caseId !== undefined) p.caseId = portalCase(db, b.caseId); if (b.branding !== undefined) { if (!b.branding || typeof b.branding !== 'object' || Array.isArray(b.branding) || Object.keys(b.branding).some(x => !['logoUrl', 'accentColor'].includes(x)) || (b.branding.logoUrl && !/^https:\/\//.test(b.branding.logoUrl)) || (b.branding.accentColor && !/^#[0-9a-fA-F]{6}$/.test(b.branding.accentColor))) throw Object.assign(new Error('Invalid branding'), { status: 400 }); p.branding = b.branding } if (b.visibility !== undefined) { if (!['public', 'private'].includes(b.visibility)) throw Object.assign(new Error('Invalid visibility'), { status: 400 }); p.visibility = b.visibility } if (b.slug !== undefined) { if (!validSlug(b.slug) || db.portals.some(x => x !== p && x.slug === b.slug)) throw Object.assign(new Error('Invalid or duplicate slug'), { status: 400 }); p.slug = b.slug } void audit('portal.update', { portalId: p.id }); return adminPortal(p) })) }
        if (parts.length === 4 && method === 'DELETE') { return json(res, 200, await update(async () => { p.visibility = 'private'; await fsp.rm(path.join(filesRoot, p.id), { recursive: true, force: true }); await fsp.rm(path.join(internalRoot, p.id), { recursive: true, force: true }); await fsp.rm(path.join(apiRoot, p.slug), { recursive: true, force: true }); if (storageMirrorDir) await fsp.rm(mirrorPortalDir(p.id), { recursive: true, force: true }).catch(() => { }); db.portals = db.portals.filter(x => x !== p); void audit('portal.delete', { portalId: p.id }); return { deleted: p.id } })) }
        if (parts[4] === 'integrity' && parts.length === 5 && method === 'GET') {
          const out = await verifyPortalFiles(p, { signal: new AbortController().signal, setTotal() { }, advance() { } });
          void audit('integrity.verify', { portalId: p.id, summary: out.summary }); return json(res, 200, out);
        }
        // Background integrity scan: returns immediately, progress via /admin/api/jobs/:id.
        if (parts[4] === 'integrity-jobs' && parts.length === 5 && method === 'POST') {
          const portalId = p.id;
          const job = jobManager.submit('integrity-scan', { portalId });
          return json(res, 202, job);
        }
        // Internal notes and attachments never enter p.files, public manifests, SDK or signed URLs.
        if (parts[4] === 'notes') {
          // Вътрешните бележки са СПИСЪК. Свободният текст на портала е p.notesText (различно поле).
          if (!Array.isArray(p.notes)) p.notes = [];
          if (parts.length === 5 && method === 'GET') return json(res, 200, { notes: p.notes });
          if (parts.length === 5 && method === 'POST') {
            const b = await parse(req); const title = clean(b.title), content = clean(b.content);
            if (!title || title.length > 160 || content.length > 20000) return fail(res, 400, 'Invalid note');
            const taxonomy = normalizeTaxonomy(b);
            return json(res, 201, await update(() => { const n = { id: id(), title, content, ...taxonomy, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), fileId: clean(b.fileId) || null }; if (n.fileId && !p.files.some(f => f.id === n.fileId)) throw Object.assign(new Error('Unknown linked file'), { status: 400 }); p.notes.push(n); void audit('note.create', { portalId: p.id, noteId: n.id }); return n }));
          }
          if (parts.length === 6) {
            const n = p.notes.find(x => x.id === parts[5]); if (!n) return fail(res, 404, 'Note not found');
            if (method === 'PATCH') { const b = await parse(req); if (b.title !== undefined && (!clean(b.title) || clean(b.title).length > 160) || b.content !== undefined && (typeof b.content !== 'string' || b.content.length > 20000)) return fail(res, 400, 'Invalid note'); const taxonomy = normalizeTaxonomy(b, n); return json(res, 200, await update(() => { if (b.title !== undefined) n.title = clean(b.title); if (b.content !== undefined) n.content = b.content; Object.assign(n, taxonomy); n.updatedAt = new Date().toISOString(); void audit('note.update', { portalId: p.id, noteId: n.id }); return n })); }
            if (method === 'DELETE') return json(res, 200, await update(() => { p.notes = p.notes.filter(x => x.id !== n.id); void audit('note.delete', { portalId: p.id, noteId: n.id }); return { deleted: n.id } }));
          }
        }
        if (parts[4] === 'attachments') {
          p.attachments ??= [];
          if (parts.length === 5 && method === 'GET') return json(res, 200, { attachments: p.attachments });
          if (parts.length === 5 && method === 'POST') {
            const filename = clean(req.headers['x-file-name']); if (!filename || filename.length > 240 || /[\/\r\n\0]/.test(filename)) return fail(res, 400, 'Invalid X-File-Name');
            const data = await body(req, runtime.effective().maxUploadBytes); const f = { id: id(), name: filename, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), uploadedAt: new Date().toISOString() };
            const folder = path.join(internalRoot, p.id); await fsp.mkdir(folder, { recursive: true }); const fp = path.join(folder, f.id);
            await fsp.writeFile(fp, data, { flag: 'wx', mode: 0o600 });
            try { return json(res, 201, await update(() => { p.attachments.push(f); void audit('attachment.create', { portalId: p.id, attachmentId: f.id }); return f })); } catch (e) { await fsp.rm(fp, { force: true }); throw e }
          }
          if (parts.length >= 6) {
            const f = p.attachments.find(x => x.id === parts[5]); if (!f) return fail(res, 404, 'Attachment not found');
            if (parts.length === 7 && parts[6] === 'download' && method === 'GET') {
              const fp = path.join(internalRoot, p.id, f.id); let stat; try { stat = await fsp.lstat(fp) } catch { return fail(res, 404, 'Attachment unavailable') } if (!stat.isFile()) return fail(res, 404, 'Attachment unavailable');
              return streamDownload(req, res, fp, stat, f.name, () => { void audit('attachment.download', { portalId: p.id, attachmentId: f.id }) });
            }
            if (parts.length === 6 && method === 'DELETE') {
              // Stage the physical file before committing metadata; restore on write failure.
              const fp = path.join(internalRoot, p.id, f.id), staged = fp + '.deleting-' + id();
              let moved = false;
              try { await fsp.rename(fp, staged); moved = true } catch (e) { if (e.code !== 'ENOENT') throw e; return fail(res, 409, 'Attachment file missing; integrity check required') }
              let result;
              try { result = await update(() => { p.attachments = p.attachments.filter(x => x.id !== f.id); void audit('attachment.delete', { portalId: p.id, attachmentId: f.id }); return { deleted: f.id } }) }
              catch (e) { if (moved) await fsp.rename(staged, fp); throw e }
              // If cleanup fails, the staged object is recoverable and never publicly exposed.
              try { await fsp.unlink(staged) } catch (e) { console.error('Staged attachment cleanup failed', staged, e) }
              return json(res, 200, result);
            }
          }
        }
        if (parts[4] === 'taxonomy' && parts.length === 5 && method === 'GET') {
          const unique = key => [...new Set(p.files.flatMap(f => key === 'tags' ? (f.tags || []) : [f[key] || '']).filter(Boolean))].sort((a, b) => a.localeCompare(b));
          return json(res, 200, { topics: unique('topic'), categories: unique('category'), groups: unique('group'), tags: unique('tags') });
        }
        if (parts[4] === 'files' && parts.length === 5 && method === 'GET') return json(res, 200, filePage(p.files, url));
        // Dedicated HTML publishing API. HTML is stored as a downloadable attachment,
        // never rendered as active content on the portal origin (prevents stored XSS).
        // Authorization is identical to other admin mutations. Published documents
        // default to KEY_REQUIRED and unlisted until an admin explicitly changes policy.
        if (parts[4] === 'html-projects' && parts.length === 5) {
          if (method === 'GET') return json(res, 200, { projects: p.htmlProjects || [] });
          if (method === 'POST') {
            const b = await parse(req), folder = clean(b.folder), title = clean(b.title);
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(folder) || !title || title.length > 120) return fail(res, 400, 'Invalid project folder or title');
            const base = await fsp.realpath(htmlProjectsRoot).catch(() => null); if (!base) return fail(res, 400, 'Project storage unavailable');
            let actual, index; try { actual = await fsp.realpath(path.join(base, folder)); index = await fsp.realpath(path.join(actual, 'index.html')); if (!(await fsp.stat(index)).isFile()) throw Error('Not a file') } catch { return fail(res, 400, 'index.html missing') }
            if (!actual.startsWith(base + path.sep) || !index.startsWith(actual + path.sep)) return fail(res, 400, 'Unsafe project folder');
            if ((p.htmlProjects || []).some(x => x.folder === folder)) return fail(res, 409, 'Project already registered');
            const project = await update(() => { const item = { id: id(), title, folder, enabled: true, createdAt: new Date().toISOString() }; p.htmlProjects ??= []; p.htmlProjects.push(item); void audit('html.project.register', { portalId: p.id, projectId: item.id }); return item });
            return json(res, 201, { ...project, url: '/site/' + p.slug + '/' + project.id + '/' });
          }
        }
        if (parts[4] === 'html-projects' && parts.length === 6 && method === 'DELETE') {
          return json(res, 200, await update(() => { const old = (p.htmlProjects || []).length; p.htmlProjects = (p.htmlProjects || []).filter(x => x.id !== parts[5]); if (old === p.htmlProjects.length) throw Object.assign(new Error('Not found'), { status: 404 }); void audit('html.project.unregister', { portalId: p.id, projectId: parts[5] }); return { unregistered: parts[5] } }));
        }
        if (parts[4] === 'html' && parts.length === 5 && method === 'POST') {
          const filename = clean(req.headers['x-file-name']);
          if (!filename || filename.length > 240 || !/^([^\/\r\n\0]+)\.html?$/i.test(filename)) return fail(res, 400, 'An .html or .htm filename is required');
          const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          if (contentType !== 'text/html' && contentType !== 'application/octet-stream') return fail(res, 415, 'Expected text/html');
          const data = await body(req, Math.min(runtime.effective().maxUploadBytes, 10 * 1024 * 1024));
          if (!data.length || data.includes(0)) return fail(res, 400, 'Invalid HTML payload');
          const result = await update(async () => {
            const f = { id: id(), name: filename, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), uploadedAt: new Date().toISOString(), contentType: 'text/html', accessMode: 'KEY_REQUIRED', listed: false };
            await fsp.mkdir(path.join(filesRoot, p.id), { recursive: true });
            await fsp.writeFile(path.join(filesRoot, p.id, f.id), data, { flag: 'wx', mode: 0o600 });
            p.files.push(f); const mirroredHtml = await storeMirrored(p.id, f.id, data); if (mirroredHtml) f.mirror = mirroredHtml; observer.fileUpload({ bytes: data.length, encrypted: false }); if (mirroredHtml === 'failed') observer.mirrorFailed(); void audit('html.publish', { portalId: p.id, fileId: f.id, mirror: mirroredHtml || 'disabled' }); return publicFile(f);
          }, async f => { await fsp.rm(path.join(filesRoot, p.id, f.id), { force: true }); await removeMirrored(p.id, f.id) });
          return json(res, 201, { ...result, publishStatus: 'stored', security: 'attachment-only', downloadUrl: '/api/v1/p/' + encodeURIComponent(p.slug) + '/files/' + result.id + '/download' });
        }
        if (parts[4] === 'files' && parts.length === 5 && method === 'POST') { const rawName = String(req.headers['x-file-name'] || ''); let decoded; try { decoded = decodeURIComponent(rawName) } catch { decoded = rawName } const filename = clean(decoded); if (!filename || filename.length > 240 || /[\/\r\n\0]/.test(filename)) return fail(res, 400, 'Invalid X-File-Name'); const encHeader = req.headers['x-file-encrypt']; const wantEncrypt = encHeader !== undefined && String(encHeader).trim() !== '' ? String(encHeader) === '1' : cryptoOptions.encryptFiles; const data = await body(req, runtime.effective().maxUploadBytes); return json(res, 201, await update(async () => { const f = { id: id(), name: filename, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), uploadedAt: new Date().toISOString(), category: runtime.settings.data.defaultCategory, group: runtime.settings.data.defaultGroup }; const stored = wantEncrypt ? fileCrypto.encrypt(data, adminToken) : data; if (wantEncrypt) { f.encrypted = true; f.storedSize = stored.length } await fsp.mkdir(path.join(filesRoot, p.id), { recursive: true }); await fsp.writeFile(path.join(filesRoot, p.id, f.id), stored, { flag: 'wx', mode: 0o600 }); p.files.push(f); const mirrored = await storeMirrored(p.id, f.id, stored); if (mirrored) f.mirror = mirrored; observer.fileUpload({ bytes: stored.length, encrypted: !!f.encrypted }); if (mirrored === 'failed') observer.mirrorFailed(); void audit('file.upload', { portalId: p.id, fileId: f.id, encrypted: !!f.encrypted, mirror: mirrored || 'disabled' }); return publicFile(f) }, async f => { await fsp.rm(path.join(filesRoot, p.id, f.id), { force: true }); await removeMirrored(p.id, f.id) })) }
        if (parts[4] === 'files' && parts[5]) {
          const f = p.files.find(x => x.id === parts[5]);
          if (!f) return fail(res, 404, 'File not found');
          if (parts.length === 7 && parts[6] === 'metadata' && method === 'PATCH') {
            const b = await parse(req); const meta = normalizeTaxonomy(b, f); if (typeof b.notes === 'string') meta.notes = clean(b.notes).slice(0, 2000);
            // Видимост в публичния каталог (иконата 👁/🚫 на файла) — същата проверка като при политиката.
            if (b.listed !== undefined && typeof b.listed !== 'boolean') return fail(res, 400, 'Invalid listed');
            if (typeof b.listed === 'boolean') meta.listed = b.listed;
            return json(res, 200, await update(() => { Object.assign(f, meta); f.modifiedAt = new Date().toISOString(); void audit('file.metadata', { portalId: p.id, fileId: f.id, listed: f.listed !== false }); return publicFile(f) }))
          }
          if (parts.length === 7 && parts[6] === 'lock' && method === 'PATCH') { const b = await parse(req); const locked = !!(b && b.locked); return json(res, 200, await update(() => { f.locked = locked; f.lockedBy = locked ? (clean(b.by) || 'admin') : ''; f.lockedAt = locked ? new Date().toISOString() : ''; void audit(locked ? 'file.lock' : 'file.unlock', { portalId: p.id, fileId: f.id }); return publicFile(f) })) }
          if (parts.length === 6 && method === 'PATCH') { const b = await parse(req); const name = clean(b.name); if (!name || name.length > 240 || /[\/\r\n\0]/.test(name)) return fail(res, 400, 'Invalid name'); return json(res, 200, await update(() => { f.name = name; Object.assign(f, normalizeTaxonomy(b, f)); void audit('file.rename', { portalId: p.id, fileId: f.id }); return publicFile(f) })) }
          if (parts.length === 6 && method === 'DELETE') return json(res, 200, await update(async () => { p.files = p.files.filter(x => x !== f); await fsp.rm(path.join(filesRoot, p.id, f.id), { force: true }); await removeMirrored(p.id, f.id); observer.fileDelete({ bytes: f.size || 0 }); void audit('file.delete', { portalId: p.id, fileId: f.id }); return { deleted: f.id } }))
          if (parts.length === 7 && parts[6] === 'sign' && method === 'POST') { const receipt = signer.sign({ fileId: f.id, name: f.name, sha256: f.sha256, size: f.size, secret: p.signingSecret || adminToken }); void audit('file.sign', { portalId: p.id, fileId: f.id }); return json(res, 201, { receipt, note: 'Receipt is HMAC-SHA256 over the file SHA-256 + timestamp. Key rotation revokes verification of prior receipts until PKCS#7 is available.' }) }
          if (parts.length === 7 && parts[6] === 'verify-signature' && method === 'POST') { const b = await parse(req); return json(res, 200, signer.verify(b && b.receipt, p.signingSecret || adminToken)) }
          // Пълен стек с хешове: изчислява се от съдържанието (след декриптиране, ако е нужно).
          if (parts.length === 7 && parts[6] === 'hashes' && method === 'GET') {
            const fp = path.join(filesRoot, p.id, f.id);
            // Пълният набор: SHA-2 (256/384/512), SHA-3, SHA-1 и MD5 — само поддържаните от OpenSSL.
            const supported = new Set(crypto.getHashes());
            const algos = ['sha256', 'sha512', 'sha384', 'sha3-256', 'sha1', 'md5'].filter(a => supported.has(a));
            const hashes = {}; for (const a of algos) hashes[a] = crypto.createHash(a);
            let size = 0;
            try {
              if (f.encrypted) {
                const plain = fileCrypto.decrypt(fs.readFileSync(fp), adminToken); size = plain.length; for (const a of algos) hashes[a].update(plain);
              } else {
                for await (const chunk of fs.createReadStream(fp)) { size += chunk.length; for (const a of algos) hashes[a].update(chunk) }
              }
            } catch (e) { return fail(res, e.code === 'ENOENT' ? 404 : 500, e.code === 'ENOENT' ? 'File unavailable' : 'Hashing failed') }
            const sum = {}; for (const a of algos) sum[a] = hashes[a].digest('hex');
            const out = {
              fileId: f.id, name: f.name, size, algorithms: algos, hashes: sum, computedAt: new Date().toISOString(),
              // Обратна съвместимост: старите полета остават на горното ниво.
              sha256: sum.sha256 || '', sha512: sum.sha512 || '', sha1: sum.sha1 || '', md5: sum.md5 || '',
              registered: { sha256: f.sha256 || '' }, match: (sum.sha256 || '') === (f.sha256 || '')
            };
            if (!out.match) out.warning = 'SHA-256 не съвпада с регистрирания при качване';
            void audit('file.hashes', { portalId: p.id, fileId: f.id, match: out.match, algorithms: algos.length });
            return json(res, 200, out);
          }
          if (parts.length === 7 && parts[6] === 'preview' && method === 'GET') { if (!runtime.settings.preview.enabled) return fail(res, 503, 'Preview disabled'); const buf = readPlainBuffer(p, f); if (!buf) return fail(res, 404, 'File unavailable'); const pv = preview.preview(buf, f.name); if (pv.kind === 'inline') { res.writeHead(200, { 'Content-Type': pv.mime, 'Content-Length': buf.length, 'Content-Disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(f.name.replace(/[\r\n]/g, '')), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(buf) } if (pv.kind === 'html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }); return res.end(preview.wrap(f.name, pv.html)) } res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(pv.text) }
          if (parts.length === 7 && parts[6] === 'thumbnail.svg' && method === 'GET') { if (!runtime.settings.preview.thumbnails) return fail(res, 503, 'Thumbnails disabled'); const th = preview.thumbnail(f.name); res.writeHead(200, { 'Content-Type': th.mime, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); return res.end(th.data) }
          if (parts.length === 7 && parts[6] === 'download' && method === 'GET') {
            const fp = path.join(filesRoot, p.id, f.id); let stat; try { stat = await fsp.lstat(fp) } catch { return fail(res, 404, 'File unavailable') }
            if (!stat.isFile()) return fail(res, 404, 'File unavailable'); void audit('file.download.admin', { portalId: p.id, fileId: f.id });
            if (f.encrypted) return serveEncryptedFile(req, res, fp, f, () => { counters.downloads++ });
            return streamDownload(req, res, fp, stat, f.name, () => { counters.downloads++ });
          }
          if (parts.length === 7 && parts[6] === 'versions' && method === 'GET') return json(res, 200, { current: { version: f.version || 1, size: f.size, sha256: f.sha256, uploadedAt: f.uploadedAt, encrypted: !!f.encrypted }, versions: [...(f.versions || [])].sort((a, b) => b.version - a.version), total: (f.versions || []).length + 1 });
          if (parts.length === 7 && parts[6] === 'versions' && method === 'POST') {
            const note = clean(req.headers['x-version-note'] || '');
            const data = await body(req, runtime.effective().maxUploadBytes);
            const prev = versioning.snapshotCurrent(f, { note });
            const newVersion = versioning.nextVersion(f);
            const curPath = path.join(filesRoot, p.id, f.id);
            const archPath = versioning.versionPath(filesRoot, p.id, f.id, prev.version);
            const sha256 = crypto.createHash('sha256').update(data).digest('hex');
            const stored = f.encrypted ? fileCrypto.encrypt(data, adminToken) : data;
            const result = await update(async () => {
              await fsp.rename(curPath, archPath);
              try { await fsp.writeFile(curPath, stored, { flag: 'wx', mode: 0o600 }) } catch (e) { await fsp.rename(archPath, curPath).catch(() => { }); throw e }
              f.versions ??= []; f.versions.push(prev);
              f.size = data.length; f.sha256 = sha256; f.uploadedAt = new Date().toISOString(); f.version = newVersion;
              if (f.encrypted) f.storedSize = stored.length;
              const drop = versioning.pruneTargets(f);
              f.versions = f.versions.filter(v => !drop.includes(v.version));
              void audit('file.version.upload', { portalId: p.id, fileId: f.id, version: newVersion, prevVersion: prev.version });
              return { pruned: drop };
            }, async () => { await fsp.rm(curPath, { force: true }).catch(() => { }); await fsp.rename(archPath, curPath).catch(() => { }) });
            for (const vn of result.pruned) await fsp.rm(versioning.versionPath(filesRoot, p.id, f.id, vn), { force: true }).catch(() => { });
            return json(res, 201, { file: publicFile(f), version: newVersion, previous: prev, pruned: result.pruned });
          }
          if (parts.length === 9 && parts[6] === 'versions' && parts[8] === 'download' && method === 'GET') {
            const vn = Number(parts[7]); if (!Number.isInteger(vn) || vn < 1) return fail(res, 400, 'Invalid version');
            const v = (f.versions || []).find(x => x.version === vn); if (!v) return fail(res, 404, 'Version not found');
            const vp = versioning.versionPath(filesRoot, p.id, f.id, vn);
            let stat; try { stat = await fsp.lstat(vp) } catch { return fail(res, 404, 'Version unavailable') } if (!stat.isFile()) return fail(res, 404, 'Version unavailable');
            if (v.encrypted) { let buf; try { buf = fileCrypto.decrypt(fs.readFileSync(vp), adminToken) } catch { return fail(res, 500, 'Decryption failed') } res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'Content-Disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(f.name.replace(/[\r\n]/g, '') + '.v' + vn), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); void audit('file.version.download', { portalId: p.id, fileId: f.id, version: vn }); return res.end(buf) }
            return streamDownload(req, res, vp, stat, f.name, () => { void audit('file.version.download', { portalId: p.id, fileId: f.id, version: vn }) });
          }
          if (parts.length === 9 && parts[6] === 'versions' && parts[8] === 'restore' && method === 'POST') {
            const vn = Number(parts[7]); if (!Number.isInteger(vn) || vn < 1) return fail(res, 400, 'Invalid version');
            const v = (f.versions || []).find(x => x.version === vn); if (!v) return fail(res, 404, 'Version not found');
            const vp = versioning.versionPath(filesRoot, p.id, f.id, vn);
            const curPath = path.join(filesRoot, p.id, f.id);
            const prev = versioning.snapshotCurrent(f, { note: 'restore from v' + vn });
            const newVersion = versioning.nextVersion(f);
            const archPath = versioning.versionPath(filesRoot, p.id, f.id, prev.version);
            const result = await update(async () => {
              await fsp.rename(curPath, archPath);
              try { await fsp.copyFile(vp, curPath) } catch (e) { await fsp.rename(archPath, curPath).catch(() => { }); throw e }
              f.versions ??= []; f.versions.push(prev);
              f.size = v.size; f.sha256 = v.sha256; f.encrypted = !!v.encrypted; f.storedSize = v.storedSize || null; f.uploadedAt = new Date().toISOString(); f.version = newVersion;
              void audit('file.version.restore', { portalId: p.id, fileId: f.id, restoredFrom: vn, newVersion });
              return { file: publicFile(f), restoredFrom: vn, version: newVersion };
            }, async () => { await fsp.rm(curPath, { force: true }).catch(() => { }); await fsp.rename(archPath, curPath).catch(() => { }) });
            return json(res, 200, result);
          }
        }
      } return fail(res, 404, 'Not found')
    } return fail(res, 404, 'Not found')
  } catch (e) { req.log.error('unhandled', { err: e && e.message ? e.message : 'Internal error', status: e && e.status || 500, code: e && e.code }); if (!e || !e.status || e.status >= 500) void errorLog.append('error', 'http', e && e.message ? e.message : 'Internal error'); return fail(res, e && e.status || 500, e && e.status ? e.message : 'Internal error') }
}
// Ключов пакет на диска (<storage>/keys/<N>-<отпечатък>/public.asc|private.asc) се
// импортира при старт: без презапис, без дубликати. Ролите идват от subkeys/*.json,
// ако пакетът ги носи (sign, encrypt-comms, encrypt-storage, authenticate).
async function bundleRoles(base) {
  try {
    const names = (await fsp.readdir(path.join(base, 'subkeys'))).filter(n => n.endsWith('.json'));
    const roles = new Set();
    for (const name of names) {
      try { const meta = JSON.parse(await fsp.readFile(path.join(base, 'subkeys', name), 'utf8')); const role = String((meta && (meta.role || meta.purpose)) || '').trim().toLowerCase(); if (role) roles.add(role) } catch { /* липсващ мета файл значи „няма роля“ */ }
    }
    return [...roles];
  } catch { return [] }
}
async function importKeyBundles() {
  const keysRoot = path.join(root, 'keys'), result = { imported: [], skipped: [] };
  let entries = [];
  try { entries = await fsp.readdir(keysRoot, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return result; throw e }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const base = path.join(keysRoot, entry.name);
    const read = async name => { try { return await fsp.readFile(path.join(base, name), 'utf8') } catch { return '' } };
    const armored = (await read('private.asc')) || (await read('public.asc'));
    if (!armored.trim()) continue;
    let info;
    try { info = pgp.describe(pgp.parseKeyBlock(armored)) } catch (e) { result.skipped.push({ dir: entry.name, reason: e.message }); continue }
    const duplicate = (db.pgpKeys || []).find(k => k.fingerprint === info.fingerprint || k.keyId === info.keyId);
    if (duplicate) { result.skipped.push({ dir: entry.name, fingerprint: info.fingerprint, reason: 'already imported' }); continue }
    let publicArmored = armored;
    if (info.hasSecret) { try { publicArmored = pgp.publicKeyOf(armored) } catch { publicArmored = armored } }
    const record = { id: id(), label: entry.name.slice(0, 80), userId: info.userId || '', algorithm: info.algorithm, bits: info.bits || 0, version: Number(info.version) || 4, keyId: info.keyId, fingerprint: info.fingerprint, createdAt: info.createdAt, addedAt: new Date().toISOString(), publicArmored, secretEnc: info.hasSecret ? fileCrypto.encrypt(Buffer.from(armored, 'utf8'), adminToken).toString('base64') : null, source: 'bundle', roles: await bundleRoles(base) };
    await update(() => { db.pgpKeys = [...(db.pgpKeys || []), record]; const settings = db.packageSettings || {}; if (!settings.signKeyId) db.packageSettings = { ...settings, signKeyId: record.id }; void audit('pgp.key.import', { id: record.id, keyId: record.keyId, dir: entry.name, roles: record.roles }); return record });
    result.imported.push({ id: record.id, fingerprint: record.fingerprint, label: record.label, hasSecret: info.hasSecret, roles: record.roles });
  }
  return result;
}
async function firstRunSeed() {
  if (process.env.HAPI_FIRST_RUN_SEED !== '1') return;
  const marker = path.join(root, '.first-run-done');
  try { await fsp.access(marker); return } catch { /* ENOENT значи „още не е стартиран“ — това е очакваното */ }
  let init = {}; try { init = JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')) } catch { /* липсващи опции значат празен обект (първи старт) */ }
  const str = v => typeof v === 'string' ? v.trim() : '';
  const dbName = str(init.db_name);
  const slug = dbName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'files';
  if (!db.portals.length) {
    const p = { id: id(), slug, title: dbName || 'Files', description: '', visibility: 'private', createdAt: new Date().toISOString(), files: [] };
    await fsp.mkdir(path.join(filesRoot, p.id), { recursive: true }); db.portals.push(p); metadataStore.save(db);
  }
  const uname = /^[A-Za-z0-9_.@-]{1,64}$/.test(str(init.username)) ? str(init.username) : 'api';
  if (!metadataStore.getUser(uname)) {
    const given = str(init.password), generated = given.length < 8 || given.length > 200;
    const pw = generated ? crypto.randomBytes(18).toString('base64url') : given;
    metadataStore.createUser(uname, hashPassword(pw), ['read', 'download']);
    if (generated) await fsp.writeFile(path.join(root, 'api-credentials.txt'), 'username: ' + uname + '\npassword: ' + pw + '\n', { mode: 0o600 });
  }
  if (!(runtime.settings.backupSchedule || {}).enabled) await runtime.save({ backupSchedule: { ...DEFAULT_BACKUP_SCHEDULE, enabled: true } });
  await fsp.writeFile(marker, new Date().toISOString());
  log.info('first-run', { ns: 'server', portal: slug, apiUser: uname, dailyBackups: true });
}
// Evidence View порталът (QR) се публикува в <HA config>/www/hapi/data, за да го сервира
// Home Assistant на /local/hapi/data/portal.html. Провалът не спира add-on-а: без достъп
// до конфигурацията останалите функции трябва да работят.
async function deployEvidencePortal() {
  const enabled = String(optionValue('EVIDENCE_PORTAL_DEPLOY', 'evidence_portal_deploy', 'true')) !== 'false';
  if (!enabled) { log.info('evidence-portal.disabled', { ns: 'server' }); return }
  try {
    const result = require('./evidence-portal').deploy();
    if (result.ok) log.info('evidence-portal.deployed', { ns: 'server', dir: result.dir, copied: result.copied.length, unchanged: result.unchanged.length });
    else log.warn('evidence-portal.skipped', { ns: 'server', reason: result.error });
  } catch (e) { log.warn('evidence-portal.failed', { ns: 'server', err: e.message }) }
}
async function start() {
  try {
    // Първо заключване на data директорията: две инстанции на едни и същи данни биха
    // корумпирали метаданни, одит верига и TSA архив. INSTANCE_STRICT=0 само предупреждава.
    const instanceLock = require('./instance-lock');
    const lock = instanceLock.acquire({ dir: root, id: instanceId });
    if (!lock.ok) {
      const holder = lock.holder || {};
      const message = `data directory ${root} is locked by instance ${holder.id || '?'} (pid ${holder.pid || '?'} on ${holder.host || '?'}, heartbeat ${holder.heartbeatAt || '?'})`;
      if (String(process.env.INSTANCE_STRICT || '1') !== '0') {
        // Подсказката е важна: при преизползван PID старият файл изглежда като жив
        // собственик, а човекът пред конзолата няма как да го разбере от самите числа.
        console.error('instance lock: ' + message);
        console.error(`instance lock: ако в ${root} няма друга работеща инстанция, изтрий ${lock.file} и рестартирай add-on-а`);
        process.exit(1)
      }
      log.warn('instance.locked', { ns: 'server', holder: holder.id, pid: holder.pid });
    } else {
      instanceState = { id: instanceId, acquired: true, tookOver: Boolean(lock.tookOver), startedAt: lock.payload.startedAt };
      if (lock.tookOver) log.warn('instance.stale-lock', { ns: 'server', previous: lock.previous ? lock.previous.id : null });
      const beat = setInterval(() => { try { instanceLock.heartbeat(root, { id: instanceId }) } catch (e) { log.warn('instance.heartbeat.failed', { ns: 'server', err: e.message }) } }, 30000);
      beat.unref();
    }
    // Вградените правила се копират веднъж в редактируемата директория, а липсващите
    // файлове се отчитат в лога — иначе правилата тихо остават само вградените.
    const seeded = gatewayApi.seedRules();
    if (seeded.copied && seeded.copied.length) log.info('rules.seeded', { ns: 'rules', dir: seeded.dir, files: seeded.copied.length });
    if (seeded.error) log.warn('rules.seed.failed', { ns: 'rules', dir: seeded.dir, err: seeded.error });
    const rulesStatus = gatewayApi.status();
    if (rulesStatus.missing.length) log.warn('rules.defaults', { ns: 'rules', missing: rulesStatus.missing.join(',') });
    else log.info('rules.loaded', { ns: 'rules', files: Object.keys(rulesStatus.files).length });
    const lines = (await fsp.readFile(telemetryFile, 'utf8')).split('\n'); for (const line of lines) { if (!line.trim()) continue; try { const e = JSON.parse(line); if (['visit', 'download', 'rating'].includes(e.event)) applyTelemetry(e) } catch { console.error('Invalid telemetry record') } }
  } catch (e) { if (e.code !== 'ENOENT') throw e } await fsp.mkdir(htmlProjectsRoot, { recursive: true }); await fsp.mkdir(filesRoot, { recursive: true }); await fsp.mkdir(internalRoot, { recursive: true }); await auditChain.init(); db = metadataStore.load(); metadataStore.purgeExpiredSessions(); jobManager.recover(); await firstRunSeed(); await deployEvidencePortal(); await importKeyBundles().catch(e => log.warn('pgp.bundle.failed', { ns: 'pgp', err: e.message })); for (const p of db.portals) if (!fs.existsSync(path.join(apiRoot, p.slug, 'qr.svg'))) await writeApiDir(p, baseUrl(null)); applyBackupSchedule(); if (runtime.settings.retention && runtime.settings.retention.enabled) { const runScheduledRetention = () => { void queue.then(async () => { const r = await retention.apply(db.portals); metadataStore.save(db); if (r.deleted || r.disabled || r.auditLinesPruned) void audit('retention.scheduled', { deleted: r.deleted, disabled: r.disabled, auditLinesPruned: r.auditLinesPruned }) }).catch(e => console.error('SCHEDULED RETENTION FAILED', e.message)) }; setInterval(runScheduledRetention, 86400000).unref() } if (storageCheckIntervalMs > 0) { void runStorageCheck('scheduled').catch(() => { }); setInterval(() => { void runStorageCheck('scheduled').catch(() => { }) }, storageCheckIntervalMs) } log.info('startup', { ns: 'server', node: process.version, pid: process.pid, dataDir: root, level: log.level(), ingress: ingressMode, publicHost, port, adminPort, tsa: cryptoOptions.tsaEnabled, encryptFiles: cryptoOptions.encryptFiles, signPackages: cryptoOptions.signPackages, tls: Boolean(cryptoOptions.tlsCert || cryptoOptions.tlsKey) });
  // TLS за собствените листенери (порт 8099/8098/8088). Двете опции вървят заедно:
  // липсващ или нечетим файл спира старта, вместо тихо да падне на HTTP.
  const tlsEnabled = Boolean(cryptoOptions.tlsCert || cryptoOptions.tlsKey);
  let makeServer = (h) => http.createServer(h);
  if (tlsEnabled) {
    if (!cryptoOptions.tlsCert || !cryptoOptions.tlsKey) { console.error('TLS: tls_cert и tls_key трябва да са зададени заедно'); process.exit(1) }
    try { const tlsOptions = { cert: fs.readFileSync(cryptoOptions.tlsCert), key: fs.readFileSync(cryptoOptions.tlsKey) }; makeServer = (h) => require('node:https').createServer(tlsOptions, h) }
    catch (e) { console.error('TLS: ' + e.message); process.exit(1) }
  }
  const servers = [makeServer(handler).listen(port, publicHost, () => log.info('listening', { ns: 'server', listener: 'public', host: publicHost, port, tls: tlsEnabled }))]; if (ingressMode) servers.push(makeServer(handler).listen(adminPort, adminBindHost, () => log.info('listening', { ns: 'server', listener: 'ingress-admin', host: adminBindHost, port: adminPort })));
  // Public API Gateway (PG-6): отделен listener без административни маршрути.
  const gatewayPort = Number(process.env.PUBLIC_GATEWAY_PORT || 0), gatewayBind = process.env.PUBLIC_GATEWAY_BIND || '0.0.0.0';
  if (gatewayPort > 0 && gatewayPort !== port && gatewayPort !== adminPort) servers.push(makeServer((req, res) => { req.hapiPublicOnly = true; return handler(req, res) }).listen(gatewayPort, gatewayBind, () => log.info('listening', { ns: 'server', listener: 'public-gateway', host: gatewayBind, port: gatewayPort })));
  // Graceful stop (Supervisor sends SIGTERM, `timeout` in config.yaml is 30s): stop
  // accepting requests, let queued metadata writes finish, then close SQLite so the
  // WAL is checkpointed instead of leaving the shutdown to the kernel.
  let shuttingDown = false;
  const shutdown = signal => { if (shuttingDown) return; shuttingDown = true; log.info('shutdown', { ns: 'server', signal }); let finished = false; const finish = () => { if (finished) return; finished = true; try { require('./instance-lock').release(root, instanceId) } catch (e) { log.warn('instance.release.failed', { ns: 'server', err: e.message }) } try { observer.close() } catch (e) { log.warn('observer.close.failed', { ns: 'server', err: e.message }) } try { metadataStore.close() } catch (e) { log.error('sqlite.close.failed', { ns: 'server', err: e.message }) } process.exit(0) }; const timer = setTimeout(finish, 5000); timer.unref(); let open = servers.length; if (!open) return finish(); for (const s of servers) s.close(() => { if (--open === 0) { clearTimeout(timer); void Promise.resolve(queue).catch(() => { }).then(finish) } }) };
  process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'))
} start().catch(e => { console.error(e); process.exit(1) });
