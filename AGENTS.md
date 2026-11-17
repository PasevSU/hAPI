# AGENTS.md — как се работи в това хранилище

**hAPI Enterprise** е Home Assistant add-on (Node 22+, нула runtime зависимости, `node:sqlite`)
плюс HACS интеграция. Един източник на истина за версията: `hapi_enterprise/config.yaml`.

Този файл е за агента: командите, портите и капаните, които вече са ни стрували издания.
Не е потребителска документация — тя е в `documentation/` и `README.md`.

## Команди

| Какво | Команда |
| --- | --- |
| Пълен тестов пакет | `node scripts/safe-release.cjs` (генератори → build → verify → матрица → отчет → скенери → lint) |
| Бърза проверка | `node scripts/safe-release.cjs --fast` (същото без матрицата) |
| Дневник на всички тестове | `node scripts/verify-runner.cjs` — ВСЕКИ тест, пълен лог на всеки в `reports/test-logs/<пуск>/`; `--status` чете без пуск, `--tail=<име>` показва лога |
| Един тест | `node tests/<име>.cjs` |
| Отчет за изданието | `node scripts/release-status.cjs` + `node tests/release-status.cjs` |
| Изграждане | `node scripts/build-release.cjs` → `node scripts/verify-release.cjs` → `node scripts/build-haoss.cjs` |
| Линт | `npx eslint hapi_enterprise tests custom_components scripts --max-warnings=0` |
| Икони (спрайт v4) | `node scripts/build-icons-sprite.mjs --zip=<PasevSU-SVG-Controls-v4-Complete.zip>` → `hapi_enterprise/ui/icons-v4.svg` (710 символа); пази се от `tests/icons-v4.cjs` |
| Документи | `sync-addon-changelog` · `source-inventory` · `gen-test-rules` · `docs-index` · `docs-manual` · `api-reference` · `openapi-admin` · `error-codes` · `audit-events` |

## Твърди порти (чупят изданието)

- `server.js` ≤ **2722** реда (днес **2703**) → нов сегмент влиза като файл в
  `hapi_enterprise/server_module/` (зарежда се автоматично, без вписване) или в
  `hapi_enterprise/routes/*.js`, ако е част от HTTP договора.
- Всички текстови файлове са **LF**; един CRLF чупи S08/S22.
- `dist/` съдържа точно 6 файла; `verify-release` трябва да е **22/22** (S20 е само с `--with-tests`).
- `release-status` иска зелен матрикс и **431** теста в дървото.
- `tests/known-defects.cjs`: затворен ред сочи съществуващ `.js`/`.cjs`, заглавието носи текущата версия.
- `ui-version`, `addon-changelog`, `docs-index`, `scenario-matrix`, `ui-css-split` — виж `tests/`.

## Карта на кода

- `hapi_enterprise/server.js` — HTTP диспечер и админ API; не расте (бюджет на редовете).
- `hapi_enterprise/server_module/` — сегменти, които `server.js` зарежда ВСИЧКИ по име
  (`server-modules.js`), без твърдо вписан списък: `portal-landing.js` (публичната страница
  `/p/<id>`). Договор: `module.exports.create = (host) => ({ name?, order?, handle(ctx) })`;
  `handle` връща `true`, когато е приключил заявката. Счупен файл тук = грешка при старт.
  Тест: `tests/server-modules.cjs`. Плюс ред в `COPY server_module /app/server_module/` —
  иначе `docker-runtime` пада.
- `hapi_enterprise/core.js` — глобалните функции, които се ползват многократно (QR, адреси,
  API документ); зарежда ВСИЧКИ `core_module/*.js` по име, същият договор като
  `server-module.js`, но `create(deps, api) => ({ name?, fn })`, а `core.api.<име>` е замразен.
  Първият аргумент е това, което `server.js` подава, вторият — ЖИВИЯТ обект на слоя, за да
  ползва един модул друг. Днес: `qr` (SVG) · `address` (договор · `attach` · `landingPath`) ·
  `api-docs` (`spec` · `record` · `registry`) · `hash` (`digest` · `file` · `verify` · `basis`) ·
  `http` (`client`). Никой не вика `qr-svg`/`portal-links`/`api-spec`
  напряко. Тест: `tests/core-modules.cjs`. Нова функция → файл в `core_module/`
  (+ ред в `COPY core_module`) и ред в `CRITICAL` на `integrity.js`.
