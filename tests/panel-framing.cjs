'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: „вижда ли се панелът“ — решението на БРАУЗЪРА, не кодът на отговора.
//
// Дефектът от 0.69.40: панелът на add-on-а в Home Assistant е iframe, а документът
// на UI-я се сервираше с `frame-ancestors 'none'`. Всички дотогавашни тестове минаха:
// документът беше 200, всичките 23 ресурса се зареждаха, CSP имаше… и екранът беше
// празен, защото браузърът ОТКАЗВА да покаже такъв документ в рамка.
//
// Затова тук се проверява точно това решение:
//   1. оценителят на `frame-ancestors` минава случаите, по които браузърът решава;
//   2. статично: ВСЯКА HTML повърхност в сървъра има изрична политика за вграждане;
//   3. живо, през ДВАТА адреса, които Home Assistant дава (`/api/hassio_ingress/<token>`
//      и `/app/<slug>`): панелът се вгражда от същия origin и НЕ се вгражда от чужд;
//   4. публичните страници (портал, тайна връзка) не се вграждат никъде.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopChild } = require('./helpers.cjs');
const { frameAllowed, frameSources } = require('./lib/csp-frame.cjs');

const ROOT = path.join(__dirname, '..');
const ADMIN = 'panel-framing-token-9c4e17b2a6d8f035';
const pub = 18409;
const adm = 18408;
const HA = `http://127.0.0.1:${adm}`;
const PREFIXES = ['/api/hassio_ingress/panel-token_9f2c', '/app/99438e72_hapi_enterprise'];
let ENGINE_CASES = 0;

// ── 1. Оценителят: случаите, по които браузърът решава ────────────────────────
function checkEngine() {
  const origin = 'https://ha.example.com:8123';
  const doc = origin + '/api/hassio_ingress/tok/ui/';
  const cases = [
    ['без CSP — вграждането не е ограничено', null, 'https://evil.example/', true],
    ['CSP без frame-ancestors не ограничава вграждането', "default-src 'none'", 'https://evil.example/', true],
    ['frame-ancestors none блокира и собствения origin (дефектът)', "frame-ancestors 'none'", origin + '/lovelace/0', false],
    ['frame-ancestors self пуска същия origin (панелът)', "frame-ancestors 'self'", origin + '/lovelace/0', true],
    ['frame-ancestors self спира чужд сайт', "frame-ancestors 'self'", 'https://evil.example/x', false],
    ['звезда пуска всички', 'frame-ancestors *', 'https://evil.example/x', true],
    ['схема https: пуска https родител', 'frame-ancestors https:', 'https://evil.example/x', true],
    ['схема https: не пуска http родител', 'frame-ancestors https:', 'http://evil.example/x', false],
    ['точен origin с порт съвпада', 'frame-ancestors https://ha.example.com:8123', origin + '/a', true],
    ['точен origin без порт не съвпада с друг порт', 'frame-ancestors https://ha.example.com', origin + '/a', false],
    ['поддомейн-шаблон съвпада', 'frame-ancestors https://*.example.com', 'https://ha.example.com/a', true],
    ['поддомейн-шаблон без порт не покрива друг порт (CSP3)', 'frame-ancestors https://*.example.com', 'https://ha.example.com:8123/a', false],
    ['две политики се налагат заедно', ["frame-ancestors 'self'", "frame-ancestors 'none'"], origin + '/a', false],
    ['няколко източника — стига един', "frame-ancestors 'self' https://evil.example", 'https://evil.example/a', true],
    ['непрозрачен origin (data:) не минава като self', "frame-ancestors 'self'", 'data:text/html,x', false],
  ];
  for (const [label, policy, ancestor, expected] of cases) {
    const result = frameAllowed(policy, ancestor, doc);
    assert.equal(result.allowed, expected, label + ' → ' + result.reason);
  }
  ENGINE_CASES = cases.length;
  console.log('· оценител frame-ancestors: ' + cases.length + ' случая (none/self/*/схема/порт/няколко политики)');
}

