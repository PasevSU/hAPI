# План за следващите промени — 0.69.225 и след нея

> **Клас:** исторически · **Замразен към:** 0.69.236

> **Как е направен.** Всяка точка по-долу почива на измерване в ДНЕШНОТО дърво (0.69.224,
> матрица **428/428**, `fresh=true`), не на преценка. Където пише „преди“, това е точният
> ред от файла днес; „след“ е замяната, която предлагам. Тежестта е по това колко боли, а
> не по това колко е интересно.

## 0. Първо — какво виси неизпратено

`HEAD` е на `v0.69.216`, в дървото има **70 промени** (0.69.217 → 0.69.224). Докато това не
излезе, всяка следваща промяна увеличава един комит, който никой не е виждал.

| Стъпка | Команда | Готово, когато |
| --- | --- | --- |
| Комит + таг | `.commit-msg.txt` → `git tag -a v0.69.224` | `node scripts/check-tag-version.cjs v0.69.224` е зелено |
| Публикуване | `pwsh -NoProfile -File scripts/publish-haoss.ps1 -Version 0.69.224 -Execute` | 3 архитектури в ghcr, 4/4 SHA-256 |

---

## 1. `Referrer-Policy` на трите HTML отговора без нея (S, сигурност)

**Измерено:** 21 отговор с `text/html`, **22** с `Referrer-Policy` — но точно **3** HTML
отговора я нямат: `server.js:1470` (началната страница на add-on-а), `server.js:1780`
(**страницата на файл в портала — с `?expires=&sig=` в адреса**) и `server.js:2496`
(прегледът). Тайната страница вече я има — тоест правилният модел съществува, просто не е
приложен навсякъде.

**Преди** (`server.js:1780`, съкратено):

```js
res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
```

**След:**

```js
res.writeHead(200, {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});
```

**Тест:** в `tests/blackbox-api.cjs` — `GET` на страница на файл със подпис и `GET /` искат
`referrer-policy: no-referrer`; в `tests/portal-partial-page.cjs` — същото за отказа.

---

## 2. Немски превод на опциите на add-on-а (S, липсващ файл)

**Измерено:** `hapi_enterprise/translations/` има `bg.yaml` (18.5 KB) и `en.yaml` (12.7 KB), а
**`de.yaml` няма**, макар интерфейсът да има DE (`ui/i18n.js`), `DE.md` да съществува и
`config.yaml` да описва **44** опции. `tests/addon-translations.cjs:66` изброява езиците
на ръка — затова липсата не се вижда.

**Преди** (`tests/addon-translations.cjs:66`):

```js
const translations = { bg: readTranslation('bg.yaml'), en: readTranslation('en.yaml') };
```

**След:**

```js
const translations = {
  bg: readTranslation('bg.yaml'),
  en: readTranslation('en.yaml'),
  de: readTranslation('de.yaml'),
};
const langs = Object.keys(translations);
for (const lang of langs) {
  assert.equal(translations[lang].size, options.length, `${lang}: преведени ${translations[lang].size} от ${options.length} опции`);
}
```

**Съдържание:** `hapi_enterprise/translations/de.yaml` със същата структура като `en.yaml`
(`configuration:` → 2 интервала ключ → 4 интервала `name:`/`description:`), 44 записа.

---

## 3. `JSON.parse` — от 55 „навсякъде“ до две точни решения (M)

**Измерено:** 55 срещания, но разбити по същност:

| Вид | Брой | Какво значи |
| --- | --- | --- |
| Тяло на заявка | **2** (`server.js:570` — вече с 400; `routes/reports.js:42` — без) | истинският вход |
| Файл, който сами пишем | **25** | повреден/подрязан файл дава 500 без код |
| Вътрешен кръг `JSON.parse(JSON.stringify(x))` | **3** | безопасно |
| Друго (конфигурация, метаданни) | 25 | смесено |

**Решение 1 — един вход за тела.** `server.js:570` вече има правилния `parse()` с 400.
`routes/reports.js:42` го повтаря на ръка:

```js
// преди
value = JSON.parse((await body(req, limit)).toString('utf8'));
// след
try { value = JSON.parse((await body(req, limit)).toString('utf8')); }
catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
```

