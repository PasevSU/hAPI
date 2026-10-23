# Състояние на изданието — hAPI Enterprise 0.69.39

Версия: **0.69.39** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **211/211** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.39 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 345 файла · 57873 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 341 файла · 57509 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 211 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.39.tar.gz` | add-on архив (141 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.39.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.39

`server.js` спира да бъде монолит: HTTP слоят се разделя на компоненти.

- Отчетите и генераторът вече са отделни файлове: `hapi_enterprise/routes/reports.js`
  (`/admin/api/v2/reports/{render,package,sign}`, `rfc3161` + `verify`) и
  `hapi_enterprise/routes/generator.js` (`/admin/api/generator/templates`). Кодът е
  преместен 1:1 — нито един маршрут не е променен.
- Един договор за всички: `create(deps)` → `handle({ req, res, url, parts, method })`,
  който връща `true` (заявката е негова и е приключена) или `false` (следващият я поема).
  Зависимостите се подават изрично — компонентът не пипа база, портали или файлове,
  ако не са му дадени.
- `server.js` падна от 2971 на 2727 реда; таванът се пази от `tests/server-structure.cjs`
  и **само се намалява** — нов маршрут отива в компонент.
- Тестът хваща и втората класическа грешка при изнасяне: `require('./…')` от `routes/`
  гледа в `routes/`, а не в `hapi_enterprise/` (точно това даде 500 при отчетите,
  докато не се поправи на `../`).
- `Dockerfile` копира `routes/`; `hapi_enterprise/routes/README.md` описва договора и
  следващите кандидати (sensors, core, ui-assets, portals, settings).

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
