'use strict';
// ОРАКУЛ: панелът се зарежда ПРЕЗ INGRESS — документът и всичките му относителни ресурси.
//
// Дефектът от 0.69.19: коренът на ingress-а (`/api/hassio_ingress/<token>`) сервираше
// `ui/index.html` направо, но този HTML ползва ОТНОСИТЕЛНИ адреси (`styles.css`,
// `bootstrap.js`, `app.js`, …). От корена браузърът ги търси на `<ingress>/styles.css` —
// път, който не съществува, защото статиката е само под `/ui/`. Резултатът беше панел
// без стилове и без скриптове: празен екран в Home Assistant.
//
// Затова тук се проверява точният резултат:
//   • коренът пренасочва към `<ingress>/ui/` (302) — и когато пътят е в URL-а, и когато
//     HA е подал само `X-Ingress-Path`;
//   • пренасочването ЗАПАЗВА ingress префикса (иначе браузърът излиза извън add-on-а);
//   • ВСЕКИ относителен `src`/`href` от документа се зарежда с 200 от крайния адрес;
//   • старият „празен“ адрес `<ingress>/styles.css` вече не е нужен, за да работи панелът.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopChild } = require('./helpers.cjs');

const INGRESS = '/api/hassio_ingress/panel-token_9f2c';
const pub = 18399;
const adm = 18398;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ingress-panel-'));
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: 'ingress-panel-secret-4a7f19c2b8e5d3', PORT: String(pub), ADMIN_PORT: String(adm), INGRESS_MODE: 'true' },
    stdio: 'pipe',
  });
  const base = `http://127.0.0.1:${adm}`;
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${pub}/health`)).ok) { ready = true; break } } catch { /* още стартира */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert(ready, 'сървърът не стартира');

    // 1. Коренът на ingress-а пренасочва към /ui/, запазвайки префикса.
    const root = await fetch(base + INGRESS, { redirect: 'manual' });
    assert.equal(root.status, 302, 'коренът на ingress-а трябва да пренасочи, а не да сервира HTML');
    assert.equal(root.headers.get('location'), INGRESS + '/ui/', 'пренасочването губи ingress префикса');

    // 2. Същото, когато HA е подал пътя вече отрязан и само със заглавка.
    const viaHeader = await fetch(base + '/', { redirect: 'manual', headers: { 'X-Ingress-Path': INGRESS } });
    assert.equal(viaHeader.status, 302, 'корен със X-Ingress-Path трябва да пренасочи');
    assert.equal(viaHeader.headers.get('location'), INGRESS + '/ui/', 'пренасочването без префикс води извън add-on-а');

    // 3. Документът от крайния адрес и ВСЕКИ негов относителен ресурс.
    const doc = await fetch(base + INGRESS + '/ui/');
    assert.equal(doc.status, 200, 'документът на панела не се зарежда');
    assert.equal(doc.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await doc.text();
    assert.match(html, /Enterprise Control Center/, 'сервира се друг документ');

    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((r) => !/^(?:https?:|data:|#)/.test(r));
    assert(refs.length >= 10, 'документът трябва да сочи поне 10 ресурса, намерени: ' + refs.length);
    const broken = [];
    for (const ref of refs) {
      const target = new URL(ref, `http://x${INGRESS}/ui/`).pathname;
      const res = await fetch(base + target);
      if (res.status !== 200) broken.push(`${res.status} ${target}`);
    }
    assert.deepEqual(broken, [], 'ресурсите на панела не се зареждат през ingress: ' + broken.join(', '));

    // 4. Правилото зад дефекта: документът НЕ се сервира от корена на ingress-а.
    assert.equal((await fetch(base + INGRESS + '/', { redirect: 'manual' })).status, 302, 'коренът на ingress-а отново сервира HTML вместо да пренасочи');

    console.log(
      'PASS ingress-panel-load: коренът пренасочва към <ingress>/ui/ (с префикс) · документът 200 · ' +
      refs.length + '/' + refs.length + ' ресурса заредени'
    );
  } finally {
    await stopChild(child).catch(() => { });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
