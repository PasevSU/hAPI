# Състояние на изданието — hAPI Enterprise 0.69.212

Версия: **0.69.212** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **414/414** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.212 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 654 файла · 119475 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 648 файла · 117504 реда · critical: 0 · high: 0 · medium: 0 · low: 203 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 414 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.212.tar.gz` | add-on архив (212 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.212.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.212.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.212

- **Образът вече СЕ билдва — и без npm.** В 0.69.210/0.69.211 Dockerfile-ът теглеше Node от
  `https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-<arch>-musl.tar.xz`. Такъв файл **не
  съществува** за официалните издания: и трите джоба на „Add-on image“ паднаха с
  `curl: (22) The requested URL returned error: 404` (плюс CI и Release workflow-ите).
  Причината: локалният тест четеше Dockerfile-а с регулярни изрази и „минаваше“, без никога
  да билдва образа. Сега Dockerfile-ът е на **два етапа**: `node:22.23.2-alpine` е етап 1 и от
  него се копира **само** `/usr/local/bin/node`; етап 2 е чист `alpine:3.24` с `libstdc++`
  (динамичният Node го иска). npm/npx/corepack остават в изхвърления етап — не съществуват
  нито във файловата система, нито в историята на слоевете. Измерено на истински build:
  `node --version` → `v22.23.2`, `npm/npx/corepack` → няма, `require("node:sqlite").DatabaseSync`
  → `function`, `zlib-1.4-r0`.
- **Заключеният critical в zlib е поправен; musl/openssl чакат Alpine.** `apk policy` в
  `alpine:3.24` показва, че хранилището дава `zlib 1.4-r0` (вдигнат от `--available`) и **само**
  `musl 1.2.6-r3` / `openssl 3.5.9-r0` — тоест за тях поправка в този клон още няма, а
  `alpine:3.25` не съществува (`docker pull` → `not found`). Записано е в `SECURITY.md` с
  точните версии и с едноредовия изход (`FROM alpine:3.2X`), когато клонът излезе.

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