// ── 2. Статично: всяка HTML повърхност има изрична политика за вграждане ─────
/** Връща всички извиквания `res.writeHead(...)` с пълния им текст. */
function writeHeadCalls(source) {
  const calls = [];
  const needle = 'res.writeHead(';
  let from = 0;
  for (; ;) {
    const start = source.indexOf(needle, from);
    if (start < 0) break;
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = start + needle.length - 1; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) break;
    calls.push({ start, text: source.slice(start, end + 1) });
    from = end + 1;
  }
  return calls;
}

function checkStaticSurfaces() {
  const files = [path.join(ROOT, 'hapi_enterprise', 'server.js')];
  const routesDir = path.join(ROOT, 'hapi_enterprise', 'routes');
  for (const f of fs.readdirSync(routesDir)) if (f.endsWith('.js')) files.push(path.join(routesDir, f));

  // Стойността на CSP може да е литерал или константа (`SECRET_CSP`, `SEND_CSP`) —
  // и двете се смятат, за да не минава „празна“ политика.
  const cspOf = (callText, fileText) => {
    const literal = /Content-Security-Policy':\s*"([^"]*)"/.exec(callText);
    if (literal) return literal[1];
    const ident = /Content-Security-Policy':\s*([A-Z][A-Z0-9_]*)/.exec(callText);
    if (!ident) return null;
    const declared = new RegExp('const ' + ident[1] + ' = "([^"]*)"').exec(fileText);
    return declared ? declared[1] : null;
  };

  const allCalls = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const call of writeHeadCalls(source)) {
      allCalls.push({ file: path.relative(ROOT, file), csp: cspOf(call.text, source), ...call });
    }
  }
  // Документите с фиксиран HTML тип (UI-ят сервира типа от allowlist-а, затова е отделно).
  const htmlCalls = allCalls.filter((c) => /text\/html/i.test(c.text) && /Content-Type/i.test(c.text));
  assert.ok(htmlCalls.length >= 6, 'намерени са само ' + htmlCalls.length + ' HTML повърхности — скенерът е счупен');

  const withoutPolicy = htmlCalls.filter((c) => !c.csp);
  assert.deepEqual(withoutPolicy.map((c) => c.file + '@' + c.start), [], 'HTML отговор без CSP — реши изрично дали се вгражда');

  const withoutFrame = htmlCalls.filter((c) => frameSources(c.csp).length === 0);
  assert.deepEqual(withoutFrame.map((c) => c.file + '@' + c.start), [], 'HTML отговор без frame-ancestors — вграждането остава на подразбиране');

  // UI-ят на add-on-а (единственото място, което Home Assistant показва в панел)
  // ЗАДЪЛЖИТЕЛНО е вградим от същия origin.
  const ui = allCalls.filter((c) => /'Content-Type':\s*type/.test(c.text));
  assert.equal(ui.length, 1, 'очаква се точно един сервиращ файл за UI_FILES, намерени: ' + ui.length);
  assert.match(ui[0].csp, /frame-ancestors 'self'/, 'UI-ят на add-on-а трябва да е frame-ancestors \'self\' — иначе панелът е празен');
  assert.equal(/frame-ancestors 'none'/.test(ui[0].csp), false, 'UI-ят не бива да е заключен срещу вграждане');

  // Публичните страници на сървъра не се вграждат никъде.
  const pubNone = htmlCalls.filter((c) => /frame-ancestors 'none'/.test(c.csp)).length;
  assert.ok(pubNone >= 5, 'очакват се поне 5 публични HTML повърхности с frame-ancestors \'none\', намерени: ' + pubNone);

  // Интеграцията сервира портала си сама — той също не се вгражда.
  const py = fs.readFileSync(path.join(ROOT, 'custom_components', 'hapi_enterprise', '__init__.py'), 'utf8');
  assert.match(py, /frame-ancestors 'none'/, 'порталът в интеграцията трябва да е frame-ancestors \'none\'');

  for (const c of htmlCalls) console.log('  · ' + c.file + ': frame-ancestors ' + frameSources(c.csp).join(' | '));
  console.log('· статично: ' + htmlCalls.length + ' HTML повърхности — всички с CSP и frame-ancestors · публични \'none\': ' + pubNone);
}

