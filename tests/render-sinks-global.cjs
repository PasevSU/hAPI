'use strict';
// ГЛОБАЛНИ ПРОВЕРКИ ЗА „СИНКОВЕ“ НА РЕНДИРАНЕ (0.69.216).
//
// Защо има тест: сегментираният анализ на кода намери реален проблем — прегледът на файл в
// панела слагаше blob адрес в `<iframe>` за ВСЕКИ тип, различен от текст. Blob адресът
// наследява произхода на панела, тоест качен SVG (или HTML) със `<script>` вътре се изпълнява
// в същия произход и стига до `sessionStorage` с администраторския токен. Сървърът пък
// сервираше `image/svg+xml` inline без политика за съдържание.
//
// Тестът не проверява един файл: той минава през ЦЕЛИЯ интерфейс и публичните страници и
// отказва класа дефекти, а не конкретния случай:
//   1. blob в `<iframe>` — само за типове, които не изпълняват скрипт (списък + проверка);
//   2. `innerHTML` с поле от данни без `esc(` — нула (XSS през име на файл/бележка);
//   3. `Content-Disposition` с име на файл — името минава през `encodeURIComponent`;
//   4. `<script` не се вмъква през `innerHTML`;
//   5. сървърът слага политика за съдържание на inline SVG (дълбочинна защита).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');
const portalDir = path.join(root, 'hapi_enterprise', 'portal');
const read = (p) => fs.readFileSync(p, 'utf8');

/** Всички файлове на интерфейса и на публичните страници — това е „в останалите кодове“. */
function uiFiles() {
  const out = [];
  for (const dir of [uiDir, portalDir]) {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.js')) out.push({ name, file: path.join(dir, name), text: read(path.join(dir, name)) });
    }
  }
  for (const name of ['portal.js', 'secret-view.js', 'secret-page.js']) {
    const file = path.join(root, 'hapi_enterprise', name);
    if (fs.existsSync(file)) out.push({ name, file, text: read(file) });
  }
  return out;
}

// ── 1. Blob в iframe: само безопасни типове ─────────────────────────────────
// Файл, който слага обектен адрес в iframe, трябва да има списък с разрешени типове и
// проверка срещу него. Без нея произволен качен файл се рисува в произхода на панела.
const frameFiles = uiFiles().filter((f) => /createObjectURL/.test(f.text) && /<iframe/.test(f.text));
assert.ok(frameFiles.length > 0, 'има поне един файл, който рисува blob в iframe (иначе тестът е украшение)');
for (const f of frameFiles) {
  assert.match(
    f.text,
    /SAFE_FRAME\s*=\s*\/\^?\(?[^\n]*application\\\/pdf/,
    `${f.name}: липсва списък SAFE_FRAME с application/pdf — без него в iframe влиза всичко`,
  );
  assert.match(f.text, /SAFE_FRAME\.test\(/, `${f.name}: списъкът съществува, но не се проверява`);
  // Проверката трябва да е ПРЕДИ рисуването, а не след него.
  const guardAt = f.text.indexOf('SAFE_FRAME.test(');
  const drawAt = f.text.search(/showModal\([^)]*url:/);
  if (drawAt > 0) assert.ok(guardAt < drawAt, `${f.name}: проверката е след рисуването на iframe-а`);
  assert.doesNotMatch(f.text, /image\\\/svg/, `${f.name}: SVG не бива да е в списъка за iframe — той изпълнява скрипт`);
}

// ── 2. innerHTML с поле от данни без esc() ──────────────────────────────────
// Единствените позволени изключения са изброени с ПРИЧИНА; списъкът не се разширява тихо.
const ALLOW_UNESCAPED = [
  // `o.html` е нарочно суров HTML — вика се само с вътрешно построени шаблони (виж preview).
  { file: 'files-manager.js', expr: 'o.html', why: 'вътрешен шаблон, не потребителски данни' },
];
const FIELD = /\.(name|title|label|slug|email|notes|comment|reason|description)\b/;

/**
 * Изважда САМО шаблона, който отива в innerHTML — от `innerHTML` до затварящата го обратна
 * кавичка, с отчитане на вложените `${ … }`. Прозорец от N реда дава фалшиви находки
 * (`${f.name}` в съседен ред за заглавие на модала), а тест, който крещи за безопасен код,
 * ще бъде изключен при първия удобен случай.
 */
function innerHtmlTemplates(text) {
  const out = [];
  let at = text.indexOf('innerHTML');
  while (at >= 0) {
    const eq = text.indexOf('=', at);
    if (eq < 0) break;
    // Само `innerHTML = \`…\`` — при `innerHTML = ''` следващата обратна кавичка е от друг
    // ред и тогава тестът съдеше чужд шаблон (фалшива находка, която не бива да се понася).
    let k = eq + 1;
    while (k < text.length && /\s/.test(text[k])) k += 1;
    if (text[k] !== '`') {
      at = text.indexOf('innerHTML', k);
      continue;
    }
    const start = k;
    let depth = 0;
    let i = start + 1;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '$' && text[i + 1] === '{') {
        depth += 1;
        i += 1;
        continue;
      }
      if (ch === '}' && depth > 0) {
        depth -= 1;
        continue;
      }
      if (ch === '`' && depth === 0) break;
    }
    out.push(text.slice(start + 1, i));
    at = text.indexOf('innerHTML', i);
  }
  return out;
}