- `hapi_enterprise/module-folder.js` — ЕДНОТО правило за име на файл в динамична папка
  (`ELIGIBLE`, невалидно име = грешка при старт, празна папка = грешка). Ползват го и
  `server-modules.js`, и `core.js`, за да не се разминат двете копия.
- `hapi_enterprise/routes/` — извадени договори: `folders.js` (дърво на папките), `file-transfer.js`,
  `portal-qr.js`, `portal-storage.js`, `portal-tokens.js`, `portal-archive.js`, `reports.js`, `webhooks.js`.
- `hapi_enterprise/ui/` — панелът: `files-manager.js` (оркестратор), `portal-control.js`
  (карта „Достъп и QR код“), `portal-folders.js` (дърво), `portal-files.js` (списък), `i18n.js` (BG/EN/DE).
- `hapi_enterprise/portal/` — публичната страница: `portal.html`, `portal.js`, `portal-i18n.js`, `portal.css`.
- `tests/` — един файл = едно правило; `tests/lib/gui-harness.cjs` пуска реален сървър + DOM.
- `documentation/01_AS_IS_ARCHITECTURE/SYSTEM_STATE.md` — СЪСТОЯНИЕТО днес: числа, порти,
  договори, какво остава. Обновява се при всяко издание; числата се взимат от отчетите.

## Локална среда (тази машина, проверено 2026-11-07)

- Node е **v26.13.0**, а изданието/CI са на **Node 22.23.2**. Тестовете минават и на двете, но
  преди издание пусни поне `tests/smoke.cjs` и `verify-release` на Node 22 (`npx -y node@22 …`).
- `verify-release` S06 търси `python3`/`python` в PATH. Тук Python е в `.venv`, затова:
  `$env:PATH = "$PWD\.venv\Scripts;$env:PATH"` преди verify.
- Ограниченият файлов сандбокс не пуска дъщерни процеси с piped stdio (`spawnSync` с
  `encoding`) → `test-matrix`, `verify-release` (S05/S19) и build падат с EPERM. За тях искай
  еднократно `sandbox_permissions: danger-full-access` с обосновка. `write`/`edit` работят и в
  ограничен режим.
