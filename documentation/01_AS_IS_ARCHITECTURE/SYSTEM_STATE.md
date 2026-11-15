# Състояние на системата и промени в 0.69.212

> Живият документ за **„какво е системата днес“**, за разлика от нормативните документи в
> `02_TO_BE_ARCHITECTURE/` (какво трябва да бъде). Обновява се при всяко издание, а числата се
> ВЗИМАТ от скриптове и отчети, не се пишат на ръка. Всичко тук е измерено в работното дърво
> на 0.69.212; при разминаване меродавни са `reports/RELEASE-STATUS.md`,
> `reports/test-matrix.json` и `documentation/01_AS_IS_ARCHITECTURE/SOURCE_INVENTORY.md`.

## 1. Какво е системата

hAPI Enterprise е Home Assistant add-on (Node ≥ 22.13, **нула runtime зависимости**,
`node:sqlite`) плюс HACS интеграция. Един процес обслужва административен HTTP слой, публични
портали, криптирано хранилище, WORM-одит, отчети с електронен подпис и ГУИ панел, който се
зарежда и през HA Ingress, и самостоятелно (Docker).

| Показател | Стойност (измерено) |
| --- | --- |
| Версия | **0.69.212** (`hapi_enterprise/config.yaml`, огледала в 8 файла) |
| Модули в add-on-а | **109** `.js` файла в `hapi_enterprise/` |
| Изнесени HTTP компонента | **18** файла в `hapi_enterprise/routes/` |
| Модули на панела | **28** `.js` файла в `hapi_enterprise/ui/` |
| Обявени операции | **213** в `API_ENDPOINT_REFERENCE.md` |
| `server.js` | **2720** реда (пор **2722**) |
| Изнесени функции | **369** в 52 модула, **369** покрити с тест |
| Тестове в дървото | **414** файла (`413` в матрикса + `release-status.cjs`); `tests/helpers.cjs` не е тест |
| Артефакт | `dist/` — точно **6** файла, `verify-release` **22/22** |

## 2. Какво се промени в 0.69.208

