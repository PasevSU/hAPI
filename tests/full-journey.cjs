'use strict';
// ПЪЛЕН ПЪТ (S01…S12): цялата логика в един сценарий, в реда, в който я изживява
// администраторът — от старт до изтриване на портала.
//
// Защо: 190 отделни теста могат да са зелени, а веригата между тях — счупена. Тук всяка
// стъпка зависи от предишната и се проверява ТОЧНИЯТ резултат (код, байтове, отпечатък).
// При провал съобщението казва кой етап е паднал; пускането е от начало (`test-matrix`
// рестартира файла при грешка), защото състоянието не се наследява между опитите.
//
//   S01 старт и готовност            S07 хранилище на API (api.json/openapi/qr)
//   S02 правила от config/rules      S08 пакет (ZIP) + отпечатък
//   S03 портал (скрит)               S09 бърз линк (Send-lite), еднократен
//   S04 папки и регистриран файл     S10 тайна връзка (zero-knowledge), еднократна
//   S05 публикуване и правила        S11 отчет: PDF + манифест + отпечатъци
//   S06 публична страница + QR       S12 одитна верига и изтриване
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const ROOT = path.join(__dirname, '..');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const svgFor = (text) => {
  const q = require('../hapi_enterprise/qrcode.js')(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
};

let current = 'S00';
const stage = async (name, fn) => {
  current = name;
  await fn();
  console.log('  ✔ ' + name);
};

(async () => {
  // Папка на портала: винаги под /share, както в контейнера. Използваме ТОЧНО пътя,
  // който сървърът ще сметне от виртуалния `/share` (на Windows това е <диск>:\share),
  // иначе сървърът гледа друга директория и „родителската папка липсва“.
  const shareBase = path.resolve('/share');
  try {
    fs.mkdirSync(shareBase, { recursive: true });
  } catch (e) {
    console.log(`SKIP full-journey: ${shareBase} не може да се създаде (${e.code || e.message})`);
    process.exit(0);
  }
  const storageDir = fs.mkdtempSync(path.join(shareBase, 'hapi-journey-'));
  const storageRoot = '/share/' + path.basename(storageDir);

  const server = await startServer({ keepData: true });
  const { api, authFetch, base } = server;
  const text = (file, body) =>
    authFetch(`${base}${file}`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent(body.name), 'X-File-Encrypt': '0' }, body: body.text });

  try {
    let portalId = '';
    let slug = 'journey';
    let fileId = '';
    let freeId = '';
    let landing = '';

    // ── S01: старт, готовност, авторизация ────────────────────────────────────────
    await stage('S01 старт · /health · /ready · /admin без токен = 401', async () => {
      assert.equal((await fetch(base + '/health')).status, 200);
      assert.equal((await fetch(base + '/ready')).status, 200);
      assert.equal((await fetch(base + '/admin/api/audit/verify')).status, 401, 'админ API без токен е 401');
    });

    // ── S02: правилата се четат от файловете ──────────────────────────────────────
    await stage('S02 правила · /export/rules = download_rules.json', async () => {
      const rules = await api('/admin/api/v2/export/rules');
      assert.equal(rules.status, 200);
      const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'rules', 'download_rules.json'), 'utf8'));
      assert.deepEqual(rules.data.download_rules, onDisk);
      const modes = rules.data.access.modes.map((m) => m.id);
      for (const m of ['FREE', 'KEY_REQUIRED', 'DISABLED']) assert.ok(modes.includes(m), 'липсва режим ' + m);
      const pre = await api('/admin/api/v2/export/preflight', 'POST', {});
      assert.equal(pre.status, 200, JSON.stringify(pre.data));
      assert.equal(typeof pre.data.packageId, 'string');
    });

    // ── S03: новият портал е скрит, докато не се публикува ────────────────────────
    await stage('S03 портал · създаване (private) · публично 404', async () => {
      const created = await api('/admin/api/portals', 'POST', {
        slug, title: 'Пълен път', description: 'Доказателства по дело.', storage_root: storageRoot,
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      portalId = created.data.id;
      landing = base + '/p/' + portalId;
      assert.equal(created.data.visibility, 'private');
      assert.equal((await fetch(`${base}/api/v1/p/${slug}`)).status, 404, 'скрит портал не се вижда публично');
      assert.equal((await fetch(landing)).status, 404, 'и страницата му не се отваря без токен');
    });

    // ── S04: папка, файл в нея, регистрация с път, коментар и заключване ──────────
    await stage('S04 папки · нова папка · качване · регистрация · коментар/флагове', async () => {
      const made = await api(`/admin/api/portals/${portalId}/tree/folder`, 'POST', { parent: '', name: 'dokazatelstva' });
      assert.equal(made.status, 201, JSON.stringify(made.data));
      assert.equal(made.value ?? made.data.path, '/dokazatelstva');

      const up = await authFetch(`${base}/admin/api/portals/${portalId}/tree/upload?path=${encodeURIComponent('/dokazatelstva/dogovor.txt')}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'съдържание на договора',
      });
      assert.equal(up.status, 201, await up.text());

      const reg = await api(`/admin/api/portals/${portalId}/tree/register`, 'POST', { path: '/dokazatelstva/dogovor.txt' });
      assert.equal(reg.status, 201, JSON.stringify(reg.data));
      fileId = reg.data.id;
      assert.equal(reg.data.storagePath, '/dokazatelstva/dogovor.txt', 'файлът помни папката си');
      assert.equal(reg.data.sha256, sha256('съдържание на договора'));

      const tree = await api(`/admin/api/portals/${portalId}/tree`);
      assert.equal(tree.data.folderCount, 1);
      assert.equal(tree.data.fileCount, 1);
      const folderApi = await api(`/admin/api/portals/${portalId}/tree/api.json?path=/dokazatelstva`);
      assert.equal(folderApi.status, 200);
      assert.equal(folderApi.data.kind, 'storage-folder');

      const comment = await api(`/admin/api/portals/${portalId}/tree/comment`, 'POST', { path: 'dokazatelstva', comment: 'Основни доказателства' });
      assert.equal(comment.data.notes['/dokazatelstva'].text, 'Основни доказателства');

      assert.equal((await api(`/admin/api/portals/${portalId}/tree/folder`, 'PATCH', { path: '/dokazatelstva', locked: true, reason: 'приключен етап' })).status, 200);
      const lockedUp = await authFetch(`${base}/admin/api/portals/${portalId}/tree/upload?path=${encodeURIComponent('/dokazatelstva/vtori.txt')}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x',
      });
      assert.equal(lockedUp.status, 409, 'заключената папка не приема файлове');
      assert.equal((await api(`/admin/api/portals/${portalId}/tree/folder`, 'PATCH', { path: '/dokazatelstva', locked: false })).status, 200);
    });

    // ── S05: публикуване и прилагане на правилата за достъп ───────────────────────
    await stage('S05 правила на живо · public · FREE/KEY/DISABLED', async () => {
      assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);
      assert.equal((await fetch(`${base}/api/v1/p/${slug}`)).status, 200);

      const dl = (headers = {}) => fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`, { headers });
      const free = await dl();
      assert.equal(free.status, 200);
      assert.equal(await free.text(), 'съдържание на договора');

      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'KEY_REQUIRED', reason: 'тест: ключ' })).status, 200);
      assert.equal((await dl()).status, 403, 'без ключ → 403');
      const key = await api(`/admin/api/portals/${portalId}/files/${fileId}/access-keys`, 'POST', {});
      assert.equal(key.status, 201);
      assert.equal((await dl({ 'X-File-Key': key.data.key })).status, 200, 'с ключ → 200');

      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'DISABLED', reason: 'тест: недостъпен' })).status, 200);
      assert.equal((await dl({ 'X-File-Key': key.data.key })).status, 403, 'DISABLED дори с ключ → 403');

      // Връщаме свободен достъп и качваме втори файл, който остава FREE за следващите стъпки.
      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'FREE' })).status, 200);
      const second = await text(`/admin/api/portals/${portalId}/files`, { name: 'izvestie.txt', text: 'втори файл' });
      assert.equal(second.status, 201);
      freeId = (await second.json()).id;
    });

    // ── S06: публичната страница и QR кодът ───────────────────────────────────────
    await stage('S06 страница · id/резюме/адреси · QR = SVG(/p/<id>)', async () => {
      const page = await fetch(landing);
      assert.equal(page.status, 200);
      const html = await page.text();
      for (const id of ['portal-id', 'summary', 'summary-list', 'qr', 'files']) assert.ok(html.includes(`id="${id}"`), 'липсва #' + id);
      const script = await (await fetch(`${base}/portal.js`)).text();
      for (const needle of ['paintSummary', 'downloadUrlFor', 'a.setAttribute("download"', 'withAuth(']) assert.ok(script.includes(needle), 'липсва ' + needle);

      const view = await (await fetch(`${base}/api/v1/p/${portalId}`)).json();
      assert.equal(view.id, portalId);
      assert.equal(view.urls.qrTarget, '/p/' + portalId);
      assert.equal(view.fileCount, 2, 'двата регистрирани файла');
      const qr = await (await fetch(`${base}/api/v1/p/${slug}/qr.svg`)).text();
      assert.equal(qr, svgFor(landing), 'qr.svg кодира точно страницата');
    });

    // ── S07: хранилището на API-то (api.json/openapi/qr) ──────────────────────────
    await stage('S07 API хранилище · api.json · qr остава към страницата', async () => {
      const gen = await fetch(`${base}/admin/api/v2/portals/${slug}/api`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(gen.status, 201, await gen.text());
      const dir = path.join(server.dir, 'api', slug);
      for (const f of ['api.json', 'openapi.json', 'qr.svg']) assert.ok(fs.existsSync(path.join(dir, f)), 'липсва ' + f);
      assert.equal(fs.readFileSync(path.join(dir, 'qr.svg'), 'utf8'), svgFor(landing), 'генерирането не обръща QR-а към JSON');
      const record = JSON.parse(fs.readFileSync(path.join(dir, 'api.json'), 'utf8'));
      assert.equal(record.links.landingUrl, landing);
    });

    // ── S08: пакет (ZIP) с точен отпечатък ────────────────────────────────────────
    await stage('S08 пакет · ZIP · sha256 на байтовете', async () => {
      const pkg = await api('/admin/api/packages', 'POST', { portalId });
      assert.equal(pkg.status, 201, JSON.stringify(pkg.data));
      const zip = Buffer.from(await (await fetch(`${base}/admin/api/packages/${pkg.data.id}/download`, {
        headers: { Authorization: 'Bearer ' + server.token },
      })).arrayBuffer());
      assert.equal(zip.subarray(0, 2).toString('latin1'), 'PK', 'това е ZIP');
      const meta = await api(`/admin/api/packages/${pkg.data.id}`);
      assert.equal(meta.status, 200);
      assert.equal(meta.data.sha256, sha256(zip), 'отпечатъкът в метаданните е на изтегления файл');
    });

    // ── S09: бърз линк (Send-lite) — еднократен достъп ────────────────────────────
    await stage('S09 бърз линк · страница · билет · байтове · втори опит 404', async () => {
      const created = await api(`/admin/api/portals/${portalId}/files/${freeId}/sends`, 'POST', { maxAccess: 1 });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.match(created.data.url, /\/s\/[A-Za-z0-9_-]+$/);

      const sendPath = new URL(created.data.url).pathname;
      assert.equal((await fetch(base + sendPath)).status, 200, 'страницата на линка се отваря');

      const access = await fetch(`${base}/api/v1/sends/${sendPath.split('/').pop()}/access`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const accessBody = await access.text();
      assert.equal(access.status, 200, accessBody);
      const ticket = JSON.parse(accessBody);
      const file = await fetch(base + ticket.url);
      assert.equal(file.status, 200);
      assert.equal(await file.text(), 'втори файл');

      const second = await fetch(`${base}/api/v1/sends/${sendPath.split('/').pop()}/access`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(second.status, 404, 'линкът е еднократен');
    });

    // ── S10: тайна връзка — сървърът вижда само плика ────────────────────────────
    await stage('S10 тайна връзка · създаване · състояние · разкриване · втори опит 404', async () => {
      const sl = require('../hapi_enterprise/secret-links');
      const frag = sl.newFragment();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(frag.key, 'base64url'), iv);
      const ct = Buffer.concat([cipher.update('тайна за получателя', 'utf8'), cipher.final(), cipher.getAuthTag()]);
      const envelope = { v: 2, iv: iv.toString('base64url'), ct: ct.toString('base64url') };

      const created = await api('/admin/api/v2/secrets', 'POST', { envelope, idHash: frag.idHash, max_views: 1, expires_in: 3600, hint: 'парола за архива' });
      assert.equal(created.status, 201, JSON.stringify(created.data));

      const state = await fetch(`${base}/api/v2/secrets/${frag.idHash}`);
      assert.equal(state.status, 200);
      const info = await state.json();
      assert.equal(info.remainingViews, 1);
      assert.equal(info.hint, 'парола за архива');

      const reveal = await fetch(`${base}/api/v2/secrets/${frag.idHash}/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(reveal.status, 200);
      const opened = await reveal.json();
      assert.equal(opened.envelope.ct, envelope.ct);
      assert.equal(opened.viewsLeft, 0);

      const again = await fetch(`${base}/api/v2/secrets/${frag.idHash}/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(again.status, 404, 'тайната е изчезнала след първия прочит');
    });

    // ── S11: отчет — PDF, манифест и двата отпечатъка ────────────────────────────
    await stage('S11 отчет · PDF · X-Manifest-SHA256 · X-PDF-SHA256', async () => {
      const M = require('../hapi_enterprise/report-manifest');
      const manifest = M.template();
      const res = await fetch(`${base}/admin/api/v2/reports/render`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + server.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest, createdAt: '2026-10-22T10:00:00Z' }),
      });
      const pdf = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 201, pdf.toString('utf8').slice(0, 300));
      assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
      assert.equal(res.headers.get('x-pdf-sha256'), sha256(pdf), 'отпечатъкът е на готовия PDF');
      assert.equal(res.headers.get('x-manifest-sha256'), M.digest(manifest), 'отпечатъкът на манифеста е същият');
    });

    // ── S12: одитната верига е валидна, после порталът се изтрива чисто ──────────
    await stage('S12 одит · verify valid · изтриване · 404 · api/ изчистена', async () => {
      const verify = await api('/admin/api/audit/verify');
      assert.equal(verify.status, 200, JSON.stringify(verify.data));
      assert.equal(verify.data.valid, true, 'веригата не е подправена');
      assert.ok(verify.data.count >= 10, 'има записи от целия път: ' + verify.data.count);

      assert.equal((await api(`/admin/api/portals/${portalId}`, 'DELETE')).status, 200);
      assert.equal((await fetch(landing)).status, 404, 'страницата вече не съществува');
      assert.equal(fs.existsSync(path.join(server.dir, 'api', slug)), false, 'api/ директорията е изчистена');
    });

    console.log('PASS full-journey: S01…S12 — от старт до изтриване, с точни кодове, байтове и отпечатъци');
  } catch (e) {
    console.error(`\n✘ ПРОВАЛ в ${current}: ${e && e.message ? e.message : e}\n`);
    throw e;
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(storageDir, { recursive: true, force: true }); } catch { /* Windows може да държи файла */ }
    try { fs.rmSync(server.dir, { recursive: true, force: true }); } catch { /* същото */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
