# Одит на постигнатото — 0.69.87

> **Какво е този документ.** Един честен отчет какво е направено в изданието 0.69.87, **откъде
> дойде всяка промяна**, с какво е доказана и какво НЕ е доказано. Не е маркетинг: числата
> долу са от последното пускане на гейтовете на тази машина, а твърденията без измерване са
> изрично отделени в §6.
>
> Обхватът е **ЦЯЛОТО издание**, не само последните промени: от таг `v0.69.86` до комит
> `763e6e8` (самият одит) това са **56 комита, 123 файла, +7764 / −766 реда**
> (`git diff --shortstat v0.69.86..763e6e8`). Краят на обхвата е ФИКСИРАН нарочно: иначе
> „до сега“ се мени с всеки нов комит и числата в документа престават да бъдат верни.
>
> Описанието „какво се промени и защо“ е в
> [`RELEASE_0.69.87.md`](RELEASE_0.69.87.md); тук е **проследимостта**: произход → код → тест
> → документ → комит.

## 1. Обхват и произход на промените

Изданието не е „списък от идеи“, а отговор на конкретни наблюдения. Всеки ред по-долу има
източник, който може да се отвори.

| # | Какво предизвика промяната | Какво беше намерено |
| - | -------------------------- | ------------------- |
| A | доклад на собственика: `Unknown secret ' hapi_pgp_path_pass'` при запис на конфигурацията | в опцията има **две** разстояния след `!secret`; Supervisor търси секрет на име `" hapi_pgp_path_pass"` |
| B | същият доклад, но погледнат в кода | четири наши документа твърдяха обратното („`!secret` не се разширява в опциите“) — вярно някога, невярно сега |
| C | `error-log.jsonl` на живата инсталация | 10 двойки `ERR_HTTP_HEADERS_SENT` за два дни: сървърът отговаря **два пъти** на една заявка |
| D | `secrets.yaml` и реалните ключове на инсталацията | `private.asc` е v6 с **AEAD** защита (`usage 253`) → дотогава `UNSUPPORTED_KEY_USAGE (253)` без обяснение; пътищата бяха относителни, а `secret.asc` не съществува |
| E | `PLAN_STATUS` §4.1 — последното открито изискване от F4-5 | липсваше `Idempotency-Key` (повторяеми заявки) |
| F | собствен гейт `bad-code-scan` падна по време на работата | allowlist-ът беше закачен за **номера на ред**: добавен ред отменяше пет приети обосновки |

## 2. Темите на изданието (цялото, по комити)

За да е проверимо „какво влезе“, комитите са групирани по тема. Всяка тема има тест или
документ, който я пази — иначе не би била в изданието.

