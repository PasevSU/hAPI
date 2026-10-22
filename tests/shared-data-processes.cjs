'use strict';
// ОРАКУЛ: ЕДНИ И СЪЩИ ДАННИ ОТ ДВА РАЗЛИЧНИ ПРОЦЕСА.
//
// Два живи сървъра (различни портове, различни процеси) работят върху ЕДНА data директория.
// Проверяваме точно това, което досега не беше вярно:
//   • запис, направен в единия процес, се вижда в другия ВЕДНАГА, без рестарт;
//   • едновременни записи от двата процеса НЕ се губят (нито един портал не изчезва);
//   • ревизията расте точно с броя успешни записи;
//   • регистърът на участниците показва двама, докато и двата процеса са живи.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const instanceLock = require('../hapi_enterprise/instance-lock');

const SHARED = { HAPI_SHARED_DATA: '1' };

const health = async (server) => (await fetch(server.base + '/health')).json();
const titles = (list) => list.map((p) => p.title).sort();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-shared-'));
  const token = 'shared-' + crypto.randomBytes(18).toString('hex');
  const A = await startServer({ dataDir: dir, token, keepData: true, env: SHARED });
  const B = await startServer({ dataDir: dir, token, keepData: true, env: SHARED });
  try {
    assert.notEqual(A.child.pid, B.child.pid, 'това са ДВА различни процеса');
    assert.equal(A.dir, B.dir, 'и двата работят върху ЕДНА data директория');

    // ── 1. Регистърът на участниците: двама живи ─────────────────────────────
    const peers = instanceLock.listShared({ dir });
    assert.equal(peers.length, 2, 'регистърът вижда точно два живи процеса върху данните');
    assert.equal(peers.every((p) => Number.isInteger(Number(p.pid))), true, 'всеки участник има pid');

    // ── 2. Запис в А се вижда в Б без рестарт ────────────────────────────────
    const createdA = await A.api('/admin/api/portals', 'POST', { slug: 'ot-a', title: 'Направен в А', visibility: 'public' });
    assert.equal(createdA.status, 201, 'А създава портал');
    const listB = await B.api('/admin/api/portals');
    assert.equal(listB.status, 200, 'Б отговаря');
    assert.deepEqual(titles(listB.data.portals), ['Направен в А'], 'Б ВЕДНАГА вижда портала, създаден в А');
    assert.equal((await fetch(B.base + '/api/v1/p/ot-a')).status, 200, 'публичният адрес работи и през Б');

    // ── 3. Промяна в Б се вижда в А ──────────────────────────────────────────
    const patched = await B.api('/admin/api/portals/' + createdA.data.id, 'PATCH', { title: 'Преименуван в Б' });
    assert.equal(patched.status, 200, 'Б преименува портала');
    const listA = await A.api('/admin/api/portals');
    assert.deepEqual(titles(listA.data.portals), ['Преименуван в Б'], 'А вижда промяната, направена в Б');

    // ── 4. Едновременни записи: 10 през А и 10 през Б, без загуба ────────────
    const before = (await health(A)).shared.revision;
    const jobs = [];
    for (let i = 0; i < 10; i++) {
      jobs.push(A.api('/admin/api/portals', 'POST', { slug: 'a-' + i, title: 'А ' + i }));
      jobs.push(B.api('/admin/api/portals', 'POST', { slug: 'b-' + i, title: 'Б ' + i }));
    }
    const results = await Promise.all(jobs);
    const created = results.filter((r) => r.status === 201).length;
    assert.equal(created, 20, 'всичките 20 едновременни записа са приети (без 409/500)');

    const seenByA = await A.api('/admin/api/portals');
    const seenByB = await B.api('/admin/api/portals');
    const slugsA = seenByA.data.portals.map((p) => p.slug).sort();
    const slugsB = seenByB.data.portals.map((p) => p.slug).sort();
    assert.equal(slugsA.length, 21, 'А вижда 21 портала (1 + 20)');
    assert.deepEqual(slugsA, slugsB, 'двата процеса виждат ТОЧНО едно и също множество');
    assert.equal(new Set(slugsA).size, slugsA.length, 'няма дублирани портали');
    for (let i = 0; i < 10; i++) {
      assert.ok(slugsA.includes('a-' + i), 'порталът a-' + i + ' от А е запазен');
      assert.ok(slugsA.includes('b-' + i), 'порталът b-' + i + ' от Б е запазен');
    }

    // ── 5. Ревизията расте точно с успешните записи, а не „колкото пъти е опитано“ ─
    const afterA = (await health(A)).shared.revision;
    const afterB = (await health(B)).shared.revision;
    assert.equal(afterA, before + 20, 'ревизията е напред с точно 20 записа — без нито един излишен от повторение');
    assert.equal(afterB, afterA, 'двата процеса виждат ЕДНА и съща ревизия');

    // ── 6. Изтриване в единия се вижда в другия ──────────────────────────────
    const target = seenByA.data.portals.find((p) => p.slug === 'b-9');
    const deleted = await A.api('/admin/api/portals/' + target.id, 'DELETE');
    assert.equal(deleted.status, 200, 'А изтрива портала');
    const afterDelete = (await B.api('/admin/api/portals')).data.portals.map((p) => p.slug);
    assert.equal(afterDelete.includes('b-9'), false, 'Б вече не вижда изтрития портал');
    assert.equal((await fetch(B.base + '/api/v1/p/b-9')).status, 404, 'публичният адрес също е 404 през Б');

    // ── 7. След спиране на Б регистърът остава само с А ──────────────────────
    await B.stop({ keep: true });
    const remaining = instanceLock.listShared({ dir });
    assert.equal(remaining.length, 1, 'след спиране на Б остава точно един участник');
    assert.equal(Number(remaining[0].pid), A.child.pid, 'останалият е процесът А');

    // ── 8. А продължава да работи сам и данните са на място ──────────────────
    const soloCreate = await A.api('/admin/api/portals', 'POST', { slug: 'solo', title: 'След Б' });
    assert.equal(soloCreate.status, 201, 'А работи и след като Б спря');
    assert.equal((await A.api('/admin/api/portals')).data.portals.length, 21, 'А вижда 21 портала (изтрит е един, добавен е един)');

    console.log('PASS shared-data-processes: два процеса върху ЕДНИ данни · запис в единия се вижда в другия веднага · 20 едновременни записа без загуба · една и съща ревизия · регистърът на участниците се чисти');
  } finally {
    await A.stop({ keep: true }).catch(() => { });
    await B.stop({ keep: true }).catch(() => { });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
