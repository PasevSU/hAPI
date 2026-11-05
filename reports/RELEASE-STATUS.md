# Състояние на изданието — hAPI Enterprise 0.69.164

Версия: **0.69.164** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **358/358** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.164 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 575 файла · 98499 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 570 файла · 97561 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 358 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 43 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.164.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.164.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.164.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.164

- **Watchdog-ът е описан според поведението на Supervisor.** `watchdog:` задава само
  адреса за проверка; watchdog-ът е отделен ключ за всяко приложение и е изключен по
  подразбиране. Ръководството показва как да го включиш и диагностицира случая, когато
  add-on-ът спре, без Supervisor да го рестартира. `tests/addon-config.cjs` пази това уточнение.
- **Възстановена е поддръжката за `armv7`.** Архитектурата присъства в `config.yaml`, а
  проверките съпоставят всяка обявена архитектура с базовия Node образ и workflow-а за образи.
- **Описанията на съхранението сверени с доставяните defaults.** Подразбираното място е
  `addon_config/hapi_enterprise`; Samba-достъпният `/share/hapi/data` остава отделна опция.
- **Достъпност на интерфейса.** Етикетите на полетата в Export Center вече сочат към
  контролите си, а диалогът на файловия панел ограничава Tab-фокуса вътре и връща фокуса
  към основния изглед, ако задействащият елемент е премахнат при прерисуване.
- **Осъвременен е Node 22 patch pin-ът.** `node:22.23.2-alpine3.24` е потвърден в Docker
  Registry за `amd64`, `arm/v7` и `arm64/v8`; той остава над изискването `Node >=22.13`
  за `node:sqlite`. Това е runtime актуализация, не твърдение, че CVE броят е нула.

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
