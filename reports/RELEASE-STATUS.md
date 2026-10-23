# Състояние на изданието — hAPI Enterprise 0.69.43

Версия: **0.69.43** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **215/215** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.43 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 351 файла · 58567 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 347 файла · 58203 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 215 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.43.tar.gz` | add-on архив (142 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.43.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.43

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

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S21 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
