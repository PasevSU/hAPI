# Промени в hAPI Enterprise

Тази версия: **0.69.43**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.43

Одит на целия код: три дефекта, намерени с живи проби срещу работещия сървър.

- **Теч на памет в ключалката на тайните.** `server.js` слагаше в Map
  `previous.then(() => current)`, а изчистваше записа само при `get(id) === current` —
  условие, което никога не е вярно. Всеки преглед на тайна оставяше запис завинаги;
  изчистването беше мъртъв код. Ключалката е изнесена в `secret-lock.js`, помни точно
  опашката, която влиза в Map, и я маха в `finally`. `server.js` падна до 2720 реда.
- **500 вместо 400 за невалиден вход.** `POST /admin/api/qr-artifacts` с липсващ или
  невалиден `qrId` връщаше `{"error":"Internal error"}` (500) и записваше „unhandled“
  в лога. Сега `createArtifacts` хвърля с `status: 400` и клиентът вижда причината.
- **Грешките на клиента се записваха като `ERROR … unhandled`.** Всяко очаквано
  „Invalid JSON“/„Invalid case number“ пълнеше дневника като сървърна грешка и удавяше
  истинските 500-ци. Сега 4xx е `warn` (`request.rejected`), а `error` + централизиран
  дневник остава само за 5xx.
- Тестове: `tests/secret-lock.cjs` (сериализация + 550 достъпа без остатък),
  `tests/error-logging.cjs` (4xx не е ERROR), `tests/api-input-errors.cjs` (23 невалидни
  входа срещу живия сървър — нито един 5xx, нито един „unhandled“), разширен
  `tests/runtime-config.cjs` (отказът е 400 с причина). `tests/docker-runtime.cjs`
  потвърждава, че новият модул влиза в образа — без него add-on-ът не стартира.
