# Състояние на изданието — hAPI Enterprise 0.69.240

Версия: **0.69.240** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **467/467** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.240 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **216** находки в 135 файла (най-много `no-empty` 93) |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 739 файла · 133252 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 732 файла · 131144 реда · critical: 0 · high: 0 · medium: 0 · low: 195 — чисто · изключения: 29/29 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 467 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.240.tar.gz` | add-on архив (238 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.240.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.240.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.240

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

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S23 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
