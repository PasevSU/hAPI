# План, част 2: интерфейс, премахване на Report Studio и ред на изпълнение (0.69.242)

> **Клас:** нормативен · **Собственик на факта:** издаване

Тази част продължава [PLAN_ONE_CLICK_REPORTS.md](./PLAN_ONE_CLICK_REPORTS.md) — §1 заявката,
§2 анализът на прикачения пакет, §3 текущото състояние, §4 решенията D1–D14, §5 сървърната
архитектура и §6 листът с линковете. Разделението е заради нормата за размер на нормативен
документ (`tests/docs-size.cjs` ≤ 400 реда), а номерата на разделите продължават от §7.

Файловете, които още липсват в дървото (създават се по стъпките в §11):

- `report-oneclick.js` — нов: рендърът на отчета;
- `statik-index.js` — нов: листът на линковете;
- `ui-files.json` — нов: allowlist-ът на UI файловете;
- `ui/selection.js` — нов: глобалното маркиране;
- `ui/portal-tree.js` — нов: дърво-панелът;
- `server_module/statik.js` — нов: маршрутът `/statik/`;
- нови тестове в `tests/`: `oneclick-reports.cjs`, `statik-links.cjs`, `ui-portal-tree.cjs`,
  `ui-report-buttons.cjs`, `report-studio-removed.cjs`.

---

## 7. Интерфейс

### 7.1 Дърво-панел (`ui/portal-tree.js`)

Нов блок „Дърво“ в акордеона на `files-manager.js` (ред до „Достъп и QR код“, „Папки“, „Файлове“),
с `expandPortalBlocks(host, { block: 'tree' })` за тестовете.

- Показва ЦЯЛОТО дърво на избрания портал (една заявка към `admin/api/portals/<id>/tree`).
- Всеки ред: чекбокс (`aria-label` = име на файла), икона, име, размер, дата.
- Маркирането отива в `HapiSelection` (D8); брояч в заглавната лента; „маркирай всичко в
  папката“ и „изчисти“.
- Операции върху маркираното (съществуващи маршрути, без нов сървърен код):
  **ZIP** (`routes/portal-archive.js`), **отчет за избраните** (новият `oneclick` с `files[]`),
  **копиране**, **преместване**, **нова папка** (`routes/folders.js`).
- Всяка операция има `role="status"` ред (като `fnRow` в `portal-control.js`) и не блокира
  останалите при грешка.

### 7.2 Бутони с едно натискане

| Къде | Какво | Как |
| --- | --- | --- |
| Карта на портала | „Отчет за портала“ (+ „пакет с доказателства“) | запис в `FUNCTIONS`, `area: 'report'` |
| Ред на папка | „Отчет за папката“ | икона в реда на дървото/списъка |
| Ред на файл | „Отчет за файла“ | икона в реда (до съществуващата зъбчатка) |
| Дърво-панел | „Отчет за избраните“ | общ бутон `#pf-fn-run` |

След успех панелът показва линка и го слага в листа; бутон „копирай линка“.

### 7.3 Какво изчезва от екрана

- Разделът „Отчети“ в главното меню (Report Studio), табът „Отчети“ в настройките, зъбчатката
  „Отчет в студио“ до файл, бутоните „комбо/рекурсивен комбо“ на таблото — всичко това води до
  студиото и се маха заедно с него.

---

## 8. Йерархия (какво стои под какво)

```
портал
└─ папка
   └─ файл
```

Едно и също правило за трите нива: **всеки възел може да роди отчет за себе си и за всичко под
себе си**. Отчетът винаги описва точно това ниво (`scope`), а `files` брои колко файла влизат.
Затова `oneclick` приема `type` и `path`, а не „списък от екрана“ — екранът само подава пътя.

---

## 9. Премахване на Report Studio — инвентар

### 9.1 Файлове за изтриване (интерфейс)

| Файл | Байтове | Зависимости, които остават |
| --- | --- | --- |
| `ui/report-studio.js` | 62 119 | — |
| `ui/report-scope.js` | 14 626 | заменя се от `HapiSelection` |
| `ui/report-objects.js` | 5 172 | обектите стават част от манифеста на новия `report-oneclick.js` |
| `ui/report-sign.js` | 9 781 | подписът остава сървърен (`routes/reports.js`) |

### 9.2 Места за пипане

