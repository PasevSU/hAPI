'use strict';
// ПРОВЕРКИТЕ ОТ ПАНЕЛА СЕ ВИЖДАТ В ДНЕВНИКА — край до край, на жив сървър.
//
// Докладван проблем: „натискаш Провери целостта, показва резултат и нищо не остава“.
// Решението беше одит, но одитът се чете от друг екран и не се ЗАСИЧА — нито в дневника за
// разработка (`GET /admin/api/logs`), нито в журнала на грешките (`GET /admin/api/errors`).
//
// Този тест пада, ако:
//   • успешна проверка на цялостта не остави `check.integrity` с `event: ok` в дневника;
//   • ПРОВАЛЕНА проверка не влезе в журнала на грешките с `source: check.integrity` и причина;
//   • издаването/списъкът/отнемането на токен не оставят `check.token` с операцията;
//   • проверката на QR архивите не остави `check.qr` с `op: verify`;
//   • сверката на конфигурацията не остави `check.config`, а провалът ѝ — ред в журнала;
//   • смяната на ключа за подпис не остави `check.key`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startServer } = require('./lib/gui-harness.cjs');
const { storageRoot } = require('./helpers.cjs');

const ok = (r) => r.status === 200 || r.status === 201 || r.status === 202;

(async () => {
  const storage = storageRoot();
  // Собствена папка за данните: вътрешното копие (което проверката чете) е
  // `<dataDir>/files/<portalId>/<fileId>`, а не копието в папката на портала.
  const dataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'check-log-data-'));
  const server = await startServer({ dataDir, env: { ...storage.env, PORTAL_FOLDER_COPY: 'true' } });
  /** Дневникът се чете по събитие и контекст — „някъде има ред“ не е доказателство. */
  const logEntries = async () => {
    const r = await server.api('/admin/api/logs?limit=500');
    assert.equal(r.status, 200, 'дневникът се чете: ' + r.status);
    return r.data.entries || [];
  };
  const checkRows = async (name) => (await logEntries()).filter((e) => e.msg === 'check.' + name);
  try {
    const created = await server.api('/admin/api/portals', 'POST', { title: 'Проверки', slug: 'p-checks', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 160));
    const portal = created.data.portal || created.data;

    // Файл в портала: без него проверката за цялост няма какво да сверява.
    const upload = await fetch(server.base + '/admin/api/portals/' + encodeURIComponent(portal.id) + '/files', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + server.token, 'x-file-name': encodeURIComponent('dokazatelstvo.txt') },
      body: 'байтове за проверка',
    });
    assert.ok(ok({ status: upload.status }), 'файлът се качва: ' + upload.status);
    const uploaded = await upload.json();
    assert.ok(uploaded && uploaded.id, 'качването връща id: ' + JSON.stringify(uploaded).slice(0, 160));

    // ── 1. Успешна проверка на цялостта: следа в дневника ──────────────────
    const clean = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/integrity');
    assert.equal(clean.status, 200, 'проверката минава: ' + JSON.stringify(clean.data).slice(0, 200));
    const okRows = (await checkRows('integrity')).filter((e) => e.ctx && e.ctx.event === 'ok');
    assert.equal(okRows.length >= 1, true, 'успешната проверка оставя `check.integrity` с event=ok: ' + JSON.stringify(await checkRows('integrity')));
    assert.equal(okRows[0].level, 'info', 'успехът е info, не шум в грешките');
    assert.equal(okRows[0].ns, 'check', 'има собствен namespace (`ns` е на върха на записа, не в ctx)');
    assert.ok(typeof okRows[0].ctx.ms === 'number', 'измерено е времето: ' + JSON.stringify(okRows[0].ctx));

    // ── 2. Провалена проверка: причина в журнала на грешките ───────────────
    // Подменя се ВЪТРЕШНОТО копие — точно това, което проверката чете и което се дава за
    // изтегляне. Копието в папката на портала се сверява от `config/verify` (друг договор).
    const internal = path.join(dataDir, 'files', portal.id, uploaded.id);
    assert.ok(fs.existsSync(internal), 'вътрешното копие е на място: ' + internal);
    fs.writeFileSync(internal, 'подменени байтове', 'utf8');
    const tampered = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/integrity');
    assert.equal(tampered.status, 200, 'проверката пак отговаря 200 (резултатът е в тялото)');
    assert.equal(tampered.data.summary.MISMATCH >= 1, true, 'подмяната се вижда като MISMATCH: ' + JSON.stringify(tampered.data.summary));
    // Присъдата е ЕДНО място за „има ли проблем“ — панелът чете нея, а не ключовете на summary.
    assert.equal(tampered.data.verdict.ok, false, 'присъдата казва „има проблем“: ' + JSON.stringify(tampered.data.verdict));
    assert.equal(tampered.data.verdict.failed >= 1, true, 'присъдата брои проблемните файлове: ' + JSON.stringify(tampered.data.verdict));
    assert.equal(clean.data.verdict.ok, true, 'чистата проверка е ok: ' + JSON.stringify(clean.data.verdict));
    const errors = await server.api('/admin/api/errors?source=check.integrity&limit=50');
    assert.equal(errors.status, 200, 'журналът на грешките се чете: ' + errors.status);
    const rows = errors.data.events || [];
    assert.equal(rows.length >= 1, true, 'провалът влиза в журнала с source=check.integrity: ' + JSON.stringify(errors.data).slice(0, 300));
    assert.equal(rows.some((e) => /INTEGRITY_MISMATCH/.test(e.message)), true, 'причината е INTEGRITY_MISMATCH: ' + JSON.stringify(rows.map((e) => e.message)));
    assert.equal(rows[0].details.portalId, portal.id, 'записът знае за кой портал е');
    assert.equal(typeof rows[0].details.failed, 'number', 'броят на проблемните файлове е записан: ' + JSON.stringify(rows[0].details));

    // ── 3. Токените: издаване, списък, отнемане ────────────────────────────
    const issued = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/tokens', 'POST', { ttlSeconds: 3600, maxUses: 5 });
    assert.equal(issued.status, 201, 'токенът се издава: ' + JSON.stringify(issued.data).slice(0, 160));
    const listed = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/tokens');
    assert.equal(listed.status, 200, 'списъкът се чете');
    const revoked = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/tokens/' + encodeURIComponent(issued.data.id), 'DELETE');
    assert.equal(revoked.status, 200, 'токенът се отнема: ' + revoked.status);
    const tokenRows = await checkRows('token');
    const ops = tokenRows.map((e) => e.ctx && e.ctx.op);
    for (const op of ['issue', 'list', 'revoke']) {
      assert.equal(ops.includes(op), true, 'операцията „' + op + '“ е в дневника: ' + JSON.stringify(ops));
    }
    assert.equal(tokenRows.every((e) => e.ctx.portalId === portal.id), true, 'всяка следа знае портала');

    // ── 4. QR архивите: проверката оставя `check.qr` с op=verify ───────────
    const qrVerify = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id) + '/qr/verify', 'POST');
    assert.equal(qrVerify.status, 200, 'проверката на архивите минава: ' + JSON.stringify(qrVerify.data).slice(0, 200));
    const qrRows = await checkRows('qr');
    assert.equal(qrRows.length >= 1, true, 'проверката на архивите оставя следа: ' + JSON.stringify(qrRows));
    assert.equal(qrRows.some((e) => e.ctx && e.ctx.op === 'verify'), true, 'операцията е op=verify: ' + JSON.stringify(qrRows.map((e) => e.ctx)));

    // ── 5. Сверката на конфигурацията: успех и провал със своя източник ─────
    const base = '/admin/api/portals/' + encodeURIComponent(portal.id);
    const cfg = await server.api(base + '/config');
    assert.equal(cfg.status, 200, 'конфигурацията се чете: ' + JSON.stringify(cfg.data).slice(0, 160));
    const verified = await server.api(base + '/config/verify', 'POST');
    assert.equal(verified.status, 200, 'сверката на конфигурацията минава: ' + JSON.stringify(verified.data).slice(0, 200));
    const configRows = await checkRows('config');
    assert.equal(configRows.some((e) => e.ctx && e.ctx.event === 'ok'), true, 'успешната сверка оставя check.config: ' + JSON.stringify(configRows));
    // Липсващ файл от `files[]` = провал, който се засича и в журнала на грешките.
    const target = (verified.data.files || [])[0];
    if (target && target.path) {
      const storagePath = path.join(storage.share, String(portal.storage_root || ''), target.path);
      const doomed = fs.existsSync(storagePath) ? storagePath : null;
      if (doomed) {
        fs.rmSync(doomed, { force: true });
        const broken = await server.api(base + '/config/verify', 'POST');
        assert.equal(broken.status, 200, 'сверката отговаря и при проблем');
        const configErrors = await server.api('/admin/api/errors?source=check.config&limit=50');
        assert.equal(configErrors.status, 200, 'журналът се чете по check.config: ' + configErrors.status);
        const rowsBroken = configErrors.data.events || [];
        assert.equal(rowsBroken.length >= 1, true, 'провалът на сверката влиза в журнала: ' + JSON.stringify(configErrors.data).slice(0, 300));
        assert.equal(rowsBroken.some((e) => /CONFIG_FILES_/.test(e.message)), true, 'причината е по вида на проблема: ' + JSON.stringify(rowsBroken.map((e) => e.message)));
      }
    }

    // ── 6. Смяната на ключа за подпис оставя `check.key` ───────────────────
    const rotated = await server.api(base + '/signing-key', 'POST', {});
    assert.equal(rotated.status, 200, 'ключът се сменя: ' + rotated.status);
    const keyRows = await checkRows('key');
    assert.equal(keyRows.some((e) => e.ctx && e.ctx.op === 'rotate'), true, 'смяната на ключа оставя следа: ' + JSON.stringify(keyRows));

    console.log(
      'PASS check-log-integration: `check.integrity` при успех (info, с време) · провалът влиза в ' +
        '`GET /admin/api/errors?source=check.integrity` с INTEGRITY_MISMATCH · `check.token` за issue/list/revoke · ' +
        '`check.qr` с op=verify · `check.config` (ok и провал) · `check.key` при смяна на ключа',
    );
  } finally {
    await server.stop();
    fs.rmSync(storage.dir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL check-log-integration: ' + error.message);
  process.exitCode = 1;
});