| Промяна | Комит | Защо | Какво я пази |
| --- | --- | --- | --- |
| Логическите корени са на едно място; `<диск>:\share` вече не се създава | `8c4b4b5` | `path.resolve('/share')` на Windows е `D:\share`; 213 тестови портала се бяха натрупали на диска | `storage-roots.cjs` (статично + динамично), `legacy-logic-residue.cjs` |
| Дефинициите стигат и до инсталирането (`start.js`, `gateway-api`, `layout`, `evidence-portal`) | `9991e82` | вторите плоски списъци с корени в entrypoint-а и в модулите | `storage-roots.cjs` §2б и §5б |
| Регресионна карта „дефект → тест“ + критичен анализ на самите защити | `a40bfd4` | 39 от 54 затворени дефекта нямаха нищо, което да ги пази | `regression-guards.cjs` (52 защити), `analysis-claims.cjs` |
| Флейк под товар: `stopChild` чака 15 s и ескалира до `SIGKILL` | `01d47f5` | `event-stream` падаше на `/health`, `evidence-portal` стигаше 66 s | `process-guards.cjs` §5, `event-stream.cjs` |
| Етикетите на полетата се свързват след рендер (`ui/field-labels.js`) | `c0a3e6e` | 109 `.field` блока без `for`/`id` — екранният четец не обявява име (DEF-38) | `ui-field-labels.cjs` |
| Протокол на дебъгинга: находка → причина → решение → тест (`ui/debug-ledger.js`) | `dcae049` | инструментът казваше „нарушено“ и не помнеше нищо | `debug-ledger.cjs` |
| Котви на защитите: 10 → **53 от 54** | последният комит на изданието | „има тест“ не значи „пази това правило“ | `regression-guards.cjs` (`ANCHORS`) |
| Дългът по езика (DEF-49) стана измерим по вид текст | `c896563` | 36 850 знака изглеждаха еднаква работа, а 387 от тях не се превеждат | `ui-i18n-ratchet.cjs` |
| **Закон: менюто е на равни групи по смисъл** (3 × 6 секции) + прибиране при клик извън него | последният комит на изданието (виж `CHANGELOG.md`) | 18 чипа в един ред се чупеха на произволни редове, а „Журнал“ стоеше далеч от „Данни“ | `ui-nav-symmetry.cjs`, `ui-nav-outside-click.cjs`, законът `balanced-groups` |
| **Мобилна кора на публичната страница (0.69.209)** — числа, статус на достъпа, лист за файл със сверка на отпечатъка, бърза лента | последният комит на изданието (виж `CHANGELOG.md`) | страницата се отваря ПЪРВО на телефон, а числата и статусът ѝ липсваха | `portal-mobile.cjs` |
| **Образът е чист Alpine без npm (0.69.210)** — Node от официалния musl tarball, `--exclude='*/npm'` | `59a3406` | Docker Scout: 2 critical + 21 high, част от тях в пакети НА npm, който никога не се изпълнява | `docker-runtime.cjs`, `raspberrypi-compat.cjs`, `ha-support-matrix.cjs` §6, S04 на `verify-release` |
| **Двата портала са обяснени (ADR-0027)** — динамичен `/p/<slug>` срещу статичен evidence-portal | `59a3406` | въпросът „защо има два портала“ нямаше писмен отговор | `documentation/03_ADR/ADR-0027-two-portals.md` |
| **Папката на порталите е фиксирана (0.69.211)** — `/share/hapi/data/root_storage/<slug>`, панелът само я показва | `811e191` | свободното поле даваше начин порталът да сочи общия `/share` (чуждите папки) или папка, която никой не намира | `portal-storage-fixed.cjs`, `storage-roots.cjs`, `files-manager.cjs`, `portal-card-link.cjs` |
| **Портал „само за преглед“ със свой QR (0.69.211)** — втори запис `portal-view.js`, `inline` файлове, без пакет | `811e191` | при създаване трябва да има и read-only изглед, който не може да изтече като ZIP | `portal-readonly.cjs`, `portal-storage.cjs` |
| **Образът СЕ билдва (0.69.212)** — двуетапен Dockerfile: `node:22.23.2-alpine AS node` дава само `/usr/local/bin/node`, вторият етап е `alpine:3.24`; npm/npx/corepack остават в изхвърления етап | виж `CHANGELOG.md` (0.69.212) | 0.69.210/0.69.211 теглеха Node от musl тарбол по несъществуващ адрес (`curl 404`) — нито един образ не стигна до ghcr.io, а Supervisor-ът на HA даваше `[404] manifest unknown` | `docker-runtime.cjs`, `raspberrypi-compat.cjs`, `ha-support-matrix.cjs` §6, `ha-compatibility.cjs` HA-C01, S04 на `verify-release` (всички гледат етапите, не регулярен израз) |

Пълното описание „какво, защо и какво е измерено“ е в `CHANGELOG.md` и
`documentation/07_RELEASE/RELEASE_0.69.208.md` (§6а.1–§6а.7).

## 3. Договори с един източник на истина

Всяко от тези правила е възникнало от дефект и днес се проверява автоматично. Те са и
„капаните“ за всеки, който добавя код.

