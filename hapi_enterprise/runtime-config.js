'use strict';
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const DEFAULT = { artifactDirectory: 'qr-records', databaseFile: 'db.json', databaseDirectory: '.', organization: 'PasevSU DEV', project: 'Home Assistant Projects', campaign: 'NO TRUST Cybersecurity', backupSchedule: { enabled: false, intervalMinutes: 1440, maxBackups: 10 }, limits: { maxUploadMb: null, maxDownloadStreams: null, maxJobs: null, storageCheckMinutes: null, publicBaseUrl: '', corsOrigin: '', requirePortalToken: null, storeRawIp: null }, data: { conflictPolicy: 'queue', strictTaxonomy: false, defaultCategory: '', defaultGroup: '', maxTags: 30 }, retention: { enabled: false, fileDays: null, auditDays: null, fileAction: 'disable' }, preview: { enabled: true, thumbnails: true }, sensors: { ipMode: null, trustProxy: null, retentionDays: null, geoipPath: '' } };
const INT = { maxUploadMb: [1, 2048], maxDownloadStreams: [1, 1024], maxJobs: [1, 4], storageCheckMinutes: [0, 10080] };
function validateLimits(l) {
  if (l === undefined || l === null) l = {}; if (typeof l !== 'object' || Array.isArray(l)) throw Error('Invalid limits'); const out = { ...DEFAULT.limits };
  for (const k of Object.keys(l)) {
    if (!Object.hasOwn(DEFAULT.limits, k)) throw Error('Unknown limit ' + k);
    const v = l[k];
    if (INT[k]) { if (v === null || v === '') out[k] = null; else { const n = Number(v); if (!Number.isInteger(n) || n < INT[k][0] || n > INT[k][1]) throw Error('Invalid ' + k); out[k] = n } }
    else if (k === 'requirePortalToken' || k === 'storeRawIp') { if (v === null || v === '') out[k] = null; else if (typeof v === 'boolean') out[k] = v; else throw Error('Invalid ' + k) }
    else { const s = String(v ?? '').trim().replace(/\/+$/, ''); if (s && (s.length > 200 || !/^https?:\/\/[A-Za-z0-9.\-:\[\]]+(\/[A-Za-z0-9._~\-\/]*)?$/.test(s))) throw Error('Invalid ' + k); out[k] = s }
  }
  return out
}
function validateData(d) {
  if (d === undefined || d === null) d = {}; if (typeof d !== 'object' || Array.isArray(d)) throw Error('Invalid data settings'); const out = { ...DEFAULT.data };
  for (const k of Object.keys(d)) {
    if (!Object.hasOwn(DEFAULT.data, k)) throw Error('Unknown data setting ' + k); const v = d[k];
    if (k === 'conflictPolicy') { if (!['queue', 'first', 'skip'].includes(v)) throw Error('Invalid conflictPolicy'); out[k] = v }
    else if (k === 'strictTaxonomy') { if (typeof v !== 'boolean') throw Error('Invalid strictTaxonomy'); out[k] = v }
    else if (k === 'maxTags') { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 100) throw Error('Invalid maxTags'); out[k] = n }
    else { const s = String(v ?? '').trim(); if (s.length > 120) throw Error('Invalid ' + k); out[k] = s }
  }
  return out
}
function validateRetention(r) {
  if (r === undefined || r === null) r = {}; if (typeof r !== 'object' || Array.isArray(r)) throw Error('Invalid retention');
  const out = { enabled: !!r.enabled, fileDays: null, auditDays: null, fileAction: r.fileAction === 'delete' ? 'delete' : 'disable' };
  const days = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 36500) throw Error('Invalid retention days'); return n };
  out.fileDays = days(r.fileDays); out.auditDays = days(r.auditDays);
  if (r.fileAction !== undefined && !['disable', 'delete'].includes(r.fileAction)) throw Error('Invalid fileAction');
  return out
}
function validatePreview(p) {
  if (p === undefined || p === null) p = {}; if (typeof p !== 'object' || Array.isArray(p)) throw Error('Invalid preview settings');
  const out = { enabled: p.enabled !== false, thumbnails: p.thumbnails !== false };
  if (p.enabled !== undefined && typeof p.enabled !== 'boolean') throw Error('Invalid preview.enabled');
  if (p.thumbnails !== undefined && typeof p.thumbnails !== 'boolean') throw Error('Invalid preview.thumbnails');
  return out
}
function validSegment(v) { return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v) && v !== '.' && v !== '..' }
// Сензори за комуникацията: режим на IP, доверие към X-Forwarded-For, срок на пазене и
// път до офлайн геобазата. `null` значи „не е зададено оттук“ — тогава важи средата.
function validateSensors(s) {
  if (s === undefined || s === null) s = {};
  if (typeof s !== 'object' || Array.isArray(s)) throw Error('Invalid sensors settings');
  const out = { ...DEFAULT.sensors };
  for (const key of Object.keys(s)) {
    if (!Object.hasOwn(DEFAULT.sensors, key)) throw Error('Unknown sensors setting ' + key);
    const v = s[key];
    if (key === 'ipMode') {
      if (v === null || v === '') out[key] = null;
      else if (['hashed', 'masked', 'full'].includes(v)) out[key] = v;
      else throw Error('Invalid ipMode');
    } else if (key === 'trustProxy') {
      if (v === null || v === '') out[key] = null;
      else if (typeof v === 'boolean') out[key] = v;
      else throw Error('Invalid trustProxy');
    } else if (key === 'retentionDays') {
      if (v === null || v === '') out[key] = null;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 3650) throw Error('Invalid retentionDays');
        out[key] = n;
      }
    } else {
      // Път до файл на диска: само абсолютен, без контроли и без „..“.
      const value = String(v ?? '').trim();
      if (value && (value.length > 500 || !value.startsWith('/') || /\.\./.test(value) || /[\u0000-\u001f]/.test(value))) throw Error('Invalid geoipPath');
      out[key] = value;
    }
  }
  return out
}
function validate(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid settings'); const result = { ...DEFAULT, ...v };
  for (const key of ['artifactDirectory', 'databaseFile', 'databaseDirectory']) { if (key === 'databaseFile') { if (typeof result[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,80}\.json$/.test(result[key])) throw Error('Invalid database file') } else if (key === 'databaseDirectory') { if (result[key] !== '.' && !validSegment(result[key])) throw Error('Invalid database directory') } else if (!validSegment(result[key])) throw Error('Invalid artifact directory') }
  for (const key of ['organization', 'project', 'campaign']) if (typeof result[key] !== 'string' || result[key].length > 120) throw Error('Invalid ' + key);
  const bs = result.backupSchedule;
  if (!bs || typeof bs !== 'object' || Array.isArray(bs)) throw Error('Invalid backup schedule');
  const schedule = { enabled: !!bs.enabled, intervalMinutes: Number(bs.intervalMinutes), maxBackups: Number(bs.maxBackups) };
  if (!Number.isInteger(schedule.intervalMinutes) || schedule.intervalMinutes < 1 || schedule.intervalMinutes > 525600) throw Error('Invalid backup interval');
  if (!Number.isInteger(schedule.maxBackups) || schedule.maxBackups < 1 || schedule.maxBackups > 1000) throw Error('Invalid backup max backups');
  result.backupSchedule = schedule; result.limits = validateLimits(v.limits); result.data = validateData(v.data); result.retention = validateRetention(v.retention); result.preview = validatePreview(v.preview); result.sensors = validateSensors(v.sensors);
  for (const key of Object.keys(v)) if (!Object.hasOwn(DEFAULT, key)) throw Error('Unknown setting ' + key);
  return result;
}
// Публичен базов адрес: `limits.publicBaseUrl` (Settings) или `PUBLIC_BASE_URL` от средата
// (start.js го подава по опцията `public_domain`). Невалидна стойност се игнорира, за да не
// се създадат QR кодове с чужд или счупен адрес.
function publicBase(v) { const s = String(v ?? '').trim().replace(/\/+$/, ''); return s && s.length <= 200 && /^https?:\/\/[A-Za-z0-9.\-:\[\]]+(\/[A-Za-z0-9._~\-\/]*)?$/.test(s) ? s : '' }
function create(root) {
  const configDir = path.join(root, 'config'), configPath = path.join(configDir, 'settings.json'); let settings = DEFAULT;
  try { settings = validate(JSON.parse(fs.readFileSync(configPath, 'utf8'))) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const databaseRelative = path.join(settings.databaseDirectory, settings.databaseFile), databasePath = path.join(root, databaseRelative);
  async function atomic(file, data) { const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'; await fsp.mkdir(path.dirname(file), { recursive: true }); try { const h = await fsp.open(tmp, 'wx', 0o600); try { await h.writeFile(JSON.stringify(data, null, 2)); await h.sync() } finally { await h.close() } await fsp.rename(tmp, file) } catch (e) { await fsp.rm(tmp, { force: true }).catch(() => { }); throw e } }
  async function save(patch) {
    // Частичен запис на сензорите (само едно поле) се слива със записаното — иначе
    // `{sensors:{ipMode}}` би изтрил прокси/срока/пътя. Изрично `null` изчиства поле.
    const merged = { ...settings, ...patch };
    if (patch && patch.sensors && typeof patch.sensors === 'object' && !Array.isArray(patch.sensors)) merged.sensors = { ...settings.sensors, ...patch.sensors };
    const next = validate(merged); for (const key of ['artifactDirectory', 'databaseDirectory']) { const candidate = path.join(root, next[key]); const st = await fsp.lstat(candidate).catch(e => { if (e.code === 'ENOENT') return null; throw e }); if (st && (!st.isDirectory() || st.isSymbolicLink())) throw Error('Storage directory must be a real directory: ' + key) } await atomic(configPath, next); settings = next; return next
  }
  async function removeArtifacts(artifact) { if (!artifact || !validSegment(artifact.qrId) || artifact.relativeDirectory !== path.join(settings.artifactDirectory, artifact.qrId)) throw Error('Invalid rollback target'); const target = path.join(root, artifact.relativeDirectory); const stat = await fsp.lstat(target).catch(e => { if (e.code === 'ENOENT') return null; throw e }); if (stat && stat.isDirectory() && !stat.isSymbolicLink()) await fsp.rm(target, { recursive: true, force: true }); }
  async function createArtifacts(data) {
    if (!data || !validSegment(data.qrId)) throw Error('Invalid QR ID'); const qrId = data.qrId; const base = path.join(root, settings.artifactDirectory); await fsp.mkdir(base, { recursive: true }); const baseStat = await fsp.lstat(base); if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw Error('Invalid artifact root'); const dir = path.join(base, qrId); await fsp.mkdir(dir, { recursive: false });
    const createdAt = new Date().toISOString(); const manifest = { qrId, createdAt, organization: settings.organization, project: settings.project, campaign: settings.campaign, files: [] };
    try { for (const kind of ['manifest', 'log', 'report']) { const content = kind === 'manifest' ? JSON.stringify(manifest, null, 2) : kind === 'log' ? JSON.stringify({ qrId, createdAt, events: [{ type: 'created', at: createdAt }] }, null, 2) : JSON.stringify({ qrId, createdAt, status: 'CREATED', note: 'No external QR verification performed' }, null, 2); await fsp.writeFile(path.join(dir, kind + '.json'), content, { flag: 'wx', mode: 0o600 }) } }
    catch (e) { await fsp.rm(dir, { recursive: true, force: true }); throw e }
    return { qrId, createdAt, relativeDirectory: path.join(settings.artifactDirectory, qrId), manifest: 'manifest.json', log: 'log.json', report: 'report.json' };
  }
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== '' ? n : d };
  function effective() {
    const l = settings.limits || DEFAULT.limits, e = process.env; const b = (k, env) => l[k] !== null && l[k] !== undefined ? l[k] : e[env] === 'true';
    return { maxUploadBytes: l.maxUploadMb != null ? l.maxUploadMb * 1048576 : num(e.MAX_UPLOAD_BYTES, 52428800), maxDownloadStreams: Math.max(1, Math.min(1024, l.maxDownloadStreams != null ? l.maxDownloadStreams : num(e.MAX_DOWNLOAD_STREAMS, 32))), maxJobs: Math.min(4, Math.max(1, l.maxJobs != null ? l.maxJobs : num(e.MAX_JOBS, 1))), storageCheckIntervalMs: Math.max(0, l.storageCheckMinutes != null ? l.storageCheckMinutes * 60000 : num(e.STORAGE_CHECK_INTERVAL_MS, 3600000)), publicBaseUrl: publicBase(l.publicBaseUrl) || publicBase(e.PUBLIC_BASE_URL), corsOrigin: l.corsOrigin || e.CORS_ORIGIN || '', requirePortalToken: b('requirePortalToken', 'REQUIRE_PORTAL_TOKEN'), storeRawIp: b('storeRawIp', 'TELEMETRY_STORE_RAW_IP'), sensors: effectiveSensors() }
  }
  // Настройките на сензорите: записаното от интерфейса печели, иначе средата, иначе
  // подразбирането. `storeRawIp` (старата настройка) беше единственият начин да се
  // поиска `full` — остава в сила, ако режимът не е зададен изрично.
  function effectiveSensors() {
    const s = settings.sensors || DEFAULT.sensors, e = process.env;
    const rawIp = settings.limits && settings.limits.storeRawIp !== null && settings.limits.storeRawIp !== undefined ? settings.limits.storeRawIp : e.TELEMETRY_STORE_RAW_IP === 'true';
    const envMode = String(e.VISITOR_IP_MODE || '').trim();
    const ipMode = s.ipMode || (['hashed', 'masked', 'full'].includes(envMode) ? envMode : rawIp ? 'full' : 'hashed');
    const envDays = Number(e.VISITOR_RETENTION_DAYS);
    return {
      ipMode,
      trustProxy: s.trustProxy !== null ? s.trustProxy : e.TRUST_PROXY === 'true',
      retentionDays: s.retentionDays !== null ? s.retentionDays : Number.isFinite(envDays) && envDays > 0 ? envDays : 90,
      geoipPath: s.geoipPath || String(e.GEOIP_DB_PATH || ''),
    }
  }
  return { get settings() { return settings }, effective, databasePath, databaseRelative, save, createArtifacts, removeArtifacts };
}
module.exports = { create, validate, validateSensors };