| Тема | Комити | Какво се промени | С какво се пази |
| ---- | ------ | ---------------- | --------------- |
| Docker слой и сигурност на образа | `69e9745`, `85d0d08`, `b38f950` | `node:22.21.1-alpine3.23`, `apk upgrade`, махнати `npm`/`npx`/`yarn`/`corepack` | `docker-runtime`, `ha-compatibility`, `raspberrypi-compat`, `verify-release` S04/S05 |
| Проверка на САМОТО издание | `90fceba`, `28351d3`, `1d1e05f` | `scripts/artifact-smoke.cjs`; `verify-release` S22 — архивът байт по байт | `artifact-smoke` (11 проверки), S22 |
| `EVIDENCE_NEVER_DELETED` — доказателството не се трие по нито един вход | `a00ed3d`, `24f6092`, `3c65214`, `e53b408`, `1f5364e` | индексът се строи веднъж, `refused` брои истински откази; отказ при ръчно триене; `content_id` следва байтовете; лимитът на версиите пази публикувано; портал с архиви иска `?force=1` | `retention-evidence`, `retention-cost`, `file-transfer`, `versioning` |
| Прехвърляне между портали + огледало | `92a51b5`, `7a326fa`, `4eeb80f`, `e6425a8` | `routes/file-transfer.js` (сверка по SHA-256, нов `content_id`), `ui/files-manager.js`, второто копие следва файла, таймаут към увиснал S3 | `file-transfer`, `transfer-mirror`, `mirror-target-timeout`, `files-manager` |
| Доказателствен пакет с одитна верига | `f33a9d1` | `report-package.js`: `audit/custody.jsonl` + `custody.json`, `audit-chain.lines()` | `report-package` |
| Грешката е структура (RFC 9457) + стабилен pgp тест | `bbbc625` | `problem.js` (`type`/`title`/`status`/`detail` + старото `error`); тестът разбира subpacket-и вместо байт-търсене | `problem`, `api-input-errors`, `pgp` (30 поредни пуска) |
| Генерирани документи вместо ръчно поддържани | `bc39853`, `5ff6d20`, `681f1b2`, `bb7817b`, `1704e64`, `fa566b4` | `source-inventory.cjs`, `audit-events.cjs`; `api-reference` 186→193 операции; `server-structure` вижда и regex маршрути | `source-inventory`, `audit-events`, `api-reference`, `server-structure` |
| Плановете спират да твърдят невярно | `398d2ae`, `e975f9e`, `23f315d`, `5e5b20f`, `bada737`, `afa6686`, `a9d685c`, `c40c369`, `df69cb8`, `476696e`, `74015a5`, `65f0763`, `899f94b`, `723cb1d`, `f3b03f2` | банери „исторически“; статуси F1-8/F2-10/F4/F7 сверени с кода; `PLAN_STATUS` §4.1 изрежда отвореното извън матрицата; F1-8 получава тест (`api-generation`: смяната на slug мести `api/<slug>/`) | `docs-consistency`, `scenario-matrix`, `api-generation` |
| Отчети от измерено, не от памет | `889eff0`, `4c5a6db` | `reports/test-matrix.json`, `RELEASE-STATUS.md` се генерират от реалния пуск | `release-status` + тестът му |
| Конфигурационни диагнози, `Idempotency-Key`, `SINGLE_RESPONSE` | `78e2b44` … `763e6e8` | виж §3 — последният дял, описан ред по ред | виж §3 |

> **Бележка към колоната „С какво се пази“ — проверена машинно.** От 26 имена в обратни кавички
> с тире: **21 са тестове** в `tests/`, **3 са инструменти** в `scripts/` (`verify-release`,
> `artifact-smoke`, `bad-code-scan`), а **2 са роли на PGP ключ** (`encrypt-comms`,
> `encrypt-storage`) — файлове с тези имена няма и не бива да се търсят.

**Два пропуска, намерени ОТ САМИЯ ОДИТ и затворени.**

1. `scripts/artifact-smoke.cjs` (11 проверки на самото издание) **не се пускаше от нито един
   гейт** — стоеше само като ръчна отметка, тоест можеше да бъде пропуснат, без нищо да го
   хване. Сега е СТЕПЕН 3 в `scripts/audit-gui-compat.cjs`, тоест част от `npm run audit:gui`
   и от изхода „Издание: проверено“.
2. **36 документа** в `documentation/` (всички ADR-та, миграционните регистри, трите
   ръководства за потребителя) нямаха входяща препратка: индексът беше само „акценти“.
   Сега `scripts/docs-index.cjs` строи от диска пълния списък (**112 документа**, заглавие от
   самия файл) в `documentation/README.md`, а `tests/docs-index.cjs` го пази актуален и
   проверява, че нито един документ не липсва.
3. **Манифестът на образа не се проверяваше в обратната посока.** Четири модула
   (`container.js`, `event-bus.js`, `plugins.js`, `sqlite-repository.js`) се копират в образа,
   но **никой не ги require-ва**, а каталогът ги описваше като инфраструктура. Сега
   `tests/docker-runtime.cjs` пада при нов необвързан файл, а изключенията са изрични и с
   причина; каталогът ги отбелязва като **необвързани**.
4. **23 кода за грешка се излъчваха без нито едно обяснение в документацията**
   (`UNSUPPORTED_PKESK`, `BAD_MPI`, `MDC_MISSING`, `WORKDIR_NOT_SEALED`, …). Сега
   `scripts/error-codes.cjs` строи `ERROR_CODES.md` — **55 кода**, значение от самия код и файл
   на излъчване; `tests/error-codes.cjs` го пази актуален и проверява, че всеки ред сочи
   съществуващ файл.