| Място | Какво |
| --- | --- |
| `ui/index.html` редове 75–79 | махат се 4-те `<script>` тага, добавят се `selection.js`, `portal-tree.js` |
| `server.js` `UI_FILES` | излиза в `ui-files.json` (D12) и там няма записи за студиото |
| `ui/app.js` `NAV_GROUPS` | разделът „Отчети“ се маха; групите остават 4 × 4 (симетрията е закон) |
| `ui/settings-panel.js` `GROUPS` | табът „Отчети“ се маха; групите остават 3 × 6 |
| `ui/panel-registry.js`, `ui/files-manager.js` | дерегистрация на панела |
| `ui/i18n.js` | ключовете `rs.*`, `report.scope.*` се махат; `tests/ui-i18n-ratchet.cjs` `CEILING` се сваля |
| `hapi_enterprise/report-render.js` ред(ове) с „report-studio“ | само коментари/идентификатори, ако сочат към студиото |

### 9.3 Тестове — какво се променя и какво остава

| Тест | Съдба |
| --- | --- |
| `tests/report-entry-points.cjs` | **преписва се**: входовете вече са бутони към `oneclick`, не към студио |
| `tests/gui-sections.cjs` (17 секции) | броят се сваля с премахнатите секции |
| `tests/ui-settings-sections.cjs` (18 таба) | 18 → 17 |
| `tests/gui-coverage.cjs` | секциите на студиото излизат от обхвата |
| `tests/cms-panel.cjs`, `report-render`, `report-stamp`, `report-package`, `report-qr`, `pdf-signature`, `oracle-digest-chain` | **остават** — тестват сървъра, който остава |
| **нов** `report-studio-removed.cjs` | пазач: файловете липсват, няма `<script>` таг, няма запис в `UI_FILES`/`ui-files.json`, няма навигационен раздел, няма висящ ключ `rs.*` |
| **нов** `oneclick-reports.cjs` | трите обхвата дават PDF с верни заглавки и запис в индекса |
| **нов** `statik-links.cjs` | линкът работи без токен; непознат/изтекъл → 404; traversal → 404; `ETag` → 304; `noindex` |

Документация за преписване: `04_FUNCTION_SPECIFICATIONS/REPORT_OBJECTS.md`,
`REPORT_SCOPES.md` → един `REPORT_ONECLICK.md`; `03_ADR/ADR-0025-report-studio.md` остава
замразен, добавя се `ADR-0028`; `02_TO_BE_ARCHITECTURE/` (ARCHITECTURE_COMPLIANCE_MATRIX),
`06_TESTING/TEST_CASE_CATALOG.md`, `01_AS_IS_ARCHITECTURE/SYSTEM_STATE.md`,
`07_RELEASE/UNFINISHED_TASKS_0.69.211.md`.

---

## 10. Порти, които планът трябва да уважи

| Порта | Какво иска | Как планът го изпълнява |
| --- | --- | --- |
| `server-structure` | `server.js` ≤ 2722 реда, 22 компонента, договор `create/handle` | 0 нови реда (`host` на ред 793; `ui-files.json` освободи **10** реда — измерено, не „~40“) |
| `html-assets` / `ingress-panel-load` | всеки сервиран UI файл е в allowlist | `ui-files.json` + `?v=<версия>` |
| `static-cache` | `?v=` → immutable, иначе `no-cache`; без `no-store` | `/statik/` е отделен namespace с `immutable` по id, вписан в теста |
| `ui-portal-functions` | ≥10 функции, икони от `icons-v4-map.json`, 3 езика, чекбокс, общ бутон | отчетите влизат като записи в `FUNCTIONS` |
| `ui-i18n-ratchet` | нов модул = ред в `CEILING`, таванът само се сваля | `selection.js`, `portal-tree.js` с таван 0 |
| `ui-nav-symmetry` | 4 × 4 и 3 × 6 | разделът се маха от група, не „накрая“; групите се преброяват |
| `ui-block-aria` | `aria-controls` само в разгънато състояние | новият блок „Дърво“ следва същото |
| `field-labels` | етикети през `ui/field-labels.js` | новите полета не пишат `for`/`id` сами |
| `integrity-startup` | SHA-256 на критичните файлове | `node scripts/integrity-manifest.cjs` след всяка промяна |
| `docker-runtime` | `COPY server_module` и `COPY ui` | новите файлове влизат в `COPY` |
| `regression-guards` | всеки затворен дефект има тест и котва | DEF за студиото → `GUARDS` + `ANCHORS` |
| `docs-class`/`docs-index` | клас + ред в индекса | този документ се вписва с `docs-class --write` и `docs-index` |
| `api-reference`/`openapi-admin` | новите маршрути се регенерират | `api-reference`, `openapi-admin` след кода |
| `audit-events`/`error-codes` | новите одитни събития и кодове се вписват | `report.oneclick`, `statik.get`, `statik.gone` |
| `known-defects` | заглавие с текущата версия, затворен ред сочи файл | новите редове носят 0.69.242 |

