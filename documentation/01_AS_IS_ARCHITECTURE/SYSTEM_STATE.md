# Състояние на системата и промени в 0.69.237

> **Клас:** жив · **Собственик на факта:** състояние днес · **Проверен към:** 0.69.240

> Живият документ за **„какво е системата днес“**, за разлика от нормативните документи в
> `02_TO_BE_ARCHITECTURE/` (какво трябва да бъде). Обновява се при всяко издание, а числата се
> ВЗИМАТ от скриптове и отчети, не се пишат на ръка. Всичко тук е измерено в работното дърво
> на 0.69.237; при разминаване меродавни са `reports/RELEASE-STATUS.md`,
> `reports/test-matrix.json` и `documentation/01_AS_IS_ARCHITECTURE/SOURCE_INVENTORY.md`.

## 1. Какво е системата

hAPI Enterprise е Home Assistant add-on (Node ≥ 22.13, **нула runtime зависимости**,
`node:sqlite`) плюс HACS интеграция. Един процес обслужва административен HTTP слой, публични
портали, криптирано хранилище, WORM-одит, отчети с електронен подпис и ГУИ панел, който се
зарежда и през HA Ingress, и самостоятелно (Docker).

| Показател | Стойност (измерено) |
| --- | --- |
| Версия | **0.69.237** (`hapi_enterprise/config.yaml`, огледала в 12 файла) |
| Модули в add-on-а | **119** `.js` в корена + по папки: `routes/` **22** · `server_module/` **2** · `core_module/` **5** · `ui/` **30** · `portal/` **2** · `plugins/` **3** · `generator/` **1** |
| Изнесени HTTP компонента | **22** файла в `hapi_enterprise/routes/` |
| Модули на панела | **30** `.js` файла в `hapi_enterprise/ui/` |
| Обявени операции | **228** в `API_ENDPOINT_REFERENCE.md` (+ 33 публични правила = 261 HTTP реда) |
| `server.js` | **2722** реда (пор **2722**) — бюджетът е изчерпан, затова нов сегмент влиза в `server_module/` или `routes/`, не тук |
| Кеш на статиката | `/ui/*`, `/portal.css`, `/portal.js`, `/portal-i18n.js` — `private, max-age=31536000, immutable` **с `?v=<версия>`**, иначе `no-cache` + `ETag` и `304` без тяло; входната страница и HTML-ът на портала са `no-cache`; миниатюрите са `private, max-age=3600` (DEF-87, DEF-88) |
| Изнесени функции | **390** функции (452 символа) в **57** модула, **0** непокрити функции; 29 непокрити са константи/обекти (`NAMES`, `RULES`), не функции |
| Тестове в дървото | **466** файла в `tests/` = **465** правила (`helpers.cjs` не е тест); матриксът пуска **464**, а `release-status.cjs` върви след него |
| Артефакт | `dist/` — точно **6** файла, `verify-release` **22/22** |

