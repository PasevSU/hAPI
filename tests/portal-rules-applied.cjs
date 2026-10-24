'use strict';
// ОРАКУЛ: правилата на портала се ВЗИМАТ и се ПРИЛАГАТ — на истински заявки.
//
// Проверява се точният резултат, не „не гърми“:
//   • правилата идват от записа на портала (visibility, accessMode на файла, listed), а не
//     от някакво копие в паметта на процеса;
//   • скрит портал не се вижда публично, докато не стане public — и тогава се вижда веднага;
//   • FREE сваля без ключ, KEY_REQUIRED иска ключ (грешен ключ е отказ, верният — байтове),
//     DISABLED е отказ дори с верен ключ;
//   • bulk политиката е атомарна: dryRun НЕ променя нищо, apply променя целия набор;
//   • `/admin/api/v2/export/rules` връща ДОСЛОВНО `config/rules/download_rules.json`
//     (правилата се четат от файловете, не се измислят в кода).
//
// Съзнателно извън обхвата: `config/rules/portal_policies.json` днес НЕ се чете от runtime
// (виж бележката в края) — тестът не твърди обратното.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startServer } = require('./lib/gui-harness.cjs');

const root = path.join(__dirname, '..');

(async () => {
  const server = await startServer({ keepData: true });
  const { api, authFetch, base } = server;
  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  const body = 'Договор за доставка — съдържание за теста';

  const upload = async (portalId, name, text) => {
    const res = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      headers: { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'text/plain' },
      body: text,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  const download = async (slug, fileId, headers = {}) => {
    const res = await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`, { headers });
    return { status: res.status, text: await res.text(), res };
  };

  try {
    // ── 1. Порталът по подразбиране е скрит: правилата от записа вече важат ────────────
    const created = await api('/admin/api/portals', 'POST', { slug: 'rules-demo', title: 'Правила' });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const portalId = created.data.id;
    assert.equal(created.data.visibility, 'private', 'нов портал е скрит (private), докато не се публикува');

    const up = await upload(portalId, 'dogovor.txt', body);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const fileId = up.data.id;
    assert.equal(up.data.accessMode, 'FREE', 'файл без изрична политика наследява FREE');
    assert.equal(sha256(Buffer.from(body)), up.data.sha256, 'отпечатъкът е на качения байт-поток');

    const hidden = await download('rules-demo', fileId);
    assert.equal(hidden.status, 404, 'скрит портал не дава файл публично');

    // ── 2. Правилото за видимост се прилага веднага след промяната ─────────────────────
    const published = await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' });
    assert.equal(published.status, 200);
    const free = await download('rules-demo', fileId);
    assert.equal(free.status, 200, 'публичен портал + FREE = сваляне без ключ');
    assert.equal(free.text, body, 'байтовете са същите, не „някакъв файл“');

    // ── 3. KEY_REQUIRED: правилото на файла иска ключ ─────────────────────────────────
    const keyed = await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'KEY_REQUIRED', listed: true, reason: 'тест: ключ' });
    assert.equal(keyed.status, 200);
    assert.equal(keyed.data.mode, 'KEY_REQUIRED');

    const noKey = await download('rules-demo', fileId);
    assert.equal(noKey.status, 403, 'без ключ файлът е отказан');
    assert.match(noKey.text, /File key required/);

    const wrongKey = await download('rules-demo', fileId, { 'X-File-Key': 'fk_' + 'a'.repeat(43) });
    assert.equal(wrongKey.status, 403, 'грешен ключ не отваря файла');

    const minted = await api(`/admin/api/portals/${portalId}/files/${fileId}/access-keys`, 'POST', {});
    assert.equal(minted.status, 201, JSON.stringify(minted.data));
    assert.match(minted.data.key, /^fk_/, 'ключът има ясен префикс');
    const withKey = await download('rules-demo', fileId, { 'X-File-Key': minted.data.key });
    assert.equal(withKey.status, 200, 'верният ключ отваря файла');
    assert.equal(withKey.text, body);

    // ── 4. DISABLED е отказ дори с верен ключ ─────────────────────────────────────────
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'DISABLED', reason: 'тест: недостъпен' })).status, 200);
    const disabled = await download('rules-demo', fileId, { 'X-File-Key': minted.data.key });
    assert.equal(disabled.status, 403, 'DISABLED не се отваря и с ключ');
    assert.match(disabled.text, /Download disabled/);

    // ── 5. Bulk политика: dryRun не пипа, apply пипа целия набор ──────────────────────
    const second = await upload(portalId, 'vtori.txt', 'втори файл');
    assert.equal(second.status, 201);
    const ids = [fileId, second.data.id];

    const dry = await api(`/admin/api/portals/${portalId}/files/bulk-access`, 'POST', { fileIds: ids, mode: 'FREE', dryRun: true, listed: true });
    assert.equal(dry.status, 200, JSON.stringify(dry.data));
    assert.equal(dry.data.dryRun, true);
    assert.equal(dry.data.count, 2);
    assert.deepEqual(dry.data.changes.map((c) => c.before.mode).sort(), ['DISABLED', 'FREE'], 'dryRun вижда текущото състояние');
    assert.equal((await download('rules-demo', fileId)).status, 403, 'dryRun НЕ е променил нищо');

    const applied = await api(`/admin/api/portals/${portalId}/files/bulk-access`, 'POST', { fileIds: ids, mode: 'FREE', dryRun: false, listed: true });
    assert.equal(applied.status, 200);
    assert.equal(applied.data.dryRun, false);
    assert.equal((await download('rules-demo', fileId)).status, 200, 'след apply правилото действа');
    const afterApply = await api(`/admin/api/portals/${portalId}`);
    assert.deepEqual(afterApply.data.files.map((f) => f.accessMode), ['FREE', 'FREE'], 'правилото е записано в портала');

    // ── 6. Скрит файл: правилото `listed` важи за списъка и за адреса му ──────────────
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/metadata`, 'PATCH', { listed: false })).status, 200);
    const listing = await fetch(`${base}/api/v1/p/rules-demo/files`).then((r) => r.json());
    assert.equal(listing.files.some((f) => f.id === fileId), false, 'скритият файл не е в списъка');
    assert.equal((await fetch(`${base}/api/v1/p/rules-demo/files/${fileId}`)).status, 404, 'скритият файл няма и собствен адрес');
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/metadata`, 'PATCH', { listed: true })).status, 200);

    // ── 7. Правилата идват от файловете в config/rules, дословно ──────────────────────
    const rules = await api('/admin/api/v2/export/rules');
    assert.equal(rules.status, 200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'config', 'rules', 'download_rules.json'), 'utf8'));
    assert.deepEqual(rules.data.download_rules, onDisk, '/export/rules връща точно download_rules.json');
    const gatewayModes = rules.data.access.modes.map((m) => m.id);
    // Сървърът приема точно три режима за ФАЙЛ; порталът има и PRIVATE/AUTHENTICATED.
    assert.deepEqual(['DISABLED', 'FREE', 'KEY_REQUIRED'].filter((m) => !gatewayModes.includes(m)), [], 'режимите на файла са описани в /export/rules');
    assert.ok(gatewayModes.includes('PRIVATE') && gatewayModes.includes('AUTHENTICATED'), 'порталните режими също са описани');
    assert.ok(rules.data.export_profiles && rules.data.public_gateway && rules.data.rate_limits, 'останалите правила също се четат');

    // ── 8. Правилото на ПЛОЩТА на портала (gateway модел) се взима от записа ────────────
    const gateway = require('../hapi_enterprise/gateway-api');
    assert.equal(gateway.portalMode({ accessMode: 'DISABLED' }), 'DISABLED', 'изричната политика на портала печели');
    assert.equal(gateway.portalMode({ visibility: 'public' }), 'FREE', 'публичният портал без политика е FREE');
    assert.equal(gateway.portalMode({ visibility: 'hidden' }), 'KEY_REQUIRED', 'скритият без политика иска ключ');
    const decision = gateway.decideFile({ portal: { slug: 'p', accessMode: 'DISABLED' }, file: { id: 'f', name: 'a.pdf' } });
    assert.equal(decision.allowed, false, 'порталът с DISABLED не пуска файла');
    assert.equal(decision.mode, 'DISABLED');
    assert.equal(gateway.fileView({ slug: 'p', accessMode: 'FREE' }, { id: 'f', name: 'a.pdf', accessMode: 'DISABLED' }).access, 'DISABLED', 'правилото на файла печели пред това на портала');

    console.log(
      'PASS portal-rules-applied: скрит→404, public→200 · FREE/KEY_REQUIRED/DISABLED приложени на живо · ' +
      'грешен ключ 403, верен 200 · bulk dryRun не пипа, apply пипа · /export/rules = download_rules.json'
    );
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
