# План за прилагане — „заедно с 0.69.225“, с пряко документиране на кода

> **Клас:** исторически · **Замразен към:** 0.69.242

> **Правило на този план:** всяка промяна носи коментар В САМИЯ код, който казва **защо**
> съществува — не какво прави (това се вижда). Точно този стил държи репото разбираемо:
> `core.js`, `module-folder.js`, `audit-html-headers.cjs` започват с „Защо съществува“.
> Затова по-долу всяка замяна е дадена с нейния коментар, а не само с кода.

## 0. Какво значи „пряко документиране“ тук (и какво НЕ е)

| Ниво | Къде | Какво трябва да има |
| --- | --- | --- |
| Заглавен коментар на файл | първите 5–20 реда | „Защо съществува“, измереното число, което го оправдава, и какво НЕ прави |
| JSDoc на изнесена функция | над `function`/`module.exports` | типове на входа/изхода (`@param`/`@returns`) и едно изречение за договора |
| Коментар на решение | до самия ред | „защо точно така“ (напр. „50 ms × 160 = 8 s, защото под товар стартът стига 6 s“) |
| Документ | `CHANGELOG.md`, `KNOWN_DEFECTS.md`, `SYSTEM_STATE.md`, `AGENTS.md` | същото твърдение, но за човек, който не чете кода |

**Какво НЕ е документация:** ред `// проверява X`, който преразказва кода; „TODO“ без име и
срок (забранено от `tests/no-stubs.cjs`); коментар, който цитира число, което никой не мери.

---

## Батч A — „безопасният път“ да е един вход (S, прави пътя детерминиран)

### A1. `scripts/safe-release.cjs` — двуфазен пуск на матрицата

**Проблемът, измерен:** три пуска паднаха на `matrix-freshness`, защото отпечатъкът е от преди
промяна в скрипт. Скриптът знае причината, но я оставя на човека.

**Подменя се** редът в `plan`:

```js
  // 3. Матрицата — последна от „пишещите“ стъпки.
  ...(fast ? [] : [['Тестове (матрица)', 'scripts/test-matrix.cjs', ['--skip=release-status', '--attempts=1']]]),
```

**Става:**

```js
  // 3. Матрицата — последна от „пишещите“ стъпки.
  //
  // ДВЕ ФАЗИ, защото `matrix-freshness` сравнява отпечатъка в отчета с днешното дърво: ако
  // току-що е пипан скрипт или тест, пълната серия пада по определение (измерено 3 пъти на
  // 2026-11-15). Затова: bootstrap без двата „само-проверяващи“ теста → отпечатъкът е готов →
  // пълна серия, в която те вече минават.
  ...(fast ? [] : [
    ['Тестове · bootstrap (отпечатък)', 'scripts/test-matrix.cjs', ['--skip=matrix-freshness,release-status', '--attempts=1']],
    ['Тестове (пълна серия)', 'scripts/test-matrix.cjs', ['--skip=release-status', '--attempts=1']],
  ]),
```

**Готово, когато:** `node scripts/safe-release.cjs` минава зелено от ПЪРВИЯ път, дори когато
преди него е пипан файл в `tests/` или `scripts/`.

### A2. `tests/helpers.cjs` — един вход за „вдигни сървър“, който казва защо е паднал

**Проблемът, измерен:** `rbac-default-matrix` падна с „сървърът приключи преждевременно
(код 1)“ **без нито ред stderr** — `waitHealthy` получава `stderr` само ако тестът го подаде, а
този не го подава. Диагнозата беше невъзможна без ръчен пуск.

**Ново** (добавя се към `module.exports`):

```js
/**
 * Вдига сървър с ясна причина при провал: събира stderr, чака до 12 s и при „портът е зает“
 * опитва ОЩЕ ВЕДНЪЖ на нов порт. Защо: под товар `freePort()` и `listen()` се разминават и
 * детето излиза с код 1, а тестът вижда само „приключи преждевременно“ (измерено 2026-11-15).
 * @param {{env?: object, port?: number, tries?: number}} [opts]
 * @returns {Promise<{child: import('node:child_process').ChildProcess, base: string, port: number, stderr: () => string}>}
 */
async function bootServer({ env = {}, port = null, tries = 2 } = {}) { /* ... */ }
```

**Подменя се** в `tests/rbac-default-matrix.cjs` (ред ~60) и `tests/ha-integration-proxy.cjs`:

