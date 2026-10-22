'use strict';
// ОРАКУЛ: заливка от няколко процеса ВЪРХУ ПРАЗНА база (най-лошият случай).
//
// Точно тук се криеха два реални дефекта, намерени при задълбочената проверка:
//   1. изчакването при конфликт беше СЛЕД вземането на базата — тоест всеки опит си
//      гарантираше нов сблъсък и при заливка опитите се изчерпваха (503);
//   2. сливането при ПРАЗНА база падаше към „печели нашето“ и изхвърляше чуждия запис —
//      първите записи на втория и третия процес тихо изчезваха.
// Затова тук се проверява точният резултат: всички заявки приети, всички записи налични
// във ВСЕКИ процес, ревизията напред с точно броя записи.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const PROCESSES = 3;
const PER_PROCESS = 15;
const TOTAL = PROCESSES * PER_PROCESS;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-burst-'));
  const token = 'burst-' + crypto.randomBytes(18).toString('hex');
  const servers = [];
  try {
    for (let i = 0; i < PROCESSES; i++) {
      servers.push(await startServer({ dataDir: dir, token, keepData: true, env: { HAPI_SHARED_DATA: '1' } }));
    }
    const revisionOf = async (server) => (await (await fetch(server.base + '/health')).json()).shared.revision;
    assert.equal(await revisionOf(servers[0]), 0, 'базата е празна преди заливката');

    // Заливка: всички процеси пишат ЕДНОВРЕМЕННО, без никаква начална база.
    const jobs = [];
    for (let i = 0; i < PER_PROCESS; i++) {
      for (const [n, server] of servers.entries()) jobs.push({ slug: 'p' + n + '-' + i, promise: server.api('/admin/api/portals', 'POST', { slug: 'p' + n + '-' + i, title: 'P' + n + '-' + i }) });
    }
    const results = await Promise.all(jobs.map((job) => job.promise));

    const refused = results.filter((r) => r.status !== 201);
    assert.equal(refused.length, 0, 'нито една заявка не е отказана (няма 409/500/503): ' + refused.slice(0, 3).map((r) => r.status + ' ' + JSON.stringify(r.data)).join(' | '));

    // Всеки процес трябва да види ВСИЧКИ записи, не само своите.
    for (const [n, server] of servers.entries()) {
      const list = await server.api('/admin/api/portals');
      const slugs = list.data.portals.map((p) => p.slug);
      assert.equal(slugs.length, TOTAL, 'процес ' + n + ' вижда всичките ' + TOTAL + ' портала');
      assert.equal(new Set(slugs).size, TOTAL, 'процес ' + n + ' не вижда дубликати');
      for (const job of jobs) assert.ok(slugs.includes(job.slug), 'процес ' + n + ' вижда ' + job.slug);
    }

    // Ревизията е напред с точно броя записи (без излишни от повторени опити).
    const revisions = [];
    for (const server of servers) revisions.push(await revisionOf(server));
    assert.deepEqual(revisions, [TOTAL, TOTAL, TOTAL], 'всички процеси отчитат ревизия ' + TOTAL);

    // Дискът съдържа същото — без „приети, но забравени“ записи.
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(onDisk.portals.length, TOTAL, 'в базата на диска са всичките ' + TOTAL);

    console.log('PASS shared-data-burst: ' + PROCESSES + ' процеса × ' + PER_PROCESS + ' едновременни записа върху ПРАЗНА база · 0 отказа · ' + TOTAL + '/' + TOTAL + ' налични във всеки процес · ревизия ' + TOTAL + ' · без загубени записи');
  } finally {
    for (const server of servers) await server.stop({ keep: true }).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