**Решение 2 — един глобален четец за файлове.** Нов `core_module/json.js`:

```js
module.exports.create = () => ({
  name: 'json',
  fn: {
    /** { ok, value } или { ok: false, reason: 'ENOENT'|'EACCES'|'malformed' } — без 500. */
    read: (file) => {
      let text;
      try { text = require('node:fs').readFileSync(file, 'utf8'); }
      catch (e) { return { ok: false, reason: e.code || 'unreadable' }; }
      try { return { ok: true, value: JSON.parse(text) }; }
      catch { return { ok: false, reason: 'malformed' }; }
    },
  },
});
```

Замяна на едно място (от 25):

```js
// преди — podрязан файл хвърля и целият маршрут става 500
const db = JSON.parse(await fsp.readFile(file, 'utf8'));
// след — причината се вижда и отговорът е 409/500 с код, не „Internal error“
const read = core.api.json.read(file);
if (!read.ok) return fail(res, read.reason === 'ENOENT' ? 404 : 500, 'Store unreadable: ' + read.reason);
const db = read.value;
```

**Тест:** `tests/api-input-errors.cjs` разширен с „подрязан файл → код на грешката“;
`bad-code-scan` low 36 → 0.

---

## 4. Един `qrcode.js` вместо две еднакви копия (S)

**Измерено:** `hapi_enterprise/evidence-portal/assets/qrcode.js` е **байт по байт** същият
като `hapi_enterprise/qrcode.js` (2302 реда, `Get-FileHash` съвпада). Днес еднаквост, утре
разминаване — а никой не го проверява.

**Стъпка 1 (веднага, евтино) — тест, който пада при разминаване:**

```js
// tests/evidence-portal-qr.cjs
const same = fs.readFileSync(a).equals(fs.readFileSync(b));
assert.ok(same, 'assets/qrcode.js трябва да е копие на qrcode.js — иначе двата QR енкодера се разминават');
```

**Стъпка 2 — едно копие:** `evidence-portal/portal.html:14` зарежда `./assets/qrcode.js`;
достатъчно е сборката (`scripts/build-release.cjs`) да копира `qrcode.js` в `assets/` и
копието да не се пази в git — или маршрутът на портала да сервира `/qrcode.js`.

---

## 5. Началната страница излиза от `server.js` (S, бюджет)

**Измерено:** `server.js` е **2703** от пор **2722** (19 реда запас). Първият сегмент, който
може да излезе без риск, е началната страница (`server.js:1470`) — тя не пипа състояние.

**Преди:** ред 1470 в `server.js` рисува `text/html` за `/`.
**След:** нов `hapi_enterprise/server_module/landing.js`:

```js
module.exports.create = (host) => ({
  name: 'landing',
  order: 5,
  handle({ res, url, method }) {
    if (url.pathname !== '/' || method !== 'GET') return false;
    res.writeHead(200, { ...host.htmlHeaders('panel'), 'Content-Type': 'text/html; charset=utf-8' });
    res.end(host.landingHtml());
    return true;
  },
});
```

`server.js` не се променя никъде другаде — зареждането по име вече съществува. **Готово,
когато:** `server.js` < 2680, `server-modules.cjs` §5б зелено (компонентът не поема
`/admin/api`), `html-assets.cjs` приема новия файл.

---

## 6. `ui/files-manager.js` — 4393 реда, 14 секции (L)

**Измерено:** най-големият файл в проекта; самият той има секции „Контакт/Дело (extras)“,
„QR и API“, „Файлови операции“, „Отчети“, „Пакет“, „Подписан URL и разписка“.

**Първа стъпка — най-самостоятелната:** секцията „Отчети“ излиза в нов `ui/report-panel.js` по
вече установения договор (както `portal-folders.js`/`portal-files.js`):

```js
// ui/report-panel.js — НОВ файл, същите функции без промяна
window.HapiReportPanel = {
  mount(ctx) { /* същите функции, преместени без промяна */ },
};
```

```js
// files-manager.js — преди: 400 реда в тялото; след: един монтаж
if (window.HapiReportPanel) window.HapiReportPanel.mount({ state, api, t, reload });
```

