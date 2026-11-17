# Промени в hAPI Enterprise

Тази версия: **0.69.240**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.240

- **Невалидният JSON се решава на ЕДНО място (DEF-67).** Досега всяко четене на външен JSON
  (`/data/options.json`, редове на одита, метаданни на качване, стойности в SQLite, кеш на
  геолокация, тяло на webhook) увиваше `JSON.parse` в собствен `try` и връщаше различно —
  `null`, `[]`, `{}`, текста или 500. Един и същ боклук във входа даваше различен отговор според
  модула. Сега има глобален `parse-json.js`: `parseJson(text)` → `{ ok: true, value }` или
  `{ ok: false, error }`, и `parseJsonOr(text, fallback = null)`. През него минават 13 файла:
  `audit-chain.js`, `retention.js`, `core-store.js`, `secret-links.js`, `packager.js`,
  `portal-config.js`, `sqlite-store.js`, `visitor-intel.js`, `routes/upload-sessions.js`,
  `core_module/http.js` и `server.js` (4 места).
- **Поведението е запазено, не променено.** `parseJson` привежда входа до текст точно както
  `JSON.parse` (затова `Buffer`, число и `null` се разчитат), а невалидното връща като
  `{ ok: false }` вместо да хвърля — всяко място решава какво да прави, както досега. Най-осезаемата
  разлика е в `sqlite-store.js`: повредени метаданни дават **500 `CORRUPT_METADATA`** с причина,
  а не необяснен `SyntaxError` в лога.
- **Модулът е критичен.** `parse-json.js` е в `CRITICAL` на `integrity.js` (манифестът се сверява
  при старт) и в `COPY` списъка на `Dockerfile`; без второто образът пада при старт.
- **Числата на скенера.** Находките `json-parse-untrusted` паднаха **99 → 78**, а в продукта
  необяснени четения: **0** — останалите са в `tests/` и `scripts/`, където входът е наш.
  Изключенията в `scripts/bad-code-allowlist.json` са 29, всички с причина (0 мъртви).
- **Тестът пази правилото.** `tests/parse-json.cjs` проверява разчитането (`null`, число, `Buffer`,
  валиден обект), четирите вида повреда, разликата между текст `null` и повреда в `parseJsonOr`,
  пуска скенера и иска **нула** необяснени находки в `hapi_enterprise/`, и сверява allowlist-а
  с реалността. Защитата е вписана в `tests/regression-guards.cjs` (котва: „минава през
  parse-json.js“).
