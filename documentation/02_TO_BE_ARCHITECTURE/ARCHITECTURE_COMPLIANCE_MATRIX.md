# Architecture Compliance Matrix

**Документ:** HAPI-ARCH-API-004 · **Приложение към** HAPI-ARCH-API-001 (API Architecture & Runtime Logic Specification)

**Обхват:** съпоставка „изискване → къде е в кода → кой тест го пази → какво липсва“. Това е доказателството за текущата имплементация, не целевата архитектура. Версия: **0.69.78**.

Обозначения: ✅ изпълнено и проверено · 🟡 частично · ⛔ липсва.

---

## 1. Дванадесетте инварианта (§21)

| # | Инвариант | Код | Тест | Статус |
| --- | --- | --- | --- | --- |
| 1 | Един портал има една коренна папка | `portalRoot()`, `storage_root` при създаване (`server.js`) | `portal-folder`, `portal-order` | ✅ |
| 2 | Не се допуска вложен портал | папката се избира само под `/share`/`/media`; своя `storage_root` | `portal-folder` (нов портал не наследява чужди файлове) | ✅ |
| 3 | Максимум три подпапки | `portal-qr.tooDeep()` в `routes/folders.js` и `tree/upload` | `portal-qr-archive` (3 → 201, 4 → 409, нищо на диска) | ✅ |
| 4 | Подпапките не получават автоматичен QR | QR се създава само за портал (`ensureFirst`) | `portal-qr-archive` | ✅ |
| 5 | Архивирането не променя публичния адрес | `/p/<id>` не се пипа при архив | `portal-qr-archive` (верига QR-001→003) | ✅ |
| 6 | Архивирането създава физически файл | `routes/portal-qr.js` → `ooxml.zip()` в `<данни>/archives/` | `portal-qr-archive` (файл на диска, хешът съвпада) | ✅ |
| 7 | Старите QR остават проследими | `previousQrId`, `previousManifestHash`, `GET …/qr/{qrId}` | `portal-qr-archive` | ✅ |
| 8 | Публикуван файл не може да изчезне незабелязано | `listed:false` → 404; режими + основание | `portal-order`, `portal-rules-applied` | 🟡 (виж §5, ред 1) |
| 9 | Заключен публикуван файл остава видим с основание | `folderFilesOf` + `lockReasonOf`, `403` при изтегляне | `portal-order` | ✅ |
| 10 | Номер в комбинирания отчет ↔ едно съдържание | `content-id.js` (`CT-…`), `f.contentId`, `content_id` в манифеста + `manifest_id` | `content-id` (две версии под едно име → два идентификатора) | ✅ |
| 11 | Порталът е източникът на събитията и сензорите | `observer.js`, `decision-sensors.js`, `portal-qr.stats()` | `visitor-sensors`, `decision-sensors`, `ha-integration-flow` | ✅ |
| 12 | Публичният клиент не получава физически пътища | отдава се само файл по относителен път; `realpath` проверка | `portal-order` (.. и %2e%2e → 400), `public-route-allowlist` | ✅ |

## 2. Четирите договора (§5–§8)

| Договор | Вход | Код | Тест | Статус |
| --- | --- | --- | --- | --- |
| `order` | `/portal.html?order=…`, `/p/<id>`, `/t/<token>` | `routes/portal-storage.js : serveOrder`, `routes/portal-tokens.js` | `portal-order`, `portal-page*`, `portal-tokens` | ✅ |
| `file` | `/api/v1/p/<slug>/files/<id>/qr.svg`, изтегляне по id | `server.js` (файлов маршрут), `routes/portal-storage.js` | `core-qr-file`, `portal-page-contract` | 🟡 самостоятелна страница със собствен списък липсва |
| `html` | `/site/<slug>/<project>/…` | `server.js` (HTML проекти, CSP) | `html-publish` | 🟡 без отделен sandbox |
| `blok` | `?qr=<прекратен>` | `serveBlocked()` (**410**) | `portal-qr-archive` | ✅ |

## 3. Достъп и прозрачност (§11–§14)