- След поправка на правата (2026-11-07) ограничените команди пишат в `reports/`, `dist/`, `.git`.
  Изключение: ~2 047 файла със собственик `BUILTIN\Administrators` не приемат Low integrity
  етикет — тях ги пиши с `write`/`edit`, не през shell. Възстановяване на правата:
  `D:\hAPI-acl-recovery\` (DACL) и `icacls D:\hAPI /setintegritylevel M /t` (етикети).
- `origin/main` изостава от локалния `main` (измерено 2026-11-15: **8 комита напред, 0 назад** —
  историята НЕ е разклонена, push-ът е fast-forward). Историческата бележка за разклоняване е в
  `dev/PROJECT-ANALYSIS-2026-11-07.md` (R1); при ново разклоняване там се добавя ред.

## Капани

- PowerShell мачка backtick и `\u` в `node -e` → пиши временен `.cjs` в `reports/` и го трий.
- **`require` кешира по ПЪТ, не по съдържание.** Тест, който пренаписва същия файл в същата
  временна папка и чака друг резултат, получава ПЪРВИЯ модул (така `server-modules.cjs`
  изглеждаше счупен, а кодът беше верен). Всяка проба → собствена папка или собствено име.
- `Add-Content` и here-strings дават CRLF → нормализирай с node преди `build-release`.
- Форматер, който маха интервала около `>` в CSS, чупи exact-string тестове (затова `.vscode/settings.json`
  изключва format on save).
- Тестовете оставят папки в `%TEMP%`; матрицата вече ги чисти сама след серията.
- Браузърните инструменти не стигат до `127.0.0.1` → ползвай `gui-harness`, не Playwright.
- **Твърдение никога не получава DOM възел.** `assert.equal(app.$(…), null)` при провал кара
  Node да строи diff (`myersDiff`) от инспекцията на ЦЕЛИЯ възел — измерено **144 s** и
  `Array buffer allocation failed` вместо съобщение, тоест грешката се превръща в OOM и
  никой не разбира какво е сгрешено (DEF-92). Възел се проверява с `assert.ok(!възел)` /
  `assert.ok(възел === друг)`, а за съдържание се чете `.textContent`/`.getAttribute`.
  Пази го `tests/dom-harness.cjs` §6.
- **Тестовият DOM трябва да познава `isConnected`.** Без него `ensureModal()` в QR студиото
  строи ВТОРИ прозорец при всяко отваряне (браузърът преизползва същия) и тестът чете стария —
  точно това скри, че „QR за тази папка“ показва адреса на портала (DEF-92). Пази го
  `tests/dom-harness.cjs` §7, а `gui-journeys` J53 го проверява от край до край.
- `--only` не пише `reports/test-matrix.json` (пази пълния отчет за `release-status`).
- **Версия без таг = издание без образ.** Версията в `config.yaml` се вдига преди тага, а
  `addon-image.yml` строи образа по версията от манифеста. Затова този workflow се пуска и на
  `push` към `main`, не само на таг `v*`: без това Home Assistant показва обновяване и дава
  `[404] manifest unknown` (точно това стана с 0.69.215, която остана в `main` без таг).
  Името остава конвенцията на HA `ghcr.io/pasevsu/{arch}-addon-hapi_enterprise`; единно
  многоархитектурно име би искало manifest list, какъвто workflow-ът не строи.
  Тест: `tests/addon-image-pipeline.cjs` (+ котва в `regression-guards.cjs`, DEF-61).
- **Базовият образ на Dockerfile е `alpine:major.minor`, без кръпка.** `FROM alpine:3.24.5`
  (опит от 0.69.222) дава 4 червени теста при зелен код — `docker-runtime`, `ha-compatibility`,
  `ha-support-matrix`, `raspberrypi-compat` искат точно `/^alpine:\d+\.\d+$/` — и събаря
  `verify-release` S04. Кръпките влизат през `apk upgrade --no-cache --available`, не през тага;
  затова тагът не се пипа, когато излезе нов patch на Alpine.
- **Матрицата носи отпечатък на дървото (0.69.224).** `test-matrix.json` пази `treeHash`
  (sha256 по СЪДЪРЖАНИЕТО на `hapi_enterprise/`, `tests/`, `scripts/`, без `reports/`, `dist/`,
  `release/`), а `release-status` сравнява с днешния и казва „остаряло“, ако се разминават.
  Затова: генераторите (`gen-test-rules`, `docs-index`, `integrity-manifest`, `build-release`)
  се пускат ПРЕДИ матрицата — иначе тя описва старо дърво. Bootstrap редът е
  `--skip=matrix-freshness,release-status` → `release-status` → пълна серия.
- **Тест, който казва SKIP, не е минал.** `test-matrix.cjs` разпознава `SKIP`/`SKIPPED` в
  изхода, брои теста отделно (`skippedByEnv`) и `release-status` го изброява с ⊘ — иначе
  „100% успех“ включваше проверки, които не са се случили.
- **Матрицата не се пуска през терминала на агента.** Инструментът я мести във фонов режим и
  после убива процесите `node` с контролно събитие → дете умира с `exit=3221225786`
  (0xC000013A) по средата на списъка, а `reports/test-matrix.json` остава от ПРЕДИШНИЯ пуск.
  `Invoke-CimMethod Win32_Process Create` НЕ помага (проверено 2026-11-15: същият `exit`).
  Работещият начин е планирана задача — тя има собствена конзола и не получава `Ctrl+C`:
  `Register-ScheduledTask -TaskName hapi-matrix -Action (New-ScheduledTaskAction -Execute cmd.exe -Argument '/c node scripts\test-matrix.cjs --skip=release-status --attempts=1 > D:\hAPI\reports\m.out.log 2>&1' -WorkingDirectory D:\hAPI) -Force; Start-ScheduledTask hapi-matrix`,
  после чакай реда `резултат:` в лога (извеждай по ред на всеки 5 s, иначе и този чакащ процес
  бива преместен във фон), накрая `Unregister-ScheduledTask hapi-matrix`.
- **След промяна в кода матрицата се пуска ДВА пъти.** `matrix-freshness` сравнява
  `treeHash` в `reports/test-matrix.json` с днешния: първият пуск записва новия отпечатък,
  вторият го чете и минава. Това е нормалният път, не флейк — не „поправяй“ теста. Копието,
  което той строи за проверката на броя, е зелено ПО СТРОЕЖ (`passed` се смята от броя
  тестове), иначе един чужд провал заключваше матрицата в цикъл (0.69.226).
- **Последният ключ в `manifest.json` е без запетая.** Интеграционният манифест завършва с
  `"version": "X"` и `}`; редакция, която добави запетая, чупи `build-release` с
  `JSON.parse` грешка, преди който и да е тест да каже какво е станало.
- **Таймер, който държи процеса.** `setTimeout(() => URL.revokeObjectURL(...), 60000)` в панела
  не пуска Node да излезе след последното твърдение: `gui-file-share` става 62 s вместо 2 s,
  `gui-journeys` 112 s вместо 20 s, матрицата — 490 s вместо 338 s (и `J53` флейква по 45 s).
  Минавай през `revokeLater(url, ms)` в `files-manager.js`, който прави `timer.unref?.()`.
- **Скрити input-и не живеят в сгъваемо тяло.** При акордеон тялото изчезва от документа и
  бутонът остава без input (тъкмо това чупеше „цяла папка“). `fm-file-input`/`fm-dir-input`
  стоят в `portalDetail()`, извън трите блока.
- **Акордеон в тестовете.** `expandPortalBlocks(host, { block: 'folders' | 'control' | 'files' })`
  иска КОЙ блок; „разгъни всички“ вече не съществува. `openBlock(name)` в `gui-journeys`
  твърди, че другите два са `aria-expanded="false"`.
- **Токенът не влиза в адрес.** Живият поток НЕ приема `?token=` (401 дори с верния токен) —
  `EventSource` носи еднократен билет от `POST /admin/api/events/ticket` (30 s, изразходва се).
  Тест: `tests/sse-ticket.cjs`. Ако добавяш нов поток, искай билет, не ключ.
- **Логическите корени живеят само в `hapi_enterprise/paths.js`.** `/share`, `/media`, `/config`,
  `/data` са низове в конфигурацията, не host пътища. На Windows `path.resolve('/share')` е
  `D:\share` — папка в корена на диска. Затова се ползва `paths.resolveRoot()` /
  `paths.resolveStoragePath()` (в сървъра — `portalAbs()`), а тестовете получават времен
  корен от `gui-harness`. Тест: `tests/storage-roots.cjs`.
- **Нито един тест не строи `<диск>:\share`.** Новият тест взима пътя от
  `tests/helpers.cjs#storageRoot()` (`{ dir, share, env }`) и подава `env: storage.env` /
  `env: { ...storage.env, … }` на `startServer`/`spawn`. `tests/storage-roots.cjs` отказва
  `…root, 'share'`, `path.resolve('/share')` и `path.join('/share'…)` извън `tests/lib/`,
  `helpers.cjs` и себе си. Ако папката е нужна на диска — `path.join(storage.share, …)`.
  Изключение по същност: `isLogicalRoot('')` е `true` (празно = коренът по подразбиране),
  тоест портал без собствена папка НЕ получава `portal.html`.
