'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
// §FILE_CONTRACT (§6 от HAPI-ARCH-API-001): договорът `file` е САМОСТОЯТЕЛНА страница за
// един файл. Тестът пази точно това, което спецификацията изисква, а не „има страница“:
//   • не зарежда цялата папка на портала (другите имена НЕ се появяват в HTML-а);
//   • показва доказателствата: размер, SHA-256, Content ID и в коя QR ревизия/манифест влиза;
//   • същите проверки за достъп и път като при изтегляне (traversal, скрита папка, чужд портал);
//   • влиза се и с `?file=`, и с `:папка/път` (донорският формат), с еднакъв резултат.
const shareRoot = path.resolve('/share');

(async () => {
  const server = await startServer();
  const slug = 'file-page-' + Date.now().toString(36);
  const folder = path.join(shareRoot, slug);
  try {
    const call = async (p, method = 'GET', bodyJson) => {
      const res = await server.authFetch(server.base + p, {
        method,
        headers: bodyJson === undefined ? {} : { 'content-type': 'application/json' },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
      return { status: res.status, text: await res.text() };
    };
    const created = await call('/admin/api/portals', 'POST', { slug, title: 'Договор file', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава');
    const id = JSON.parse(created.text).id;
    fs.mkdirSync(path.join(folder, 'тема'), { recursive: true });
    const body = 'съдържание на договора';
    fs.writeFileSync(path.join(folder, 'документ.txt'), body);
    fs.writeFileSync(path.join(folder, 'тема', 'друг.txt'), 'втори файл, който НЕ бива да се показва');
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, 'документ.txt'))).digest('hex');

    // ── 1. Страницата съществува и носи доказателствата ─────────────────────
    const page = await call(`/file.html?file=${encodeURIComponent(slug + '/документ.txt')}`);
    assert.equal(page.status, 200, 'страницата се отваря: ' + page.text.slice(0, 160));
    assert.match(page.text, /документ\.txt/, 'показва името на файла');
    assert.match(page.text, new RegExp(sha), 'показва пълния SHA-256 на файла');
    assert.match(page.text, /Content ID/, 'показва Content ID');
    assert.match(page.text, new RegExp(`/api/v1/p/${slug}/tree/file\\?path=`), 'дава адрес за изтегляне през контролирания маршрут');
    assert.match(page.text, /Само един файл|само един файл/i, 'казва, че не зарежда папката');

    // ── 2. Другите файлове НЕ се показват (договорът не зарежда папката) ────
    assert.equal(/друг\.txt/.test(page.text), false, 'вторият файл не се споменава');
    assert.equal(/тема\//.test(page.text), false, 'подпапката не се споменава');

    // ── 3. Същият резултат и в донорския формат `:папка/път` ────────────────
    const colon = await call('/file.html:' + slug + '/' + encodeURIComponent('документ.txt'));
    assert.equal(colon.status, 200, 'двоеточият вид работи');
    assert.match(colon.text, new RegExp(sha), 'същите доказателства и там');

    // ── 4. Публикуван във QR: страницата казва в коя ревизия и манифест ─────
    const archived = await call(`/admin/api/portals/${id}/qr/archive`, 'POST', { note: 'за file договора' });
    assert.equal(archived.status, 201, 'архивирането минава');
    const published = await call(`/file.html?file=${encodeURIComponent(slug + '/документ.txt')}`);
    assert.equal(published.status, 200);
    assert.match(published.text, /QR-001/, 'показва ревизията, в която файлът е публикуван');
    assert.match(published.text, /MF-QR-001/, 'показва манифеста');

    // ── 5. Същите проверки за достъп като при изтегляне ─────────────────────
    for (const bad of [`${slug}/../извън.txt`, `${slug}/тема/../../f.txt`, `${slug}/`, '../share']) {
      const res = await call(`/file.html?file=${encodeURIComponent(bad)}`);
      assert.ok([400, 404].includes(res.status), 'невалиден път се отказва: ' + bad + ' → ' + res.status);
    }
    assert.equal((await call('/file.html?file=' + encodeURIComponent('няма-такъв-портал/файл.txt'))).status, 404, 'непознат портал → 404');
    assert.equal((await call(`/file.html?file=${encodeURIComponent(slug + '/липсва.txt')}`)).status, 404, 'липсващ файл → 404');

    const hidden = await call(`/admin/api/portals/${id}/tree/folder`, 'PATCH', { path: '/тема', visible: false });
    assert.equal(hidden.status, 200, 'флагът на папката се задава: ' + hidden.text.slice(0, 120));
    assert.equal((await call(`/file.html?file=${encodeURIComponent(slug + '/тема/друг.txt')}`)).status, 404, 'файл в скрита папка не се показва');

    console.log('portal-file-page OK: договорът `file` — един файл · SHA-256 · Content ID · QR-001/MF-QR-001 · traversal и скрита папка → 404');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
    if (server.stop) await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1) });