## 2. Какво се промени

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
| **Папката на порталите е фиксирана (0.69.211)** — днес `<корен>/hAPI/portals/<slug>`, панелът само я показва | `811e191` | свободното поле даваше начин порталът да сочи общия `/share` (чуждите папки) или папка, която никой не намира | `portal-storage-fixed.cjs`, `storage-roots.cjs`, `files-manager.cjs`, `portal-card-link.cjs` |
| **Портал „само за преглед“ със свой QR (0.69.211)** — втори запис `portal-view.js`, `inline` файлове, без пакет | `811e191` | при създаване трябва да има и read-only изглед, който не може да изтече като ZIP | `portal-readonly.cjs`, `portal-storage.cjs` |
| **Образът СЕ билдва (0.69.212 + 0.69.217)** — двуетапен Dockerfile: `node:22.23.2-alpine AS node` дава само `/usr/local/bin/node`, вторият етап е `alpine:3.24`; npm/npx/corepack остават в изхвърления етап; от 0.69.217 `addon-image.yml` се пуска и при `push` към `main`, не само на таг | виж `CHANGELOG.md` (0.69.212, 0.69.217) | 0.69.210/0.69.211 теглеха Node от musl тарбол по несъществуващ адрес (`curl 404`) — нито един образ не стигна до ghcr.io; а версията в `config.yaml` се вдига преди тага: 0.69.215 остана без образ и HA даваше `[404] manifest unknown` (DEF-61) | `docker-runtime.cjs`, `raspberrypi-compat.cjs`, `ha-support-matrix.cjs` §6, `ha-compatibility.cjs` HA-C01, S04 на `verify-release`, `addon-image-pipeline.cjs` (DEF-61) |
| **Архивът не взима локални файлове (0.69.213)** — `release-lib.archiveEntries()` изключва всичко, което `git ls-files --others --ignored` познава; същото правило ползват `build-release` и S08/S09 на `verify-release` | виж `CHANGELOG.md` (0.69.213) | 0.69.212 даде 212 файла в `dist/RELEASE.json` на тази машина и 211 в CI (локален `generator.7z`); отчетът цитира бройката, CI го обяви за остарял и `CI`/`Release` паднаха | `release-archive-ignored.cjs`, `regression-guards.cjs` (DEF-58) |
| **Качването е СЕСИЯ със сверка по хеш (0.69.214)** — `routes/upload-sessions.js` (парчета по 1 MB, `X-Chunk-Sha256`, сверка на целия файл, обратно четене, `mtime` възстановен, история в `upload-history/<portalId>.jsonl`) + `ui/upload-progress.js` (модален прозорец със затъмнен фон и реален напредък от сървъра) | виж `CHANGELOG.md` (0.69.214) | една заявка с цялото тяло: без напредък, без продължаване след прекъсване, без доказуема цялост и със загубен `mtime` (DEF-59) | `upload-sessions.cjs`, `gui-upload-progress.cjs`, `gui-upload-resume.cjs`, `gui-upload-folder.cjs` |
| **Първата част от езиковия дълг (0.69.215)** — 11 съобщения на панела минаха през речника (`fm.*`), таванът на ратчето падна с 228 знака | виж `CHANGELOG.md` (0.69.215) | български литерали в `files-manager.js` не се виждаха от DE/EN потребителя (DEF-49) | `ui-i18n-ratchet.cjs` (таван само надолу), `ui-i18n.cjs`, `files-manager.cjs` |
| **Прегледът не рисува документи, които изпълняват скрипт (0.69.216)** — `SAFE_FRAME` в панела, CSP за inline SVG на сървъра, RFC 5987 в `Content-Disposition` | виж `CHANGELOG.md` (0.69.216) | blob адресът наследява произхода на панела: качен SVG със `<script>` стигаше до `sessionStorage` с администраторския токен (DEF-60) | `preview-unsafe-types.cjs`, `render-sinks-global.cjs` (глобално по целия интерфейс) |
| **Образът се строи и при push към `main` (0.69.217)** — `addon-image.yml` получава `branches: [main]` освен тага | виж `CHANGELOG.md` (0.69.217) | версията в `config.yaml` се вдига преди тага: 0.69.215 остана без образ и HA даваше `[404] manifest unknown` (DEF-61) | `addon-image-pipeline.cjs`, `regression-guards.cjs` (DEF-61) |
| **Няма вграден стил в панела (0.69.218)** — напредъкът е `<progress value>` + CSS, логото и колоните в прегледа са класове | виж `CHANGELOG.md` (0.69.218) | собствената политика `style-src 'self'` блокираше `style="width:…"`: лентата на напредъка оставаше празна в Home Assistant (DEF-62) | `ui-inline-style-csp.cjs` (33 файла, глобално), `gui-upload-progress.cjs` |
| **Договорът за адресите при създаването (0.69.219)** — `portal-links.js` издава `page` · `api` · `manifest` · `openapi` · `qr` · шаблони за файл/папка · `readOnly` · `files.empty`, а `POST /admin/api/portals` и `api-info` го връщат от един код | виж `CHANGELOG.md` (0.69.219) | адресите се сглобяваха на три места, създаването не връщаше нито един, а спътникът „само за преглед“ нямаше видим адрес (DEF-63) | `portal-creation-contract.cjs`, `gui-portal-create-contract.cjs` |
| **Компонентите се зареждат по папка (0.69.220 + 0.69.223)** — `server-modules.js` чете `server_module/*.js` по име; първият изваден сегмент е `/p/<id>`; `core.js` зарежда ВСИЧКИ `core_module/*.js` и дава замразен `core.api` (`qr` SVG · `address` договор/`attach`/`landingPath`) | виж `CHANGELOG.md` (0.69.220, 0.69.223) | всеки нов сегмент искаше ред в `server.js` при бюджет точно на тавана (DEF-64), а QR кодът и договорът за адресите се правеха на три места — една промяна минаваше през три файла и едно от местата оставаше старо (това роди DEF-63/DEF-70) | `server-modules.cjs` (всички по име, счупен = грешка при старт), `core-modules.cjs` (замразен `core.api`, без пряк `require` в потребителите), `file-placement.cjs`, `docker-runtime.cjs` |
| **Договорът за прегледа носи СВОЙ подпис (0.69.221)** — `readOnlyPart()` приема готов договор; `attach()` строи спътника пръв, с неговия `accessQuery`; `api-info` подава `readOnlyAccess`; критичният преглед `CRITICAL_REVIEW_0.69.220.md` §5 даде жива проба и DEF-70…DEF-73 | виж `CHANGELOG.md` (0.69.221) | за ЧАСТЕН портал адресът на спътника беше без `?expires=&sig=` и правеше 404, макар договорът да твърдеше „готов“ (DEF-70); тестовете не го хванаха, защото създаваха публичен портал | `portal-creation-contract.cjs` §7 (частен портал, два различни подписа), `logic-audit-fresh.cjs` |
| **Кешът е обвързан с версия и носи `ETag` (0.69.226 + 0.69.227)** — `?v=<версия>` дава `immutable`, иначе `no-cache`; версията се слага в HTML-а при сервиране; `static-etag.js` пази тялото в паметта и дава `304` без тяло, етикетът е sha256 от СЕРВИРАНОТО съдържание | виж `CHANGELOG.md` (0.69.226, 0.69.227) | 46 отговора бяха `no-store`: панелът теглеше **34 файла / 1044 KB** при всяко зареждане, `public` миниатюра от заключен портал можеше да остане в прокси на доставчика (DEF-87), а адресите БЕЗ версия се четяха от диска при всяка заявка (DEF-88) | `static-cache.cjs` (§1 кеш с/без версия · §2 входът носи версия · §3 порталът · §4 нито един `public`), `static-etag.cjs` (§1 304 без тяло · §2 страницата повторно · §3 порталните файлове · §4 същото тяло) |
| **Опциите на портала са един файл с правила (0.69.236)** — плосък `configuration.yaml` с `id`/`off:`, маршрути `GET/PUT …/config` (+`verify`/`adopt`/`export.yaml`/`import`) и блок „Опции“ в панела; формите идват от `portal-config.RULES` | виж `CHANGELOG.md` (0.69.236) | опциите живееха в четири места, а файлът беше само изход; две проверки на едни и същи форми можеха да се разминат | `portal-config-format`, `portal-config-ids`, `portal-config-registry`, `portal-config-api`, `portal-config-ui` |
| **Дневникът на проверките и обектът функции (0.69.237)** — `check-log.js` води журнал `check.<име>` с `ok`/`fail`/`crash`, `verify-verdict.js` решава една присъда за целия отговор; бутоните на портала станаха един обект `FUNCTIONS` (икони v4 + чекбокс + състояние на реда) с пакетно изпълнение | виж `CHANGELOG.md` (0.69.237) | панелът четеше `summary.ok`, а отговорът носи ГЛАВНИ букви — „разминават се 0“ точно при подправен файл (DEF-93); проверките не оставяха следа в журнала, а 11 отделни бутона нямаха общо състояние (DEF-94) | `check-log.cjs`, `check-log-integration.cjs`, `verify-verdict.cjs`, `ui-portal-functions.cjs`, `regression-guards.cjs` (DEF-93, DEF-94) |

