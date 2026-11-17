# План: отчети с едно натискане, дърво-панел и `/statik/` линкове (0.69.242)

> **Клас:** нормативен · **Собственик на факта:** издаване

Този документ е **анализът и планът преди кода** за следващата функционалност. Нищо от
описаното тук не е реализирано към 0.69.241 — редът е: този документ → ADR-0028 → код по
фазите в §11 (част 2), всяка фаза със зелен критерий.

---

## 1. Заявката на собственика (дословно, за да не се загуби смисълът)

> „следващата стъпка не трябва да се прави без цялостен документиран анализ и план, следвайки
> вече изградената йерархична структура като по нея трябва да създадеш към прикаченият вече
> пакет бутони изготвящи точните репорти с натискането на един бутон поставен на папка, файл
> или на самият портал.“

Пет изисквания, които се разграждат на задачи:

| № | Изискване | Раздел |
| --- | --- | --- |
| 1 | Един бутон на **папка**, **файл** и **портал** → точен отчет, по прикачения пакет | §4, §8 |
| 2 | Панел с **цялото дърво** на портала: маркиране на файлове (глобална функция за ZIP и отчет с избрани файлове), копиране, преместване, нови папки | §7 |
| 3 | Отчетите дават **твърдогенерирани линкове** с префикс `/statik/`, само за изтегляне (без QR към панели), вписани в **лист**, който ги свързва с пътя до файла/файловете; по желание и препратка към API линковете | §5, §6 |
| 4 | Файлът се генерира **ВИНАГИ отделно** при натискане на бутона по т. 2 — не се преизползва стар | §5.4 |
| 5 | **Report Studio се премахва изцяло** | §9 |

Раздели §7–§14 са в [част 2](./PLAN_ONE_CLICK_REPORTS_UI.md): интерфейс, йерархия, инвентар за
премахването на студиото, порти, ред на изпълнение, рискове и обхват. Разделението е заради
нормата за размер на нормативен документ (`tests/docs-size.cjs` ≤ 400 реда).

---

## 2. Анализ на прикачения пакет `_HASH_REPORT_ENTERPRICE_cli.7z`

Архивът е 3 857 114 байта (17.11.2026). `7z` липсва на машината, но `tar` (bsdtar) чете 7z —
извлечен е извън хранилището в `D:\_hash_report_cli\_HASH_REPORT_ENTERPRICE_cli`.

### 2.1 Какво има вътре (измерено)

| Папка | Файлове | Байтове | Съдържание |
| --- | --- | --- | --- |
| `js/` | 34 | 259 355 | Node ESM порт: `api.mjs`, `cli.mjs`, `archive.mjs`, `generate.mjs`, `lib/*.mjs`, `lib/reports/*`, `lib/pdf/*` |
| `hash_report_generator/assets` | 1 | 751 | шаблон |
| `hash_report_generator/style` | 34 | 39 303 | декларативни стилове (`*_font_families.js` и др.) |
| `docu/` | 121 | 386 901 | документация на пакета |
| `config/` | 2 | 10 361 | конфигурация |
| `vendor/` | **липсва** | — | `vendor/pdf-rfc3161` (посочен в `package.json` като `file:`) |

### 2.2 Какво пакетът всъщност предлага (прочетено, не предположено)

- Програмен API `js/api.mjs`: `buildArgv`, `prepareOutput`, `reportForFolder`, `reportForFile`,
  `reportForFiles`, `normalise`, `quietFor`, `execute`, `CLONE_VERSION`. Опции: `source, files,
  filters, recursive, output, profile, archive, normalise, requireLayoutPass, perFile, embedPdf,
  embedPosition, quiet`.
- Регистър на типовете отчети `js/lib/reports/index.mjs`: **8 модула** — `single`, `single_pdf`,
  `combo`, `combo_all`, `combo_pdf`, `combo_all_pdf`, `volume`, `file_information_report`. Всеки е
  замразен обект `{ id, title, input_scope, version, sections[] }`; секциите идват от
  `sections.mjs` (22 804 B) през `getSection`.
- `report_profiles/*.js` — 8 декларативни профила по ~260–300 B (тип + секции), без логика.

### 2.3 Три пречки пред вграждането такъв, какъвто е