- **И инсталирането чете същите дефиниции.** `start.js` взима данните от
  `paths.LOGICAL_ROOTS.data`, `gateway-api.js`/`layout.js`/`evidence-portal.js` — от
  `paths.CONFIG_ROOTS` (HA конфигурацията е `/config` при standalone, `/homeassistant` в
  add-on), а `evidence-portal` ползва `paths.existingRoot('share')` — път само ако папката
  съществува. Втори плосък списък с корени се отказва от `tests/storage-roots.cjs` §2б;
  UMD файловете без зависимости (`export-rules.js`, `public-gateway.js`) пазят литерали,
  но равенството им с глобалния списък се проверява.
- **`aria-controls` само в разгънато състояние.** Сгънатият блок не носи препратка, защото
  тялото му не е в документа (`tests/ui-block-aria.cjs`).
- **Етикетите не се пишат ръчно.** Всеки `<div class="field">` получава `label[for]` + `id` от
  `ui/field-labels.js` след рендер (`app.js` вика `bindLabels()` при всеки mount и през
  `MutationObserver`). Нов панел НЕ пише `for`/`id` сам — иначе вторият `id` се дублира.
  Полетата без етикет се връщат в `unnamed`, не се кръщават. `tests/ui-field-labels.cjs`.
- **Менюто има симетрия и логика — това е закон, не вкус.** Двете менюта са в групи с РАВЕН
  брой: „Настройки“ — `GROUPS` в `settings-panel.js` (днес 3 × 6), главното — `NAV_GROUPS` в
  `app.js` (4 × 4), всяка група с име за екранен четец и `data-nav-group`. Нов раздел влиза в
  групата по смисъл, не „накрая“; секция извън група чупи теста. Пази го
  `tests/ui-nav-symmetry.cjs`, а живият екран — законът `balanced-groups` (с решение в
  `debug-ledger.js`). Отвореното меню се прибира само при клик извън него и при `Escape`
  (`tests/ui-nav-outside-click.cjs`).