Пълното описание „какво, защо и какво е измерено“ е в `CHANGELOG.md` и `documentation/07_RELEASE/RELEASE_0.69.208.md` (§6а.1–§6а.7).

## 3. Договори с един източник на истина

Всяко от тези правила е възникнало от дефект и днес се проверява автоматично. Те са и
„капаните“ за всеки, който добавя код.

| Договор | Единственото място | Тест |
| --- | --- | --- |
| Логически корени `/share`, `/media`, `/config`, `/data` | `hapi_enterprise/paths.js` | `storage-roots.cjs` |
| Корен на порталните папки (`/share/hAPI/portals`) | `paths.portalsRoot()` / `paths.portalRootFor(slug)`; домашната папка `/share/hAPI` е `paths.hapiHome()`, а `storage-preflight` подава ефективните `STORAGE_LOCATION`/`STORAGE_SUBDIRECTORY` в env | `portal-storage-fixed.cjs`, `storage-roots.cjs` |
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
| Дневник на проверките | `hapi_enterprise/check-log.js` — `NAMES` е затворен договор, непознато име се пише като `check.unknown` | `check-log.cjs`, `check-log-integration.cjs` |
| Присъдата „има проблем“ | `hapi_enterprise/verify-verdict.js` (`verdict()`, `describe()`, `PROBLEM_KEYS`) — панелът не смята сам | `verify-verdict.cjs` |
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
| Редове в регистъра | **95** | `KNOWN_DEFECTS.md` (21 живи) + `KNOWN_DEFECTS_ARCHIVE.md` (74); заглавието носи версията |
| Затворени | **88** | всеки с поне един тест в `GUARDS`; **83** и с котва |
| Отворени | **6** | DEF-01, DEF-06, DEF-49, DEF-66, DEF-67, DEF-69 |

