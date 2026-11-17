# Глобални функции от донорските хранилища — каталог и договори

> **Клас:** план · **Обхват:** `hapi_enterprise/core_module/*` · **Основа:** 0.69.231
>
> **Състояние (0.69.232):** фаза 1 е ВНЕДРЕНА — `core_module/hash.js` и `core_module/http.js`
> със `tests/core-hash.cjs` и `tests/core-http.cjs`. Останалите функции са план.
>
> **Метод:** от двете хранилища се взима **договорът**, не кодът. Причината е тристепенна:
> (1) лицензи — `js_project_pack` съдържа LGPL (OpenPGP.js) и MIT (CryptoJS) код, а
> `HASH_REPORT_ENTERPRICE` няма изричен лиценз в прегледаните файлове; (2) размер — hAPI е с
> **нула runtime зависимости**, а тези пакети носят цели библиотеки; (3) сигурност — в локалното
> копие на `js_project_pack` (според записа в паметта на проекта) има живи тайни и литерална
> админ парола, тоест файловете не се копират „на парче“, а се четат само като източник на идеи.
>
> Затова по-долу всяка функция е **наш договор**, вдъхновен от конкретен файл, с посочен
> източник и с тест, който ще падне, ако договорът се размине.

## 1. Какво значи „глобална функция“ в hAPI

Договорът вече съществува и не се измисля наново (`AGENTS.md`, `hapi_enterprise/core.js`):

```js
module.exports.create = (deps, api) => ({ name: 'hash', fn: { /* … */ } });
```

- файл в `core_module/`, зарежда се по име (`module-folder.js`), `core.api.<име>` е **замразен**;
- `deps` е това, което `server.js` подава; `api` е живият обект на слоя (за да ползва една
  функция друга);
- име на файл = име на функция (без двусмислие — урокът от DEF-81);
- нов файл → ред в `Dockerfile COPY core_module` и в `CRITICAL` на `integrity.js`;
- тест: `tests/core-modules.cjs` + собствен договорен тест;
- първият коментар във файла влиза в `SOURCE_INVENTORY` (затова описва предназначението, не история).

## 2. Инвентар — `PasevSU/HASH_REPORT_ENTERPRICE` (ChronoSeal, JS клонинг)

| Файл | Какво прави (по собствения му коментар) | Какво ни трябва |
| --- | --- | --- |
| `js/lib/util.mjs` | SHA-256 на **1 MiB парчета**, никога целият файл в паметта; `jsonSafe` нормализира всяка стойност преди сериализация | `hash` |
| `js/lib/generate.mjs` | „digest basis“: за всеки запис по ред — hex sha256 + относителното име, UTF-8, после хеш на целия поток | `hash.basis()` |
| `js/lib/identity.mjs` | идентификатори, байт-съвместими с Python; **шаблон за самоизключване** (отчетът не влиза в следващия отчет) | `hash` + правилото за резервирани имена в `files[]` |
| `js/lib/selection.mjs` | явен избор **или** обхождане на папка, стеснено от обща граматика на филтри | `filter` |
| `tools/jsx/file-filters.mjs` | fnmatch филтри, ENV списък, флаг за регистър, таван на дължината (512) | `filter` |
| `tools/jsx/lib/glob.mjs` | fnmatch-съвместим matcher (Python `fnmatchcase`) | `filter` |
| `js/lib/classify.mjs` | етикети на типове артефакти; **редът има значение**, за да съвпадат колоните | `classify` |
| `js/lib/evidence.mjs` | произходът не се гадае: нечетима стойност = `null` + причина | `evidence` |
| `js/lib/archive.mjs` | номер папка + SQLite копие; **папката се публикува с rename първо, транзакцията се commit-ва второ**; провал връща и двете | `archive` |
| `js/lib/config.mjs` | нищо не се подразбира тихо; политика, която не може да се спази, се **отхвърля** | `rules` |
| `js/lib/report.mjs` | декларативно сглобяване: профил избира подредени модули, правилото знае заглавие/полета/колони | `rules` |
| `js/lib/quality.mjs` | **read-only** A4 проверка на оформлението; праговете идват от профил, не от константи | `layout` |
| `js/lib/normalize.mjs` | PDF/A-2b чрез собствен нормализатор: вградени TrueType подмножества, sRGB, XMP, поправен xref | `pdfa` |
| `tools/jsx/hash-table.mjs` | режими `single_file` / `current_folder` / `recursive_folder`; алгоритми sha256/sha512/sha1/md5 | `hash` (режимите) |
| `tools/jsx/style-loader.mjs` | оценка на декларативни rule файлове **в процеса**, вместо дете-процес на всяко зареждане | `rules` |