| Изискване | Код | Тест |
| --- | --- | --- |
| Едно решение за достъп | `portal-policy.js` (`decide`, `snapshot`) | `portal-tokens`, `gateway-server` |
| Заключването иска основание | `LOCK_REASON_REQUIRED` (файл и папка) | `access-policy`, `portal-order`, `storage-tree-api` |
| Парола не отваря друг портал | скоупи + ACL (`user_portals`) | `portal-tokens` (A↔B, отнемане) |
| Allowlist за публичния слушател | `public-route-allowlist.js` (32 правила) | `public-route-allowlist` (35 разрешени, 33 отказани) |
| Без изтекли токени в имената на маршрути | `observer.normalizePath` (`/t/:token`) | `portal-tokens` |

## 4. Експлоатация и интеграция (§15–§16)

| Изискване | Код | Тест |
| --- | --- | --- |
| Сензори с реални числа, едно изчисление | `security` + `qr` + `guidance` в `/admin/api/sensors` | `decision-sensors`, `portal-qr-archive` |
| Home Assistant без втора логика | `coordinator._normalize_*`, 29 сензора | `ha-integration-flow` |
| Грешки без вътрешни пътища | `fail()` в маршрутите; 404 при липса на право | `portal-order`, `public-route-allowlist` |
| API договор, който не се разминава | `admin-api-spec.js` + `scripts/api-reference.cjs` | `admin-api-spec`, `api-reference` |

## 5. Липсваща функционалност (честен списък)

**Няма отворени редове.** Всичко, което първото издание на матрицата отбеляза като липсващо
(договор `file` като страница, изолация на недоверен HTML, QR бадж в списъка на порталите), е
затворено и е преместено в §5.1 с кода и теста, който го пази. Нов ред се добавя ТУК, когато
се появи разминаване между спецификацията и кода — не се пренаписва спецификацията.

### 5.1 Реализирано след първото издание на матрицата