1. **`vendor/` не идва с архива.** `package.json` сочи `"pdf-rfc3161": "file:vendor/pdf-rfc3161"`,
   но папката липсва, тоест `npm install` в хранилището би паднал.
2. **PDF зависимостта не е в JS пътя.** Търсене за `pdf-rfc3161`, `vendor/` и `canRequire` в
   `js/*.mjs` и `js/lib/*.mjs` не връща нищо — PDF частта минава през `tools/pdfnorm` и
   `tools/jsx/style-loader.mjs`, които не са в `js/` порта.
3. **Шрифтовете са системни TrueType без fallback.** `js/lib/fonts.mjs` внася
   `../../tools/pdfnorm/lib/fonts.mjs` (`TrueTypeFont`) и иска реални файлове от операционната
   система за 6 роли (regular, bold, italic, bold_italic, monospace, monospace_bold), като
   нарочно пада шумно, ако липсват. Базовият образ на add-on-а е `alpine:3.24` — там такива
   шрифтове няма, а политиката на хранилището е **нула runtime зависимости**.

### 2.4 Изводът (решение D1)

Пакетът се ползва като **спецификация**, не като зависимост: взимат се типологията на отчетите,
имената и съставът на секциите, декларативните профили и правилата за съдържание. Рендърът
остава нашият — вече изграден, тестван и без зависимости:

| Модул | Байтове | Роля |
| --- | --- | --- |
| `hapi_enterprise/report-manifest.js` | 21 676 | манифест на отчета, `digest(manifest)` |
| `hapi_enterprise/report-render.js` | 20 191 | `renderPdf(manifest, {data, hashes, certificates, watermark, stamps, createdAt, system})` → Buffer |
| `hapi_enterprise/report-package.js` | 8 469 | пакет с доказателства (ZIP: PDF + манифест + `.tsr`) |
| `hapi_enterprise/report-stamp.js` | 10 605 | RFC 3161 времеви печат (изричен, `tsa: true`) |
| `hapi_enterprise/routes/reports.js` | 329 реда | HTTP договорът под `admin/api/v2/{reports,cms,rfc3161}` |

Тече и днес: `tests/report-render.cjs`, `tests/pdf-signature.cjs`, `tests/report-stamp.cjs`,
`tests/report-package.cjs`, `tests/oracle-digest-chain.cjs`, `tests/cms-panel.cjs`. Тоест
рендърът в Alpine работи — шрифтовете са вградени в нашия рендър, не се търсят по системата.

---

## 3. Анализ на текущото състояние (какво има и какво пречи)

### 3.1 Сървър — бюджет и автоматично зареждане

| Факт | Последица за плана |
| --- | --- |
| `server.js` е **точно 2722 реда** при таван 2722 | Нов код НЕ влиза в `server.js` |
| `server_module/*.js` се зарежда **всеки по име**, договор `create(host) → { handle(ctx) }` | `/statik/` влиза като `server_module/statik.js` — **0 нови реда** в `server.js` |
| `routes/*.js` се вписват ръчно в `server.js` (по един ред) | новите отчетни маршрути влизат в **съществуващия** `routes/reports.js` — 0 нови реда |
| `host` за `server_module` се строи на ред 793 (един дълъг ред) | новите зависимости се дописват на **същия ред** — 0 нови реда |
| `server_module/<файл>` иска ред в `COPY server_module /app/server_module/` | иначе `docker-runtime` пада |
| `UI_FILES` в `server.js` е allowlist с по един ред на файл | 3 нови UI файла = 3 нови реда → **нужно е освобождаване (D12)** |

### 3.2 Отчети днес

- Три входа водят до Report Studio (`tests/report-entry-points.cjs` го пази): табло (само
  „всичко“), зъбчатка до файл, карта на портала. И четирите строят **манифест** и го подават на
  студиото, където потребителят довършва ръчно (обхвати, обекти, подпис).
- Това е точно процесът, който собственикът иска да изчезне: „един бутон → точен отчет“.

### 3.3 Статика и кеш

- `static-etag.js` (2955 B): `load(file, transform)` пази тяло + `ETag` (sha256 base64url, 27
  знака) в `Map` за живота на процеса; `matches(req, etag)` → 304 без тяло.
- Правило: `/ui/*`, `/portal.css`, `/portal.js`, `/portal-i18n.js` носят `?v=<версия>` и
  `private, max-age=31536000, immutable`; иначе `no-cache`. `no-store` на статика и
  `public, max-age` на миниатюри са забранени (DEF-87).