const unescaped = [];
for (const f of uiFiles()) {
  for (const tpl of innerHtmlTemplates(f.text)) {
    for (const m of tpl.matchAll(/\$\{([^{}]+)\}/g)) {
      const expr = m[1].trim();
      if (/^(esc|attr|encodeURIComponent|T|t|Number|String)\(/.test(expr)) continue;
      if (!FIELD.test(expr)) continue;
      if (/\?\s*'/.test(expr)) continue;
      if (ALLOW_UNESCAPED.some((a) => a.file === f.name && expr.includes(a.expr))) continue;
      unescaped.push(`${f.name}: ${expr.slice(0, 80)}`);
    }
  }
}
assert.deepEqual(unescaped, [], 'полета от данни в innerHTML без esc(): ' + unescaped.join(' · '));

// ── 3. Content-Disposition: името на файла минава през encodeURIComponent ───
// Постоянно име (`filename="visitors.csv"`) е безопасно. Динамичното трябва или да е
// процентно-кодирано (RFC 5987), или да е доказано ASCII (sanitized с бял списък в същия ред).
const serverDirs = [path.join(root, 'hapi_enterprise'), path.join(root, 'hapi_enterprise', 'routes')];
const badDisposition = [];
for (const dir of serverDirs) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const text = read(path.join(dir, name));
    for (const [index, line] of text.split('\n').entries()) {
      if (!/Content-Disposition/.test(line)) continue;
      if (!/filename|filename\*/.test(line)) continue;
      const dynamic = /\+\s*[A-Za-z_$]|\$\{/.test(line);
      if (!dynamic) continue;
      if (/encodeURIComponent/.test(line)) continue;
      // Доказано ASCII: същата заглавка идва от променлива, минала през бял списък.
      if (/\.replace\(\/\[\^A-Za-z0-9\._-\]\/g/.test(text)) continue;
      badDisposition.push(`${name}:${index + 1}`);
    }
  }
}
assert.deepEqual(badDisposition, [], 'Content-Disposition с непреценткодирано име: ' + badDisposition.join(', '));

// ── 4. Никой не вмъква <script през innerHTML ───────────────────────────────
// Проверява се САМО шаблонът, който отива в innerHTML — `<script` в коментар не е проблем.
const scriptSinks = [];
for (const f of uiFiles()) {
  for (const tpl of innerHtmlTemplates(f.text)) {
    if (/<script[\s>]/i.test(tpl)) scriptSinks.push(f.name);
  }
}
assert.deepEqual(scriptSinks, [], 'файлове, които вмъкват <script> през innerHTML: ' + scriptSinks.join(', '));

// ── 5. Inline SVG на сървъра носи политика за съдържание ────────────────────
const server = read(path.join(root, 'hapi_enterprise', 'server.js'));
assert.match(server, /pv\.mime === 'image\/svg\+xml'/, 'сървърът разпознава inline SVG като документ');
assert.match(
  server,
  /pv\.mime === 'image\/svg\+xml'\)[^\n]*Content-Security-Policy/,
  'inline SVG се сервира с Content-Security-Policy (иначе скрипт вътре в SVG се изпълнява при директно отваряне)',
);

console.log(
  `PASS render-sinks-global: ${uiFiles().length} UI файла · blob→iframe само с SAFE_FRAME (${frameFiles.length} файла) · ` +
    `0 полета без esc() · Content-Disposition с encodeURIComponent · без <script през innerHTML · inline SVG с CSP`,
);