- **Кешът на статиката е версия в адреса, не `no-store`.** `/ui/*`, `/portal.css`, `/portal.js`,
  `/portal-i18n.js` се дават `private, max-age=31536000, immutable` само когато адресът носи
  `?v=<версия>`, иначе `no-cache`. Версията се слага в HTML-а при СЕРВИРАНЕ (`uiIndexHtml` в
  `server.js`, `.replace` в `portal-landing.js`), не във файловете на диска — иначе `html-assets`
  и проверката за съществуващи файлове гледат друга истина. Нов статичен адрес → `?v=` в HTML-а
  и ред в `tests/static-cache.cjs`; `no-store` на статика и `public, max-age` на миниатюри са
  забранени (DEF-87: 34 файла / 1044 KB при всяко зареждане, а `public` миниатюра от заключен
  портал можеше да остане в прокси на доставчика).
- **Статиката не се чете от диска при всяка заявка.** `static-etag.js` пази тялото в паметта и
  дава `ETag` = sha256 от СЕРВИРАНОТО съдържание (тоест от HTML-а с версия в адреса) и `304` без
  тяло при `If-None-Match`. Заглавките на панела се строят ВЕДНЪЖ (обект `headers`, защото 200 и
  304 носят едни и същи) — `tests/panel-framing.cjs` търси и обекта, не само `writeHead`. Нов
  статичен адрес → през същия модул, иначе пак се чете от диска (DEF-88).
- **Нов UI файл не се сервира сам.** `UI_FILES` в `server.js` е allowlist: без ред там
  `/ui/<нов>.js` връща **404** и падат `ingress-panel-load`, `panel-framing`, `report-api`,
  `file-placement` (+ `html-assets`, `docker-runtime` за списъка). Плюс ред в `CEILING` на
  `tests/ui-i18n-ratchet.cjs` за всеки нов модул — таванът само се сваля. Измерено при
  DEF-38: забравените две места дадоха 7 червени теста при зелен код.