- `/statik/` **не е** статика на панела: съдържанието се ражда при поискване (отчет), затова
  минава през същия модул за `ETag`/304, но с `immutable` по id (съдържанието на един id никога
  не се променя).

### 3.4 Вече съществуващи маршрути, които НЕ бива да се дублират

| Маршрут | Файл | Ползва се за |
| --- | --- | --- |
| `admin/api/portals/<id>/tree…` | `routes/folders.js` (192) | дървото, създаване на папка, преместване, копиране |
| `api/v1/p/<slug>/tree/file` | `routes/portal-storage.js` (510) | изтегляне на файл от портала (изисква токен) |
| `admin/api/v2/reports/*` | `routes/reports.js` (329) | render/package/sign/tsa |
| `…/archive` | `routes/portal-archive.js` (312) | архивиране, retention 183 дни, `PURGE_EVERY_MS = 6h` |

Извод: **дървото и файловите операции вече съществуват на сървъра** — липсва само панел, който
да ги ползва с маркиране. Нов сървърен код се пише само за отчетите и за `/statik/`.

---

## 4. Решения (всяко с причина; тези редове са договорът)

**D1 — Пакетът е спецификация, не зависимост.** Причини в §2.4: липсващ `vendor/`, PDF извън JS
порта, системни шрифтове срещу политиката „нула зависимости“.

**D2 — Три типа отчет вместо осем.** Пакетът има 8 модула, но те са вариации на три обхвата.
Отчетите с едно натискане са:

| Бутон стои на | Тип | Секции (по `sections.mjs`) | Файл в линка |
| --- | --- | --- | --- |
| портал | `portal` (≈ `volume` / `combo_all`) | `timestamp_record`, `generation_note`, `legal_documentation`, `file_inventory`, `text_checksums` | `report-portal-<slug>-<ts>.pdf` |
| папка | `folder` (≈ `single`) | `timestamp_record`, `generation_note`, `legal_documentation`, `text_checksums` | `report-folder-<name>-<ts>.pdf` |
| файл | `file` (≈ `file_information_report`) | `timestamp_record`, `generation_note`, `text_checksums` | `report-file-<name>-<ts>.pdf` |

Четвърти бутон (по избор, включен по подразбиране изключен): „пакет с доказателства“ — същият
отчет + манифест + `.tsr` в ZIP през `report-package.js`.

**D3 — Къде живее кодът.** Рендър логиката (сканиране на обхвата → манифест → PDF) е в нов
`hapi_enterprise/report-oneclick.js` (чист модул, без HTTP). HTTP договорът е нов ред в
**съществуващия** `routes/reports.js` под `admin/api/v2/reports/oneclick`. `/statik/` е
**нов** `server_module/statik.js` (зарежда се автоматично, 0 реда в `server.js`).

**D4 — Листът с линковете е един файл: `statik/index.json`.** Живее до генерираните файлове в
`<root>/statik/`. Един запис = един отчет = един линк. Схема в §6.1.

**D5 — Линкът е capability, не автентикация.** `/statik/<id>/<име>.pdf`, при което **файлът се
намира по `id` в индекса**, а не по пътя в адреса. Непознат или изтекъл `id` → **404** (не 403,
за да няма изброяване). Пътят от URL-а никога не се използва за достъп до диска → няма
traversal. Заглавки в §6.3. Само `GET`/`HEAD`.

**D6 — API линкът е втори стълб в листа.** Всеки запис носи и `api` — адреса на файла/папката в
порталното API (`/api/v1/p/<slug>/tree/file?path=…`, `routes/portal-storage.js`). Той иска токен
и не е публичен; листът го показва, за да може операторът да стигне до оригинала.

**D7 — Никакъв кеш на отчет.** Всяко натискане ражда **нов** `id` и нов запис; старите остават
до retention. Това изпълнява изискване №4 буквално: файлът винаги се генерира отделно.

**D8 — Маркирането е глобален обект.** Нов `hapi_enterprise/ui/selection.js` —
`window.HapiSelection` с `toggle, add, remove, has, list, clear, count, onChange`. Ползват го
ZIP, „отчет с избрани файлове“ и копиране/преместване — една истина за „кое е маркирано“, вместо
всеки панел да държи своя масив (днес `report-scope.js` държи своя и затова изчезва).

