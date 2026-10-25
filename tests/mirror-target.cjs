'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const mirror = require('../hapi_enterprise/mirror-target.js');
// §MIRROR_TARGET_PATH_OR_S3: целта на огледалото има два вида зад ЕДИН договор —
// запис → прочитане обратно → сравнение по SHA-256 → триене.
//
// Фалшивият S3 сървър по-долу САМ проверява подписа SigV4 по спецификацията (не приема
// „какъвто и да е“ Authorization), защото смисълът на теста е да хване грешка в
// канонизацията: ред на хедърите, кодиране на пътя, обхват на ключа.
const KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const sha256Hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

/** Независима проверка на Authorization: AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…, Signature=… */
function verifySignature(req, body) {
  const auth = req.headers.authorization || '';
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return { ok: false, why: 'форма на Authorization' };
  const [, accessKey, scope, signedHeaders, signature] = m;
  if (accessKey !== KEY) return { ok: false, why: 'access key' };
  const [dateStamp, region, service, terminator] = scope.split('/');
  if (terminator !== 'aws4_request' || service !== 's3') return { ok: false, why: 'scope' };
  const names = signedHeaders.split(';');
  for (const required of ['host', 'x-amz-content-sha256', 'x-amz-date']) if (!names.includes(required)) return { ok: false, why: 'липсва ' + required };
  const payloadHash = sha256Hex(body || Buffer.alloc(0));
  if ((req.headers['x-amz-content-sha256'] || '') !== payloadHash) return { ok: false, why: 'x-amz-content-sha256' };
  const canonicalHeaders = names.map((n) => n + ':' + String(req.headers[n] || '').trim() + '\n').join('');
  const url = new URL(req.url, 'http://127.0.0.1');
  const canonicalQuery = [...url.searchParams.entries()].map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => k + '=' + v).join('&');
  const canonicalRequest = [req.method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], scope, sha256Hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(Buffer.from('AWS4' + SECRET, 'utf8'), dateStamp), region), service), 'aws4_request');
  const expected = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  if (expected !== signature) return { ok: false, why: 'подписът не съвпада' };
  return { ok: true };
}

/** Минимален S3: PUT/GET/HEAD/DELETE + Object Lock (403 при триене на заключен обект). */
function startFakeS3() {
  const objects = new Map(); // key -> { bytes, lockRetainUntil }
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const check = verifySignature(req, body);
      seen.push({ method: req.method, url: req.url, lock: req.headers['x-amz-object-lock-mode'] || null, retain: req.headers['x-amz-object-lock-retain-until-date'] || null, ok: check.ok });
      if (!check.ok) { res.writeHead(403, { 'content-type': 'application/xml' }); res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>'); return }
      const key = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/[^/]+\//, '')); // маха bucket-а
      if (req.method === 'PUT') {
        const retain = req.headers['x-amz-object-lock-retain-until-date'] || null;
        objects.set(key, { bytes: body, lockRetainUntil: retain && new Date(retain) > new Date() ? retain : null });
        res.writeHead(200, { etag: '"' + sha256Hex(body).slice(0, 16) + '"' }); res.end(); return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const hit = objects.get(key);
        if (!hit) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'content-length': String(hit.bytes.length) });
        res.end(req.method === 'HEAD' ? undefined : hit.bytes); return;
      }
      if (req.method === 'DELETE') {
        const hit = objects.get(key);
        if (hit && hit.lockRetainUntil) { res.writeHead(403, { 'content-type': 'application/xml' }); res.end('<Error><Code>AccessDenied</Code></Error>'); return }
        objects.delete(key);
        res.writeHead(204); res.end(); return;
      }
      res.writeHead(405); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, objects, seen, endpoint: `http://127.0.0.1:${server.address().port}` })));
}