### 2.1 Проверено и намерено за чисто

Одит, който изброява само находките, не показва колко е търсил. Затова и обратното:

| Проверка | Резултат |
| -------- | -------- |
| 56 комита в изданието → всеки споменат в този документ | **56/56** |
| 26 имена в обратни кавички → съществуват като тест/инструмент/роля | **0 измислени** |
| 29 скрипта в `scripts/` → имат caller или са документирани | **0 сираци** |
| 22 UI модула → всеки е споменат в поне един тест | **0 без проверка** |
| 14 HTTP кода, използвани от `fail()` → имат заглавие по RFC в `problem.js` | **0 без заглавие** |
| 43 опции → преводи в `bg.yaml` и `en.yaml`, без излишни ключове | **43/43 + 43/43** |
| 47 кода за грешка, излъчвани от кода → описани в `ERROR_CODES.md` | **0 неописани** |
| 271 тест → всички се изпълняват от матрицата (единственото изключение е `release-status`, който се пуска отделно със собствения си тест) | **пълно покритие** |
| 43 функции/маршрута в нормативната спецификация → съществуват в кода | `api-reference` + `scenarios` |

**Шум, който одитът сам отхвърли (важно е да се знае).** Три отделни проверки първо дадоха
фалшиви находки и бяха опровергани с измерване, преди да влязат в документ:

- `public-gateway.js`, `download-access.js`, `export-manager.js` изглеждаха мъртви, защото
  проверката търсеше `require('./x')`, а кодът изисква с разширение (`require('./x.js')`);
- `cms-sign.js`, `report-*.js`, `x509.js` и др. изглеждаха мъртви, защото require-веригата
  започваше само от `server.js` и не влизаше в `routes/` (`require('../x')`);
- 15 UI модула изглеждаха без GUI проверка, защото проверката сравняваше имена на тестове, а не
  съдържание — всеки от тях е споменат в поне един тест.


## 3. Проследимост на последните 16 комита

