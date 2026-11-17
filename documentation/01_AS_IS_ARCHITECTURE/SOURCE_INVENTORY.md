# Source Inventory — hAPI Enterprise (As-Is)

> **Клас:** жив · **Собственик на факта:** брой модули и функции · **Проверен към:** 0.69.234

> **Генериран документ.** Версия на кода: **0.69.234**. Пише се от `node scripts/source-inventory.cjs`, проверява се от `tests/source-inventory.cjs`. Ръчните редакции се губят при следващото генериране — затова „предназначението“ идва от първия коментар в самия файл: документът не може да твърди нещо, което кодът не казва.

Общо: **133** backend модула · **20** HTTP компонента · **30** UI модула · **9** Python модула · **49** инструмента · **456** теста. Архитектурните описания са в [`MODULE_CATALOG.md`](MODULE_CATALOG.md), маршрутите — в [`API_ENDPOINT_REFERENCE.md`](../02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md).

### Файлове (241)

| Файл | Вид | Предназначение (първи ред от самия файл) |
| ---- | --- | ----------------------------------------- |
| `custom_components/hapi_enterprise/__init__.py` | python | hAPI Enterprise Home Assistant integration. |
| `custom_components/hapi_enterprise/binary_sensor.py` | python | Binary sensors for hAPI Enterprise: is something broken right now? |
| `custom_components/hapi_enterprise/config_flow.py` | python | Config flow for the hAPI Enterprise integration. |
| `custom_components/hapi_enterprise/const.py` | python | Constants for the hAPI Enterprise Home Assistant integration. |
| `custom_components/hapi_enterprise/coordinator.py` | python | DataUpdateCoordinator for hAPI Enterprise telemetry. |
| `custom_components/hapi_enterprise/diagnostics.py` | python | Diagnostics for the hAPI Enterprise integration. |
| `custom_components/hapi_enterprise/discovery.py` | python | Auto-detection of the hAPI app for the integration's config flow. |
| `custom_components/hapi_enterprise/entity.py` | python | Shared entity helpers for the hAPI Enterprise integration. |
| `custom_components/hapi_enterprise/sensor.py` | python | Sensor platform for hAPI Enterprise telemetry. |
| `hapi_enterprise/admin-api-spec.js` | backend | Договор за АДМИНИСТРАТИВНОТО API (OpenAPI 3.1). |
| `hapi_enterprise/api-registry.js` | backend | Създаване на хранилище за API на портал (Фаза 8): api/<slug>/ |
| `hapi_enterprise/api-spec.js` | backend | Генериране на публично API за портал (Фаза 8 / API-01…03) — чист JS, без I/O. |
| `hapi_enterprise/api-version.js` | backend | Версиониране на API (Фаза 2.5): v2 е текущ, v1 (legacy) продължава да работи, |
| `hapi_enterprise/audit-chain.js` | backend | Одитен дневник с ХЕШ-ВЕРИГА: всеки запис носи `prevHash` на предишния, така че подмяна |
| `hapi_enterprise/cabinet.js` | backend | Filing cabinet: an admin-only document store (folders, subfolders, files) separate from portals. |
| `hapi_enterprise/case-access.js` | backend | ОГРАНИЧАВАНЕ ПО ДЕЛО (план 17, F7-1, DoD „достъп по дело“). |
| `hapi_enterprise/cases.js` | backend | Дела (cases): номер, заглавие, категория, „относно“, контакт и полета по желание. |
| `hapi_enterprise/cms-sign.js` | backend | Detached CMS/PKCS#7 подпис (RS-06) — това, което PDF четецът проверява. |
| `hapi_enterprise/config-profiles.js` | backend | Named configuration profiles. Each profile is a validated, atomically persisted |
| `hapi_enterprise/container.js` | backend | DI контейнер (Фаза 2.1, P1/P2). Лениво инстанцира сингълтони; поддържа |
| `hapi_enterprise/content-id.js` | backend | Идентичност на СЪДЪРЖАНИЕТО (`content_id`) — §11 и §12 от HAPI-ARCH-API-001. |
| `hapi_enterprise/core_module/address.js` | backend | ГЛОБАЛНА ФУНКЦИЯ „address“ — договорът за адресите на портала, файловете и прегледа. |
| `hapi_enterprise/core_module/api-docs.js` | backend | ГЛОБАЛНА ФУНКЦИЯ „api-docs“ — API документът на портала (OpenAPI + api/<slug>/). |
| `hapi_enterprise/core_module/hash.js` | backend | ГЛОБАЛНА ФУНКЦИЯ „hash“ — едно място за хеш, парче по парче. |
| `hapi_enterprise/core_module/http.js` | backend | ГЛОБАЛНА ФУНКЦИЯ „http“ — един изходящ клиент с таймаут и типизирана грешка. |
| `hapi_enterprise/core_module/qr.js` | backend | ГЛОБАЛНА ФУНКЦИЯ „qr“ — единственото място, което прави QR код. |
| `hapi_enterprise/core-store.js` | backend | Core hierarchical store (DOCFLOW Phases 1). Own SQLite file, additive to the legacy |
| `hapi_enterprise/core.js` | backend | ГЛОБАЛНИТЕ ФУНКЦИИ НА СЪРВЪРА — ВСИЧКИ ФАЙЛОВЕ ОТ `core_module/` БЕЗ ТВЪРДО ВПИСАН СПИСЪК. |
| `hapi_enterprise/crypto-options.js` | backend | Крипто опции на add-on-а: env (от start.js) има приоритет, после options.json, после |
| `hapi_enterprise/decision-sensors.js` | backend | От измерване към РЕШЕНИЕ: кой компонент, какъв проблем, от кога и какво да проверим. |
| `hapi_enterprise/directory.js` | backend | Variables registry + contact directory with domain rules, auto-fill and a conflict queue. |
| `hapi_enterprise/download-access.js` | backend | Download Access Control (FD-0) — централни правила за достъпност на изтегляне. |
| `hapi_enterprise/download-stream.js` | backend | Поточно изтегляне на файл с ограничен брой едновременни потоци и (по избор) |
| `hapi_enterprise/error-log.js` | backend | Centralized, bounded structured error log. Entries are appended as JSONL with |
| `hapi_enterprise/event-bus.js` | backend | In-process Event Bus (Фаза 2.2, P5). Излъчва наблюдаеми domain събития; |
| `hapi_enterprise/event-stream.js` | backend | SSE ПОТОК ЗА ЖИВИ СЪБИТИЯ — `GET /admin/api/events/stream` (F4-7, втората половина). |
| `hapi_enterprise/evidence-portal.js` | backend | Публикуване на Evidence View портала в папката, която Home Assistant сервира статично. |
| `hapi_enterprise/evidence-portal/assets/app.js` | backend | Evidence View портал — дърво, информация за файловете и QR. |
| `hapi_enterprise/evidence-portal/assets/consent.js` | backend | hAPI consent gate. Never treat browser state as server authorization. |
| `hapi_enterprise/evidence-portal/assets/qrcode.js` | backend | QR Code Generator for JavaScript |
| `hapi_enterprise/exif.js` | backend | EXIF / МЕТАДАННИ — извличане и СРАВНЕНИЕ (план 18, панел 08). |
| `hapi_enterprise/export-manager.js` | backend | Export Manager (FD-1) — трансферно ядро с проверка на целостта. |
| `hapi_enterprise/export-rules.js` | backend | File Delivery & Export Manager — правила за експорт (FD-0). |
| `hapi_enterprise/file-crypto.js` | backend | Opt-in whole-file encryption at rest (AES-256-GCM). The logical file SHA-256 and |
| `hapi_enterprise/forensic.js` | backend | FORENSIC АНАЛИЗ (план 18, панел 07) — файлът се проверява по СЪДЪРЖАНИЕТО, не по разширението. |
| `hapi_enterprise/gateway-api.js` | backend | PG-6 / FD-6: backend прилагане на правилата за публичен достъп и експорт. |
| `hapi_enterprise/generator.js` | backend | PasevSU Document Generator — ШАБЛОНИ ОТ ДИСКА, ИНДЕКС НА ЖИВО. |
| `hapi_enterprise/generator/app.js` | backend | PasevSU Document Generator — клиентската част. |
| `hapi_enterprise/idempotency.js` | backend | IDEMPOTENCY-KEY — повторена заявка не изпълнява действието втори път (docs/plan/17, F4-5). |
| `hapi_enterprise/instance-lock.js` | backend | Заключване на data директорията: една жива инстанция на add-on-а, един собственик. |
| `hapi_enterprise/integrity.js` | backend | ПРАВИЛО ЗА ЦЯЛОСТ ПРИ СТАРТИРАНЕ (0.69.208). |
| `hapi_enterprise/interpolate.js` | backend | Интерполация на `{{променлива}}` в текстове, които отиват към хора: име и описание на |
| `hapi_enterprise/job-manager.js` | backend | Persistent, bounded FIFO job queue with cooperative pause/resume and crash |
| `hapi_enterprise/layout.js` | backend | Карта на структурата: къде какво стои и на кой адрес се вижда. |
| `hapi_enterprise/links.js` | backend | ЕДИНСТВЕНОТО място, където се строят адресите на hAPI. |
| `hapi_enterprise/load-control.js` | backend | Intelligent (adaptive) load control. Replaces the static download concurrency cap |
| `hapi_enterprise/logger.js` | backend | Structured debug logging for the add-on. |
| `hapi_enterprise/migration-bridge.js` | backend | Phase 1.5 migration bridge: legacy (directory, portals, cabinet) -> DOCFLOW core. |
| `hapi_enterprise/mirror-target.js` | backend | Цел на огледалото (0.69.87, стъпка M3 от `READY_MADE_COMPONENTS.md` §2.5). |
| `hapi_enterprise/module-folder.js` | backend | ЕДНА ПАПКА КОМПОНЕНТИ — ЕДНО ПРАВИЛО ЗА ИМЕНА (0.69.224). |
| `hapi_enterprise/notify.js` | backend | DOCFLOW Phase 4.4 — QR/линк dispatch чрез Home Assistant notify.* услуги. |
| `hapi_enterprise/observer.js` | backend | Наблюдение (сензори) без зависимости: комуникация, файлове, извиквания, изтегляния, |
| `hapi_enterprise/oidc.js` | backend | OIDC вход (authorization code + PKCE, S256) — без външни зависимости. |
| `hapi_enterprise/ooxml.js` | backend | Minimal dependency-free ZIP writer/reader and OOXML (docx/xlsx) helpers. |
| `hapi_enterprise/option-spec.js` | backend | ДЕСКРИПТОР НА ГЛОБАЛНИТЕ ОПЦИИ — ЕДНО МЯСТО ЗА ЕДНА ОПЦИЯ (O-01 от |
| `hapi_enterprise/package-crypto.js` | backend | Криптиран контейнер за експортен пакет (hapiPKG1). |
| `hapi_enterprise/packager.js` | backend | Пакетиране на портал (или избрани файлове) в ZIP с манифест, хешове и |
| `hapi_enterprise/page-version.js` | backend | ВЕРСИЯ В АДРЕСА НА СТАТИЧНИТЕ РЕСУРСИ НА HTML СТРАНИЦА (DEF-87). |
| `hapi_enterprise/path-crypto.js` | backend | Ключохранилище на PGP (бач B2 от `PLAN-0.69.67-LINKS-AND-FILES.md`). |
| `hapi_enterprise/paths.js` | backend | ЛОГИЧЕСКИТЕ КОРЕНИ НА ХРАНИЛИЩЕТО — ЕДНО МЯСТО ЗА ЦЕЛИЯ ПРОЕКТ. |
| `hapi_enterprise/pdf-writer.js` | backend | Dependency-free PDF writer with embedded TrueType fonts (Unicode incl. Cyrillic). |
| `hapi_enterprise/pgp-sign.js` | backend | ПОДПИСВАНЕ НА ПАПКА И НА МНОЖЕСТВО ФАЙЛОВЕ (PGP) — с ключа, който ВЕЧЕ е зададен. |
| `hapi_enterprise/pgp-tools.js` | backend | PGP ИНСТРУМЕНТИ — един списък с ключове и трите действия: подпис, проверка, публична част. |
| `hapi_enterprise/pgp.js` | backend | OpenPGP (RFC 9580 / RFC 4880) — деташиран подпис без външни зависимости. |
| `hapi_enterprise/plugins.js` | backend | Плъгин регистър (Фаза 2.4, P2/P4). Именувани плъгини по вид (storage, renderer, |
| `hapi_enterprise/plugins/ocr.js` | backend | OCR плъгин (Фаза 2.4). Интерфейс за извличане на текст; конфигурационно |
| `hapi_enterprise/plugins/renderer.js` | backend | Renderer плъгин (Фаза 2.4). Единен интерфейс към PDF (pdf-writer) и OOXML |
| `hapi_enterprise/plugins/storage.js` | backend | Storage плъгин (Фаза 2.4). Интерфейс за файловия бекенд; днес — локална ФС. |
| `hapi_enterprise/portal-access.js` | backend | Подписан достъп до ЦЕЛИЯ портал: `<адрес>?expires=<unix>&sig=<hmac>`. |
| `hapi_enterprise/portal-config.js` | backend | ОПИСАНИЕ НА ПОРТАЛ (configuration.yaml) — един файл на портал. |
| `hapi_enterprise/portal-folder.js` | backend | Папка на портала в хранилището: РЕАЛНИТЕ файлове, с истинските им имена. |
| `hapi_enterprise/portal-integrity.js` | backend | Целостта на ФИЗИЧЕСКИТЕ архиви (правило `ARCHIVE_NOT_TAMPERED`). |
| `hapi_enterprise/portal-links.js` | backend | ДОГОВОРЪТ „АДРЕСИ ЗА ПОРТАЛА, ФАЙЛОВЕТЕ И ПРЕГЛЕДА — ОЩЕ ПРИ СЪЗДАВАНЕТО“ (0.69.219). |
| `hapi_enterprise/portal-policy.js` | backend | ЕДНА политика за достъп до портал (Stage D): идентичност → портал → ресурс → действие. |
| `hapi_enterprise/portal-qr.js` | backend | QR ревизии, манифести и ФИЗИЧЕСКИ архиви за един портал. |
| `hapi_enterprise/portal-skin.js` | backend | КОЖА НА ПУБЛИЧНАТА СТРАНИЦА НА ПОРТАЛА (`portal_skin`, env `PORTAL_SKIN`) — отделен модул, |
| `hapi_enterprise/portal-term.js` | backend | СРОК И ДОСТЪП НА ПОРТАЛА — задължителни при създаването (0.69.210). |
| `hapi_enterprise/portal-view.js` | backend | Портал „само за преглед“ — СПЪТНИК на нормалния портал, не трети вид страница. |
| `hapi_enterprise/portal/portal-i18n.js` | backend | Речник на ПУБЛИЧНАТА страница на портала (BG / EN / DE). |
| `hapi_enterprise/portal/portal.js` | backend | Публична страница на портала — това, което се отваря при сканиране на QR кода. |
| `hapi_enterprise/preview.js` | backend | Document preview & thumbnails (Phase 4.3). Dependency-free: renders text, |
| `hapi_enterprise/problem.js` | backend | ГРЕШКАТА КАТО ДОКУМЕНТ (RFC 9457, „problem details“). |
| `hapi_enterprise/process-guards.js` | backend | Последен предпазител на процеса. |
| `hapi_enterprise/public-gateway.js` | backend | Public API Gateway (PG-0) — втори, независим канал за достъп. |
| `hapi_enterprise/public-package.js` | backend | Еднократни токени за пакет, поискан от ПУБЛИЧНАТА страница. |
| `hapi_enterprise/public-route-allowlist.js` | backend | Allowlist за ПУБЛИЧНИЯ Gateway listener (`PUBLIC_GATEWAY_PORT`, в add-on-а 8088). |
| `hapi_enterprise/qr-svg.js` | backend | QR КОД КАТО SVG — единственото място, което решава с какви параметри се рисува. |
| `hapi_enterprise/qrcode.js` | backend | QR Code Generator for JavaScript |
| `hapi_enterprise/rbac.js` | backend | Role-based access control over the administrative API. Three roles are resolved |
| `hapi_enterprise/readiness.js` | backend | Решение за readiness — чиста функция, без I/O. |
| `hapi_enterprise/registry.js` | backend | Metadata-driven profile schemas (prefix 1000-5000). A new profile is a config entry, |
| `hapi_enterprise/report-manifest.js` | backend | Фаза 11 / RS-01: манифест на отчет (Report Studio). |
| `hapi_enterprise/report-package.js` | backend | ПАКЕТ С ДОКАЗАТЕЛСТВА от манифест на отчет (W7). |
| `hapi_enterprise/report-render.js` | backend | Фаза 11 / RS-03: манифест → PDF чрез собствения pdf-writer (без външни зависимости). |
| `hapi_enterprise/report-stamp.js` | backend | Фаза 11 / RS-05: реален RFC 3161 обхват върху отчет от Report Studio. |
| `hapi_enterprise/repository.js` | backend | Repository интерфейс (Фаза 2.3, ADR-04/P4). Дефинира persistence контракта за |
| `hapi_enterprise/respond.js` | backend | ОТГОВОРЪТ НА ЗАЯВКА — точно веднъж. |
| `hapi_enterprise/retention.js` | backend | Retention policies: age-based expiry of uploaded files and the human-readable audit |
| `hapi_enterprise/routes/admin-docs.js` | routes | Договорът за административното API — като компонент на HTTP слоя. |
| `hapi_enterprise/routes/events.js` | routes | SSE поток — административен компонент на HTTP слоя (F4-7, живата половина). |
| `hapi_enterprise/routes/evidence.js` | routes | Доказателства по ДЕЛО — компонент на HTTP слоя (план 17, F7-1 „достъп по дело“). |
| `hapi_enterprise/routes/file-transfer.js` | routes | Преместване и копиране на файл между портали (F2-10 / F2-11) — компонент на HTTP слоя. |
| `hapi_enterprise/routes/folders.js` | routes | Папки на портала в хранилището — компонент на HTTP слоя. |
| `hapi_enterprise/routes/forensic.js` | routes | Forensic и метаданни — компонент на HTTP слоя (план 18, панели 07 и 08). |
| `hapi_enterprise/routes/generator.js` | routes | Document Generator — компонент на HTTP слоя. |
| `hapi_enterprise/routes/link-check.js` | routes | Проверка дали един публичен адрес НАИСТИНА се отваря — компонент на HTTP слоя. |
| `hapi_enterprise/routes/oidc.js` | routes | OIDC вход — компонент на HTTP слоя. |
| `hapi_enterprise/routes/pgp-keyring.js` | routes | PGP ключохранилище — компонент на HTTP слоя. |
| `hapi_enterprise/routes/portal-archive.js` | routes | ЗАКРИВАНЕ НА ПОРТАЛ (архив за съхранение, 6 месеца преди окончателно изтриване). |
| `hapi_enterprise/routes/portal-links.js` | routes | ВРЪЗКИ ЗА QR СТУДИОТО — временна, само за четене и с парола (0.69.229). |
| `hapi_enterprise/routes/portal-page.js` | routes | Публичната страница на портала — ЕДИН адрес, на адреса на add-on-а (и през Home Assistant). |
| `hapi_enterprise/routes/portal-qr.js` | routes | Логическите корени (`/share`, `/media`) се разпознават през ЕДИН модул — `paths.js`. |
| `hapi_enterprise/routes/portal-storage.js` | routes | Изтегляне на файл ОТ ПАПКАТА на портала (публичен вход през портала, не отделен адрес). |
| `hapi_enterprise/routes/portal-tokens.js` | routes | Публични токени за един портал (Stage D) — HTTP слоят. |
| `hapi_enterprise/routes/portal-unlock.js` | routes | ОТКЛЮЧВАНЕ НА ЗАКЛЮЧЕН ПОРТАЛ С ПАРОЛА (0.69.210) — HTTP слоят. |
| `hapi_enterprise/routes/reports.js` | routes | Report Studio + RFC 3161 — компонент на HTTP слоя. |
| `hapi_enterprise/routes/upload-sessions.js` | routes | Качване на файл в папката на портала — НА СЕСИИ, с проверка по хеш и без пипане на датите (0.69.214). |
| `hapi_enterprise/routes/webhooks.js` | routes | Webhooks с HMAC — административен компонент на HTTP слоя (F4-7). |
| `hapi_enterprise/runtime-config.js` | backend | Конфигурацията на средата: какво идва от опциите на add-on-а, кое е твърдо зададено и |
| `hapi_enterprise/secret-links.js` | backend | Тайни връзки (zero-knowledge): тайната се шифрова В БРАУЗЪРА, а сървърът пази само |
| `hapi_enterprise/secret-lock.js` | backend | Сериализация на достъпа до една тайна по id: два едновременни прегледа не бива да |
| `hapi_enterprise/secret-page.js` | backend | Страница за преглед на тайна връзка. ЦЯЛАТА информация е във фрагмента на адреса |
| `hapi_enterprise/secret-view.js` | backend | Преглед на тайна връзка — страната на БРАУЗЪРА (модел като scrt.link v2). |
| `hapi_enterprise/send.js` | backend | „Бърз линк“ (Send-lite): еднократен/срочен/безсрочен публичен достъп до ЕДИН файл, |
| `hapi_enterprise/server_module/portal-assets.js` | backend | СТАТИЧНИТЕ ФАЙЛОВЕ НА ПУБЛИЧНАТА СТРАНИЦА — `/portal.js`, `/portal-i18n.js`, `/portal.css` |
| `hapi_enterprise/server_module/portal-landing.js` | backend | ПУБЛИЧНАТА СТРАНИЦА НА ПОРТАЛА — `/p/<id>[/]` (0.69.220). |
| `hapi_enterprise/server-modules.js` | backend | ВСИЧКИ ФАЙЛОВЕ ОТ `server_module/` СА КОМПОНЕНТИ — БЕЗ ТВЪРДО ВПИСАН СПИСЪК (0.69.220). |
| `hapi_enterprise/server.js` | backend | Една жива инстанция на data директория (виж instance-lock.js). Попълва се в start(). |
| `hapi_enterprise/share-links.js` | backend | Share links за портал: NFC/QR таг за Home Assistant Companion + universal link. |
| `hapi_enterprise/shared-data.js` | backend | ЕДНИ И СЪЩИ ДАННИ — ОТ РАЗЛИЧНИ ПРОЦЕСИ (многослоен цикъл върху един източник на истина). |
| `hapi_enterprise/signer.js` | backend | Подпис + timestamp (Фаза 3.3): HMAC-SHA256 над SHA-256 хеша на файла. |
| `hapi_enterprise/site-csp.js` | backend | CSP за изолираните HTML проекти (`/site/<портал>/<проект>/…`). |
| `hapi_enterprise/sqlite-repository.js` | backend | SQLite repository (Фаза 2.3). Асинхронна фасада над core-store, която |
| `hapi_enterprise/sqlite-store.js` | backend | SQLite is the authoritative metadata store. The legacy JSON file is retained |
| `hapi_enterprise/standalone.js` | backend | hAPI Enterprise — edge/standalone runtime. |
| `hapi_enterprise/start.js` | backend | hAPI Enterprise — add-on entrypoint. |
| `hapi_enterprise/static-etag.js` | backend | ETag И 304 ЗА СТАТИКАТА (DEF-88, 0.69.227). |
| `hapi_enterprise/storage-check.js` | backend | Storage health checks: verifies that each configured storage location exists, is a |
| `hapi_enterprise/storage-migrate.js` | backend | !/usr/bin/env node |
| `hapi_enterprise/storage-preflight.js` | backend | Логическите корени идват от `paths.js` — един източник за целия проект (вж. `tests/storage-roots.cjs`). |
| `hapi_enterprise/storage-tree.js` | backend | Дърво на папка от хранилището (storage_root) — чист модул (UMD). |
| `hapi_enterprise/throttle.js` | backend | Ограничаване на скоростта на ПОТОКА (bandwidth pacing). |
| `hapi_enterprise/tsa-client.js` | backend | RFC 3161 Time-Stamp Protocol клиент (TSQ → TSA → TSR), без зависимости. |
| `hapi_enterprise/ui/api-base.js` | ui | Базов адрес за заявките от панела (Enterprise Control Center). |
| `hapi_enterprise/ui/app.js` | ui | Enterprise Control Center — обвивка на GUI (Фаза 10 / UI-01). |
| `hapi_enterprise/ui/bootstrap.js` | ui | Зарежда споделените ядра (същите файлове, които ползва backend-ът) с правилния |
| `hapi_enterprise/ui/dashboard-panel.js` | ui | ТАБЛОТО (и „Относно“) — вход към разделите, без мониторинг. |
| `hapi_enterprise/ui/data.js` | ui | ДЕМО данни за GUI-я. Живеят в JS, за да работи интерфейсът и през file:// |
| `hapi_enterprise/ui/debug-ledger.js` | ui | ДЕБЪГ ПРОТОКОЛ: записва ВСЯКА находка на дебъгинг системата заедно с ПРИЧИНАТА и |
| `hapi_enterprise/ui/debug-objects.js` | ui | ДЕБЪГ ИНСТРУМЕНТ: автоматично разпознаване на обектите в панела и прилагане на |
| `hapi_enterprise/ui/directory-panel.js` | ui | Контакти и дела (самостоятелни панели). Ползват същите административни API-та |
| `hapi_enterprise/ui/export-center.js` | ui | Export & Download Center (FD-2). |
| `hapi_enterprise/ui/field-labels.js` | ui | Етикети на полетата — едно място, след всеки рендер (DEF-38). |
| `hapi_enterprise/ui/files-manager.js` | ui | Портали & файлове (единен модул, план 17 + API-01/02). |
| `hapi_enterprise/ui/i18n.js` | ui | Речник за СЪДЪРЖАНИЕТО на панелите (не само навигацията) — BG/EN/DE. |
| `hapi_enterprise/ui/icons.js` | ui | Един набор от ИКОНИ за целия интерфейс — вградени SVG (без шрифт-икони, без CDN). |
| `hapi_enterprise/ui/monitoring-panel.js` | ui | МОНИТОРИНГ — ЕДНА страница за всичко, което add-on-ът мери. |
| `hapi_enterprise/ui/panel-registry.js` | ui | Регистър на панелите (план 18 §7: „панел като модул“ — `render/mount/unmount/permissions/capabilities` |
| `hapi_enterprise/ui/paptresor.js` | ui | Paptresor — печатен отчет за ПРИЛАГАНЕ на QR кода на портал (A4 плакат или лист с етикети). |
| `hapi_enterprise/ui/portal-control.js` | ui | Контейнер „Контролен панел на портала“ — настройки на портала и API/QR. |
| `hapi_enterprise/ui/portal-files.js` | ui | Контейнер „Файлове в портала (N) · /път“ — филтри, карти на файловете и качване. |
| `hapi_enterprise/ui/portal-folders.js` | ui | Контейнер „Папки на портала“ — експлорер на storage_root: скриващи се менюта. |
| `hapi_enterprise/ui/portals.js` | ui | Панел „Портали & API“ (Фаза 8 / API-01…03): генериране на публично API, |
| `hapi_enterprise/ui/public-gateway.js` | ui | Public Gateway & Access (PG-2) — два канала, портални политики и Public Access Test. |
| `hapi_enterprise/ui/qr-studio.js` | ui | QR СТУДИО — ЕДНО ГЛОБАЛНО МЯСТО ЗА ВСЯКА QR ОПЕРАЦИЯ (0.69.229). |
| `hapi_enterprise/ui/report-objects.js` | ui | Регистър на обектите за Report Studio (Фаза 11 / обектна библиотека). |
| `hapi_enterprise/ui/report-scope.js` | ui | Обхвати на отчетите — ЕДНО място, за да не се разминават отчетите по местата, от |
| `hapi_enterprise/ui/report-sign.js` | ui | Клиент за detached CMS (PKCS#7) подпис на отчет — това, което панелът вика. |
| `hapi_enterprise/ui/report-studio.js` | ui | Report Studio (Фаза 11 / RS-02): библиотека → документ → свойства → A4 preview. |
| `hapi_enterprise/ui/secret-share.js` | ui | Генериране на тайни връзки в БРАУЗЪРА — моделът на scrt.link v2 (MIT), собствен код. |
| `hapi_enterprise/ui/settings-panel.js` | ui | Настройки на връзката: админ токен, API адрес и публичен адрес за API/QR. |
| `hapi_enterprise/ui/upload-progress.js` | ui | Прозорец за качване с РЕАЛЕН напредък, сверка по хеш и възстановяване (0.69.214). |
| `hapi_enterprise/ui/visitors-panel.js` | ui | Панел „Кой влиза“ — чете сензорите за комуникацията (visitor-intel.js) през |
| `hapi_enterprise/versioning.js` | backend | Document versioning (Phase 4.3). Dependency-free helpers; physical I/O and |
| `hapi_enterprise/virtual-storage.js` | backend | Виртуално хранилище на портал (Фаза 8): йерархия topic → category → group → файл. |
| `hapi_enterprise/visitor-intel.js` | backend | Сензори за комуникацията на портала: кой влиза, какво тегли, колко пъти, от кое IP и — |
| `hapi_enterprise/webhooks.js` | backend | WEBHOOKS С HMAC — доставка на събития към външен адрес с подпис и повторение |
| `hapi_enterprise/workdir-crypto.js` | backend | L2: криптирана работна папка (бач B4 от `PLAN-0.69.67-LINKS-AND-FILES.md`). |
| `hapi_enterprise/workdir-io.js` | backend | L2 (бач B4): работната папка — единственото място, което знае как се пише и чете |
| `hapi_enterprise/workdir-migrate.js` | backend | L2 миграция (бач B4): откритите файлове в работните папки стават контейнери. |
| `hapi_enterprise/worm.js` | backend | WORM ЗА ОСНОВНОТО ХРАНИЛИЩЕ — файл, който е влязъл в доказателство, не се презаписва |
| `hapi_enterprise/x509.js` | backend | Минимален X.509 (self-signed) — за подписване на отчети и за устройствени сертификати. |
| `scripts/api-reference.cjs` | инструмент | Генерира `documentation/02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md` ОТ КОДА. |
| `scripts/artifact-smoke.cjs` | инструмент | Проверка на САМОТО ИЗДАНИЕ, не на работното дърво: разопакова `dist/hapi_enterprise-<в>.tar.gz` |
| `scripts/audit-events.cjs` | инструмент | КАТАЛОГ НА ОДИТНИТЕ СЪБИТИЯ — ГЕНЕРИРАН ОТ КОДА. |
| `scripts/audit-gui-compat.cjs` | инструмент | Двустепенна проверка: ПЪРВО целият GUI, и само при 100 % успех — съвместимостта на пакета. |
| `scripts/audit-html-headers.cjs` | инструмент | ВСЕКИ HTML ОТГОВОР НОСИ ПЪЛНИЯ НАБОР ЗАГЛАВКИ — ЕДНО МЯСТО, КОЕТО ГО ПРОВЕРЯВА (0.69.225). |
| `scripts/bad-code-scan.cjs` | инструмент | Сегментен скан за лош код. |
| `scripts/build-haoss.cjs` | инструмент | Builds a standalone, HACS-compatible integration repository in release/haoss. |
| `scripts/build-release.cjs` | инструмент | Строи изданието за Home Assistant в `dist/`: |
| `scripts/check-ha-live.cjs` | инструмент | Жива проверка на Home Assistant след поправка на токен/връзка. |
| `scripts/check-tag-version.cjs` | инструмент | Проверка „таг = версия“ — тагът, който се публикува, трябва да сочи точно тази |
| `scripts/compare-live-options.cjs` | инструмент | СРАВНЯВА ЖИВИТЕ ОПЦИИ НА ADD-ON-А С defaults В `config.yaml` — БЕЗ ДА ПЕЧАТА ТАЙНИ. |
| `scripts/decrypt-package.cjs` | инструмент | Разшифроване на криптиран експортен пакет БЕЗ add-on. |
| `scripts/dev-dashboard.cjs` | инструмент | команди (запаметявани в dashboard-commands.json) |
| `scripts/diag-package.cjs` | инструмент | ПАКЕТ ЗА ДЕБЪГИНГ И ОТСТРАНЯВАНЕ НА ПРОБЛЕМИ (0.69.208). |
| `scripts/docs-class.cjs` | инструмент | КЛАС НА ДОКУМЕНТА — нормата D-01 от `DOCS_AND_OPTIONS_STRUCTURE.md` (0.69.228). |
| `scripts/docs-index.cjs` | инструмент | ПЪЛНО СЪДЪРЖАНИЕ НА `documentation/` — ГЕНЕРИРАНО ОТ ДИСКА. |
| `scripts/docs-manual.cjs` | инструмент | ГЕНЕРАТОР НА ПРИЛОЖЕНИЯТА КЪМ ПЪЛНОТО РЪКОВОДСТВО (0.69.161). |
| `scripts/document-empty-catches.cjs` | инструмент | Еднократен инструмент: добавя КОНКРЕТНА причина във всеки празен `catch` в издавания код. |
| `scripts/error-codes.cjs` | инструмент | КАТАЛОГ НА КОДОВЕТЕ ЗА ГРЕШКА — ГЕНЕРИРАН ОТ КОДА. |
| `scripts/export-release.cjs` | инструмент | Изнася готовото издание в папка за качване (по подразбиране Downloads). |
| `scripts/export-tracked.cjs` | инструмент | Експорт на „точно това, което би влязло в git“ — без robocopy /MIR по цялото дърво. |
| `scripts/fetch-package.cjs` | инструмент | Паралелно теглене на експортен пакет (или който и да е файл с Range поддръжка). |
| `scripts/function-catalog.cjs` | инструмент | Каталог на функциите: какво ВСЕКИ модул изнася и кой тест го покрива. |
| `scripts/gen-test-rules.cjs` | инструмент | ГЕНЕРАТОР НА КАТАЛОГА С ПРАВИЛАТА (0.69.158). |
| `scripts/integrity-manifest.cjs` | инструмент | ГЕНЕРАТОР НА МАНИФЕСТА ЗА ЦЯЛОСТ (`hapi_enterprise/integrity-manifest.json`). |
| `scripts/join-package.cjs` | инструмент | Слепване на разделен експортен пакет БЕЗ add-on. |
| `scripts/logic-audit.cjs` | инструмент | Логически одит — търси подозрителна ЛОГИКА, не синтаксис. |
| `scripts/manifest-schema.cjs` | инструмент | `config/schemas/manifest.schema.json` — ГЕНЕРИРАН ОТ КОДА. |
| `scripts/openapi-admin.cjs` | инструмент | МАШИННО ЧЕТИМИЯТ ДОГОВОР ЗА АДМИНИСТРАТИВНОТО API — като ФАЙЛ, а не само като код. |
| `scripts/option-schema.cjs` | инструмент | `options:` И `schema:` СЕ ГЕНЕРИРАТ ОТ ДЕСКРИПТОРА (O2 от `DOCS_AND_OPTIONS_STRUCTURE.md` §7). |
| `scripts/options-reference.cjs` | инструмент | СПРАВОЧНИК НА ГЛОБАЛНИТЕ ОПЦИИ — ГЕНЕРИРАН (D3 от `DOCS_AND_OPTIONS_STRUCTURE.md` §5, §9). |
| `scripts/pre-push-audit.cjs` | инструмент | Одит преди качване в GitHub: какво влиза в хранилището и няма ли тайни/едри файлове. |
| `scripts/release-audit.cjs` | инструмент | Одит на всички издания: какво е имало и вече го няма. |
| `scripts/release-lib.cjs` | инструмент | Помощни функции за изданието на hAPI Enterprise. |
| `scripts/release-notes.cjs` | инструмент | 0.69.98 — Бележките на изданието се ВЗИМАТ от CHANGELOG-а, а не се пишат на ръка. |
| `scripts/release-status.cjs` | инструмент | Генерира `reports/RELEASE-STATUS.md` от РЕАЛНИТЕ артефакти, вместо да се пише на ръка. |
| `scripts/resume-package.cjs` | инструмент | Възобновяване на прекъснат трансфер на експортен пакет (или който и да е файл с Range). |
| `scripts/run-tests.cjs` | инструмент | Пълен пакет: пуска всеки тест във файл последователно и обобщава. |
| `scripts/safe-release.cjs` | инструмент | ЕДНА КОМАНДА ЗА ЦЕЛИЯ БЕЗОПАСЕН ПЪТ ДО ИЗДАНИЕ (0.69.225). |
| `scripts/script-audit.cjs` | инструмент | ОБХОД НА СКРИПТОВИТЕ ФАЙЛОВЕ — търси фалшиви функции, мъртъв код, счупена логика и |
| `scripts/secret-patterns.cjs` | инструмент | Общи правила за тайни, ползвани от одита (pre-push-audit) и от експорта за публикуване |
| `scripts/settings-defaults.cjs` | инструмент | Генерира таблицата „Настройки по подразбиране“ от `config.yaml` и преводите, вместо |
| `scripts/source-inventory.cjs` | инструмент | Инвентар на изходния код — ГЕНЕРИРАН, за да не остарява. |
| `scripts/split-styles.cjs` | инструмент | РАЗДЕЛЯ `ui/styles.css` на ЧЕТИРИТЕ файла от дизайн системата (план 18 §7): tokens, layout, |
| `scripts/sync-addon-changelog.cjs` | инструмент | Supervisor показва changelog само ако до `config.yaml` на add-on-а има `CHANGELOG.md`. |
| `scripts/test-matrix.cjs` | инструмент | Цялостен тестов пакет: изпълнява ВСИЧКИ тестове от `tests/` и при каквато и да е |
| `scripts/tree-fingerprint.cjs` | инструмент | ОТПЕЧАТЪК НА ДЪРВОТО — за да не може остаряла матрица да мине за зелена (0.69.224). |
| `scripts/verify-release.cjs` | инструмент | Проверка на изданието за Home Assistant — всички сценарии на едно място. |
| `scripts/verify-runner.cjs` | инструмент | ДНЕВНИК НА ВСИЧКИ ТЕСТОВЕ — пуска ВСЕКИ тест и запазва ПЪЛНИЯ му изход (0.69.232). |