| Правило | Код | Тест |
| --- | --- | --- |
| `ARCHIVE_NOT_TAMPERED` — подмяна в архива се вижда без човешка сверка | `portal-integrity.js` (8 проверки по ред), `POST …/qr/verify`, `qr.integrity` в `/admin/api/sensors` | `portal-integrity` (байтове · манифест · файл вътре · одит · сензор) |
| `ORDER_URL_COLON` — `/portal.html:<папка>` без пренаписване в прокси | `routes/portal-storage.js` (разчита пътя и подава `order`), `public-route-allowlist.js` | `portal-order` (корен, подпапка, непозната папка → 404), `public-route-allowlist` |
| `IMMUTABLE_CONTENT_ID` — съдържанието, не името, определя идентичността | `content-id.js`, `contentId` във файла (преизчислява се и при `POST …/versions` и `…/versions/{n}/restore`), `content_id` + `manifest_id` в манифеста, `Content ID` в отчетния запис | `content-id` (две версии под едно име · верига `content_id → sha256 → manifest_id → qr_id`), `file-transfer` (след нова версия идентичността е друга) |
| `RESTORE_FROM_ARCHIVE` — връщане към старо състояние без загуба | `POST …/qr/{qrId}/restore`: проверка → предпазен архив → запис на байтовете; излишните НЕ се трият | `portal-qr-restore` (предпазен архив · точни байтове · `keptExtra` · повреден архив → 409) |
| `PORTAL_PING` — връзката до портала е проверима | `GET /api/v1/p/<slug>/ping` (право `read`, без съдържание) | `portal-qr-restore` (200 · активен QR · договори · непознат портал → 404) |
| `OIDC_PKCE_LOGIN` — вход през външен доставчик без тайна в адреса | `oidc.js` (PKCE S256, RS256, state/nonce), `routes/oidc.js`, бисквитка `hapi_sso` | `oidc-login` (поток · state веднъж · роля от групи · `alg none`/изтекъл отказ) |
| `EVIDENCE_NEVER_DELETED` — политиката за задържане не може да изтрие публикувано съдържание | `retention.js` (`evidenceIndex` от `db.portalQr`, `protectionOf` — текущо съдържание И история на версиите, отказ при `delete`), `getQrRegistry` в `server.js`, `refused` в одита; същото правило и при ръчно `DELETE …/files/{fileId}` (`409` + `file.delete.refused`), и при `DELETE /admin/api/portals/{id}` (`409`, а `?force=1` трие заедно с архивите и записва `forced`) | `retention-evidence` (манифест · `archive-unindexed` · `sealed` · `qr-manifest-version` · обратна съвместимост), `retention-cost` (индексът се строи веднъж · защитата работи след оптимизацията), `file-transfer` (ръчно изтриване на архивиран файл → 409 · след нова версия → 409 · портал с архиви → 409, после `?force=1` → 200) |
| `MIRROR_TARGET_PATH_OR_S3` — второто копие е цел, не папка | `mirror-target.js` (`parseSpec`, `signV4`, `pathTarget`, `s3Target`), `server.js` (`mirror.put/get/remove`), опции `s3_access_key`/`s3_secret_key`, `file.mirror.locked` | `mirror-target` (SigV4 срещу независима проверка · Object Lock заглавки · грешен секрет → 403), `mirror-s3-wiring` (настройка → s3 цел · без ключове → отказ при старт) |
| `STORAGE_DEFAULT_SHARE` — данните са в `/share/hapi/data`, но стара инсталация не се обявява за празна | `config.yaml` (нови подразбирания + схема до три нива), `storage-preflight.js` (`DEFAULT_SUB`, `validSub`, `hasData`, `STORAGE_LEGACY_LOCATION`) | `storage-default-location` (6 случая · стар път печели пред празен нов · `../escape` и 4 нива → отказ) |
| `QR_BADGE_IN_LIST` — баджът „QR vN · N арх.“ идва със списъка, не с втора заявка | `server.js` (`qrSummary` в `adminPortal`), `ui/files-manager.js` (`qrBadge`: активен = ok, прекратен = warn + основание) | `portal-qr-badge` (QR-001 → QR-002 + 1 архив → прекратен с основание · манифест `MF-QR-001`) |
| `HTML_IN_SANDBOX` — недовереният HTML е в изолиран контекст | `site-csp.js` (`forFile`: `sandbox` без `allow-same-origin`, `connect-src 'none'`), `server.js` (`/site/…` подава политиката) | `portal-html-sandbox` (документ → пясъчник · ресурси → статика · изход от папката → 4xx) |
| `FILE_CONTRACT_PAGE` — договорът `file` е самостоятелна страница за ЕДИН файл | `routes/portal-storage.js` (`serveFile`), `public-route-allowlist.js` (2 правила: `?file=` и `:папка/път`) | `portal-file-page` (доказателства: SHA-256 · Content ID · QR-001/`MF-QR-001`; другите файлове НЕ се показват; traversal и скрита папка → 404) |
| `TRANSFER_BETWEEN_PORTALS` — преместването не е „изтрий и качи наново“ | `routes/file-transfer.js` (`POST …/files/{fileId}/transfer`): байтовете с `wx` + четене обратно и сверка по SHA-256, нов `content_id` (съдържа `portalId`), източникът се освобождава само след успешен запис при целта; откази 409 за заключен файл, файл с версии и доказателство (същото правило като `EVIDENCE_NEVER_DELETED`), копирането на доказателство е разрешено | `file-transfer` (копие с нов `content_id` · преместване с освобождаване · 400/404/409 по причина · байтовете оцеляват), `transfer-mirror` (второто копие следва файла) |
| `PROBLEM_DETAILS_RFC9457` — грешката е структура, не низ | `problem.js` (`body`: `type` · `title` · `status` · `detail` + старото `error`), `fail()` в `server.js`; типът остава `application/json` за обратна съвместимост | `api-input-errors` (всеки 4xx от 23 входа носи полетата и старото `error`), `problem` (чистата функция) |
| `IDEMPOTENT_RETRY` — повторена заявка не изпълнява действието втори път | `idempotency.js` (`handle` преди маршрутите, отпечатък метод+път+тяло, ключ заедно със самоличността, `Idempotency-Replayed`), таблица `idempotency` в `sqlite-store.js`, `idempotency.replay`/`idempotency.conflict` в одита | `idempotency` (без заглавка → старото поведение · повторение → същия отговор · друго тяло → 422 · в ход → 409+`Retry-After` · друга самоличност → собствен ключ · двоичен/5xx отговор не се пази · жив сървър: един портал и един файл) |

