'use strict';
// Цел на огледалото (0.69.87, стъпка M3 от `READY_MADE_COMPONENTS.md` §2.5).
//
// Досега `storage_mirror` можеше само папка: второ копие на всеки файл, сверено със
// SHA-256 и поправяно при нужда. Тук целта става абстракция с два вида, а договорът
// остава СЪЩИЯТ: записва се, прочита се обратно, сравни се, одитира се, брои се.
//
//   path — папка (както досега): `flag:'wx'`, права 0600, прочитане и сравнение.
//   s3   — S3-съвместимо хранилище (MinIO, AWS S3, B2, Wasabi) през HTTPS, с подпис
//          SigV4, направен с `node:crypto` + `fetch`. Без npm: add-on-ът няма нито една
//          външна зависимост и това не се променя.
//
// Защо S3 и защо Object Lock: `flag:'wx'` пази само от нашия код. Object Lock (COMPLIANCE)
// прави обекта неизтриваем и от root, докато трае срокът — това е истинският WORM (DEF-06).
// Затова `put` може да носи `x-amz-object-lock-mode` и `x-amz-object-lock-retain-until-date`,
// а `remove` при заключен обект НЕ е грешка: очаквано е да бъде отказано.
//
// Адресът се задава с един низ, за да няма шест нови полета в интерфейса:
//
//   s3://<bucket>[/<prefix>][?endpoint=…&region=…&lock=<дни>]
//
// Ключовете идват от опциите `s3_access_key` / `s3_secret_key` (env S3_ACCESS_KEY /
// S3_SECRET_KEY) и НИКОГА не влизат в адреса или в лога.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const CODE = 'MIRROR_TARGET_PATH_OR_S3';
const DEFAULT_REGION = 'us-east-1';
// Мъртъв или забавен S3 не бива да блокира проверката/поправката на цялото огледало:
// без таймаут една заявка може да виси с минути, а `verify` минава файл по файл.
const DEFAULT_TIMEOUT_MS = 15000;

const sha256Buf = (buf) => crypto.createHash('sha256').update(buf).digest();
const sha256Hex = (buf) => sha256Buf(buf).toString('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** RFC 3986 кодиране както го иска SigV4: `encodeURIComponent` не пипа !'()* . */
function uriEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Разчита адреса на целта. Хвърля при невалиден вход — по-добре ясна грешка при старт,
 * отколкото тихо огледало, което не пише никъде.
 */
function parseSpec(raw, { root, allowAny = false } = {}) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return null;
  if (!/^s3:\/\//i.test(value)) {
    const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve('/share', value);
    // Само HA-видимите папки: иначе една буквална грешка в настройката може да насочи
    // второто копие към чужда директория. `STORAGE_MIRROR_ANY` е изричен изход за тестове
    // и за нестандартни инсталации.
    if (!allowAny && !['/share', '/media', '/config', '/data'].some((p) => abs === p || abs.startsWith(p + '/'))) {
      throw Error('storage_mirror must be inside /share, /media or /config');
    }
    if (root && (abs === path.resolve(root) || abs === path.join(path.resolve(root), 'files'))) throw Error('storage_mirror must differ from the data directory');
    return { kind: 'path', dir: abs };
  }
  let url;
  try { url = new URL(value) } catch { throw Error('storage_mirror: невалиден s3 адрес') }
  const bucket = url.hostname;
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw Error('storage_mirror: невалиден име на кофа (s3://bucket/...)');
  const prefix = url.pathname.replace(/^\/+|\/+$/g, '');
  const endpoint = (url.searchParams.get('endpoint') || '').replace(/\/+$/, '');
  if (endpoint && !/^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[A-Za-z0-9._~\-/]*)?$/.test(endpoint)) throw Error('storage_mirror: невалиден endpoint');
  const region = (url.searchParams.get('region') || DEFAULT_REGION).trim();
  if (!/^[a-z0-9-]{2,40}$/.test(region)) throw Error('storage_mirror: невалиден region');
  const lockRaw = url.searchParams.get('lock');
  let lockDays = 0;
  if (lockRaw !== null) {
    lockDays = Number(lockRaw);
    if (!Number.isInteger(lockDays) || lockDays < 1 || lockDays > 36500) throw Error('storage_mirror: lock трябва да е 1..36500 дни');
  }
  return { kind: 's3', bucket, prefix, endpoint, region, lockDays };
}

/**
 * Подпис SigV4 (AWS Signature Version 4) за един S3 запрос.
 * Връща готовите хедъри за `fetch`. Чиста функция: същият вход → същият подпис.
 */