| Промяна | Код | Тест | Документ | Комит |
| ------- | --- | ---- | -------- | ----- |
| `Idempotency-Key` (F4-5): повторена заявка не изпълнява действието втори път | `idempotency.js`, таблица `idempotency` в `sqlite-store.js` | `tests/idempotency.cjs` (10 проверки + жив сървър) | `API_ARCHITECTURE_SPEC.md` §4.4b, матрица §5.1 | `78e2b44` |
| Документите казват истината за `!secret` в опциите | — | `docs-consistency` | `admin-token.md`, `installation-layout.md`, `pgp-keys-setup.md`, `PGP_KEYRING_AND_WORK_FOLDER.md` | `dd07581` |
| `SECRET_NAME_HAS_SPACE` / `SECRET_NOT_EXPANDED` + `secretOption` | `path-crypto.js`, `start.js` | `pgp-keyring` (4 нови), `start-token-required` | `pgp-keys-setup.md` §3 капан 2 | `fe81d87` |
| Изданието доказва, че разпознава незаместен `!secret` | `scripts/artifact-smoke.cjs` | `artifact-smoke` (9-та проверка) | `RELEASE_0.69.87.md` §3 | `e5f151c` |
| `SECRET_PATH_RELATIVE` — относителен път не е път в контейнера | `path-crypto.js` | `pgp-keyring` (5-та нова) | `installation-layout.md`, `pgp-keys-setup.md` капан 3 | `6ca383c` |
| `S2K_AEAD_UNSUPPORTED` + allowlist по сегмент | `pgp.js`, `path-crypto.js` (`KEY_ERRORS`), `scripts/bad-code-scan.cjs` + allowlist | `pgp-keyring` (6-та нова), фикстур `secret-aead.asc` | `PGP_KEYRING_AND_WORK_FOLDER.md` таблица, `TEST_CASE_CATALOG.md` T-PGP-02 | `57afa49` |
| Договорът на ключохранилището изброява новите причини | — | `api-reference` | `INTEGRATION_CONTRACTS.md` | `fbf1daa` |
| `OPTION_SECRET_NOT_EXPANDED` при старт за всяка опция | `start.js` | `start-token-required` (9 случая) | `installation-layout.md` таблица, `pgp-keys-setup.md` | `543a7da` |
| AEAD-ограничението в честния списък | — | `docs-consistency` | `PLAN_STATUS.md` §4.1, `BACKLOG-AFTER-0.69.67.md` | `6911ff2` |
| `SINGLE_RESPONSE`: тялото преди заглавките, без втори отговор | `respond.js` (изнесен от `server.js`), `server.js` | `tests/respond.cjs` | `MODULE_CATALOG.md`, матрица §5.1, `RELEASE_0.69.87.md` §2.11 | `aa764de`, `c70bbd6` |
| Късен отговор ≠ сървърна грешка (`response.already-sent`) | `server.js` (catch) | `tests/server-structure.cjs` (инвариант) | `CHANGELOG.md` | `87757c1` |
| Изданието не отговаря двойно (проверка върху архива) | `scripts/artifact-smoke.cjs` | `artifact-smoke` (11-та проверка) | `RELEASE_QUALIFICATION.md`, `RELEASE_0.69.87.md` §3 | `f5089c5` |
| Отказаният втори отговор се вижда в лога (`RESPONSE_ALREADY_SENT`) | `respond.js` | `tests/respond.cjs` (прихваща `console.warn`) | `CHANGELOG.md` | `e6d7dcc` |
| Конфигурационните диагнози в издателския запис (§2.10) | — | `docs-consistency` | `RELEASE_0.69.87.md` §2.10 | `a1c74da` |
| Пълният одит на изданието (този документ) | — | `docs-consistency` | `documentation/README.md` (индекс) | `763e6e8` |
| `artifact-smoke` става част от гейта (пропуск, намерен от одита) | `scripts/audit-gui-compat.cjs` (СТЕПЕН 3) | `audit-gui-compat` | `RELEASE_CHECKLIST.md` | `f13069a` |
| Пълният индекс на документацията се генерира (втори пропуск от одита) | `scripts/docs-index.cjs` | `tests/docs-index.cjs` | `documentation/README.md` §„Пълно съдържание“ | `d8cb370` |
| Манифестът се проверява и обратно — нищо мъртво в образа (трети пропуск) | `tests/docker-runtime.cjs` | `docker-runtime` | `MODULE_CATALOG.md` бележка за необвързаните | `1cff14a` |
| Каталог на кодовете за грешка, генериран от кода (четвърти пропуск) | `scripts/error-codes.cjs`, `path-crypto.js` | `tests/error-codes.cjs` | `ERROR_CODES.md` | — |

Общо в последния дял: **43 файла, +1791 / −359 реда, 16 комита** (от `78e2b44` до `763e6e8`).

## 4. Измерени гейтове (последно пускане, тази машина)

| Гейт | Команда | Резултат |
| ---- | ------- | -------- |
| Тестова матрица | `node scripts/test-matrix.cjs --skip=release-status` | **269/269, 1 опит, 208 с** |
| Издателски сценарии | `node scripts/verify-release.cjs` | **21/21** (S22: архивът е байт по байт равен на `hapi_enterprise/`) |
| Самото издание | `node scripts/artifact-smoke.cjs` | **11 проверки** върху разархивирания архив |
| Отчет за изданието | `node scripts/release-status.cjs` + `tests/release-status.cjs` | **0.69.87 · 270 теста**, независим от платформа и дата |
| Справочник на API | `node scripts/api-reference.cjs --check` | 193 операции · 32 публични правила · 11 компонента |
| Каталог на одитните събития | `node scripts/audit-events.cjs --check` | 164 събития от 12 файла |
| Инвентар на кода | `node scripts/source-inventory.cjs --check` | 169 файла, съвпада с диска |
| Подразбирания в README | `node scripts/settings-defaults.cjs --check` | 43 настройки |
| Документация | `tests/docs-consistency.cjs` | OK, без счупени връзки |
| Матрица на сценариите | `tests/scenario-matrix.cjs` | 62 области · 49 маршрута · 24 RBAC способности · 43 опции · 270 тестови файла |
| Логически одит | `node scripts/logic-audit.cjs --gate` | чисто |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | чисто |
| GUI + съвместимост + изданието | `node scripts/audit-gui-compat.cjs` | 33/33 · 28/28 · `verify-release` S01–S21 · `artifact-smoke` (11 проверки) като СТЕПЕН 3 |
| Стил | `npx eslint .` | 0 |