| `SINGLE_RESPONSE` — отговорът се пише точно веднъж | `respond.js` (`json` строи тялото ПРЕДИ заглавките, `fail` не прави втори `writeHead` при вече започнал отговор), `server.js` (`require('./respond')`) | `respond` (BigInt → нищо не се пише · втори отговор → тих · тяло по RFC 9457 · защитни заглавки) |
| `WEBHOOK_HMAC` — изходящото събитие е подписано и се повтаря (F4-7) | `webhooks.js` (`sign`/`verifySignature` върху `<t>.<тяло>`, `publicDetails` филтър, `publish`/`drain`, изчакване 30 s→1 h), `routes/webhooks.js` (6 маршрута, право `settings`), таблици `webhooks`/`webhook_deliveries` в `sqlite-store.js`, `webhooks.start()` в `server.js`, `publish` при качване и при копиране/преместване | `webhooks` (верен подпис · старо `t` → `STALE` · ключ веднъж · повторение и „изчерпано“ · тялото без тайни и пътища · HTTP 401/201/400/404) |
| `SSE_LIVE_EVENTS` — живият поток носи същите събития, без да ги измисля (F4-7) | `event-stream.js` (`broadcast`/`open`, пръстен от 200, `Last-Event-ID` → `resync`, сърцебиене 20 s, таван 30 min), `routes/events.js` (право `metrics`), `stream` в `webhooks.js` (`publish` храни и потока), `eventStream.closeAll()` при спиране | `event-stream` (заглавки и `retry` · излъчване до всички · `Last-Event-ID` връща пропуснатите · старо id → `resync` · HTTP 401/200 и качване → събитие в потока) |
| `WORM_MAIN_STORE` — доказателството не се презаписва (F7-3) | `worm.js` (`seal`/`unseal`/`isSealed`/`sealManifest`/`verify`), `sealFiles` в `server.js` след `qr.archived`, `worm.unseal` преди изтриване, `WRITABLE` в `verifyPortalFiles` | `worm` (0444 и `isSealed` · `unseal` пуска записа · `sealManifest` точно по манифеста · `verify` намира записваемо доказателство · липсващ файл → `MISSING`) |
| `COURT_ROLES_IN_GUI` — съдът не вижда панел, който ще върне 403 | `rbac.js` (`whoami` с `read` за четирите съдебни роли), `ui/panel-registry.js` (`allowed`/`DENIED`), `ui/app.js` (`loadCapabilities`) | `court-whoami` (200 за съд · `evidence` без `settings`/`portals` · `DENIED` от регистъра · `settings` остава 403) |
| `WORM_SEAL_EVERY_PLATFORM` — заключването не зависи от платформата | `worm.js` (`seal` без платформена врата), `routes/portal-qr.js` (`restore` отключва преди запис и заключва пак) | `worm` (презапис/дописване → EPERM · почистване минава), `portal-qr-restore` (след възстановяване файлът е `0444`) |
| `AEAD_SECRET_KEY_INTEROP` — AEAD-защитеният ключ е сверен с ВТОРА реализация, не сам със себе си | `pgp.js` (`sealAeadSecretSection`/`openAeadSecretSection`) | `pgp-aead-interop` + `tests/lib/aead-interop.py` (Python/`cryptography` · двете посоки · двете подредби) |
| `WEBVIEW2_SHELL` — GUI-ят има истински WebView2 прозорец, а не само браузър в режим на приложение | `START_HAPI_GUI.pyw` (pywebview → WebView2, иначе същата Edge/Chrome `--app=` команда) | `gui-starter-pyw` (`--check` · паритет с `.bat` · създаване на прозорец без `start()`) |
| `GUI_STANDALONE_PACKAGE` — интерфейсът се дава и на машина без хранилището, без backend вътре | `release-lib.guiPackage`, `build-release.cjs` (`dist/hapi-enterprise-gui-*.zip`), `START_HAPI_GUI.txt` | `gui-package` (разопакова пакета и пита стартера оттам), `verify-release` S23 (backend е забранен изрично) |
| `DESIGN_SYSTEM_SPLIT` — стиловете са четири слоя с нормативен ред, а не един файл (план 18 §7) | `ui/tokens.css` · `ui/layout.css` · `ui/components.css` · `ui/themes.css`, ред на зареждане в `ui/index.html`, allow-list в `server.js` | `ui-css-split` (ред · 4×200 през /ui/ · всеки `var(--x)` дефиниран · темата само в `themes.css`) |
| `ADMIN_API_CONTRACT` — договорът за административното API е машинно четирим и съдържа само реални права | `admin-api-spec.js` (`ROUTES`), `scripts/openapi-admin.cjs` → `api/hapi-admin.openapi.json` + `...postman_collection.json` | `openapi-admin` (файловете са изходът на генератора · 208 операции · всяко право съществува в `rbac` · `$ref`-овете се решават), `admin-api-spec` (таблица ↔ код) |
| `COURT_ROLES` — съдът чете доказателства, но не ги променя (F7-1) | `rbac.js` (`ROLES`, `isRole`, способности `evidence`/`custody`/`expert_opinion`), `user_roles`/`group_roles` в `config.yaml`, преводите | `court-roles` (7 роли · съдът чете evidence/custody и не пише · няма портали/настройки/потребители · само `expert` представя становище · сгрешена роля пада към подразбирането · Ingress понижава), `oracle-rbac-matrix` (28 способности × 7 роли) |
| `STALE_SUPPRESSION_GUARD` — изключение, което вече не пази нищо, е грешка, а не мълчание | `scripts/bad-code-scan.cjs` (`allowIndex`/`usedAllow`, `allow` в JSON-а, `--gate` брои мъртвите), `eslint.config.mjs` (`reportUnusedDisableDirectives: 'error'`) | `node scripts/bad-code-scan.cjs --gate` (23/23 записа пазят находка · 0 мъртви), `reports/RELEASE-STATUS.md` (редът показва `изключения: N/N (0 мъртви)`) |
| `HA_INTEGRATION_PYTHON` — интеграцията е Python, а тестовият пакет е JS: счупен Python не се виждаше от нито един тест | `custom_components/hapi_enterprise/*.py` (`compile()` в паметта, имената от `const.py`, платформите, преводите, причините в `config_flow.py`, allowlist-ите `_ALLOWED`/`_PUBLIC_TAIL` на моста) | `ha-integration-python` (6 файла се компилират · 20 имена от `const.py` съществуват · `sensor`/`binary_sensor` имат `async_setup_entry` · 63 ключа в `strings.json` = `en.json` = `bg.json` · 7 причини имат текст и обратно · мостът пуска 8 и спира 11 пътя · публичният вход пуска 5 и спира 6) |
| `DEFECT_REGISTER` — регистърът на дефектите не може да блокира изданието с остарели редове | `documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md`, `tsa-client.js`, `cms-sign.js`, `report-stamp.js`, `report-manifest.js` (`HASH_ALGORITHMS`) | `known-defects` (текуща версия в документа · всеки затворен ред сочи съществуващ файл · без статус „Планиран“ · отворен „Висока“ с причина · DEF-04/DEF-05 сверени с кода) |
| `PORTAL_VARIANTS` — двете копия на публичната страница (add-on и интеграция) пазят ЕДНИ инварианти, а договорите им остават различни | `hapi_enterprise/portal/portal.js`, `custom_components/hapi_enterprise/portal.js` (без опасни sink-ове, `innerHTML` само за SVG път, `textContent` за данни, без външни ресурси, ключ само във фрагмента) | `portal-variants` (по 2 `innerHTML` само SVG · 40 и 23 `textContent` · add-on `/api/v1/p/` ≠ интеграция `/api/hapi_enterprise/v1/p/` · `X-Portal-Key` без `?token=`) |
| `PACKAGE_SCRIPTS` — `package.json` е договор: документацията и CI не могат да викат команда или файл, който не съществува | `package.json`, всички `.md` в дървото без `CHANGELOG*.md` и `reports/` (161), `.github/workflows/*.yml` | `package-scripts` (13 цитирани команди съществуват · всеки скрипт сочи съществуващ файл · `lint` обхожда съществуващи пътища · `node scripts/…` в ръководство съществува · `CHANGELOG` и `reports/` изключени, защото историята назовава премахнати команди) |
| `DOC_CITATIONS` — документацията не може да сочи файл или тест, който не съществува | `documentation/**`, кореновите `*.md`; срещу цялото дърво | `doc-citations` (1008 цитата на `.js` в 124 документа · 382 цитата на `tests/<име>.cjs` · липсващ файл минава само ако редът казва „липсва/премахнат/нов“ · `docs/plan/**` и `CHANGELOG.md` извън обхвата) |
| `ESLINT_BASELINE` — базовата линия на eslint не се разминава с измереното (ESLint я прилага по подразбиране, тоест зелен lint ≠ чист код) | `eslint-suppressions.json`, `eslint.config.mjs`, `hapi_enterprise/**`, `tests/**`, `scripts/**` | `eslint-baseline` (136 файла · 166 записа · 218 находки едно към едно · всяко правило е реално · без непокрити находки) |
| `ADDON_TRANSLATIONS` — всяка опция на add-on-а има пълен превод на български и английски, без сирачета | `hapi_enterprise/config.yaml` (`options:`, `schema:`), `hapi_enterprise/translations/{bg,en}.yaml` | `addon-translations` (43 опции · 43+43 записа · 172 полета · name+description навсякъде · без превод за несъществуваща опция · двата езика с еднакво множество) |
| `FORMAT_SCOPE` — `npm run format` не пипа чужди пакети, история и генерирано съдържание, но първоначалният код остава в обхвата | `.prettierignore`, `hapi_enterprise/evidence-portal/`, `hapi_enterprise/generator/`, `archive/`, `dist/`, `documentation/`, `docs/` | `format-scope` (6 защитени дървета · по 0 файла, които prettier би променил · `hapi_enterprise/server.js` в обхвата) |
| `SECRET_PATTERNS` — правилата за тайни хващат реалистични стойности, не хващат познатите безопасни, а одитът е изпълним (код 0) | `scripts/secret-patterns.cjs`, `scripts/pre-push-audit.cjs`, цялото проследено дърво, `tests/fixtures/pgp/` | `secret-patterns` (6 правила · 6 положителни · 4 безопасни · забранени имена и в подпапки · 786 файла без теч · одитът минава) |
| `LINE_ENDINGS` — артефактите са възпроизводими: LF в индекса и в текстовите записи на архивите, независимо от работното копие | `.gitattributes`, `scripts/release-lib.cjs` (`entryData`), `dist/*.{tar.gz,zip}` | `line-endings` (787 проследени · индексът без `i/crlf` · 234 текстови записа в 3 артефакта без CRLF) |
| `DIST_FOLDER` — `dist/` съдържа точно едно издание, а двата манифеста го описват изцяло | `scripts/build-release.cjs`, `dist/`, `hapi_enterprise/config.yaml` | `dist-folder` (6 файла · RELEASE.json описва трите архива · SHA256SUMS.txt покрива всички файлове със съвпадащи суми) |
| `RULE_FILE_REJECTION` — отхвърлен файл с правила се вижда, вместо да бъде тихо подменен | `gateway-api.js` (`rulesCheck` → `sources='invalid'`, `status().invalid`/`errors`), `server.js` (`checks.rules` изисква и липсващи, и отхвърлени), `export-rules.validateRules` | `rules-invalid` (валиден → видим · невалиден → `invalid` + причина + лог · в сила са вградените правила · `/ready` 503 · след reload зелено) |
| `LIMITED_USE_TOKENS` — порталният токен има срок, отзоваване И лимит на отварянията (план 20 §5) | `routes/portal-tokens.js` (`maxUses`, 410 при изчерпване, одит `exhausted`), `sqlite-store.js` (`max_uses`/`uses` + `ALTER TABLE` миграция, условен `UPDATE`), `portal-policy.js` (сензор `tokenExhausted`), `ui/files-manager.js`/`ui/public-gateway.js` (показват фактите, не „168 ч/10“) | `portal-tokens` (две отваряния минават, третото — 410 без бисквитка · без `maxUses` не се изчерпва · невалиден лимит → 400), `store-migration` (стара база се мигрира, редът е запазен, миграцията е идемпотентна), `export-config` (`token_policies.json` = код) |
| `RULES_DECLARATIONS` — декларативните правила казват само това, което кодът изпълнява, и се проверяват срещу него | `config/rules/*.json` + `hapi_enterprise/rules/*.json` (`export_permissions` без измислена роля, `download_access` без непроверения `hierarchy`, `download_audit` само с реални събития и с `note`, че не се зарежда, `download_rules` без петте ключа без консуматор, `rate_limits` като справка срещу `DEFAULT_POLICY` без `burst`/`block_minutes`/`overrides`), `download-access.js` (`MODES`, `VISIBILITY`, `PERMISSION_IDS`, `validatePolicy`), `export-rules.js` (`MODES`), `rbac.js` (`ROLES`), `gateway-api.js` (`RULE_FILES`) | `rules-declarations` (8 права = `PERMISSION_IDS` в двете посоки · 12 режима = `MODES` · всяка роля съществува в `rbac` · `default_policy` минава `validatePolicy` · `rate_limits` положителни · 10 файла, 8 се зареждат, осталите с `note`), `export-config` (събитията в `download_audit` съществуват в генерирания `AUDIT_EVENTS.md`, полетата — в `audit-chain.js`), `rules-parity` (вградените копия са същите файлове) |

