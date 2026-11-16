'use strict';
// ТАЙНИТЕ ОПЦИИ НЕ ИЗЛИЗАТ В ЛОГА (O-07 от `DOCS_AND_OPTIONS_STRUCTURE.md` §7).
//
// Защо има тест: `secret: true` в дескриптора е обещание, че стойността не се логва, не се връща
// от `api-info` и не влиза в диагностичния пакет. Днес то се крепи на един списък в `logger.js`,
// който матеше ТОЧНИ имена (`password`, `token`…) — тоест `pgp_key_pass` или `s3_secret_key` се
// логваха в чист вид, ако някой ги сложи в обект на лог събитие.
//
// Проверява се ПОВЕДЕНИЕ, не текст: `redact()` се вика с реалните ключове и имена на променливи
// от дескриптора. Тестът пада и в обратната посока — обикновена опция не бива да се прикрива,
// защото иначе „редица от звездички“ не значи нищо (ще скрием и това, което е важно за одита).
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { OPTIONS } = require(path.join(ROOT, 'hapi_enterprise', 'option-spec.js'));
const { redact } = require(path.join(ROOT, 'hapi_enterprise', 'logger.js'));

const secrets = OPTIONS.filter((o) => o.secret);
assert.ok(secrets.length >= 3, 'дескрипторът има тайни опции: ' + secrets.length);

// ── 1. Всеки таен ключ и всяко негово име на променлива се прикриват ────────
const leaked = [];
for (const entry of secrets) {
  for (const key of [entry.key, entry.env]) {
    const value = redact({ [key]: 'SECRET-VALUE-1234' })[key];
    if (value !== '***') leaked.push(`${key} → ${value}`);
  }
}
assert.deepEqual(leaked, [], 'тайна опция не се прикрива в лога: ' + leaked.join(', '));

// ── 2. Обикновените опции НЕ се прикриват (иначе одитът губи смисъл) ────────
const overRedacted = [];
for (const entry of OPTIONS.filter((o) => !o.secret)) {
  const ctx = redact({ [entry.key]: 'обикновена-стойност' });
  if (ctx[entry.key] !== 'обикновена-стойност') overRedacted.push(entry.key);
}
assert.deepEqual(overRedacted, [], 'обикновена опция се прикрива без причина: ' + overRedacted.join(', '));

// ── 3. Тайната не изтича и през съобщение, в което е поставена като стойност ─
const message = redact({ note: 'Bearer SECRET-VALUE-1234' });
assert.equal(message.note.includes('SECRET-VALUE-1234'), false, 'дълъг bearer низ в съобщение се прикрива');

console.log(
  `PASS option-secrets: ${secrets.length} тайни опции (${secrets.map((s) => s.key).join(', ')}) · ` +
    'ключът и името на променливата се прикриват · обикновените остават четими',
);
