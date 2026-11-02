'use strict';
// 0.69.102 — ПАПКАТА НА ПОРТАЛА ТРЯБВА ДА СЕ ОТВАРЯ САМА.
//
// Човекът, който държи документите си в `/share/USB/hapi/data/`, отваря точно тази папка в
// Home Assistant. Дотук там имаше само неговите файлове: `portal.html`, `api.json` и
// `openapi.json` се записваха САМО в служебната директория на add-on-а (`data/api/<slug>/`),
// тоест папката нямаше страница и не можеше да се отвори сама.
//
// Проверява се РЕАЛНАТА дълбочина на пътя (`/share/USB/hapi/data/<уникална>`), че файловете
// се обновяват при промяна на портала, че живата връзка в страницата води до портала (там се
// зареждат и подпапките) и че общ корен (`/share`) НЕ се пипа — иначе един портал би сложил
// своята страница до папките на всички останали.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const portalFolder = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-folder.js'));

const NAME = 'hapi-folder-test-' + process.pid.toString(36);
// `/share` е абсолютен път в add-on-а: на Linux е `/share`, на Windows — `<диск>:\share`.
// Тестът го строи от диска на работната папка, а не с твърдо „D:“ — иначе в CI пада.
const shareRoot = path.join(path.parse(process.cwd()).root, 'share');
const DIR = path.join(shareRoot, 'USB', 'hapi', 'data', NAME);
const REL = '/share/USB/hapi/data/' + NAME;
const DOC = 'съдържание на анекса';

const clean = () => fs.rmSync(DIR, { recursive: true, force: true });

