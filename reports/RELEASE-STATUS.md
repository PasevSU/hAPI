# Състояние на изданието — hAPI Enterprise 0.69.91

Версия: **0.69.91** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **315/315** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.91 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 513 файла · 86129 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 508 файла · 85539 реда · critical: 0 · high: 0 · medium: 0 · low: 193 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 315 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.91.tar.gz` | add-on архив (191 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.91.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.91.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.91

- **Под префикс (както е зад Home Assistant) страницата търсеше адресите си в корена на HA.**
  Страницата на портала получава адресите си от сървъра (`data-api`, `data-base`) и те бяха
  root-absolute: при `/hapi/p/<id>` браузърът би поискал `/api/v1/p/…` — маршрут на Home
  Assistant, не на hAPI. Причината да има префикс: `/api/` е пространството на HA (неговият API
  изглед обслужва `/api/{path}` и иска сесия), затова изглед, регистриран там от интеграция,
  може да бъде засенчен — aiohttp избира първия съвпаднал маршрут, а HA се вдига преди
  интеграциите. Сега интеграцията сервира същата публична повърхност и на **`/hapi/…`**, подава
  `X-Forwarded-Prefix` към backend-а, а сървърът слага префикса пред `{{BASE}}` и `{{API}}`.
  Префиксът се проверява (`links.prefixFromHeaders`): до три сегмента, без `.` и `..`, иначе се
  игнорира — иначе `X-Forwarded-Prefix: /../x` би изкарал адресите извън портала.
  `tests/ha-path-prefix.cjs` пуска сървъра и иска `data-api="/hapi/api/v1/p/<slug>"` и
  `data-base="…/hapi"`, а `ha-integration-python` иска изглед `/hapi/{tail:.*}`.
  **Проверено обратно:** махнат префикс от адресите → „под префикс API-то е
  /hapi/api/v1/p/<slug>“; махната проверка за `..` → „невалиден префикс се игнорира“.
  За да сочат и рекламираните адреси там: `public_base_url` = `https://<домейн>/hapi`.

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