(async () => {
  // ── 1. Разчитане на адреса ────────────────────────────────────────────────
  assert.equal(mirror.parseSpec(''), null, 'празно = без огледало');
  assert.equal(mirror.parseSpec('   '), null);
  // Относителен път се смята от `/share`; на Windows това е друг диск, затова тук се
  // пуска с изричното разрешение (в контейнера пътят минава и без него).
  const p = mirror.parseSpec('backup-hapi', { allowAny: true });
  assert.equal(p.kind, 'path');
  assert.ok(p.dir.endsWith(path.join('share', 'backup-hapi')), 'относителен път се смята от /share: ' + p.dir);
  // Само HA-видими папки, освен с изричното разрешение — същото правило като преди 0.69.87.
  assert.throws(() => mirror.parseSpec('/etc/hapi'), /inside \/share/, 'път извън HA-видимите папки се отказва');
  assert.equal(mirror.parseSpec('/etc/hapi', { allowAny: true }).kind, 'path', 'STORAGE_MIRROR_ANY е изричен изход');
  assert.throws(() => mirror.parseSpec(path.join('/share', 'x'), { root: path.join('/share', 'x'), allowAny: true }), /differ from the data directory/, 'огледалото не може да е самите данни');

  const s3 = mirror.parseSpec('s3://hapi-evidence/files-hapi?endpoint=http://minio:9000&region=eu-central-1&lock=30');
  assert.deepEqual({ kind: s3.kind, bucket: s3.bucket, prefix: s3.prefix, endpoint: s3.endpoint, region: s3.region, lockDays: s3.lockDays },
    { kind: 's3', bucket: 'hapi-evidence', prefix: 'files-hapi', endpoint: 'http://minio:9000', region: 'eu-central-1', lockDays: 30 });
  assert.equal(mirror.parseSpec('s3://bucket/x').region, mirror.DEFAULT_REGION, 'без region се ползва подразбирането');
  assert.equal(mirror.parseSpec('s3://bucket/x').lockDays, 0, 'без lock няма заключване');

  for (const bad of ['s3://Bucket_No/UP', 's3://ok/x?lock=0', 's3://ok/x?lock=abc', 's3://ok/x?lock=999999', 's3://ok/x?endpoint=ftp://nope', 's3://ok/x?region=UPPER_CASE']) {
    assert.throws(() => mirror.parseSpec(bad), /storage_mirror/, 'трябва да се откаже: ' + bad);
  }
  assert.throws(() => mirror.create({ raw: 's3://bucket/x', accessKey: '', secretKey: '' }), /s3_access_key/, 's3 без ключове се отказва ясно');

  // ── 2. Цел „папка“: същият договор като преди ─────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-target-'));
  try {
    const dir = path.join(tmp, 'mirror');
    const folder = mirror.create({ raw: dir, root: tmp, allowAny: true });
    assert.equal(folder.kind, 'path');
    const data = crypto.randomBytes(2048);
    assert.equal((await folder.put('portal-1', 'file-1', data)).ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'files', 'portal-1', 'file-1')).length, data.length, 'байтовете са на същото място като преди');
    assert.deepEqual(await folder.get('portal-1', 'file-1'), data);
    // Повторен запис при съществуващ файл се отказва (flag wx) и НЕ се брои за успех.
    assert.equal((await folder.put('portal-1', 'file-1', Buffer.from('x'))).ok, false, 'съществуващ файл не се презаписва');
    assert.equal((await folder.remove('portal-1', 'file-1')).ok, true);
    assert.equal(await folder.get('portal-1', 'file-1'), null);

    const eph = mirror.s3Target ? null : null; void eph;

    // ── 3. Цел „s3“: подпис, запис, прочитане, заключване ────────────────
    const fake = await startFakeS3();
    try {
      const target = mirror.create({ raw: `s3://hapi-evidence/backup?endpoint=${fake.endpoint}&region=eu-central-1&lock=30`, accessKey: KEY, secretKey: SECRET });
      assert.equal(target.kind, 's3');
      assert.equal(target.describe().location, 's3://hapi-evidence/backup');
      assert.match(target.describe().location, /^s3:\/\/hapi-evidence/, 'описанието не съдържа ключове');
      assert.equal(JSON.stringify(target.describe()).includes(SECRET), false, 'секретът не влиза в описанието');

      const payload = crypto.randomBytes(4096);
      const put = await target.put('portal-2', 'file-2', payload);
      assert.equal(put.ok, true, 'записът минава подпис, прочита се обратно и съвпада: ' + JSON.stringify(put));
      assert.deepEqual(await target.get('portal-2', 'file-2'), payload, 'байтовете се връщат същите');

      const putSeen = fake.seen.find((s) => s.method === 'PUT');
      assert.equal(putSeen.ok, true, 'подписът е валиден');
      assert.equal(putSeen.lock, 'COMPLIANCE', 'Object Lock се иска с COMPLIANCE');
      assert.ok(putSeen.retain && new Date(putSeen.retain) > new Date(), 'има срок на задържане');
      assert.equal(fake.seen.filter((s) => s.method === 'GET').length >= 1, true, 'записът се проверява с четене обратно');
      assert.ok([...fake.objects.keys()].every((k) => k.startsWith('backup/files/')), 'ключът е [prefix/]files/<portal>/<file>: ' + [...fake.objects.keys()].join(','));

      // Заключен обект: триенето се отказва и това НЕ е грешка на нашия код.
      const removed = await target.remove('portal-2', 'file-2');
      assert.equal(removed.ok, false);
      assert.equal(removed.locked, true, 'отказът от Object Lock се разпознава като „заключен“');

      // Без lock: триенето минава.
      const plain = mirror.create({ raw: `s3://hapi-evidence/plain?endpoint=${fake.endpoint}&region=eu-central-1`, accessKey: KEY, secretKey: SECRET });
      assert.equal((await plain.put('p', 'f', Buffer.from('hello'))).ok, true);
      assert.equal(fake.seen.at(-1).lock, null, 'без lock няма заглавка за заключване');
      const gone = await plain.remove('p', 'f');
      assert.deepEqual(gone, { ok: true, locked: false });

      // Чужда тайна не минава: подписът се проверява наистина.
      const wrong = mirror.create({ raw: `s3://hapi-evidence/backup?endpoint=${fake.endpoint}&region=eu-central-1`, accessKey: KEY, secretKey: 'greshen-secret' });
      const denied = await wrong.put('p', 'z', Buffer.from('nope'));
      assert.equal(denied.ok, false, 'грешен секрет не пише');
      assert.match(denied.reason, /403/, 'отказът идва от S3: ' + denied.reason);
    } finally { await new Promise((r) => fake.server.close(r)) }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }

  console.log('mirror-target OK: ' + mirror.CODE + ' · папка · s3 (SigV4, Object Lock) · грешен секрет → 403');
})().catch((e) => { console.error(e); process.exit(1) });