| Договор | Единственото място | Тест |
| --- | --- | --- |
| Логически корени `/share`, `/media`, `/config`, `/data` | `hapi_enterprise/paths.js` | `storage-roots.cjs` |
| Корен на порталните папки (`/share/hapi/data/root_storage`) | `paths.portalRootLogical()` / `paths.portalRootFor(slug)`; `storage-preflight` подава ефективните `STORAGE_LOCATION`/`STORAGE_SUBDIRECTORY` в env | `portal-storage-fixed.cjs`, `storage-roots.cjs` |
| Смяна на папката на портал | `PORTAL_STORAGE_ROOT_EDIT` (`HAPI_PORTAL_STORAGE_ROOT_EDIT=1`) — иначе `PATCH` е 403 | `portal-storage-fixed.cjs` |
| Портал „само за преглед“ | `hapi_enterprise/portal-view.js` (втори запис, `inline` файлове, без пакет) | `portal-readonly.cjs` |
| Сервирани UI файлове | `UI_FILES` в `server.js` (allowlist — нов файл иначе е 404) | `html-assets.cjs`, `docker-runtime.cjs` |
| Етикети на полетата | `ui/field-labels.js` след всеки рендер | `ui-field-labels.cjs` |
| Знания за грешките | `ui/debug-ledger.js` (`SOLUTIONS`) + речник `dbg.*` | `debug-ledger.cjs` |
| Закони на оформлението | `ui/debug-objects.js` (`OBJECTS`, `LAWS`) | `gui-debug-objects.cjs` |
| Симетрия на менюто и прибиране при клик извън него | `GROUPS` в `ui/settings-panel.js` · `NAV_GROUPS` в `ui/app.js` · `applyNav` в `app.js` | `ui-nav-symmetry.cjs`, `ui-nav-outside-click.cjs` |
| Преводи | `ui/i18n.js` (BG/EN/DE), ратчет само надолу | `ui-i18n.cjs`, `ui-i18n-ratchet.cjs` |
| Затворен дефект | `KNOWN_DEFECTS.md` + `GUARDS`/`ANCHORS` | `regression-guards.cjs` |
| Размер на монолита | `server.js` ≤ 2722 реда, нов код → `routes/*.js` | `server-structure.cjs` |
| Жив поток без токен в адрес | еднократен билет от `POST /admin/api/events/ticket` | `sse-ticket.cjs` |
| Проверки, които чакат под товар | `helpers.stopChild` (15 s + `SIGKILL`) | `process-guards.cjs` |
| Цялост на кода при старт | `hapi_enterprise/integrity.js` + `integrity-manifest.json` | `integrity-startup.cjs` |
| Пакет за дебъгинг | `scripts/diag-package.cjs` (без тайни, с README) | `diag-package.cjs` |
| Мобилна кора на портала (числа · статус · лист · лента) | `portal/portal.html` + `portal/portal.js` (числата от ДАННИТЕ, не от HTML); същото в `custom_components/hapi_enterprise/portal.*` | `portal-mobile.cjs` (и паритет между двата портала) |
| QR код като SVG | `hapi_enterprise/qr-svg.js` (клетка 8 · поле 4 · мащабируем) | `portal-tokens.cjs`, `qr-dispatch.cjs` |

## 4. Дебъгинг системата днес

Два модула, които се включват **само** при `window.HAPI_DEBUG`, `?debug=1` или
`localStorage['hapi.debug']='1'`:

- `ui/debug-objects.js` — разпознава обектите (карта, контрола, поле, табелка, група от менюто,
  контейнер) и прилага **7 закона**: `spacing-grid`, `symmetry`, `named`, `touch-target`,
  `no-inline-layout`, `one-qr`, `balanced-groups` (менюто е на равни групи). Липсваща стойност
  се прескача, не се брои за нарушение.
- `ui/debug-ledger.js` — протокол: всяка находка влиза с **причина**, **решение** и името на
  теста, който я пази. Подписът е `закон@вид`, повторението вдига брояч вместо да отваря нов
  ред, `resolve()` затваря, появила се пак „решена“ находка се брои като **регресия**. Таван
  **200** записа в `localStorage`, `toJSON()` за доклад за дефект.

| Функция | Какво прави |
| --- | --- |
| `open(scanResult)` | записва находките; връща `{ added, repeated }` |
| `resolve(подпис, бележка)` / `reopen(...)` | затваря / отваря отново |
| `list({ status })`, `stats()` | четене и броячи (отворени, решени, повтарящи се, регресии) |
| `reportText()` | отчетът за екрана и конзолата (причина · решение · „пази: tests/…“) |
| `toJSON()`, `reset()` | готов отчет за прикачане; изчистване |

Пълната спецификация: `documentation/04_FUNCTION_SPECIFICATIONS/DEBUG_OBJECTS.md` (§6).
Отчетът се вижда на екрана в „Настройки → Диагностика → Прегледай обектите“.

## 5. Дефекти