## 3. Инвентар — `PasevSU/js_project_pack` (готови JS пакети)

| Пакет | Какво прави | Какво ни трябва |
| --- | --- | --- |
| `READY_JS_PACKAGES/02-api/http.mjs` | `HttpClient` с `baseUrl`, таймаут през `AbortController`, JSON, **типизирана грешка** `{status, data}` | `http` |
| `READY_JS_PACKAGES/02-api/api.mjs` | `API` с карта на адресите (`endpoints`) и `get`/`post`, които връщат данни, не `Response` | `http` (формата на картата) |
| `READY_JS_PACKAGES/07-ots/index.js` | `createSha256File`, `createTimestamp`, `inspectTimestamp`, `logEvent`, `scanPendingOts`, `upgradeTimestamp` (OpenTimestamps: merkle, notary, esplora, calendar) | `timestamp` |
| `READY_JS_PACKAGES/09-ui-app/app.js` | състояние на локално приложение, без сървър | **не взимаме** (панелът е сървърен) |
| `READY_JS_PACKAGES/09-ui-app/sw.js` | service worker, офлайн кеш | **не взимаме** (страниците са no-cache по DEF-87/88) |
| `READY_JS_PACKAGES/09-ui-app/admin.js` | админ панел с **литерална парола** в кода | **не взимаме** — това е точно класът на `security.md` |
| `READY_JS_PACKAGES/01-core/core.js` | CryptoJS (MIT) | **не взимаме** — имаме `node:crypto` |
| `READY_JS_PACKAGES/10-pgp`, `15-openpgpjs` | OpenPGP.js (LGPL) + CLI обвивка | **не взимаме** — имаме собствен `pgp.js` |
| `READY_JS_PACKAGES/01-core/preload.js` | Electron `contextBridge` | **не взимаме** — различен runtime |

## 4. Каталог на функциите (договори)

### 4.1 `hash` — едно място за хеш (фаза 1 — ✅ внедрено)

`hapi_enterprise/core_module/hash.js` · тест `tests/core-hash.cjs` · в `CRITICAL` на `integrity.js`.

```js
core.api.hash.digest(bytesOrString, { algo = 'sha256' })   // hex
core.api.hash.file(absPath, { algo = 'sha256', chunk = 1 MiB })   // { algo, hex, bytes }
core.api.hash.verify(absPath, expectedHex)                  // { ok, algo, actual, expected, bytes }
core.api.hash.basis(entries)                                // [{ sha256, name }] → hex
```

- **Защо:** в `hapi_enterprise/` има **38** извиквания на `createHash` в 12 файла — всяко със
  собствен начин за парчета, кодиране и име на полето.
- **Инварианти:** `file()` никога не чете целия файл (1 MiB парче); `basis()` пази реда на
  записите и кодира името в UTF-8; `verify()` връща и двете страни, за да може одитът да ги запише.
- **Грешки:** нечетим файл → `EACCES/ENOENT` без маскиране; непознат алгоритъм → отказ
  (`HASH_UNKNOWN_ALGO`), а не „по подразбиране sha256“; лошо парче → `HASH_BAD_CHUNK`; лош
  очакван хеш → `HASH_BAD_EXPECTED`; лош запис в основата → `HASH_BAD_ENTRY(S)`. Кодовете са
  дълги нарочно: каталогът на грешките (`ERROR_CODES.md`) чете обяснението от самия текст на
  изключението, а код под 6 знака не стига до описанието. За разлика от донора, **md5 и
  sha1 са ИЗКЛЮЧЕНИ** — hAPI не ги приема дори „за съвместимост“.
  Име на кода и текстът му се пишат в ЕДНА форма: `new Error('CODE: текст')` + `err.code = 'CODE'`.
- **Ползват я:** `files[]` в `configuration.yaml` (`sha256`, `size`), `verify` на папката,
  пакетите, QR печатите, `content-id.js`.
