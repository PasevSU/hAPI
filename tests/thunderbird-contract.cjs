'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: емитерът на разширението може да строи САМО имена на заглавки, които
// Thunderbird приема в `ComposeDetails.customHeaders`.
//
// Дефектът: `Disposition-Notification-To` изглежда като най-правилния начин да се поиска
// разписка, но `sanitizeCustomHeaderName()` в `parent/ext-compose.js` връща `null` за всяко
// име извън `X-` (без `X-Mozilla-`), `List-` и `msip_labels`. В `onBeforeSend` извикването на
// `setComposeDetails()` НЕ е в `try`, а обещанието за изпращане не се урежда — тоест писмото
// просто не излиза: нито диалог, нито грешка, само празен прозорец. Точно това заключи всеки
// опит за изпращане, докато заглавката стоеше в списъка.
//
// Затова проверката тук е СТАТИЧНА и срещу ПРАВИЛОТО НА ПЛАТФОРМАТА, а не срещу копието в
// `background.js`: ако някой добави име в `ALLOWED_CUSTOM_HEADER_NAMES`, тестът пак го хваща,
// защото списъкът на платформата е изписан тук отделно.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const EXT = path.join(root, 'thunderbird-extension');
const source = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

// Правилото на Thunderbird, изписано наново — нарочно НЕ се чете от емитера.
const PLATFORM_ALLOWED = ['msip_labels'];
const platformAccepts = (name) => {
  const n = String(name).toLowerCase().trim();
  return n.startsWith('x-') ? !n.startsWith('x-mozilla-') : n.startsWith('list-') || PLATFORM_ALLOWED.includes(n);
};

// ── 1. Всяко име, което емитерът строи, минава правилото ────────────────────
const built = [...source.matchAll(/buildHeader\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
assert.ok(built.length >= 20, 'емитерът строи поне 20 заглавки, намерени: ' + built.length);
const refused = built.filter((n) => !platformAccepts(n));
assert.deepEqual(refused, [], 'имена, които Thunderbird би отказал: ' + refused.join(', '));

// ── 2. Собственият allowlist не е по-широк от платформения ─────────────────
const own = (source.match(/const ALLOWED_CUSTOM_HEADER_NAMES = \[([^\]]*)\]/) || [])[1];
assert.ok(own, 'емитерът пази списъка на платформата');
const ownNames = [...own.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
for (const n of ownNames) {
  assert.ok(platformAccepts(n), `собственият allowlist не може да съдържа „${n}“`);
}

// ── 3. Разписката се иска по НАТИВНИЯ начин, не като заглавка ───────────────
assert.equal(
  built.includes('Disposition-Notification-To'), false,
  'разписката НЕ се иска като custom header — Thunderbird я строи от `returnReceipt`',
);
assert.match(source, /returnReceipt\s*=\s*true/, 'разписката се иска с `returnReceipt = true`');
assert.match(source, /enforceAllowedCustomHeaders/, 'последната защита преди изпращане остава');
assert.match(source, /onBeforeSend\.addListener/, 'закачането е на `onBeforeSend`');

// ── 4. WAR маркерът и версията са това, което договорът обещава ─────────────
assert.match(source, /const WAR_MARKER = "\{\{ PasevSU-WAR \}\}"/, 'маркерът в темата е точно този низ');
assert.match(source, /buildHeader\(\s*["']X-PasevSU-WAR["']/, 'заглавката WAR се строи');
assert.equal(manifest.manifest_version, 2, 'MailExtension манифест, версия 2');
assert.deepEqual(manifest.permissions, ['compose', 'storage'], 'точно правата за compose и storage');
assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '115.0', 'ESR 115 е долната граница');
assert.equal(manifest.background.scripts[0], 'background.js', 'фоновият скрипт е един');
assert.equal(manifest.options_ui.open_in_tab, false, 'настройките се отварят в таб на add-on-а');

// ── 5. Никакво Node в емитера ──────────────────────────────────────────────
// Коментарите се махат: самият файл ОБЯСНЯВА, че не ползва `require()`, и проверка
// върху суровия текст би паднала заради собственото си обяснение.
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
assert.equal(/require\s*\(/.test(codeOnly), false, 'MailExtension не ползва `require()`');
assert.equal(/process\.(env|argv)/.test(codeOnly), false, 'MailExtension не чете процеса');

// ── 6. Проверката на инсталацията сравнява ЗАРЕДЕНОТО с ДИСКА ───────────────
// Дефектът: `verify-install` четеше само имената и датите на записите в `.xpi`, тоест
// казваше „ALL CHECKS OK“ за архив, различен от заредения (ръчно сглобена 1.5 стоеше в
// профила, а изходният код беше 1.7). Затова инструментът трябва да държи и двете сравнения:
// версията, която Thunderbird РЕАЛНО е заредил, и хеша на ВСЕКИ запис от архива.
const verifyInstall = fs.readFileSync(path.join(root, 'psemp-gateway', 'tools', 'verify-install.cjs'), 'utf8');
assert.match(verifyInstall, /function loadedAddonVersion/, 'инсталацията се сверява със заредената версия');
assert.match(verifyInstall, /extensions\.json/, 'заредената версия идва от `extensions.json`');
assert.match(verifyInstall, /function archiveManifestVersion/, 'версията се чете от СЪДЪРЖАНИЕТО на архива');
assert.match(verifyInstall, /zlib\.inflateRawSync/, 'записите се разопаковат, преди да се хешират');
assert.match(verifyInstall, /createHash\('sha256'\)/, 'всеки запис се сверява по SHA-256, не по име и дата');

console.log(
  `PASS thunderbird-contract: ${built.length} имена минават правилото на платформата · ` +
  'разписката е `returnReceipt` · WAR маркер и манифест 2/115.0 налице · без Node',
);