**D9 — Бутоните влизат в съществуващия обект с функции.** `ui/portal-control.js` вече има
`FUNCTIONS` (ред 18) с чекбокс, икона от `icons-v4-map.json`, `role="status"` ред и общ бутон
`#pf-fn-run`. Новите отчети влизат като записи с `area: 'report'` — тоест наследяват чекбоксове,
икони, три езика и изолация на грешка, вместо да е нов паралелен механизъм.
`tests/ui-portal-functions.cjs` пази това.

**D10 — Report Studio се маха изцяло, но сървърният рендър остава.** Маха се **интерфейсът**
(студио, обхвати, обекти, подпис) и входовете към него; остава **рендърът**, защото новите
бутони го ползват. Инвентар в §9.

**D11 — Ново ADR.** `ADR-0028-one-click-reports.md` отменя ADR-0025 (Report Studio) по същество;
ADR-0025 остава замразен (клас „исторически“).

**D12 — `UI_FILES` излиза от `server.js` в JSON.** Днес всеки нов UI файл иска ред в `server.js`
при таван 2722/2722. Списъкът се мести в `hapi_enterprise/ui-files.json`, `server.js` го чете с
един ред → освобождава ~40 реда и прави добавянето на UI файл безболезнено. Котвата в
`tests/server-structure.cjs` и `tests/html-assets.cjs` се мести заедно със списъка.

**D13 — Езикът не се пише на ръка.** Всички нови низове са ключове в `i18n.js` (BG/EN/DE), а
новите модули имат таван 0 български стринга в `tests/ui-i18n-ratchet.cjs` (`CEILING`).

**D14 — Retention и одит.** Записите в `statik/index.json` живеят **183 дни** (същата политика
като `portal-archive.js`), чистят се при старт и на всеки 6 часа. Всяко генериране, всяко
изтегляне и всяко изтриване влизат в одита (`report.oneclick`, `statik.get`, `statik.gone`).

---

## 5. Сървърна архитектура

### 5.1 Нови файлове

| Файл | Роля | Редове (цел) |
| --- | --- | --- |
| `hapi_enterprise/report-oneclick.js` | сканира обхват → манифест → PDF; чисти функции без HTTP | ~180 |
| `hapi_enterprise/server_module/statik.js` | `/statik/<id>/<име>` — само за изтегляне | ~120 |
| `hapi_enterprise/statik-index.js` (нов) | четене/запис/чистене на `statik/index.json` | ~110 |
| `hapi_enterprise/ui-files.json` | allowlist на UI файловете (D12) | данни |
| `hapi_enterprise/ui/selection.js` | глобално маркиране (D8) | ~90 |
| `hapi_enterprise/ui/portal-tree.js` (нов) | панел с дървото, маркиране, операции | ~320 |

Променени: `routes/reports.js` (+1 маршрут), `ui/portal-control.js` (`area: 'report'`),
`ui/files-manager.js` (акордеон „Дърво“), `ui/index.html` (script тагове), `i18n.js` (ключове),
`server.js` (само `host` на ред 793 и четене на `ui-files.json` — 0 нови реда),
`Dockerfile` (`COPY server_module`), `integrity-manifest.json`.

### 5.2 Договор на `report-oneclick.js`

```js
// Един вход за трите обхвата. Не знае за HTTP, за да е тестваем без сървър.
// връща { manifest, pdf, sha256, bytes, name, type, scope, files }
async function build({ type, portalRoot, portalId, slug, path: rel, portalName })
```

- `type: 'portal' | 'folder' | 'file'`; за `folder`/`file` `rel` е относителен път в портала.
- сканира обхвата (за `portal`/`folder` — рекурсивно), брои файлове и байтове, смята `sha256`
  на всеки файл през `core.api.hash`, строи `manifest` в схемата на `report-manifest.js`
  (`profile`, `createdAt`, `files[]`, `totals`), после `report-render.renderPdf(...)`.
- **отказва** празен обхват (400 „няма файлове“) и път извън портала (400) — иначе отчетът
  щеше да твърди нещо за нула файла.

### 5.3 HTTP договор

