# Състояние на изданието — hAPI Enterprise 0.69.198

Версия: **0.69.198** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **380/380** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.198 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 608 файла · 108191 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 603 файла · 107267 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 380 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.198.tar.gz` | add-on архив (201 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.198.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.198.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.198

- **Одит на пътя на обновяването + скрипт за прилагане.** Измерено защо „Обнови“ не се
  появява: add-on-ът е **локална папка** в `/addons` (`repository.yaml` липсва, тоест нито едно
  хранилище не е добавено като източник), интеграцията е **ръчно копие** в
  `/config/custom_components`, а **HACS липсва** (`/config/custom_components/hacs` и
  `.storage/hacs.*` не съществуват). Сървърната страна е наред: release `v0.69.197` е публичен
  с 6 артефакта, `SHA256SUMS.txt` съвпада 5/5, а образите в GHCR съществуват за `amd64`,
  `aarch64` и `armv7`. Изводът е в `documentation/07_RELEASE/UPDATE_PATH_AUDIT.md` — с двете
  решения (Supervisor хранилище за add-on-а, HACS custom repository за интеграцията) и
  таблица „симптом → причина → проверка“.
- **`scripts/apply-update.ps1`** — dry run по подразбиране; проверява release-а, `repository.yaml`,
  интеграционното хранилище и **образите в GHCR с анонимен pull токен** (точно това прави
  Supervisor), описва какво има на инстанцията и с `-Execute` копира интеграцията
  (`/MIR`, без `__pycache__`) и/или **преименува** локалните add-on папки на `*.local-<версия>.bak`
  (нищо не се трие). След копиране сверява **всеки файл по SHA-256**; излиза с код 1 само при
  истинска грешка, а находките за поправяне се отчитат отделно.
- **Приложено на инстанцията**: интеграцията е качена на 0.69.197 по SMB и сверена —
  **26/26 файла байт по байт**. Остават ръчните две отметки (добавяне на хранилището в
  Supervisor и рестарт) — програмният вход в API-то е измерено невъзможен на тази инсталация.
- `tests/apply-update-script.cjs` пази договора на скрипта: dry run по подразбиране, никакво
  рекурсивно триене, SHA-256 сверка, проверка на трите архитектури и наличие на одита.

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
