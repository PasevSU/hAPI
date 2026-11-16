'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: отказът за огромно тяло (413) не бива да оставя отровена връзка.
//
// Дефектът: `body()` четеше заявката с `for await (const chunk of req)` и хвърляше
// веднага щом размерът мине лимита. Изходът от асинхронния итератор унищожава сокета,
// тоест 413 се пише върху половин затворена връзка. Самият отказ ДОСТИГА до клиента
// (затова първата проверка по-долу минава и със стария код), но връзката остава в пула
// на клиента в невъзможно състояние: следващата заявка, която я преизползва, чака
// отговор, който никога не идва. `blackbox-security` висеше безкрайно точно така — на
// кирилски GET веднага след 413, а не на самото огромно тяло.
//
// Затова тук има ТАВАН 5 s на всяка заявка: регресията пада с ясно съобщение, вместо да
// блокира цялата матрица.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, waitHealthy, stopChild } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'oversize-body-token-4f1c8a62d95b07e3';
const BUDGET_MS = 5000;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-oversize-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: TOKEN, PUBLIC_GATEWAY_PORT: '0' },
    stdio: 'ignore',
  });

  try {
    await waitHealthy(child, base);

    // 300 KB в маршрут с лимит 64 KB: тялото се отхвърля още в средата на изпращането.
    const huge = JSON.stringify({ slug: 'x'.repeat(300000), title: 't' });
    const started = Date.now();
    let res;
    try {
      res = await fetch(base + '/admin/api/portals', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        body: huge,
        signal: AbortSignal.timeout(BUDGET_MS),
      });
    } catch (e) {
      throw new Error(
        `отказът не стигна до клиента за ${BUDGET_MS} ms (${e.name}: ${e.message}) — ` +
        'сокетът е унищожен, преди 413 да излезе; чети тялото със слушатели, не с for await',
        { cause: e },
      );
    }
    const elapsed = Date.now() - started;
    await res.text();
    assert.ok(res.status >= 400 && res.status < 500, `огромно тяло → 4xx (получено ${res.status})`);
    assert.ok(elapsed < BUDGET_MS, `отказът идва веднага, не след чакане (${elapsed} ms)`);

    // Сървърът не бива да плаща за отказа: след него нормална заявка минава.
    const after = await fetch(base + '/health', { signal: AbortSignal.timeout(BUDGET_MS) });
    assert.equal(after.status, 200, 'след отказа сървърът продължава да обслужва');
    assert.equal(child.exitCode, null, 'сървърът не е приключил');

    // Същината на дефекта: заявка по ПРЕИЗПОЛЗВАНА връзка след 413 не бива да виси.
    // Пътят е с кирилица, защото точно такъв висеше в `blackbox-security`.
    let next;
    try {
      next = await fetch(base + '/admin/api/portals/' + encodeURIComponent('несъществуващ'), {
        headers: { Authorization: 'Bearer ' + TOKEN },
        signal: AbortSignal.timeout(BUDGET_MS),
      });
    } catch (e) {
      throw new Error(
        `заявката СЛЕД 413 виси (${e.name}: ${e.message}) — отказът е унищожил сокета, ` +
        'вместо да бъде изчерпан; чети тялото със слушатели, не с for await',
        { cause: e },
      );
    }
    assert.equal(next.status, 404, 'липсващ ресурс след 413 → 404, не мълчание');
    await next.text();

    console.log(`PASS oversize-body: 413 за 300 KB за ${elapsed} ms · следващата заявка по същата връзка отговаря`);
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAIL oversize-body:', e.message); process.exitCode = 1; });