---

## 11. Ред на изпълнение (всяка стъпка със зелен критерий)

| # | Стъпка | Зелен критерий |
| --- | --- | --- |
| 0 | Двете части на плана + `ADR-0028`, `docs-class --write`, `docs-index` | `node tests/docs-class.cjs`, `docs-index` |
| 1 | ✔ `ui-files.json` (D12) + `server.js` чете оттам · изпълнена | `server-structure` (2712/2722), `html-assets`, `ingress-panel-load`, `docker-runtime`, `ui-version` |
| 2 | ✔ нов `report-oneclick.js` + маршрут `oneclick` + лист · изпълнена | `oneclick-reports.cjs` |
| 3 | ✔ нов `statik-index.js` + `server_module/statik.js` + retention · изпълнена | `statik-links.cjs`, `docker-runtime` |
| 4 | `ui/selection.js` + `ui/portal-tree.js` + блок „Дърво“ | `ui-portal-tree.cjs`, `ui-block-aria` |
| 5 | Бутони в `FUNCTIONS` (`area: 'report'`) + линк в листа на екрана | `ui-portal-functions`, `ui-report-buttons.cjs` |
| 6 | Махане на Report Studio (§9) + пазач | `report-studio-removed.cjs`, `gui-sections`, `ui-settings-sections` |
| 7 | Документация: `REPORT_ONECLICK.md`, API референции, `SYSTEM_STATE.md` | генераторите + `docs-manual`, `api-reference`, `openapi-admin` |
| 8 | Версия 0.69.242 (8 огледала), `CHANGELOG`, `KNOWN_DEFECTS`, матрикс ×2, `verify-release` 22/22, комит + таг | `release-status`, `safe-release` |

Всяка стъпка е самостоятелна: ако 5 се окаже трудна, 1–4 вече са в дървото и зелени.

---

## 12. Рискове и как се хващат

| Риск | Хващане |
| --- | --- |
| `/statik/` става страничен вход към файлове | `id` е 32 знака от `crypto.randomBytes(24)`; пътят се взима САМО от индекса; `statik-links.cjs` пробва `../`, абсолютен път и чужд `id` |
| Отчет за огромен портал блокира заявката | `files`/`bytes` се броят преди рендера; над праг (10 000 файла) → `413` с точен текст; рендерът е синхронен, но с ограничение |
| Индексът се поврежда | запис през temp + `rename`; четене с толерантност; `statik-links.cjs` пуска счупен JSON |
| Report Studio оставя висящи ключове | `report-studio-removed.cjs` търси `rs.` в `i18n.js` и в `data.js` |
| Навигационната симетрия се чупи | `ui-nav-symmetry` брои групите след махането |
| `server.js` пак стига тавана | стъпка 1 освободи **10** реда (измерено); новият код е извън него по договор |
| Шрифтове/PDF в Alpine | не се пипа рендърът; пази `tests/pdf-signature.cjs` (тече и днес) |
| Дублиране на дървото (сървър) | панелът ползва `routes/folders.js`; нов сървърен код само за отчети и `/statik/` |

---

## 13. Извън обхват (съзнателно)

- **Не вграждаме** `_HASH_REPORT_ENTERPRICE_cli.7z` като зависимост (D1) — нито JS порта, нито
  Python генератора, нито `vendor/pdf-rfc3161`.
- **Не правим** QR код към `/statik/` линк — те са само за изтегляне (изрично изискване).
- **Не правим** публичен листинг на `/statik/` и не показваме линковете в портала.
- **Не махаме** сървърния рендър, RFC 3161, CMS подписа и пакета с доказателства — те остават и
  се ползват от новите бутони.
- **Не пипаме** `report-manifest.js` схемата освен ако `oneclick` не поиска ново поле; ако поиска,
  то влиза с тест в `tests/report-render.cjs`.

---

## 14. Какво следва веднага след одобрението

Стъпки 1–3 (§11) са изпълнени: allowlist-ът на статиката е `hapi_enterprise/ui-files.json`
(`server.js` 2722 → 2715), отчетът се строи от `report-oneclick.js` през
`POST /admin/api/v2/reports/oneclick`, а линкът `/statik/<id>/<име>` се сервира от
`server_module/statik.js` без токен. Следва стъпка 4 — `ui/selection.js` и `ui/portal-tree.js`
(маркиране и дърво-панел), защото отчетът за избраните файлове идва оттам.