// ── 3. Живо: истинският сценарий на Home Assistant ───────────────────────────
function refsOf(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => !/^(?:https?:|data:|#|mailto:)/.test(r));
}

(async () => {
  checkEngine();
  checkStaticSurfaces();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-panel-framing-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: ADMIN, PORT: String(pub), ADMIN_PORT: String(adm), INGRESS_MODE: 'true' },
    stdio: 'pipe',
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${pub}/health`)).ok) { ready = true; break } } catch { /* още стартира */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert(ready, 'сървърът не стартира');

    for (const prefix of PREFIXES) {
      const panelUrl = HA + prefix + '/ui/';
      const parentUrl = HA + '/lovelace/0'; // страницата на Home Assistant — същият origin

      const root = await fetch(HA + prefix, { redirect: 'manual' });
      assert.equal(root.status, 302, prefix + ': коренът трябва да пренасочи към UI-я');
      assert.equal(root.headers.get('location'), prefix + '/ui/', prefix + ': пренасочването губи ingress префикса');

      const doc = await fetch(panelUrl);
      assert.equal(doc.status, 200, prefix + ': документът на панела не се зарежда');
      const csp = doc.headers.get('content-security-policy') || '';
      const html = await doc.text();
      assert.match(html, /Enterprise Control Center/, prefix + ': сервира се друг документ');

      const framed = frameAllowed(csp, parentUrl, panelUrl);
      assert.equal(framed.allowed, true, prefix + ': панелът НЕ може да се вгради в Home Assistant — ' + framed.reason);
      const foreign = frameAllowed(csp, 'https://evil.example/steal', panelUrl);
      assert.equal(foreign.allowed, false, prefix + ': чужд сайт може да вгради панела');

      const broken = [];
      for (const ref of refsOf(html)) {
        const target = new URL(ref, 'http://x' + prefix + '/ui/').pathname;
        const res = await fetch(HA + target);
        if (res.status !== 200) broken.push(res.status + ' ' + target);
      }
      assert.deepEqual(broken, [], prefix + ': ресурсите на панела не се зареждат — ' + broken.join(', '));
      console.log('· ' + prefix + ': панелът се вгражда от Home Assistant, не от чужд сайт · ' + refsOf(html).length + ' ресурса OK');
    }

    // Генераторът е второто приложение на add-on-а — същият договор.
    const genUrl = HA + PREFIXES[0] + '/generator/index.html';
    const gen = await fetch(genUrl);
    assert.equal(gen.status, 200, 'генераторът не се зарежда през ingress');
    const genCsp = gen.headers.get('content-security-policy') || '';
    assert.equal(frameAllowed(genCsp, HA + '/lovelace/0', genUrl).allowed, true, 'генераторът не може да се вгради от Home Assistant');
    assert.equal(frameAllowed(genCsp, 'https://evil.example/', genUrl).allowed, false, 'генераторът се вгражда от чужд сайт');

    // Публичните страници: нито собственият origin, нито чужд.
    const created = await fetch(HA + '/admin/api/portals', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'framing-portal', title: 'Framing', visibility: 'public' }),
    });
    assert.equal(created.status, 201, 'порталът за проверката не се създава');
    const body = await created.json();
    const createdPortal = body.portal || body;
    const slug = createdPortal.slug || createdPortal.id;
    assert.ok(slug, 'създаденият портал няма адрес: ' + JSON.stringify(body).slice(0, 200));
    const portalUrl = `http://127.0.0.1:${pub}/p/${slug}`;
    const page = await fetch(portalUrl);
    assert.equal(page.status, 200, 'публичният портал не се зарежда');
    const portalCsp = page.headers.get('content-security-policy') || '';
    assert.equal(frameAllowed(portalCsp, portalUrl, portalUrl).allowed, false, 'публичният портал се вгражда от същия origin');
    assert.equal(frameAllowed(portalCsp, 'https://evil.example/', portalUrl).allowed, false, 'публичният портал се вгражда от чужд сайт');

    console.log('PASS panel-framing: оценител ' + ENGINE_CASES + ' случая · HTML повърхности с изрична политика · панелът се вгражда от Home Assistant (2 адреса), публичните страници — не');
  } finally {
    await stopChild(child).catch(() => { });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
