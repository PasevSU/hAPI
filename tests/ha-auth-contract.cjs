'use strict';
// ДОГОВОР ЗА АВТЕНТИКАЦИЯ НА HOME ASSISTANT (локален, без мрежа).
//
// Home Assistant дава два начина за достъп до HTTP изглед на интеграция:
//   • `requires_auth = True`  → HA САМ проверява токена (Bearer JWT или сесия) и подава
//     `request['hass_user']`; това е пътят за всичко, което е „на потребителя“;
//   • `requires_auth = False` → изгледът е публичен и НЕ БИВА да обслужва защитени данни.
// Дълготрайните токени се издават от профила на потребителя, а за външно приложение —
// през `/auth/authorize` + `/auth/token` с `client_id` = адресът на приложението; и двете
// са на порта на HA (8123) и не изискват наш порт.
//
// Интеграцията ни има публична повърхност по необходимост: получателят на портал няма
// профил в Home Assistant. Затова тук се пази ГРАНИЦАТА, а не „има ли токен“:
//   • всеки изглед декларира `requires_auth` изрично (няма скрит/default достъп);
//   • нито един публичен изглед не сочи към административен път;
//   • префиксът `/hapi/…` отказва `/admin/…` и `/internal/…` с 404 (fail closed);
//   • интеграцията НЕ чете `Authorization` от HA заявка — токенът на HA се проверява от HA;
//   • административният токен на hAPI НЕ се приема в YAML (само в config entry).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'custom_components', 'hapi_enterprise', '__init__.py');
const source = fs.readFileSync(file, 'utf8');

// ── 1. Всеки изглед декларира `requires_auth` изрично ───────────────────────
const classes = [...source.matchAll(/^(\s*)class (\w+)\(HomeAssistantView\):\n([\s\S]*?)(?=\n\1\S|\n\1class |(?![\s\S]))/gm)];
assert.ok(classes.length >= 4, 'очакват се поне 4 изгледа, намерени: ' + classes.length);
const views = [];
for (const [, , name, body] of classes) {
  assert.match(body, /requires_auth\s*=\s*(True|False)/, `изгледът ${name} не декларира requires_auth изрично`);
  const url = (body.match(/url\s*=\s*"([^"]+)"/) || [])[1] || '';
  const requiresAuth = (body.match(/requires_auth\s*=\s*(True|False)/) || [])[1] === 'True';
  views.push({ name, url, requiresAuth });
}

// ── 2. Публичен изглед никога не води до административна повърхност ────────
for (const view of views) {
  if (view.requiresAuth) continue;
  assert.equal(
    /admin/i.test(view.url.replace('api:hapi_enterprise', '')),
    false,
    `публичният изглед ${view.name} (${view.url}) сочи към административен път`,
  );
}
// Поне един изглед трябва да е публичен (страницата на портала) — иначе получателят на
// портал не може да отвори нищо без профил в HA.
assert.ok(views.some((v) => !v.requiresAuth), 'има публична повърхност (страницата на портала)');

// ── 3. Префиксът `/hapi/…` е fail closed ────────────────────────────────────
assert.match(source, /_ADMIN_PATH\s*=\s*re\.compile\(r"\^\/\(\?:admin\|internal\)/, 'има шаблон за административните пътища');
assert.match(source, /if _ADMIN_PATH\.match\(target\):\s*\n\s*raise web\.HTTPNotFound\(\)/,
  '`/hapi/…` отказва `/admin` и `/internal` с 404, преди да проксира');

// ── 4. Токенът на HA се проверява от HA, не от нас ─────────────────────────
assert.equal(
  /request\.headers\.get\(\s*["']Authorization["']/.test(source),
  false,
  'интеграцията не чете `Authorization` от заявката — това е работа на Home Assistant',
);
// Прокситата подават СВОЯ ключ за портал нагоре, а не HA токена.
assert.match(source, /headers = \{"Authorization": "Bearer " \+ portal_key\}/, 'към hAPI отива ключът на портала');

// ── 5. Административният токен не се приема в YAML ─────────────────────────
const schema = (source.match(/CONFIG_SCHEMA = vol\.Schema\(([\s\S]*?)\n\)/m) || [])[1] || '';
assert.ok(schema.includes('CONF_BACKEND_URL'), 'YAML приема `backend_url`');
assert.equal(schema.includes('CONF_TOKEN'), false, 'YAML НЕ приема административния токен (само config entry)');
assert.match(source, /backend_url: !secret hapi_backend_url/, 'docstring-ът показва `!secret` формата');

// ── 6. Отчет за човека ─────────────────────────────────────────────────────
const publicOnes = views.filter((v) => !v.requiresAuth).map((v) => v.name);
console.log(
  'PASS ha-auth-contract: ' + views.length + ' изгледа, всеки с изричен `requires_auth` · публични: ' +
  publicOnes.join(', ') + ' · `/hapi/…` отказва admin/internal с 404 · HA токен не се чете от нас · ' +
  'административният токен не влиза в YAML',
);
