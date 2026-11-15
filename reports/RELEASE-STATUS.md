# Състояние на изданието — hAPI Enterprise 0.69.213

Версия: **0.69.213** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **415/415** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.213 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 655 файла · 119572 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 649 файла · 117601 реда · critical: 0 · high: 0 · medium: 0 · low: 203 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 415 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.213.tar.gz` | add-on архив (211 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.213.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.213.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.213

- **Архивът на изданието съдържа само това, което е в хранилището.** `build-release.cjs`
  събира файловете от файловата система, затова всеки локален, **игнориран** файл в
  `hapi_enterprise/` влизаше в `dist/`. Измерено при 0.69.212: локалният
  `hapi_enterprise/generator.7z` даде **212** файла в `dist/RELEASE.json`, а CI (където файла
  го няма) — **211**. `reports/RELEASE-STATUS.md` цитира точно тази бройка, тоест отчетът
  съдържаше машинно-зависимо число: CI го обяви за остарял (`reports/RELEASE-STATUS.md е
  остарял`) и `Release` падна, без нито един ред код да е сгрешен. Сега `release-lib.cjs` има
  `ignoredPaths()` (чете `git ls-files --others --ignored --exclude-standard`) и
  `archiveEntries()`, което ползват add-on архивът, интеграцията и GUI пакетът. Без git
  поведението е старото. Пази го `tests/release-archive-ignored.cjs` (собствено git хранилище
  в `%TEMP%` + проверка, че в това хранилище нито един запис на изданието не е игнориран).
- **Затваря DEF-58** (архивът зависи от локални файлове) — с котва в
  `tests/regression-guards.cjs`.

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