- **DEF-06 (WORM):** физическата неизтриваемост иска `chattr +i` (root) или S3 Object Lock —
  извън възможностите на средата, затова остава отворен, а не „затворен на думи“.
- **DEF-49 (език):** **22 047** български знака (таван 22 051), от които **368** са съобщения
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

## 6. Измерени порти (0.69.237)

| Гейт | Команда | Резултат |
| --- | --- | --- |
| Пълен матрикс | `node scripts/test-matrix.cjs --skip=release-status --attempts=1` | **464/464**, **1** опит (времето е в `reports/test-matrix.json`, за да не остарява тук) |
| Артефакт | `node scripts/verify-release.cjs` | **22/22** (с `--with-tests` — **23/23**), `dist/` 6 файла |
| Отчет за изданието | `node scripts/release-status.cjs` + `tests/release-status.cjs` | PASS, 465 теста в дървото |
| ГУИ и съвместимост | `node scripts/audit-gui-compat.cjs` | **33/33** · **28/28** |
| Регресионни защити | `tests/regression-guards.cjs` | 88 затворени дефекта · 89 защити · 109 теста · **84** котви |
| Езиков дълг | `tests/ui-i18n-ratchet.cjs` | 29 модула · 22 047 (таван 22 051) · 30 `t()` · 1 модул със собствен речник · 726 знака демо данни извън дълга |
| Речник на публичната страница | `tests/portal-i18n.cjs`, `tests/integration-portal-i18n.cjs` | BG/EN/DE с еднакъв набор; интеграцията ползва СЪЩИЯ файл; 23 знака в кода под таван 23 |
| Одити | `logic-audit --gate` · `bad-code-scan --gate` | 0 · 0 |
| Линт | `npx eslint . --max-warnings=0` | 0 |
| Хигиена | `D:\share` / `C:\share` | не съществуват |

## 7. Какво остава

0. **Пълният списък с неизпълненото е в `documentation/07_RELEASE/UNFINISHED_TASKS_0.69.211.md`** —
   отворените дефекти, 4 пропуснати функции, техническият дълг с числа и съзнателните
   „дупки“, които НЕ бива да се „поправят“. Пази го `tests/unfinished-register.cjs`: тестът пада,
   когато задача се затвори, за да се обнови документът, вместо да лъже.
1. **Превод на интерфейсния текст** — DEF-49, отделна задача. Таванът е 22 051, измереното е
   22 047 и дългът е заключен (`ui-i18n-ratchet`, само надолу). Report Studio е извън обхвата по решение,
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
7. **Публикуване на 0.69.237** — таг `v0.69.237`, `scripts/publish-haoss.ps1 -Execute`,
   проверка на SHA-256. Не е пускано: чака изрична дума за публикуване (0.69.214 е последното
   публикувано; 0.69.215 … 0.69.237 са в `main` без таг, тоест без образ — това е DEF-61).
8. **Спътникът „само за преглед“ не се показва различно в КАРТАТА на панела** — той е отделен
   запис със собствен QR и заглавие с наставка „(преглед)“, но картата му изглежда като
   обикновен портал. Отделна иконка/филтър е решение за следващо издание (`portal-readonly.cjs`
   пази поведението на СТРАНИЦАТА: чип, бутон „Прегледай“, без пакет).
9. **Скриптът на портала вече не пада на частична страница** (`setStatus` на липсващ `#status`
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
- [`../07_RELEASE/archive/0.69/RELEASE_0.69.208.md`](../07_RELEASE/archive/0.69/RELEASE_0.69.208.md) — бележките за изданието.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — промените в ред за четене.