| Метод | Път | Тяло | Отговор |
| --- | --- | --- | --- |
| `POST` | `admin/api/v2/reports/oneclick` | `{portal, type, path?, tsa?, package?}` | `202` `{id, url, name, sha256, bytes, type, scope, files, createdAt, api}` |
| `GET` | `admin/api/v2/reports/links?portal=` | — | `{links: [запис…]}` (листът, §6.1) |
| `DELETE` | `admin/api/v2/reports/links/<id>` | — | `204` (махва запис и файл) |
| `GET`/`HEAD` | `/statik/<id>/<име>.pdf` | — | PDF, `attachment`, `immutable`, `ETag` |

- `POST /oneclick` **винаги** рендира наново (D7); `202` е защото при голям портал рендърът е
  секунди — отговорът идва след записа в индекса, но клиентът получава готовия линк.
- Всичко под `admin/api/v2/reports` е зад `adminGate` — същото като днес.
- `/statik/` **не** е зад adminGate (иначе линкът не е „твърдогенериран“), затова е capability
  (D5) + `noindex` + без листинг.

### 5.4 Защо файлът се ражда при натискане, а не предварително

Изискване №4 идва от реален риск: отчет, изтеглен от стар линк, твърди състояние, което вече не
е вярно. Затова: рендър → запис в индекса → връщане на линка, в една заявка. Няма „подготвен
отчет“, няма фонова задача, няма кеш на байтовете.

---

## 6. Листът с линковете

### 6.1 Схема на `statik/index.json`

```json
{
  "version": 1,
  "updatedAt": "2026-11-17T15:00:00.000Z",
  "links": {
    "kQ7d…32знака": {
      "id": "kQ7d…",
      "file": "report-portal-demo-20261117T150000Z.pdf",
      "portalId": "p_abc",
      "slug": "demo",
      "type": "portal",
      "scope": "portal",
      "path": "",
      "name": "report-portal-demo-20261117T150000Z.pdf",
      "sha256": "…",
      "bytes": 184320,
      "files": 42,
      "url": "/statik/kQ7d…/report-portal-demo-20261117T150000Z.pdf",
      "api": "/api/v1/p/demo/tree/file?path=",
      "createdAt": "2026-11-17T15:00:00.000Z",
      "expiresAt": "2027-05-19T15:00:00.000Z",
      "hits": 0,
      "lastHitAt": null
    }
  }
}
```

`path` е относителният път в портала (за `folder`/`file`), `url` е готовият линк, `api` е
препратката към API-то (D6). Листът се показва в панела като таблица „кога · какво · път · линк ·
изтегляния“, с бутон за копиране на линка и бутон за изтриване.

### 6.2 Записване

- Единствен писач: новият `statik-index.js`; запис през временен файл + `rename` (атомарно), за да не
  остане половин JSON при спиране.
- Четенето е с толерантност: счупен JSON → празен индекс + `log.warn` (панелът не бива да пада
  заради листа).

### 6.3 Заглавки на `/statik/<id>/<име>`

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="<име>"
Content-Length: <bytes>
Cache-Control: private, max-age=31536000, immutable
ETag: "<sha256-27>"
X-Content-Type-Options: nosniff
X-Robots-Tag: noindex, nofollow
Referrer-Policy: no-referrer
```

`immutable` е верен, защото един `id` никога не сочи друго съдържание (нов отчет = нов `id`).
`If-None-Match` → `304` през `static-etag.js`.

### 6.4 Чистене

- При старт и на всеки 6 часа: записи с `expiresAt < now` се махат заедно с файла; липсващ файл
  при жив запис → записът се маха (не 500 при изтегляне).
- `EVIDENCE_NEVER_DELETED` от `portal-archive.js` важи и тук: отчет, който е част от архивен
  запис с доказателствена стойност, не се трие от чистенето (само ръчно `DELETE`).

---

## Продължение: интерфейс, премахване на студиото и ред на изпълнение

Продължението е в [PLAN_ONE_CLICK_REPORTS_UI.md](./PLAN_ONE_CLICK_REPORTS_UI.md) — оттам започва
§7: интерфейс (дърво-панел, бутони, какво изчезва от екрана), §8 йерархия, §9 инвентар за
премахването на Report Studio, §10 порти, §11 ред на изпълнение, §12 рискове, §13 извън обхват,
§14 какво следва. Двете части са разделени заради нормата за размер на нормативен документ
(`tests/docs-size.cjs` ≤ 400 реда), а номерата на разделите продължават.
