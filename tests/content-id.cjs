'use strict';
// 0.69.83 — идентичност на съдържанието (`content_id`), §11 и §12 от HAPI-ARCH-API-001.
//
// Проверява се ТВЪРДЕНИЕТО, а не наличието на поле: един номер не може да обозначава две
// различни байтови версии, а нова версия получава собствена идентичност, без да пренаписва
// предишната. Затова:
//   • същите байтове → същият `content_id` (дори името да е друго);
//   • сменени байтове под същото име → различен `content_id`;
//   • `content_id` върви с файла (публичен изглед), с манифеста и с отчетния запис;
//   • веригата `content_id → sha256 → manifest_id → qr_id` е проверима от един отговор.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const contentId = require('../hapi_enterprise/content-id');
const ooxml = require('../hapi_enterprise/ooxml');

const shareRoot = path.resolve('/share');
const cleaned = [];

(async () => {
  // ── 1. Модулът: идентичност, която зависи само от портала и байтовете ────────
  console.log('· съдържанието определя идентичността, не името');
  {
    const sha = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const first = contentId.of({ portalId: 'p1', sha256: sha, size: 10 });
    assert.match(first, /^CT-[0-9a-f]{32}$/, 'форматът е стабилен: ' + first);
    assert.equal(contentId.of({ portalId: 'p1', sha256: sha, size: 10 }), first, 'същото съдържание → същият идентификатор');
    assert.notEqual(contentId.of({ portalId: 'p1', sha256: other, size: 10 }), first, 'други байтове → друг идентификатор');
    assert.notEqual(contentId.of({ portalId: 'p1', sha256: sha, size: 11 }), first, 'друг размер → друг идентификатор');
    assert.notEqual(contentId.of({ portalId: 'p2', sha256: sha, size: 10 }), first, 'друг портал → друга идентичност');
    assert.equal(contentId.of({ portalId: 'p1', sha256: 'zz', size: 10 }), null, 'невалиден хеш не се гадае');
    assert.equal(contentId.of({ portalId: '', sha256: sha, size: 10 }), null, 'без портал няма идентичност');
    assert.equal(contentId.of({}), null);
    // Записаната идентичност печели пред преизчислената (за да не „мърда“ публикувано).
    assert.equal(contentId.forFile({ id: 'p1' }, { contentId: first, sha256: other, size: 10 }), first);
  }

  const server = await startServer();
  try {
    const jsonOf = async (p, method, body) => {
      const res = await server.authFetch(server.base + p, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data };
    };
    const upload = async (portalId, name, body) => {
      const res = await server.authFetch(server.base + `/admin/api/portals/${portalId}/files`, {
        method: 'POST',
        headers: { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream', 'x-file-encrypt': '0' },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 201, 'качването минава: ' + text.slice(0, 200));
      return JSON.parse(text);
    };

    const slug = 'cid-' + Date.now().toString(36);
    const portal = (await jsonOf('/admin/api/portals', 'POST', { slug, title: 'Съдържание', visibility: 'public' })).data;
    cleaned.push(portal.slug);
    fs.mkdirSync(path.join(shareRoot, slug), { recursive: true });

    // ── 2. Файлът носи content_id още при качване ─────────────────────────────
    console.log('· всеки качен файл получава собствен content_id');
    const v1 = await upload(portal.id, 'договор.pdf', 'първа версия');
    assert.match(v1.contentId, /^CT-[0-9a-f]{32}$/, 'файлът има content_id: ' + v1.contentId);
    assert.equal(v1.contentId, contentId.of({ portalId: portal.id, sha256: v1.sha256, size: v1.size }), 'идва от байтовете, не от името');

    // ── 3. Същото име, други байтове → НОВА идентичност ───────────────────────
    console.log('· същото име с други байтове е ДРУГО съдържание');
    const v2 = await upload(portal.id, 'договор.pdf', 'втора версия');
    assert.notEqual(v2.contentId, v1.contentId, 'подмененият файл получава нова идентичност');
    assert.notEqual(v2.sha256, v1.sha256);
    // Старият запис не е пренаписан: двете версии съществуват едновременно.
    const files = (await jsonOf(`/admin/api/portals/${portal.id}`)).data.files || [];
    const ids = new Set(files.map((f) => f.contentId));
    assert.equal(ids.size, 2, 'двете версии пазят собствени идентичности: ' + [...ids].join(', '));

    // ── 4. Манифестът на QR-а носи content_id и manifest_id ──────────────────
    console.log('· манифестът свързва content_id → sha256 → manifest_id → qr_id');
    // Архивира се ПАПКАТА на портала (source of truth за `order`); затова втората версия
    // се слага и на диска — така манифестът описва точно байтовете, които са публикувани.
    fs.writeFileSync(path.join(shareRoot, slug, 'договор.pdf'), 'втора версия');
    const made = await jsonOf(`/admin/api/portals/${portal.id}/qr/archive`, 'POST', { note: 'версия 1 и 2' });
    assert.equal(made.status, 201, 'архивът се създава');
    const zip = Buffer.from(await (await server.authFetch(server.base + `/admin/api/portals/${portal.id}/qr/QR-001/archive`)).arrayBuffer());
    const manifest = JSON.parse(ooxml.unzip(zip).get('manifest.json')().toString('utf8'));
    assert.equal(manifest.manifest_id, 'MF-QR-001', 'манифестът има собствен идентификатор');
    assert.equal(manifest.qr_id, 'QR-001');
    for (const entry of manifest.files) {
      assert.match(entry.content_id, /^CT-[0-9a-f]{32}$/, 'всеки файл в манифеста носи content_id: ' + entry.path);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      assert.equal(entry.content_id, contentId.of({ portalId: portal.id, sha256: entry.sha256, size: entry.size_bytes }), 'идентичността съвпада с байтовете в манифеста');
    }
    const onDisk = manifest.files.find((f) => f.path === 'договор.pdf');
    assert.ok(onDisk, 'файлът е в манифеста');
    // След подмяната в папката е втората версия — манифестът описва ТОВА, което е архивирано.
    assert.equal(onDisk.content_id, v2.contentId, 'манифестът сочи версията, която реално е на диска');

    // ── 5. Публичният QR договор дава същата верига ──────────────────────────
    console.log('· публичният договор показва веригата, без вътрешни данни');
    const pub = (await jsonOf(`/api/v1/p/${slug}/qr.json`)).data;
    const rev = pub.revisions.find((r) => r.id === 'QR-001');
    assert.equal(rev.manifestId, 'MF-QR-001', 'ревизията носи manifest_id');
    assert.equal(rev.nextQrId, 'QR-002', 'и наследника');
    assert.equal('note' in (rev.archive || {}), false, 'вътрешните бележки не излизат');

    // ── 6. Отчетният запис сочи съдържанието, не само името ─────────────────
    console.log('· отчетът за файл съдържа Content ID');
    const scope = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'report-scope.js'), 'utf8');
    assert.match(scope, /\['Content ID', file && file\.contentId\]/, 'отчетният запис носи идентичността на съдържанието');

    console.log('PASS content-id: съдържанието определя идентичността · нова версия = нова идентичност · верига content_id → sha256 → manifest_id → qr_id · отчетът сочи съдържание');
  } finally {
    await server.stop().catch(() => { });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  for (const name of cleaned) {
    try { fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true }) } catch { /* Linux */ }
  }
});
