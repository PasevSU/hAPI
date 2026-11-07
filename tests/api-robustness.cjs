'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ ЗА ЦЯЛАТА АДМИНИСТРАТИВНА ПОВЪРХНОСТ: грешен вход не е „счупен сървър“.
//
// Защо е отделен от `api-input-errors.cjs`: онзи проверява 23 ръчно избрани входа,
// този обхожда ВСЕКИ маршрут от договора (`admin-api-spec.ROUTES`) с пет вида тяло.
// Така нов маршрут се проверява автоматично, без някой да се сети да добави ред.
//
// Намереното при първото пускане (0.69.195): тяло `null` — валиден JSON — връщаше
// **500** на 29 маршрута, защото `parse()` го подаваше нататък и `null.field` е
// TypeError. Отделно `GET /admin/api/evidence/assignments` отговаряше 500 заради
// мъртъв ред, който четеше `db.cases.users` при липсваща колекция.
//
// Правила:
//   • 5xx е провал; 503 е умислен отказ и се позволява;
//   • в отговор с ГРЕШКА не бива да изтича абсолютен път или стек (успешните отговори
//     на административните маршрути законно показват папки — панелът ги рисува).
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const { startServer } = require('./lib/gui-harness.cjs');
const spec = require('../hapi_enterprise/admin-api-spec.js');

const DUMMY = 'probe-id';
const BODIES = ['{}', '[]', 'null', 'not-json', '{"x":1}'];
// Скъпи/разрушителни пътища и безкрайни потоци: тестваме ВХОДА, не архивирането.
const SKIP = [
  '/admin/api/database/restore', '/admin/api/database/backup', '/admin/api/database/backups/verify',
  '/admin/api/storage/check', '/admin/api/storage/mirror/verify', '/admin/api/retention',
  '/admin/api/rules/reload', '/admin/api/evidence-portal/deploy', '/admin/api/objects/scan',
  '/admin/api/events/stream',
];
const LEAK = [/(^|[^a-zA-Z])\/(data|config|share|media|ssl)\//, /[A-Z]:\\/, /node_modules/, /\n\s+at\s+\w/, /\/home\/node/];

(async () => {
  const server = await startServer();
  const fiveHundred = [];
  const leaks = [];
  const open = [];
  let calls = 0;
  let anonymous = 0;
  try {
    for (const [method, rawPath] of spec.ROUTES) {
      if (SKIP.some((s) => rawPath.startsWith(s))) continue;
      const path = rawPath.replace(/\{[^}]+\}/g, DUMMY);

      // Без токен маршрутът НЕ бива да отговаря 2xx. Така успешните административни
      // отговори, които законно показват папки (`/rules`, `/diagnostics`, `/logs`,
      // `/generator/templates`, `/v2/rfc3161/verify`), не са изложени на никого.
      anonymous += 1;
      const anon = await fetch(server.base + path, {
        method: method === 'GET' || method === 'DELETE' ? method : 'POST',
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
        signal: AbortSignal.timeout(8000),
      });
      await anon.text();
      if (anon.status < 400 && anon.status !== 503) open.push(method + ' ' + path + ' → ' + anon.status);

      const bodies = method === 'GET' || method === 'DELETE' ? [undefined] : BODIES;
      for (const body of bodies) {
        calls += 1;
        const res = await server.authFetch(server.base + path, {
          method,
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(8000),
        });
        const text = await res.text();
        if (res.status >= 500 && res.status !== 503) fiveHundred.push(method + ' ' + path + ' · тяло=' + (body || '—') + ' → ' + res.status);
        if (res.status >= 400 && LEAK.some((re) => re.test(text))) leaks.push(method + ' ' + path + ' → ' + res.status + ' · ' + text.slice(0, 120));
      }
    }
  } finally {
    await server.stop();
  }
  assert.deepEqual(fiveHundred, [], 'грешен вход не бива да дава 5xx:\n  ' + fiveHundred.slice(0, 12).join('\n  '));
  assert.deepEqual(open, [], 'маршрут без токен не бива да отговаря 2xx:\n  ' + open.slice(0, 12).join('\n  '));
  assert.deepEqual(leaks, [], 'грешката не бива да изтича вътрешен път или стек:\n  ' + leaks.slice(0, 8).join('\n  '));
  console.log(
    'PASS api-robustness: ' + calls + ' заявки с тяло през ' + spec.ROUTES.length + ' маршрута · ' + anonymous + ' анонимни заявки без 2xx · 0 отговора 5xx · 0 изтекли пътища и стекове',
  );
})().catch((e) => {
  console.error('FAIL api-robustness:', e && e.message ? e.message : e);
  process.exit(1);
});