- **Тест:** `tests/core-hash.cjs` (вектори за празен/1 B/1 MiB+1 B, `verify` при сменен байт,
  `basis` сърху два реда в разменен ред дава различен хеш).

### 4.2 `http` — изходящ клиент (фаза 1 — ✅ внедрено)

`hapi_enterprise/core_module/http.js` · тест `tests/core-http.cjs` · в `CRITICAL` на `integrity.js`.

```js
const client = core.api.http.client({ baseUrl, timeout = 15000, headers });
await client.get(path, { signal });
await client.post(path, body, { signal });   // { status, ok, data, headers }
```

- **Защо:** **8** места в кода правят изходящи заявки (webhooks, notify, огледало, TSA) — без
  общ таймаут, без общ начин за грешка, без общ `AbortController`.
- **Инварианти:** таймаутът е винаги; тялото се чете веднъж; при `!ok` се хвърля грешка с
  `status` и `data`; `baseUrl` се нормализира без завършваща наклонена черта.
- **Грешки:** таймаут → `ETIMEDOUT` със `url`; невалиден JSON → `data` е текстът, не изключение
  (решава викащият); лоши настройки (`timeout ≤ 0`) → `HTTP_BAD_OPTION` веднага, не при първата
  заявка; липсващ `fetch` → `HTTP_NO_FETCH` при създаването на клиента, не при заявката.
- **Тест:** `tests/core-http.cjs` (фалшив `fetchImpl`: 200 JSON, не-JSON, 500 с тяло, таймаут,
  нормализиране на адреса, POST тяло) — без нито една истинска мрежа.

### 4.3 `filter` — избор и glob (фаза 2)

```js
core.api.filter.match(pattern, name, { caseSensitive = false })
core.api.filter.select(entries, { include = [], exclude = [], maxPatternLength = 512 })
```

- **Защо:** `export-rules.js` има собствена проверка на пътища, а изборът на файлове за отчет е
  разпръснат; fnmatch семантиката е договор, не „приблизително съвпадение“.
- **Инварианти:** `*`, `?`, `[abc]` по Python `fnmatchcase`; шаблон над 512 знака = отказ;
  изключващото печели пред включващото.
- **Тест:** `tests/core-filter.cjs` (таблица от двойки шаблон/име, включително регистър и
  специални знаци).

### 4.4 `classify` — етикет на артефакт (фаза 2)

```js
core.api.classify.artifact(name)   // { id, label, order }
```

- **Защо:** Type колоната в отчетите и в експорта трябва да е **една и съща** дума навсякъде;
  днес `export-rules.js` и `report-render.js` я решават поотделно.
- **Инварианти:** редът на правилата е част от договора (по-специфичното първо); непознато
  разширение → `other`, никога „празно“.
- **Тест:** `tests/core-classify.cjs` (по един пример на тип + реда на специфичност).

### 4.5 `evidence` — произход без гадаене (фаза 2)

```js
core.api.evidence.record(facts)   // стойности + { value, reason } за нечетимите
```

- **Защо:** `forensic.js`, `observer.js` и диагностичният пакет събират среди без общо правило
  какво се прави, когато стойност не може да се прочете; днес понякога липсва, понякога е `null`.
- **Инварианти:** нечетимо → `null` **и** `reason`; нищо не се измисля; `jsonSafe` преди запис.
- **Тест:** `tests/core-evidence.cjs` (липсващ файл, отказан достъп, непознат тип).

### 4.6 `archive` — публикуване без половин състояние (фаза 2)

```js
await core.api.archive.publish({ stagingDir, targetDir, commit, rollback });
```

- **Защо:** `routes/portal-archive.js` мести папка и после пише в базата; ако вторият етап падне,
  остава публикувана папка без запис. ChronoSeal решава точно това: **rename първо, commit второ,
  и двете се връщат назад при провал**.
- **Инварианти:** `target` не съществува преди публикуването; `commit` и `rollback` са
  задължителни функции; при провал `staging` се връща в изходното място.
- **Тест:** `tests/core-archive.cjs` (успех, провал на `commit`, провал на `rollback` — състоянието
  се описва точно).

### 4.7 `layout` — проверка на A4 без писане (фаза 3)

```js
core.api.layout.check(geometry, profile)   // { ok, issues: [{ code, where }] }
```