| Състояние | Брой | Забележка |
| --- | --- | --- |
| Редове в регистъра | **57** | `KNOWN_DEFECTS.md`, заглавието носи версията |
| Затворени | **54** | всеки с поне един тест в `GUARDS`; **53** и с котва |
| Отворени | **3** | DEF-01 (приет, документиран — исторически документ), DEF-06, DEF-49 |

- **DEF-06 (WORM):** физическата неизтриваемост иска `chattr +i` (root) или S3 Object Lock —
  извън възможностите на средата, затова остава отворен, а не „затворен на думи“.
- **DEF-49 (език):** **21 464** български знака (таван 21 464), от които **368** са съобщения
  за грешка/логове, а **21 096** интерфейсен текст. Дванадесет екрана/документа са преведени
  напълно: `pf.*` (957 → 53), `pa.*` (667 → 0), `vp.*` (909 → 0), `dp.*` (989 → 0),
  `pfl.*` (1 059 → 0), `pc.*` (2 137 → 0), `dsh.*` (636 → 0), `ex.*` (1 977 → 0),
  `mon.*` (1 831 → 0), `pgw.*` (1 274 → 0), `pt.*` (876 → 0) и `dbg.*` (612 → 0) — с общ речник
  **994** ключа на език. Най-големият остатък са `files-manager.js` (9 672) и
  `settings-panel.js` (7 423). Демо данните (`ui/data.js`, 726 знака) **не са интерфейсен
  текст** — примерен манифест с измислени имена и организации; ратчето ги мери отделно
  (`DEMO_DATA`). Report Studio (`report-studio.js`, `report-scope.js`, `report-objects.js`) е
  **извън обхвата** по решение от 2026-11-15. Модулите със собствен речник (`app.js`) не се
  броят като дълг. Ръстът е заключен от ратчет.

## 6. Измерени порти (0.69.211)

| Гейт | Команда | Резултат |
| --- | --- | --- |
| Пълен матрикс | `node scripts/test-matrix.cjs --skip=release-status --attempts=1` | **413/413**, **1** опит (времето е в `reports/test-matrix.json`, за да не остарява тук) |
| Артефакт | `node scripts/verify-release.cjs` | **22/22** (с `--with-tests` — **23/23**), `dist/` 6 файла |
| Отчет за изданието | `node scripts/release-status.cjs` + `tests/release-status.cjs` | PASS, 414 теста в дървото |
| ГУИ и съвместимост | `node scripts/audit-gui-compat.cjs` | **33/33** · **28/28** |
| Регресионни защити | `tests/regression-guards.cjs` | 54 затворени дефекта · 54 защити · 76 теста · **53** котви |
| Езиков дълг | `tests/ui-i18n-ratchet.cjs` | 27 модула · 21 312 (таван 21 464) · 30 `t()` · 1 модул със собствен речник · 726 знака демо данни извън дълга |
| Речник на публичната страница | `tests/portal-i18n.cjs`, `tests/integration-portal-i18n.cjs` | BG/EN/DE с еднакъв набор; интеграцията ползва СЪЩИЯ файл; 23 знака в кода под таван 23 |
| Одити | `logic-audit --gate` · `bad-code-scan --gate` | 0 · 0 |
| Линт | `npx eslint . --max-warnings=0` | 0 |
| Хигиена | `D:\share` / `C:\share` | не съществуват |

## 7. Какво остава

0. **Пълният списък с неизпълненото е в `documentation/07_RELEASE/UNFINISHED_TASKS_0.69.211.md`** —
   3 отворени дефекта от 57, 4 пропуснати функции, техническият дълг с числа и съзнателните
   „дупки“, които НЕ бива да се „поправят“. Пази го `tests/unfinished-register.cjs`: тестът пада,
   когато задача се затвори, за да се обнови документът, вместо да лъже.
1. **Превод на интерфейсния текст** — DEF-49, отделна задача. Таванът е 21 464, измереното е
   21 312 и дългът е заключен (`ui-i18n-ratchet`). Report Studio е извън обхвата по решение,
   демо данните (`data.js`) не са интерфейсен текст.
2. **Котва за DEF-27** (сензорите се теглят веднъж): защитата проверява брой извиквания и
   няма устойчив низ — иска тест с брояч, не декоративна котва.