**Задължително при всяко ново UI име:** ред в `UI_FILES` (`server.js`), ред в `CEILING`
(`tests/ui-i18n-ratchet.cjs`), ред в `html-assets` ако е `<script src>`. **Готово, когато:**
никой UI файл > 2000 реда и таванът на ратчето е паднал с преместените знаци.

---

## 7. Матрицата под 220 s (M)

**Измерено:** **379 s** общо; `gui-journeys` 24 s, `link-check` 16 s, `parallel-transfers` 9 s.
Пречката за паралелност е известна и записана: `event-stream` пада на `/health` под товар, а
`evidence-portal` не спира детето си навреме.

**Стъпка 1 — паралелността става безопасна** (двата теста), **стъпка 2 — шардове:**

```js
// scripts/test-matrix.cjs — нов флаг
const shard = String(opt('shard', '')); // "1/2", "2/2"
const pick = (files) => {
  const [n, of] = shard.split('/').map(Number);
  if (!n || !of) return files;
  return files.filter((_, i) => i % of === n - 1);
};
```

**Готово, когато:** два шарда по ~110 s всеки дават същия брой тестове, а `release-status`
приема отчета само ако е пълен (`files === 428`).

---

## 8. Минимална версия на Home Assistant (S, решение)

**Измерено:** `config.yaml:23` и `hacs.json:4` казват `homeassistant: "2024.6.0"` — на две и
половина години при месечни издания. Никой тест не проверява дали обявената долна граница е
още поддържана.

```yaml
# config.yaml
homeassistant: "2025.1.0"
```

```json
// hacs.json
"homeassistant": "2025.1.0"
```

**Тест:** `tests/ha-support-matrix.cjs` — долната граница от двата файла е еднаква и не е
по-стара от N месеца (числото се пази на едно място, за да не се разминават).

---

## 9. Покритие по редове — веднъж, като отчет (M)

**Измерено:** няма никакво измерване на покритие; 428 теста, но никой не знае кои модули не
се изпълняват никога. `CRITICAL_REVIEW_0.69.220.md` го записва като непокрито.

```bash
node --experimental-test-coverage --test-reporter=lcov tests/*.cjs   # веднъж, ръчно
```

**Готово, когато:** `reports/coverage.md` изрежда модулите с 0 % и първите три получават
тест или ред в `KNOWN_DEFECTS` с причина.

---

## 10. Адресите в панела — последният втори построител (S, DEF-69)

**Измерено:** `ui/api-spec.js#buildReferences` строи същите низове, които вече дава
`core.api.address.contract` (портал · API · manifest · openapi · qr · шаблони за файл/папка).
Двете днес съвпадат и никой не го проверява — точно класът на DEF-63, но от другата страна.

**Преди:** панелът вика `window.HapiApiSpec.buildReferences(portal)`.
**След:** панелът чете `state.contracts[id]` (вече се пази от 0.69.219) и пада към
`buildReferences` само за файловите адреси, които договорът дава като ШАБЛОНИ:

```js
const contract = state.contracts[portal.id];
const url = contract ? contract.page : window.HapiApiSpec.buildReferences(portal).portal;
```

**Тест:** `gui-portal-create-contract.cjs` разширен — сменя `contract.api` в паметта и
проверява, че панелът показва НОВИЯ адрес (днес би показал стария).

---

## Ред и защо точно този

1. **0** — изданието излиза.
2. **1 · 2 · 4** — три малки промени, всяка с тест под 40 реда: подписан адрес не изтича,
   немският потребител вижда превод, двата QR енкодера не могат да се разминат.
3. **3 · 10** — дългът на входа и последният втори построител.
4. **5 · 6** — структурата (бюджетът на `server.js`, монолитът на панела).
5. **7 · 9** — скорост и покритие, защото искат най-много работа и не блокират нищо.
6. **8** — решение за поддръжката; прави се, когато има издание, в което да влезе.

**Какво НЕ влиза:** Object Lock за WORM (DEF-06, инфраструктура), едно многоархитектурно име
на образа (иска manifest list, който workflow-ът не строи), пренаписване на
`portal/portal.js` (работи и е покрит).
