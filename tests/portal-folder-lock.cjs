'use strict';
// ЗАКЛЮЧЕНА ПАПКА — и наследяването към подпапките (през истинския сървър).
//
// Защо съществува: `lockedAncestor` в `server.js` обикаля ВСИЧКИ префикси на пътя
// (`for (let i = 0; i <= parts.length; i++)`), тоест трябва да хване и непосредствената
// родителска папка, и всеки по-горен предшественик. Точно този `<=` изглежда като off-by-one
// и беше приет като находка в логическия одит — затова тук се проверява поведението, а не
// формата на цикъла:
//   • ключ на непосредствената папка (последната итерация) заключва качването в нея;
//   • ключ на ДЯДОТО заключва качването в подпапка (наследяване);
//   • съседна незаключена папка не е засегната;
//   • след отключване качването минава.
//
// Ако цикълът беше `i < parts.length`, втората и третата проверка щяха да минат, но ПЪРВАТА
// (заключената непосредствена папка) щеше да пропусне файла — тоест точно тази, която
// заключването на папка би трябвало да пази.
const assert = require('node:assert/strict');
const { startServer } = require('./lib/gui-harness.cjs');

const cases = [];
const ok = (label) => cases.push(label);

(async () => {
  const server = await startServer();
  const slug = 'lock-' + Date.now().toString(36);
  try {
    const api = async (p, method = 'GET', bodyJson, raw) => {
      const res = await server.authFetch(server.base + p, {
        method,
        headers: raw === undefined
          ? (bodyJson === undefined ? {} : { 'content-type': 'application/json' })
          : { 'content-type': 'text/plain' },
        body: raw !== undefined ? raw : (bodyJson === undefined ? undefined : JSON.stringify(bodyJson)),
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data };
    };

    const portal = (await api('/admin/api/portals', 'POST', { slug, title: 'Заключена папка', visibility: 'public' })).data;
    assert.ok(portal && portal.id, 'порталът е създаден');
    const base = '/admin/api/portals/' + portal.id + '/tree';
    const mkdir = (parent, name) => api(base + '/folder', 'POST', { parent, name });
    assert.equal((await mkdir('', 'A')).status, 201, 'папка A');
    assert.equal((await mkdir('A', 'B')).status, 201, 'подпапка A/B');
    assert.equal((await mkdir('', 'C')).status, 201, 'съседна папка C');

    const upload = (rel) => api(base + '/upload?path=' + encodeURIComponent(rel), 'POST', undefined, 'съдържание');
    const lock = (rel, locked, reason) => api(base + '/folder', 'PATCH', { path: rel, locked, reason });

    // ── 1. Заключена НЕПОСРЕДСТВЕНА папка спира качването в нея ──────────────
    assert.equal((await lock('A/B', true, 'печат на дело')).status, 200, 'A/B е заключена');
    const direct = await upload('A/B/файл.txt');
    assert.equal(direct.status, 409, 'качване в заключената папка се отказва, получено: ' + direct.status);
    assert.match(String(direct.data && direct.data.error), /заключена/, 'съобщението казва причината');
    ok('заключена непосредствена папка → качването е отказано (409)');

    // ── 2. Заключен РОДИТЕЛ спира качването в подпапка (наследяване) ────────
    assert.equal((await lock('A/B', false)).status, 200, 'A/B е отключена');
    assert.equal((await lock('A', true, 'цялото дело')).status, 200, 'A е заключена');
    const nested = await upload('A/B/файл.txt');
    assert.equal(nested.status, 409, 'наследеното заключване също отказва, получено: ' + nested.status);
    assert.match(String(nested.data && nested.data.error), /\/A/, 'съобщението сочи КОЯ папка е заключена');
    ok('заключен родител → качването в подпапка се отказва (наследяване)');

    // ── 3. Съседна незаключена папка не е засегната ─────────────────────────
    const sibling = await upload('C/файл.txt');
    assert.equal(sibling.status, 201, 'в C качването минава, получено: ' + sibling.status);
    ok('съседна незаключена папка не е засегната');

    // ── 4. След отключване качването минава ─────────────────────────────────
    assert.equal((await lock('A', false)).status, 200, 'A е отключена');
    const afterUnlock = await upload('A/B/файл.txt');
    assert.equal(afterUnlock.status, 201, 'след отключване качването минава, получено: ' + afterUnlock.status);
    ok('след отключване качването минава');

    console.log('PASS portal-folder-lock: ' + cases.length + ' проверки — ' + cases.join('; '));
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