- **Защо:** `report-render.js` и `pdf-writer.js` строят A4, но няма **read-only** проверка, че
  блок не излиза от полетата; ChronoSeal има точно такъв гейт и държи праговете в профил.
- **Инварианти:** не пипа входа; праговете идват от `config/rules/*.json`, не от константи;
  резултатът е обясним (код + място).
- **Тест:** `tests/core-layout.cjs` (нормален блок, преливащ блок, липсващ профил).

### 4.8 `timestamp` — времеви печат (фаза 3)

```js
core.api.timestamp.create(absPath)      // доказателство
core.api.timestamp.verify(absPath, proof)
core.api.timestamp.upgrade(proof)
```

- **Защо:** днес има `tsa-client.js` (RFC 3161) и опции `tsa_*`, но няма общ договор „създай /
  провери / надгради“, нито разпознаване на вече налично доказателство.
- **Инварианти:** нищо не се твърди без проверка; мрежовият доставчик е адаптер, не част от
  функцията; **никакво крипто без проверени вектори** (правилото от `pgp`/OCB).
- **Тест:** `tests/core-timestamp.cjs` — с локален фалшив доставчик; реалният OTS остава извън теста.

### 4.9 `pdfa` — PDF/A проверка и нормализация (фаза 3, по решение)

```js
core.api.pdfa.check(bytes)        // { part, conformance, issues }
core.api.pdfa.normalize(bytes, { level: '2b' })
```

- **Защо:** `pdf-writer.js:361` вече пише XMP с `pdfaid:part=3`, но никой не проверява
  резултата; ChronoSeal има собствен нормализатор (шрифтове, sRGB, xref).
- **Инварианти:** нормализацията не променя хеша на **съдържанието**, само структурата; ако не
  може да се постигне нивото — отказ, не „почти PDF/A“.
- **Тест:** `tests/core-pdfa.cjs` върху генериран от `pdf-writer` файл.

### 4.10 `rules` — декларативни правила (фаза 3)

```js
core.api.rules.load(dir, { schema })   // проверени правила, без тихи подразбирания
```

- **Защо:** `config/rules/*.json` се четат на няколко места; ChronoSeal показва модела „нищо не
  се подразбира тихо“ + оценка в процеса, вместо дете-процес.
- **Инварианти:** непознат ключ = грешка с име; липсващ задължителен = грешка; резултатът е
  замразен.
- **Тест:** `tests/core-rules.cjs`.

## 5. Приоритет и измерен ефект

| Фаза | Функции | Защо сега |
| --- | --- | --- |
| 1 | `hash`, `http` | 38 места за хеш и 8 за изходящи заявки — най-голямо дублиране; нужни веднага за `files[]` и `verify` в плана за `configuration.yaml` |
| 2 | `filter`, `classify`, `evidence`, `archive` | пряко подобряват експорта, отчетите и архива; `archive` затваря класа „публикувано без запис“ |
| 3 | `layout`, `timestamp`, `pdfa`, `rules` | изискват профили/вектори и по-широки тестове; не блокират нищо днес |

## 6. Приемни критерии за всяка функция

1. Договорът е във файл `core_module/<име>.js` с `create(deps, api)` и `name`.
2. `core.api.<име>` е замразен; никой модул не вика файла напряко (`tests/core-modules.cjs`).
3. `Dockerfile COPY core_module` покрива файла; `CRITICAL` в `integrity.js` е обновен.
4. Договорен тест: положителен случай, поне два отрицателни (лош вход, отказ), и един
   „мутационен“ — ако правилото се махне, тестът пада.
5. Нула нови зависимости; lint 0 без нови потискания; `SOURCE_INVENTORY` се обновява от първия
   коментар.
6. Нито една тайна не влиза в кода или тестовете (проверка с `diag-package` скенера).

## 7. Връзка с плана за `configuration.yaml`

- `files[]` носи `sha256` и `size` — смятат се от `hash.file()`; `verify` в панела ползва
  `hash.verify()`.
- Резервираните имена в `files[]` (`configuration.yaml`, `portal.html`, `.worm`) са нашият
  вариант на „self-exclusion“ от ChronoSeal: описанието не описва себе си като съдържание.
- Digest basis (`hash.basis()`) дава на експорта и на пакетите един договор, който може да се
  преизчисли отвън — точно както ChronoSeal прави с Python верификатора.