- **Дебъгингът има протокол, не само отчет.** `ui/debug-ledger.js` пази находка → причина →
  решение → тест (`tests/debug-ledger.cjs`). Нов закон в `debug-objects.js` без ред в
  `SOLUTIONS` (и без ключове `dbg.fix.*` на трите езика) чупи теста — текстът се пише в
  `i18n.js`, не в модула (таванът му е 0).
- **Цялостта се сверява при старт.** `hapi_enterprise/integrity.js` сравнява SHA-256 на 12
  критични файла с `integrity-manifest.json`. Промениш ли `start.js`, `server.js`, `paths.js`,
  `storage-preflight.js`, `integrity.js` или който и да е от изброените `ui/*` → пусни
  `node scripts/integrity-manifest.cjs`, иначе `tests/integrity-startup.cjs` пада (и е прав).
  Новият критичен файл се добавя в `CRITICAL` и в `Dockerfile`.
- **Пакетът за дебъгинг не носи тайни.** `scripts/diag-package.cjs` минава всеки файл през
  скенер; `tests/diag-package.cjs` пада и при поставена тайна. Черната кутия
  (`tests/blackbox-api.cjs`) проверява само HTTP — тя хвана изтекъл път в `/health` (DEF-56).
- **Езиковият дълг има таван.** `tests/ui-i18n-ratchet.cjs` мери българските стрингове по
  модули; нов UI модул без ред в таблицата му пада, а таванът само се сваля (DEF-49).
- **Затворен дефект без регресионна защита не съществува.** `tests/regression-guards.cjs`
  иска всеки ред „Затворен“ в `KNOWN_DEFECTS.md` да има тест в картата `GUARDS`; тестът
  трябва да съществува, да е част от матрицата и да има поне едно `assert`. Затваряш ли
  дефект — добави реда в `GUARDS` (и котва в `ANCHORS`, ако има конкретен текст/праг).
  **Котвата се взема от ПРАВИЛОТО** (име на заглавка, артефакт, поле, ключова дума), не
  обикновена дума: `null` или `500` не изчезват при връщане на дефекта. Днес 41 от 52
  защити имат котва; останалите 11 са изброени в `RELEASE_0.69.208.md` §6а.6.
  Старите шаблони се хващат и статично от `tests/legacy-logic-residue.cjs` (`enforced: true`).
- **Матриксът се пуска САМ.** При паралелни node процеси `event-stream` пада на `/health`
  (7 s), а `evidence-portal` не спира детето си за 5 s (66 s). Измерено: при чист пуск
  **389/389** за 337–414 s. От 0.69.208 `stopChild` чака 15 s и ескалира до `SIGKILL`, а
  стартовият бюджет е ≥ 10 s (`tests/process-guards.cjs` §5 пази това — DEF-55).
- **Скриптът на портала се слага и на страници без неговите възли.** Един и същ `portal.js`
  върви на портала, на страницата на файла, на отказа „частен портал без токен“ и на 410.
  Затова `$("status").textContent = …` (както и `#title`, `#q`, `#q-label`, `#description`)
  е `TypeError: Cannot set properties of null` — точно това даде `setStatus` (portal.js:106).
  Всяко пипане на възел в портала се пази с `if (el)`; `tests/portal-partial-page.cjs` монтира
  скрипта върху минимален DOM в ДВАТА варианта и иска нула изключения.

## Правило за промяна

1. Промяна в код → тест, който би паднал без нея.
2. Версия: `hapi_enterprise/config.yaml` + огледалата (`manifest.json`, `package.json`, `ui/data.js`,
   `README.md`, `BG.md`, `DE.md`, `hapi_enterprise/README.md`, заглавие на `KNOWN_DEFECTS.md`).
3. `CHANGELOG.md` (BG) + ред в `KNOWN_DEFECTS.md`, ако се затваря дефект.
4. Генератори → build → verify → матрикс → release-status → eslint → commit + `git tag -a vX.Y.Z`.