(async () => {
  clean();
  try {
    fs.mkdirSync(path.join(DIR, 'Договори 2026'), { recursive: true });
  } catch (e) {
    console.log(`SKIP portal-folder-artifacts: ${shareRoot} не може да се създаде (${e.code || e.message}) — липсва /share`);
    process.exit(0);
  }
  fs.writeFileSync(path.join(DIR, 'Договори 2026', 'анекс.txt'), DOC);
  const server = await startServer();
  try {
    // ── 0. Общ корен не се пипа (гаранцията, а не надеждата) ─────────────────
    for (const root of ['/share', '/media', '']) {
      const written = await portalFolder.writeArtifacts({ id: 'x', slug: 'x', storage_root: root }, '');
      assert.deepEqual(written, [], 'общ корен „' + (root || '(празен)') + '“ НЕ получава файлове на портал');
    }

    // ── 1. Портал в дълбока папка, точно като на човека ──────────────────────
    const created = await server.api('/admin/api/portals', 'POST', {
      slug: 'newportal2b',
      title: 'newportal2b',
      visibility: 'public',
      storage_root: REL,
    });
    assert.equal(created.status, 201, 'порталът се създава в /share/USB/hapi/data: ' + created.status);
    const portal = created.data.v || created.data;
    assert.equal(portal.storage_root, REL, 'порталът помни ТОЧНО тази папка');

    const present = fs.readdirSync(DIR).sort();
    for (const name of ['api.json', 'openapi.json', 'portal.html']) {
      assert.ok(present.includes(name), `в папката на портала липсва ${name} (има: ${present.join(', ')})`);
    }
    assert.ok(present.includes('Договори 2026'), 'документите на човека са си на място');

    // ── 2. portal.html е истинска страница с жива връзка ─────────────────────
    const pageFile = path.join(DIR, 'portal.html');
    const html = fs.readFileSync(pageFile, 'utf8');
    assert.match(html, /^<!doctype html>/i, 'portal.html е валиден HTML документ');
    assert.ok(html.includes('newportal2b'), 'страницата носи името на портала');
    assert.ok(html.includes('/p/' + portal.id), 'страницата сочи ЖИВИЯ портал (там се зареждат папките): ' + portal.id);

    // ── 3. api.json в папката е СЪЩИЯТ документ, който API-то сервира ────────
    const served = await (await fetch(`${server.base}/api/v1/p/newportal2b/api.json`)).json();
    const inFolder = JSON.parse(fs.readFileSync(path.join(DIR, 'api.json'), 'utf8'));
    const stable = (value) => ({ ...value, updatedAt: '' });
    assert.deepEqual(stable(inFolder), stable(served), 'копието в папката не се разминава със сервираното');
    const openapi = JSON.parse(fs.readFileSync(path.join(DIR, 'openapi.json'), 'utf8'));
    assert.equal(openapi.openapi, '3.1.0', 'договорът в папката е OpenAPI 3.1');

    // ── 4. Папките се зареждат: списъкът вижда подпапката и файла ────────────
    const tree = await (await fetch(`${server.base}/api/v1/p/newportal2b/tree?path=/`)).json();
    assert.equal((tree.folders || []).some((f) => f.name === 'Договори 2026'), true,
      'живата страница вижда подпапката: ' + JSON.stringify(tree.folders));
    const nested = await (await fetch(`${server.base}/api/v1/p/newportal2b/tree/api.json?path=/Договори 2026`)).json();
    const entry = (nested.files || [])[0];
    assert.ok(entry && entry.url, 'файлът в подпапката има адрес');
    const download = await fetch(entry.url);
    assert.equal(download.status, 200, 'адресът сваля файла: ' + download.status);
    assert.equal(await download.text(), DOC, 'съдържанието е точното');

    // ── 5. Промяна на портала обновява страницата в папката ──────────────────
    const rename = await server.api(`/admin/api/portals/${portal.id}`, 'PATCH', { title: 'Договори по дело 2026' });
    assert.equal(rename.status, 200, 'заглавието се сменя: ' + rename.status);
    const updated = fs.readFileSync(pageFile, 'utf8');
    assert.ok(updated.includes('Договори по дело 2026'), 'страницата в папката е обновена, не е стар запис');
    assert.ok(updated.includes('/p/' + portal.id), 'живата връзка остава');

    // ── 6. Смяна на папката: новата получава файловете, старата НЕ остава с чужда карта ──
    // Иначе в старата папка лежи `portal.html` с адрес към портал, който вече живее другаде:
    // документ, който изглежда валиден и лъже. Документите на човека НЕ се пипат.
    const second = path.join(shareRoot, 'hapi-folder-test-2-' + process.pid.toString(36));
    fs.mkdirSync(second, { recursive: true });
    try {
      fs.writeFileSync(path.join(second, 'втори.txt'), 'документ в новата папка');
      const moved = await server.api(`/admin/api/portals/${portal.id}`, 'PATCH', {
        storage_root: '/share/' + path.basename(second),
      });
      assert.equal(moved.status, 200, 'папката се сменя: ' + moved.status + ' ' + JSON.stringify(moved.data).slice(0, 120));
      for (const name of ['portal.html', 'api.json', 'openapi.json']) {
        assert.ok(fs.existsSync(path.join(second, name)), 'новата папка получава ' + name);
        assert.equal(fs.existsSync(path.join(DIR, name)), false, 'старата папка НЕ остава с ' + name);
      }
      assert.ok(fs.existsSync(path.join(DIR, 'Договори 2026', 'анекс.txt')), 'документът в старата папка е НЕПОКЪТНАТ');

      // ── 7. Изтриване на портала: генерираните файлове изчезват, документите остават ──
      const removed = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}`, { method: 'DELETE' });
      assert.equal(removed.status, 200, 'порталът се изтрива: ' + removed.status);
      await removed.arrayBuffer();
      for (const name of ['portal.html', 'api.json', 'openapi.json']) {
        assert.equal(fs.existsSync(path.join(second, name)), false, 'след изтриване в папката не остава ' + name);
      }
      assert.ok(fs.existsSync(path.join(second, 'втори.txt')), 'документът в новата папка е НЕПОКЪТНАТ');
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }

    console.log(`portal-folder-artifacts OK: /share/USB/hapi/data/<папка> получава portal.html + api.json + openapi.json до документите · страницата сочи живия портал (/p/${portal.id.slice(0, 6)}…) · обновява се при промяна · подпапката и файлът ѝ се зареждат · общ корен не се пипа · смяна на папката и изтриване не оставят чужда карта, документите остават`);
  } finally {
    await server.stop();
    clean();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