`server.js` е **2720/2722** реда — таванът не е вдиган, а освободен чрез изнасяне (`respond.js`).

## 5. Какво е проверено ИЗВЪН кода (живата инсталация)

Тези неща не се виждат от тестовете, затова са описани отделно.

1. **`secrets.yaml`** (`\\192.168.50.4\config`) — поправен: абсолютни пътища
   (`/homeassistant/_openpgpV6/…`), `private.asc` вместо несъществуващия `secret.asc`,
   `hapi_pgp_path_pass` → празно (паролата идва от `pgp_key_pass`), премахнати двата интервала
   в шаблона и паролата от него. Проверено: `BEGIN PGP PRIVATE KEY BLOCK` в `private.asc`,
   нула двойни интервала, всички незапразнени пътища абсолютни.
2. **Всички `!secret` препратки** в `/config` — сверени с имената в `secrets.yaml`. Няма втора
   активна счупена; двете недефинирани (`addon_usr`, `white_dirs`) са само в коментари.
3. **Реалните ключове** — публичният е 9 ключа, X25519 подключ за криптиране по Key Flags, с
   роли `sign`/`authenticate`/`encrypt-comms`/`encrypt-storage`. Частният е v6 с AEAD защита —
   оттам идва `S2K_AEAD_UNSUPPORTED`.
4. **`error-log.jsonl`** — двойките `ERR_HTTP_HEADERS_SENT` са сверени по време с
   `audit.jsonl`: съвпадат с `qr.archived` и с дълги операции по портал с 1013 папки/2000 файла,
   тоест „късен отговор“, не счупен маршрут.
5. **Мястото на данните** — инсталацията ползва `app_config` (`hapi_enterprise/`), не новото
   подразбиране `/share/hapi/data`. Това е валидно, документирано поведение за стари
   инсталации (`STORAGE_LEGACY_LOCATION`).

## 6. Какво НЕ е доказано (честен списък)

| Нещо | Защо не е доказано |
| ---- | ------------------ |
| Че записът в HA UI минава | опциите на add-on-а се пазят от Supervisor и **не са** на SMB дяла; проверката иска достъп до UI |
| Че PGP ключът се отваря | ключът е с AEAD защита; нужно е пре-експортиране без парола — действие на собственика |
| Docker образът | демонът на машината е спрян: образът не е пресъбран, CVE числата не са премерени |
| Реална инсталация през Supervisor и браузърна Ingress сесия | изисква жива инсталация |
| PDF/A-3 заверка (veraPDF), `legal hold` към Object Lock | извън обхвата на изданието (виж `PLAN_STATUS.md` §4.1) |
| Пълният отговор на въпроса „кой точно маршрут отговори два пъти“ | обезвредено е на ниво `respond.js` + `catch`; конкретният извикващ не е изолиран, защото логът не пази пътя на заявката при грешка |

## 7. Как да се провери отново (без доверие към този документ)

```bash
node scripts/test-matrix.cjs --skip=release-status   # 269/269
node scripts/build-release.cjs && node scripts/verify-release.cjs
node scripts/artifact-smoke.cjs                       # 11 проверки
node scripts/release-status.cjs && node --test tests/release-status.cjs
node scripts/logic-audit.cjs --gate
node scripts/bad-code-scan.cjs --gate
npx eslint .

# всеки комит от изданието да е споменат в този документ (проверено: 56/56)
git log --format=%h v0.69.86..763e6e8 | while read -r h; do
  grep -q "$h" documentation/07_RELEASE/AUDIT_0.69.87.md || echo "липсва: $h"
done
```

Ако числата тук и в `reports/RELEASE-STATUS.md` се разминават, важи **`RELEASE-STATUS.md`** —
той се генерира заедно с артефактите.