```js
await waitHealthy(child, `http://127.0.0.1:${port}`, { attempts: 120 });
```

**Става:**

```js
const boot = await bootServer({ env, port: await freePort() });
const { child, base, stderr } = boot;
```

**Пази го:** `tests/process-guards.cjs` §5 (вече пази 15 s грация) + ново твърдение, че
`bootServer` подава stderr при провал.

**Готово, когато:** `node tests/rbac-default-matrix.cjs` и `node tests/ha-integration-proxy.cjs`
минават 5/5 последователни пуска под товар (днес: 3/3 сами, падат в матрицата).

### A3. Нов тест в `tests/` — `scripts-usage.cjs` (липсва днес): инструмент без потребител е мъртъв код

**Защо:** днес добавих `scripts/audit-html-headers.cjs` и `scripts/tree-fingerprint.cjs`.
`source-inventory` ги вижда, но нищо не пада, ако утре скрипт остане без потребител — класът на
DEF-82, но за инструменти.

```js
'use strict';
// ВСЕКИ СКРИПТ ИМА ПОТРЕБИТЕЛ (0.69.226).
// Защо: `scripts/` е мястото, където живеят портите. Скрипт, който никой не вика, изглежда
// като порта и никой не разбира, че не се изпълнява (така `logic-audit --gate` не пишеше
// отчета си до DEF-65). Тестът иска всеки `scripts/*.cjs` да е викан от тест, генератор,
// работен поток или `safe-release`, или да е в списък с причина.
```

**Готово, когато:** списъкът с изключения е празен или всеки ред носи причина.

---

## Батч B — аудитът покрива и подписания JSON (S)

### B1. `scripts/audit-html-headers.cjs` — втори профил

**Подменя се** единичният `REQUIRED` с профили:

```js
/** Профилите: HTML страница и подписан JSON. Различни са, защото CSP за JSON е безсмислен. */
const PROFILES = {
  html: {
    test: /text\/html/,
    required: {
      'Cache-Control': 'страница с подписан адрес не бива да остава в кеша',
      'Content-Security-Policy': 'без политика страницата пуска всичко',
      'Referrer-Policy': 'адресът с ?expires=&sig= или /t/<token> не бива да изтича през Referer',
      'X-Content-Type-Options': 'браузърът не бива да гадае типа',
    },
  },
  signedJson: {
    test: /application\/json/,
    required: {
      'Cache-Control': 'подписаният JSON не бива да остава в кеша на прокси',
      'X-Content-Type-Options': 'браузърът не бива да гадае типа',
    },
  },
};
```

**Готово, когато:** `node scripts/audit-html-headers.cjs` извежда два реда обобщение (HTML и
JSON) и нито един отговор не е гол; `tests/html-headers.cjs` пази и двата профила.

---

## Батч C — `JSON.parse` върху наши файлове (M)

### C1. `core_module/json.js` — нов глобален четец

```js
'use strict';
// ГЛОБАЛНА ФУНКЦИЯ „json“ — четене на JSON без 500 при повреден файл (0.69.226).
//
// Измерено: 55 срещания на `JSON.parse`. Разбити по същност: 2 входа на заявка (вече с 400),
// 25 четения на НАШИ файлове, 3 вътрешни кръга, 25 смесени. Второто е проблемът: подрязан
// `db.json` дава `SyntaxError` → 500 „Internal error“ без код и без причина в лога.
// Затова тук има ЕДИН четец, който връща `{ ok, value, reason }` — всеки маршрут решава
// какъв код да върне, вместо да гадае.
const fs = require('node:fs');

module.exports.create = () => ({
  name: 'json',
  fn: {
    /**
     * @param {string} file абсолютен път
     * @returns {{ok: true, value: any} | {ok: false, reason: 'ENOENT'|'EACCES'|'malformed'}}
     */
    read(file) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); }
      catch (e) { return { ok: false, reason: e.code === 'ENOENT' ? 'ENOENT' : (e.code || 'unreadable') }; }
      try { return { ok: true, value: JSON.parse(text) }; }
      catch { return { ok: false, reason: 'malformed' }; }
    },
  },
});
```

**Подменя се** (първите три от 25, за да е ясен шаблонът) — `metadataStore.restoreFrom`,
`storage-tree` и `core-store` четат така:

```js
const db = JSON.parse(await fsp.readFile(file, 'utf8'));
```

**Става:**

```js
const read = core.api.json.read(file);
if (!read.ok) return fail(res, read.reason === 'ENOENT' ? 404 : 500, 'Store unreadable: ' + read.reason);
const db = read.value;
```

**Готово, когато:** `bad-code-scan --gate` дава 0 находки `json-parse-untrusted`;
`tests/api-input-errors.cjs` има проба „подрязан файл → код и причина“, а `core_module` е с
4 модула (`qr`, `address`, `api-docs`, `json`).

---

## Батч D — какво остава за след това (не в този батч)

| Точка | Защо не сега |
| --- | --- |
| Един `qrcode.js` (копие при build) | тестът вече пази равенството; смяната на build пипа `dist` и S22 |
| `Cache-Control` за всички отговори, не само HTML/JSON | първо B, после се вижда какво остава |
| Шардове на матрицата (<220 s) | иска A2 (детерминистични живи тестове) |
| `files-manager.js` 4393 реда | иска отделен цикъл и `UI_FILES`/`CEILING` |
| Минимална HA версия, покритие по редове | решения, не код |

---

## Ред на изпълнение и какво се подменя (обобщение)

| # | Файл | Подменя се | Тест | Гейт |
| --- | --- | --- | --- | --- |
| A1 | `scripts/safe-release.cjs` | един ред „матрица“ → две фази | — (самата команда) | `node scripts/safe-release.cjs` |
| A2 | `tests/helpers.cjs` + `rbac-default-matrix.cjs` + `ha-integration-proxy.cjs` | `waitHealthy(...)` → `bootServer(...)` | `process-guards.cjs` §5 | матрица |
| A3 | липсва днес: нов тест `scripts-usage.cjs` в `tests/` | — | себе си | матрица |
| B1 | `scripts/audit-html-headers.cjs` | `REQUIRED` → `PROFILES` | `tests/html-headers.cjs` | `audit-html-headers --check` |
| C1 | нов `core_module/json.js` + 3 четения | `JSON.parse(readFile)` → `core.api.json.read` | `api-input-errors.cjs` | `bad-code-scan --gate` |
| — | `CHANGELOG.md`, `KNOWN_DEFECTS.md`, `SYSTEM_STATE.md`, `AGENTS.md` | запис за всяка точка | `known-defects`, `regression-guards` | `safe-release --fast` |

**Едно изречение:** батч A прави „безопасния път“ наистина безопасен (един вход, без флейк,
без сляпа диагноза), B и C добавят по едно правило с тест, а останалото чака своя цикъл.