Външен пакет `hapi-evidence-portal v1.2` е сверен файл по файл — виж `EVIDENCE_PORTAL_V1.2_REVIEW.md`.
## 6. Регресионна база

| Показател | Стойност |
| --- | --- |
| Тестови файлове | 291 — числото се генерира в `reports/RELEASE-STATUS.md`, не се поддържа на ръка |
| Матрица | `node scripts/test-matrix.cjs` — 100 % при 1 опит е целта; флейки при паралелни портове се отчитат изрично |
| Проверки на изданието | `verify-release` 21/21 · `audit-gui-compat` 33/33 · `logic-audit --gate` · `bad-code-scan --gate` · `eslint` 0 |
| Твърд бюджет | `server.js` ≤ 2722 реда, 13 компонента в `routes/` |

> Когато ред от §5 се затвори, тук се сменя статусът и се добавя тестът, който го пази. Матрицата не е „документ за четене“, а списък на това, което още не е направено.

## 7. Сценариите за сигурност (§20) — карта към реални тестове

| # | Сценарий от §20 | Къде се проверява | Статус |
| --- | --- | --- | --- |
| 1 | Достъп до файл извън разрешения портал | `portal-order` (чужда/частна папка → 404), `portal-folder`, `whitebox-security` | ✅ |
| 2 | Заобикаляне на парола през директен API | `portal-order` (`KEY_REQUIRED` → 403), `access-policy`, `gateway-server`, `file-link-works` | ✅ |
| 3 | Административен маршрут през Public Gateway | `public-route-allowlist` (жив listener отказва `/admin`, `/ui`, `/generator`), `ingress-isolation` | ✅ |
| 4 | Подмяна на QR идентификатор | `portal-qr-archive` (непознат QR → 404, прекратен → 410 `blok`) | ✅ |
| 5 | Изтегляне на заключен файл | `portal-order` (`DISABLED` → 403 с основание), `portal-rules-applied` | ✅ |
| 6 | Създаване на четвърто вложено ниво | `portal-qr-archive` (3 → 201, 4 → 409, нищо не се създава) | ✅ |
| 7 | Подмяна на файлови байтове | `integrity` (качване/сверка), `portal-integrity` (`file_hash_mismatch`) | ✅ |
| 8 | Премахване на публикуван файл | `folder-delete`, `portal-order` (`listed:false` → 404; заключен остава видим) | ✅ |
| 9 | Подмяна на физически архив | `portal-integrity` (`archive_hash_mismatch`, `manifest_hash_mismatch`), проверка при създаване → `verificationStatus` | ✅ |
| 10 | Препращане към нов QR без видима история | `portal-qr-archive` (`nextQrId`, `previousQrId`, `previousManifestHash`) | ✅ |
| 11 | Невалиден или прекратен QR | `portal-qr-archive` (404 / 410 с основание, без съдържание) | ✅ |
| 12 | Разкриване на абсолютен файлов път през API | `portal-order` (`..` и `%2e%2e` → 400/404), `public-route-allowlist` | ✅ |
| 13 | Изпълнение на опасен HTML | `html-publish` (CSP), `portal-page-contract`, `panel-framing` | 🟡 CSP има, изолиран контекст (sandbox) — не (вж. §5, ред 4) |
| 14 | Несъответствие между комбинирания отчет и манифеста | `content-id` (`content_id` в отчета и в манифеста; две версии → два идентификатора) | ✅ |
| 15 | Администраторски токен, който е и HA long-lived token (едно изтичане = цял Home Assistant) | `admin-token-shape` (`haLongLived` от формата; жив старт: маркерът е в лога), `runtime-config.tokenShape` | ✅ предупреждение `ADMIN_TOKEN_LOOKS_LIKE_HA_LLAT` |
