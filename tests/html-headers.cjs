'use strict';
// ВСЕКИ HTML ОТГОВОР НОСИ `Referrer-Policy: no-referrer` (0.69.225).
//
// Защо има тест: адресите на портала и на файловете носят подпис в заявката
// (`?expires=…&sig=…`), а тайните връзки са `/t/<токен>`. Ако страница поиска външен ресурс
// (или потребителят последва външен линк), браузърът по подразбиране изпраща ПЪЛНИЯ адрес в
// `Referer` — тоест подписът или токенът излиза навън. Затова заглавката е част от договора
// на всяка HTML страница, не „хубаво допълнение“.
//
// Дотук тя се слагаше на 15 места в `server.js`, но точно четири HTML отговора я нямаха:
// началната страница на add-on-а, статичните файлове на панела и ДВАТА клона на прегледа на
// HTML (последните два са точно страниците, които могат да се отворят със подписан адрес).
//
//   §1 статично: всеки `text/html` отговор в сървъра и компонентите има заглавката;
//   §2 живо: истинският сървър я връща на `/` и на страницата на тайна връзка.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { auditText } = require(path.join(__dirname, '..', 'scripts', 'audit-html-headers.cjs'));
const { startServer } = require('./lib/gui-harness.cjs');

const root = path.join(__dirname, '..');
const files = [
  path.join(root, 'hapi_enterprise', 'server.js'),
  ...fs.readdirSync(path.join(root, 'hapi_enterprise', 'server_module')).map((f) => path.join(root, 'hapi_enterprise', 'server_module', f)),
  ...fs.readdirSync(path.join(root, 'hapi_enterprise', 'routes')).map((f) => path.join(root, 'hapi_enterprise', 'routes', f)),
].filter((f) => f.endsWith('.js'));

// ── 1. Статично: няма HTML отговор без заглавката ───────────────────────────
const gaps = [];
let htmlResponses = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  let at = -1;
  while ((at = text.indexOf('text/html', at + 1)) >= 0) {
    const before = text.slice(Math.max(0, at - 240), at);
    const after = text.slice(at, at + 900);
    // Таблица с разширения (`'.html': 'text/html; …'`) не е отговор.
    if (/mime\[|'\.[a-z]+':\s*$|:\s*'text\/html; charset=utf-8',\s*'\./.test(before)) continue;
    if (!/writeHead|setHeader/.test(before + after)) continue;
    htmlResponses += 1;
    if (!/Referrer-Policy/.test(after)) {
      gaps.push(path.relative(root, file).split(path.sep).join('/') + ':' + text.slice(0, at).split('\n').length);
    }
  }
}
assert.deepEqual(gaps, [], 'HTML отговор без `Referrer-Policy: no-referrer` (подписан адрес изтича през Referer): ' + gaps.join(', '));
assert.ok(htmlResponses >= 4, 'намерени са поне четири HTML отговора (днес: ' + htmlResponses + ')');

// ── 1б. Не само Referrer-Policy: целият набор, през един проверяващ (0.69.225) ──
// Горе се гледа една заглавка. Измерено при добавянето на `scripts/audit-html-headers.cjs`:
// от 12 HTML отговора 11 носеха пълния набор, а началната страница нямаше `Cache-Control`
// (тоест можеше да остане в кеша на прокси). Проверяващият е един и същ за скрипта и за теста.
{
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-html-headers.cjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, 'всеки HTML отговор носи четирите заглавки:\n' + (run.stdout || '') + (run.stderr || ''));
  const m = /audit-html-headers: (\d+) HTML отговора · (\d+) с пълния набор · (\d+) без/.exec(run.stdout || '');
  assert.ok(m, 'скриптът казва какво е проверил: ' + run.stdout);
  const total = Number(m[1]);
  const bad = Number(m[3]);
  assert.ok(total >= 12, 'обхватът не е свит — поне 12 отговора, намерени ' + total);
  assert.equal(bad, 0, 'нито един HTML отговор без пълния набор');
  // Проверяващият трябва да ХВАЩА липса — иначе е зелена обвивка.
  const good = "res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': 'x', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });";
  assert.deepEqual(auditText(good).map((r) => r.missing), [[]], 'пълният набор не се оплаква');
  assert.deepEqual(
    auditText(good.replace("'Cache-Control': 'no-store', ", '')).map((r) => r.missing),
    [['Cache-Control']],
    'липсващ Cache-Control се хваща точно',
  );
  assert.deepEqual(auditText("res.writeHead(200, { 'Content-Type': 'application/json' });"), [], 'JSON не се брои за HTML');
}

// ── 2. Живо: сървърът наистина я връща ─────────────────────────────────────
(async () => {
  const server = await startServer({ keepData: true });
  try {
    const landing = await fetch(server.base + '/');
    assert.equal(landing.status, 200, 'началната страница отговаря 200');
    assert.match(String(landing.headers.get('content-type')), /text\/html/, 'началната страница е HTML');
    assert.equal(landing.headers.get('referrer-policy'), 'no-referrer', 'началната страница носи Referrer-Policy');
    assert.equal(landing.headers.get('x-content-type-options'), 'nosniff', 'и не позволява подмяна на типа');

    const secret = await fetch(server.base + '/secret/който-и-да-е');
    assert.equal(secret.status, 200, 'черупката на тайната връзка отговаря 200 (идентификаторът е във фрагмента)');
    assert.equal(secret.headers.get('referrer-policy'), 'no-referrer', 'тайната връзка също не издава адреса си');
  } finally {
    await server.stop();
  }
  console.log(
    `PASS html-headers: ${htmlResponses} HTML отговора с Referrer-Policy: no-referrer · ` +
      'живият сървър го връща на / и на /secret/… · подписан адрес не изтича през Referer',
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
