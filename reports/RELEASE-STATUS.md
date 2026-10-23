# Състояние на изданието — hAPI Enterprise 0.69.47

Версия: **0.69.47** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **218/218** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.47 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 357 файла · 59475 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 353 файла · 59111 реда · critical: 0 · high: 0 · medium: 0 · low: 158 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 218 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.47.tar.gz` | add-on архив (145 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.47.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.47

Договорът покрива и компонентите: отчети, CMS подпис, RFC 3161 и генератор.

- **Какво липсваше:** в 0.69.46 договорът беше пълен за маршрутите, записани като
  литерал в `server.js`. Маршрутите, които живеят в `routes/*.js` (дял `/admin/api/v2`
  + `parts[3]`/`parts[4]`), оставаха извън него — тоест точно тези, които правят
  доказателствата: рендер на отчет, пакет с доказателства, CMS подпис и неговата
  проверка, RFC 3161 START/STOP и проверката на `.tsr`, както и четирите на генератора.
- **Ново:** 12 операции, всичко **123** (беше 111): `/admin/api/v2/reports/render|package|sign`,
  `/admin/api/v2/cms/verify`, `/admin/api/v2/rfc3161` (GET/POST), `/admin/api/v2/rfc3161/verify`
  (GET/POST), `/admin/api/generator/templates` (GET/POST) и `/admin/api/generator/templates/{name}`
  (GET/DELETE). Нови тагове `reports` и `generator`.
- **Как е закрепено:** `tests/admin-api-spec.cjs` държи изрична таблица за компонентите,
  но всяка двойка носи **доказателство** — котва в кода и условие за метода, което трябва
  да се намери в рамките на 40 реда. Промяна в `reports.js`/`generator.js` без промяна в
  договора чупи теста. Добавен е и обратен тест: всеки дял (`parts[3] === 'x'`, включително
  негативния `!==` на генератора) трябва да има поне един описан път.
- Договорът вече проверява и че `operationId` е **уникален** — иначе генераторите на
  клиенти правят един метод за два пътя.

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