3. **DEF-06 (WORM)** — иска root/Object Lock.
4. **Нечетните `1/3/5/7/9px` и радиусите без токен** — преглед с очи, не скрипт.
5. **Мобилната кора е в ДВАТА варианта на портала** — пълният (`hapi_enterprise/portal/*`, с речник
   BG/EN/DE) и интеграционната копия (`custom_components/hapi_enterprise/portal.*`). Еднакъв
   набор възли се пази от `portal-mobile.cjs` (паритет), а текстовете в интеграцията са
   статични на български, защото тя няма свой речник. Изгледът „Покажи всичко“ вече е и в
   двата варианта (обхожда `/tree` до три нива) — `tests/portal-tree-all.cjs` проверява
   работата и в интеграционната копия; от 0.69.210 и интеграцията има речник — същият
   файл `portal-i18n.js` (169 ключа × 3 езика), избор на език и всички съобщения през него;
   в кода остават 23 знака под таван 23 (`tests/integration-portal-i18n.cjs`).
6. **QR код към самата страница НЕ е добавен** — примерният мобилен екран го показва, но това е
   кръгова препратка, забранена от PP-04 и пазена от три теста (DEF-34). От 0.69.210 всеки
   портал има QR за ВСЯКО ниво (портал, подпапки, файлове) в панела — всички водят до
   публичната страница (`tree/qr.svg?path=`, `tests/portal-qr-levels.cjs`); забранено остава
   само кодът да сочи към самата страница, която го показва.
7. **Публикуване на 0.69.211** — таг `v0.69.211`, `scripts/publish-haoss.ps1 -Execute`,
   проверка на SHA-256. Не е пускано: чака изрична дума за публикуване (0.69.209 е публикуван и е Latest).
8. **Спътникът „само за преглед“ не се показва различно в КАРТАТА на панела** — той е отделен
   запис със собствен QR и заглавие с наставка „(преглед)“, но картата му изглежда като
   обикновен портал. Отделна иконка/филтър е решение за следващо издание (`portal-readonly.cjs`
   пази поведението на СТРАНИЦАТА: чип, бутон „Прегледай“, без пакет).
8. **Скриптът на портала вече не пада на частична страница** (`setStatus` на липсващ `#status`
   хвърляше `TypeError: Cannot set properties of null`). Пази го `tests/portal-partial-page.cjs`;
   поправката е в двата варианта. Остава непокрит единствено случаят „страница без
   `#toolbar`/`#visibility`“ — те се пишат само след успешен `GET` на портала, тоест не се
   стигат на страница на отказ; ако някога се стигнат, редът е същият (проверка за възел).

## 8. Как се проверява състоянието

```powershell
node scripts/release-status.cjs            # отчетът за изданието
node scripts/test-matrix.cjs --skip=release-status --attempts=1
node scripts/verify-release.cjs            # S01–S23 върху dist/
node tests/regression-guards.cjs           # дефект → тест → котва
node tests/ui-i18n-ratchet.cjs             # дългът по езика
node tests/debug-ledger.cjs                # знанията за грешките
node scripts/audit-gui-compat.cjs          # ГУИ и съвместимост
npx eslint . --max-warnings=0
```

## 9. Свързани документи

- [`KNOWN_DEFECTS.md`](KNOWN_DEFECTS.md) — регистърът на дефектите (единственият списък).
- [`SOURCE_INVENTORY.md`](SOURCE_INVENTORY.md) — всеки модул с роля и редове.
- [`MODULE_CATALOG.md`](MODULE_CATALOG.md) · [`DEPENDENCY_GRAPH.md`](DEPENDENCY_GRAPH.md) —
  графът на модулите.
- [`../02_TO_BE_ARCHITECTURE/ARCHITECTURE_COMPLIANCE_MATRIX.md`](../02_TO_BE_ARCHITECTURE/ARCHITECTURE_COMPLIANCE_MATRIX.md) —
  нормативното „какво трябва да бъде“ и съответствието.
- [`../07_RELEASE/RELEASE_0.69.208.md`](../07_RELEASE/RELEASE_0.69.208.md) — бележките за изданието.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — промените в ред за четене.