function signV4({ method, url, headers = {}, body = Buffer.alloc(0), accessKey, secretKey, region = DEFAULT_REGION, service = 's3', now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261025T073000Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const all = { ...headers, host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const merged = {};
  for (const [k, v] of Object.entries(all)) merged[k.toLowerCase()] = String(v).trim();
  const canonicalHeaders = names.map((n) => n + ':' + merged[n] + '\n').join('');
  const signedHeaders = names.join(';');
  // `new URL` вече е дал процентово кодирания път; кодираме го втори път САМО ако
  // съдържа знак извън безопасния набор (нашите ключове не съдържат такъв).
  const canonicalUri = /^[A-Za-z0-9._~\-/]*$/.test(u.pathname) ? u.pathname : u.pathname.split('/').map((s) => uriEncode(decodeURIComponent(s))).join('/');
  const canonicalQuery = [...u.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => k + '=' + v)
    .join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n');
  const kDate = hmac(Buffer.from('AWS4' + secretKey, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    ...merged,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** Пътят на обекта: `[prefix/]files/<portalId>/<fileId>` — същият ред като при папката. */
function keyFor(prefix, portalId, fileId) {
  const safe = (v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9._-]/g, '_');
  const head = String(prefix || '').split('/').map(safe).filter(Boolean).join('/');
  const relative = `files/${safe(portalId)}/${safe(fileId)}`;
  return head ? `${head}/${relative}` : relative;
}

function trimSlash(v) { return String(v || '').replace(/\/+$/, '') }

/** Причина за провал на мрежова заявка: таймаутът се разпознава отделно от чужд код. */
function timeoutReason(e) {
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout';
  return (e && (e.code || e.message)) || 'failed';
}

/** Цел „папка“ — поведението от преди 0.69.87, изнесено без промяна. */
function pathTarget(dir) {
  const fileFor = (portalId, fileId) => path.join(dir, 'files', portalId, fileId);
  return {
    kind: 'path',
    describe: () => ({ kind: 'path', location: dir }),
    fileFor,
    async put(portalId, fileId, data) {
      const target = fileFor(portalId, fileId);
      try {
        await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fsp.writeFile(target, data, { flag: 'wx', mode: 0o600 });
        const check = await fsp.readFile(target);
        const same = check.length === data.length && sha256Hex(check) === sha256Hex(data);
        if (!same) {
          await fsp.rm(target, { force: true }).catch(() => { });
          return { ok: false, reason: 'sha256 mismatch' };
        }
        return { ok: true };
      } catch (e) {
        // Съществуващ файл (EEXIST) не се презаписва — това е договорът, не авария.
        return { ok: false, reason: e.code || e.message };
      }
    },
    async get(portalId, fileId) {
      try { return await fsp.readFile(fileFor(portalId, fileId)) } catch { return null }
    },
    async remove(portalId, fileId) {
      await fsp.rm(fileFor(portalId, fileId), { force: true }).catch(() => { });
      return { ok: true, locked: false };
    },
  };
}

/** Цел „s3“ — запис, четене, триене през подписан HTTPS. */
function s3Target(spec, { accessKey, secretKey, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const prefix = spec.prefix || '';
  const base = trimSlash(spec.endpoint) || `https://${spec.bucket}.s3.${spec.region}.amazonaws.com`;
  // Път-стил адресиране (`endpoint/bucket/key`) работи навсякъде, включително MinIO.
  const objectUrl = (key) => (spec.endpoint ? `${base}/${spec.bucket}/${key}` : `${base}/${key}`);
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const request = async (method, key, { body = Buffer.alloc(0), extra = {} } = {}) => {
    const url = objectUrl(key);
    const headers = signV4({ method, url, body, accessKey, secretKey, region: spec.region, headers: extra });
    return fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body, signal: AbortSignal.timeout(limit) });
  };
  const get = async (portalId, fileId) => {
    try {
      const res = await request('GET', keyFor(prefix, portalId, fileId));
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch { return null }
  };
  return {
    kind: 's3',
    describe: () => ({ kind: 's3', location: `s3://${spec.bucket}${prefix ? '/' + prefix : ''}`, region: spec.region, endpoint: spec.endpoint || 'aws', lockDays: spec.lockDays }),
    keyFor: (portalId, fileId) => keyFor(prefix, portalId, fileId),
    async put(portalId, fileId, data) {
      const key = keyFor(prefix, portalId, fileId);
      const extra = {};
      if (spec.lockDays > 0) {
        extra['x-amz-object-lock-mode'] = 'COMPLIANCE';
        extra['x-amz-object-lock-retain-until-date'] = new Date(Date.now() + spec.lockDays * 86400000).toISOString();
      }
      try {
        const res = await request('PUT', key, { body: data, extra });
        if (!res.ok) return { ok: false, reason: 's3 put ' + res.status };
        // Сверката е същата като при папката: прочитаме обратно и сравняваме SHA-256.
        const back = await get(portalId, fileId);
        if (!back || sha256Hex(back) !== sha256Hex(data)) return { ok: false, reason: 'sha256 mismatch' };
        return { ok: true };
      } catch (e) {
        // Изтекъл таймаут се разпознава като `timeout`, за да го види операторът в одита.
        return { ok: false, reason: timeoutReason(e) };
      }
    },
    get,
    async remove(portalId, fileId) {
      try {
        const res = await request('DELETE', keyFor(prefix, portalId, fileId));
        // Object Lock в режим COMPLIANCE не се маха от никого — отказът е очакван.
        if (res.status === 403) return { ok: false, locked: true };
        return { ok: res.ok || res.status === 404, locked: false };
      } catch (e) { return { ok: false, locked: false, reason: timeoutReason(e) } }
    },
  };
}

/**
 * Строи целта. `null` значи „няма огледало“ — същото като празна настройка досега.
 */
function create({ raw, root, allowAny = false, accessKey = '', secretKey = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const spec = parseSpec(raw, { root, allowAny });
  if (!spec) return null;
  if (spec.kind === 'path') return pathTarget(spec.dir);
  if (!accessKey || !secretKey) throw Error('storage_mirror: за s3 цел са нужни s3_access_key и s3_secret_key');
  return s3Target(spec, { accessKey, secretKey, timeoutMs });
}

module.exports = { CODE, DEFAULT_REGION, DEFAULT_TIMEOUT_MS, parseSpec, signV4, keyFor, uriEncode, create, pathTarget, s3Target };
