# Състояние на изданието — hAPI Enterprise 0.69.241

Версия: **0.69.241** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **468/468** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.241 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **0** находки в 0 файла |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 740 файла · 133331 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 733 файла · 131223 реда · critical: 0 · high: 0 · medium: 0 · low: 192 — чисто · изключения: 29/29 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 468 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.241.tar.gz` | add-on архив (238 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.241.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.241.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.241

- **Линтът вече не „минава“ заради потискания (DEF-66).** `npx eslint .` даваше 0, но това беше
  0 **след** `eslint-suppressions.json`: **216** находки в **135** файла чакаха в базата (9 правила),
  а никой не виждаше отчета. Днес **всички са поправени**, не преместени — базата е `{}`
  (0 файла, 0 записа).
- **По правила, не на парче.** `no-unused-vars` 38 (мъртви параметри и променливи — махани, не
  потискани), `no-useless-assignment` 52 (първото присвояване преди `return`/презапис — премахнато),
  `no-control-regex` 16 (контролните символи са НАРОЧНИ в санитизацията, затова получават
  `eslint-disable-next-line` с обосновка на точния ред), `no-useless-escape` 12 (в `runtime-config.js`
  character class-ът беше сбъркан — `\[`/`\]` са излишни, `\-` е нужен), `no-empty` 93, плюс
  `no-redeclare` (`app.js`), `no-unsafe-finally` ×2 в `instance-lock.js` (хвърлянето във `finally`
  поглъщаше изключението от `try` — сега се събира и хвърля след блока), `preserve-caught-error`
  в `storage-preflight.js` (`{ cause: e }`) и `no-regex-spaces` ×2.
- **Празният `catch` е решение, не мълчание.** 93-те места получиха отговор: трите в
  `scripts/dev-dashboard.cjs` носят обосновка в коментар, а в тестовете (изчакване на `/health`,
  почистване във `finally`) `no-empty` е с `allowEmptyCatch: true` **само за `tests/**/*.cjs`** —
  изключението е тясно и е записано в `eslint.config.mjs` с причина.
- **Ратчетът само пада.** Нов `tests/eslint-ratchet.cjs` пази тавана: иска базата да е празна, с
  `eslint --print-config` доказва, че продуктът остава под пълното правило (`allowEmptyCatch: false`
  за `server.js`, `ui/files-manager.js`, `scripts/test-matrix.cjs`), че изключението е scoped само
  до тестовете и че базата е валиден JSON. Мутационно проверен — добавен запис в базата го събаря.
  Защитата е вписана в `tests/regression-guards.cjs` (котва: „базата не бива да съдържа потискания“).

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
