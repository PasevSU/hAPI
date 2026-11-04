# Source Inventory — hAPI Enterprise (As-Is)

> **Генериран документ.** Версия на кода: **0.69.150**. Пише се от
> `node scripts/source-inventory.cjs`, проверява се от `tests/source-inventory.cjs`.
> Ръчните редакции се губят при следващото генериране — затова „предназначението“ идва от
> първия коментар в самия файл: документът не може да твърди нещо, което кодът не казва.

Общо: **109** backend модула · **16** HTTP компонента · **23** UI модула · **8** Python модула · **35** инструмента · **353** теста.

Архитектурните описания са в [`MODULE_CATALOG.md`](MODULE_CATALOG.md); списъкът на
маршрутите — в [`API_ENDPOINT_REFERENCE.md`](../02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md).

### Backend модули (`hapi_enterprise/*.js`) (109)

| Файл | Предназначение (първи ред от самия файл) |
| ---- | ----------------------------------------- |
| `hapi_enterprise/admin-api-spec.js` | Договор за АДМИНИСТРАТИВНОТО API (OpenAPI 3.1). |
| `hapi_enterprise/api-registry.js` | Създаване на хранилище за API на портал (Фаза 8): api/<slug>/ |
| `hapi_enterprise/api-spec.js` | Генериране на публично API за портал (Фаза 8 / API-01…03) — чист JS, без I/O. |
| `hapi_enterprise/api-version.js` | Версиониране на API (Фаза 2.5): v2 е текущ, v1 (legacy) продължава да работи, |
| `hapi_enterprise/audit-chain.js` | Одитен дневник с ХЕШ-ВЕРИГА: всеки запис носи `prevHash` на предишния, така че подмяна |
| `hapi_enterprise/cabinet.js` | Filing cabinet: an admin-only document store (folders, subfolders, files) separate from portals. |
| `hapi_enterprise/case-access.js` | ОГРАНИЧАВАНЕ ПО ДЕЛО (план 17, F7-1, DoD „достъп по дело“). |
| `hapi_enterprise/cases.js` | Дела (cases): номер, заглавие, категория, „относно“, контакт и полета по желание. |
| `hapi_enterprise/cms-sign.js` | Detached CMS/PKCS#7 подпис (RS-06) — това, което PDF четецът проверява. |
| `hapi_enterprise/config-profiles.js` | Named configuration profiles. Each profile is a validated, atomically persisted |
| `hapi_enterprise/container.js` | DI контейнер (Фаза 2.1, P1/P2). Лениво инстанцира сингълтони; поддържа |
| `hapi_enterprise/content-id.js` | Идентичност на СЪДЪРЖАНИЕТО (`content_id`) — §11 и §12 от HAPI-ARCH-API-001. |
| `hapi_enterprise/core-store.js` | Core hierarchical store (DOCFLOW Phases 1). Own SQLite file, additive to the legacy |
| `hapi_enterprise/crypto-options.js` | Крипто опции на add-on-а: env (от start.js) има приоритет, после options.json, после |
| `hapi_enterprise/decision-sensors.js` | От измерване към РЕШЕНИЕ: кой компонент, какъв проблем, от кога и какво да проверим. |
| `hapi_enterprise/directory.js` | Variables registry + contact directory with domain rules, auto-fill and a conflict queue. |
| `hapi_enterprise/download-access.js` | Download Access Control (FD-0) — централни правила за достъпност на изтегляне. |
| `hapi_enterprise/download-stream.js` | Поточно изтегляне на файл с ограничен брой едновременни потоци и (по избор) |
| `hapi_enterprise/error-log.js` | Centralized, bounded structured error log. Entries are appended as JSONL with |
| `hapi_enterprise/event-bus.js` | In-process Event Bus (Фаза 2.2, P5). Излъчва наблюдаеми domain събития; |
| `hapi_enterprise/event-stream.js` | SSE ПОТОК ЗА ЖИВИ СЪБИТИЯ — `GET /admin/api/events/stream` (F4-7, втората половина). |
| `hapi_enterprise/evidence-portal.js` | Публикуване на Evidence View портала в папката, която Home Assistant сервира статично. |
| `hapi_enterprise/evidence-portal/assets/app.js` | (без заглавен коментар) |
| `hapi_enterprise/evidence-portal/assets/consent.js` | hAPI consent gate. Never treat browser state as server authorization. |
| `hapi_enterprise/exif.js` | EXIF / МЕТАДАННИ — извличане и СРАВНЕНИЕ (план 18, панел 08). |
| `hapi_enterprise/export-manager.js` | Export Manager (FD-1) — трансферно ядро с проверка на целостта. |
| `hapi_enterprise/export-rules.js` | File Delivery & Export Manager — правила за експорт (FD-0). |
| `hapi_enterprise/file-crypto.js` | Opt-in whole-file encryption at rest (AES-256-GCM). The logical file SHA-256 and |
| `hapi_enterprise/forensic.js` | FORENSIC АНАЛИЗ (план 18, панел 07) — файлът се проверява по СЪДЪРЖАНИЕТО, не по разширението. |
| `hapi_enterprise/gateway-api.js` | PG-6 / FD-6: backend прилагане на правилата за публичен достъп и експорт. |
| `hapi_enterprise/generator.js` | PasevSU Document Generator — ШАБЛОНИ ОТ ДИСКА, ИНДЕКС НА ЖИВО. |
| `hapi_enterprise/generator/app.js` | PasevSU Document Generator — клиентската част. |
| `hapi_enterprise/idempotency.js` | IDEMPOTENCY-KEY — повторена заявка не изпълнява действието втори път (docs/plan/17, F4-5). |
| `hapi_enterprise/instance-lock.js` | Заключване на data директорията: една жива инстанция на add-on-а, един собственик. |
| `hapi_enterprise/interpolate.js` | Интерполация на `{{променлива}}` в текстове, които отиват към хора: име и описание на |
| `hapi_enterprise/job-manager.js` | Persistent, bounded FIFO job queue with cooperative pause/resume and crash |
| `hapi_enterprise/layout.js` | Карта на структурата: къде какво стои и на кой адрес се вижда. |
| `hapi_enterprise/links.js` | ЕДИНСТВЕНОТО място, където се строят адресите на hAPI. |
| `hapi_enterprise/load-control.js` | Intelligent (adaptive) load control. Replaces the static download concurrency cap |
| `hapi_enterprise/logger.js` | Structured debug logging for the add-on. |
| `hapi_enterprise/migration-bridge.js` | Phase 1.5 migration bridge: legacy (directory, portals, cabinet) -> DOCFLOW core. |
| `hapi_enterprise/mirror-target.js` | Цел на огледалото (0.69.87, стъпка M3 от `READY_MADE_COMPONENTS.md` §2.5). |
| `hapi_enterprise/notify.js` | DOCFLOW Phase 4.4 — QR/линк dispatch чрез Home Assistant notify.* услуги. |
| `hapi_enterprise/observer.js` | Наблюдение (сензори) без зависимости: комуникация, файлове, извиквания, изтегляния, |
| `hapi_enterprise/oidc.js` | OIDC вход (authorization code + PKCE, S256) — без външни зависимости. |
| `hapi_enterprise/ooxml.js` | Minimal dependency-free ZIP writer/reader and OOXML (docx/xlsx) helpers. |
| `hapi_enterprise/package-crypto.js` | Криптиран контейнер за експортен пакет (hapiPKG1). |
| `hapi_enterprise/packager.js` | Пакетиране на портал (или избрани файлове) в ZIP с манифест, хешове и |
| `hapi_enterprise/path-crypto.js` | Ключохранилище на PGP (бач B2 от `PLAN-0.69.67-LINKS-AND-FILES.md`). |
| `hapi_enterprise/pdf-writer.js` | Dependency-free PDF writer with embedded TrueType fonts (Unicode incl. Cyrillic). |
| `hapi_enterprise/pgp.js` | OpenPGP (RFC 9580 / RFC 4880) — деташиран подпис без външни зависимости. |
| `hapi_enterprise/plugins.js` | Плъгин регистър (Фаза 2.4, P2/P4). Именувани плъгини по вид (storage, renderer, |
| `hapi_enterprise/plugins/ocr.js` | OCR плъгин (Фаза 2.4). Интерфейс за извличане на текст; конфигурационно |
| `hapi_enterprise/plugins/renderer.js` | Renderer плъгин (Фаза 2.4). Единен интерфейс към PDF (pdf-writer) и OOXML |
| `hapi_enterprise/plugins/storage.js` | Storage плъгин (Фаза 2.4). Интерфейс за файловия бекенд; днес — локална ФС. |
| `hapi_enterprise/portal-access.js` | Подписан достъп до ЦЕЛИЯ портал: `<адрес>?expires=<unix>&sig=<hmac>`. |
| `hapi_enterprise/portal-folder.js` | Папка на портала в хранилището: РЕАЛНИТЕ файлове, с истинските им имена. |
| `hapi_enterprise/portal-integrity.js` | Целостта на ФИЗИЧЕСКИТЕ архиви (правило `ARCHIVE_NOT_TAMPERED`). |
| `hapi_enterprise/portal-policy.js` | ЕДНА политика за достъп до портал (Stage D): идентичност → портал → ресурс → действие. |
| `hapi_enterprise/portal-qr.js` | QR ревизии, манифести и ФИЗИЧЕСКИ архиви за един портал. |
| `hapi_enterprise/portal/portal-i18n.js` | Речник на ПУБЛИЧНАТА страница на портала (BG / EN / DE). |
| `hapi_enterprise/portal/portal.js` | Публична страница на портала — това, което се отваря при сканиране на QR кода. |
| `hapi_enterprise/preview.js` | Document preview & thumbnails (Phase 4.3). Dependency-free: renders text, |
| `hapi_enterprise/problem.js` | ГРЕШКАТА КАТО ДОКУМЕНТ (RFC 9457, „problem details“). |
| `hapi_enterprise/process-guards.js` | Последен предпазител на процеса. |
| `hapi_enterprise/public-gateway.js` | Public API Gateway (PG-0) — втори, независим канал за достъп. |
| `hapi_enterprise/public-package.js` | Еднократни токени за пакет, поискан от ПУБЛИЧНАТА страница. |
| `hapi_enterprise/public-route-allowlist.js` | Allowlist за ПУБЛИЧНИЯ Gateway listener (`PUBLIC_GATEWAY_PORT`, в add-on-а 8088). |
| `hapi_enterprise/qrcode.js` | QR Code Generator for JavaScript |
| `hapi_enterprise/rbac.js` | Role-based access control over the administrative API. Three roles are resolved |
| `hapi_enterprise/readiness.js` | Решение за readiness — чиста функция, без I/O. |
| `hapi_enterprise/registry.js` | Metadata-driven profile schemas (prefix 1000-5000). A new profile is a config entry, |
| `hapi_enterprise/report-manifest.js` | Фаза 11 / RS-01: манифест на отчет (Report Studio). |
| `hapi_enterprise/report-package.js` | ПАКЕТ С ДОКАЗАТЕЛСТВА от манифест на отчет (W7). |
| `hapi_enterprise/report-render.js` | Фаза 11 / RS-03: манифест → PDF чрез собствения pdf-writer (без външни зависимости). |
| `hapi_enterprise/report-stamp.js` | Фаза 11 / RS-05: реален RFC 3161 обхват върху отчет от Report Studio. |
| `hapi_enterprise/repository.js` | Repository интерфейс (Фаза 2.3, ADR-04/P4). Дефинира persistence контракта за |
| `hapi_enterprise/respond.js` | ОТГОВОРЪТ НА ЗАЯВКА — точно веднъж. |
| `hapi_enterprise/retention.js` | Retention policies: age-based expiry of uploaded files and the human-readable audit |
| `hapi_enterprise/runtime-config.js` | Конфигурацията на средата: какво идва от опциите на add-on-а, кое е твърдо зададено и |
| `hapi_enterprise/secret-links.js` | Тайни връзки (zero-knowledge): тайната се шифрова В БРАУЗЪРА, а сървърът пази само |
| `hapi_enterprise/secret-lock.js` | Сериализация на достъпа до една тайна по id: два едновременни прегледа не бива да |
| `hapi_enterprise/secret-page.js` | Страница за преглед на тайна връзка. ЦЯЛАТА информация е във фрагмента на адреса |
| `hapi_enterprise/secret-view.js` | Преглед на тайна връзка — страната на БРАУЗЪРА (модел като scrt.link v2). |
| `hapi_enterprise/send.js` | „Бърз линк“ (Send-lite): еднократен/срочен/безсрочен публичен достъп до ЕДИН файл, |
| `hapi_enterprise/server.js` | Една жива инстанция на data директория (виж instance-lock.js). Попълва се в start(). |
| `hapi_enterprise/share-links.js` | Share links за портал: NFC/QR таг за Home Assistant Companion + universal link. |
| `hapi_enterprise/shared-data.js` | ЕДНИ И СЪЩИ ДАННИ — ОТ РАЗЛИЧНИ ПРОЦЕСИ (многослоен цикъл върху един източник на истина). |
| `hapi_enterprise/signer.js` | Подпис + timestamp (Фаза 3.3): HMAC-SHA256 над SHA-256 хеша на файла. |
| `hapi_enterprise/site-csp.js` | CSP за изолираните HTML проекти (`/site/<портал>/<проект>/…`). |
| `hapi_enterprise/sqlite-repository.js` | SQLite repository (Фаза 2.3). Асинхронна фасада над core-store, която |
| `hapi_enterprise/sqlite-store.js` | SQLite is the authoritative metadata store. The legacy JSON file is retained |
| `hapi_enterprise/standalone.js` | hAPI Enterprise — edge/standalone runtime. |
| `hapi_enterprise/start.js` | hAPI Enterprise — add-on entrypoint. |
| `hapi_enterprise/storage-check.js` | Storage health checks: verifies that each configured storage location exists, is a |
| `hapi_enterprise/storage-migrate.js` | !/usr/bin/env node |
| `hapi_enterprise/storage-preflight.js` | Подразбиране от 0.69.87: `/share/hapi/data`. Документите са на едно предвидимо място, |
| `hapi_enterprise/storage-tree.js` | Дърво на папка от хранилището (storage_root) — чист модул (UMD). |
| `hapi_enterprise/throttle.js` | Ограничаване на скоростта на ПОТОКА (bandwidth pacing). |
| `hapi_enterprise/tsa-client.js` | RFC 3161 Time-Stamp Protocol клиент (TSQ → TSA → TSR), без зависимости. |
| `hapi_enterprise/versioning.js` | Document versioning (Phase 4.3). Dependency-free helpers; physical I/O and |
| `hapi_enterprise/virtual-storage.js` | Виртуално хранилище на портал (Фаза 8): йерархия topic → category → group → файл. |
| `hapi_enterprise/visitor-intel.js` | Сензори за комуникацията на портала: кой влиза, какво тегли, колко пъти, от кое IP и — |
| `hapi_enterprise/webhooks.js` | WEBHOOKS С HMAC — доставка на събития към външен адрес с подпис и повторение |
| `hapi_enterprise/workdir-crypto.js` | L2: криптирана работна папка (бач B4 от `PLAN-0.69.67-LINKS-AND-FILES.md`). |
| `hapi_enterprise/workdir-io.js` | L2 (бач B4): работната папка — единственото място, което знае как се пише и чете |
| `hapi_enterprise/workdir-migrate.js` | L2 миграция (бач B4): откритите файлове в работните папки стават контейнери. |
| `hapi_enterprise/worm.js` | WORM ЗА ОСНОВНОТО ХРАНИЛИЩЕ — файл, който е влязъл в доказателство, не се презаписва |
| `hapi_enterprise/x509.js` | Минимален X.509 (self-signed) — за подписване на отчети и за устройствени сертификати. |

### HTTP компоненти (`hapi_enterprise/routes/*.js`) (16)

| Файл | Предназначение (първи ред от самия файл) |
| ---- | ----------------------------------------- |
| `hapi_enterprise/routes/admin-docs.js` | Договорът за административното API — като компонент на HTTP слоя. |
| `hapi_enterprise/routes/events.js` | SSE поток — административен компонент на HTTP слоя (F4-7, живата половина). |
| `hapi_enterprise/routes/evidence.js` | Доказателства по ДЕЛО — компонент на HTTP слоя (план 17, F7-1 „достъп по дело“). |
| `hapi_enterprise/routes/file-transfer.js` | Преместване и копиране на файл между портали (F2-10 / F2-11) — компонент на HTTP слоя. |
| `hapi_enterprise/routes/folders.js` | Папки на портала в хранилището — компонент на HTTP слоя. |
| `hapi_enterprise/routes/forensic.js` | Forensic и метаданни — компонент на HTTP слоя (план 18, панели 07 и 08). |
| `hapi_enterprise/routes/generator.js` | Document Generator — компонент на HTTP слоя. |
| `hapi_enterprise/routes/link-check.js` | Проверка дали един публичен адрес НАИСТИНА се отваря — компонент на HTTP слоя. |
| `hapi_enterprise/routes/oidc.js` | OIDC вход — компонент на HTTP слоя. |
| `hapi_enterprise/routes/pgp-keyring.js` | PGP ключохранилище — компонент на HTTP слоя. |
| `hapi_enterprise/routes/portal-page.js` | Публичната страница на портала — ЕДИН адрес, на адреса на add-on-а (и през Home Assistant). |
| `hapi_enterprise/routes/portal-qr.js` | QR ревизиите на един портал — компонент на HTTP слоя. |
| `hapi_enterprise/routes/portal-storage.js` | Изтегляне на файл ОТ ПАПКАТА на портала (публичен вход през портала, не отделен адрес). |
| `hapi_enterprise/routes/portal-tokens.js` | Публични токени за един портал (Stage D) — HTTP слоят. |
| `hapi_enterprise/routes/reports.js` | Report Studio + RFC 3161 — компонент на HTTP слоя. |
| `hapi_enterprise/routes/webhooks.js` | Webhooks с HMAC — административен компонент на HTTP слоя (F4-7). |

### Интерфейс (`hapi_enterprise/ui/*.js`) (23)

| Файл | Предназначение (първи ред от самия файл) |
| ---- | ----------------------------------------- |
| `hapi_enterprise/ui/api-base.js` | Базов адрес за заявките от панела (Enterprise Control Center). |
| `hapi_enterprise/ui/app.js` | Enterprise Control Center — обвивка на GUI (Фаза 10 / UI-01). |
| `hapi_enterprise/ui/bootstrap.js` | Зарежда споделените ядра (същите файлове, които ползва backend-ът) с правилния |
| `hapi_enterprise/ui/dashboard-panel.js` | Табло и „Относно“ — с РЕАЛНИ данни от add-on-а. |
| `hapi_enterprise/ui/data.js` | ДЕМО данни за GUI-я. Живеят в JS, за да работи интерфейсът и през file:// |
| `hapi_enterprise/ui/directory-panel.js` | Контакти и дела (самостоятелни панели). Ползват същите административни API-та |
| `hapi_enterprise/ui/export-center.js` | Export & Download Center (FD-2). |
| `hapi_enterprise/ui/files-manager.js` | Портали & файлове (единен модул, план 17 + API-01/02). |
| `hapi_enterprise/ui/i18n.js` | Речник за СЪДЪРЖАНИЕТО на панелите (не само навигацията) — BG/EN/DE. |
| `hapi_enterprise/ui/icons.js` | Един набор от ИКОНИ за целия интерфейс — вградени SVG (без шрифт-икони, без CDN). |
| `hapi_enterprise/ui/panel-registry.js` | Регистър на панелите (план 18 §7: „панел като модул“ — `render/mount/unmount/permissions/capabilities` |
| `hapi_enterprise/ui/portal-control.js` | Контейнер „Контролен панел на портала“ — настройки на портала и API/QR. |
| `hapi_enterprise/ui/portal-files.js` | Контейнер „Файлове в портала (N) · /път“ — филтри, карти на файловете и качване. |
| `hapi_enterprise/ui/portal-folders.js` | Контейнер „Папки на портала“ — експлорер на storage_root: скриващи се менюта. |
| `hapi_enterprise/ui/portals.js` | Панел „Портали & API“ (Фаза 8 / API-01…03): генериране на публично API, |
| `hapi_enterprise/ui/public-gateway.js` | Public Gateway & Access (PG-2) — два канала, портални политики и Public Access Test. |
| `hapi_enterprise/ui/report-objects.js` | Регистър на обектите за Report Studio (Фаза 11 / обектна библиотека). |
| `hapi_enterprise/ui/report-scope.js` | Обхвати на отчетите — ЕДНО място, за да не се разминават отчетите по местата, от |
| `hapi_enterprise/ui/report-sign.js` | Клиент за detached CMS (PKCS#7) подпис на отчет — това, което панелът вика. |
| `hapi_enterprise/ui/report-studio.js` | Report Studio (Фаза 11 / RS-02): библиотека → документ → свойства → A4 preview. |
| `hapi_enterprise/ui/secret-share.js` | Генериране на тайни връзки в БРАУЗЪРА — моделът на scrt.link v2 (MIT), собствен код. |
| `hapi_enterprise/ui/settings-panel.js` | Настройки на връзката: админ токен, API адрес и публичен адрес за API/QR. |
| `hapi_enterprise/ui/visitors-panel.js` | Панел „Кой влиза“ — чете сензорите за комуникацията (visitor-intel.js) през |

### Home Assistant интеграция (`custom_components/**/*.py`) (8)

| Файл | Предназначение (първи ред от самия файл) |
| ---- | ----------------------------------------- |
| `custom_components/hapi_enterprise/__init__.py` | hAPI Enterprise Home Assistant integration. |
| `custom_components/hapi_enterprise/binary_sensor.py` | Binary sensors for hAPI Enterprise: is something broken right now? |
| `custom_components/hapi_enterprise/config_flow.py` | Config flow for the hAPI Enterprise integration. |
| `custom_components/hapi_enterprise/const.py` | Constants for the hAPI Enterprise Home Assistant integration. |
| `custom_components/hapi_enterprise/coordinator.py` | DataUpdateCoordinator for hAPI Enterprise telemetry. |
| `custom_components/hapi_enterprise/diagnostics.py` | Diagnostics for the hAPI Enterprise integration. |
| `custom_components/hapi_enterprise/entity.py` | Shared entity helpers for the hAPI Enterprise integration. |
| `custom_components/hapi_enterprise/sensor.py` | Sensor platform for hAPI Enterprise telemetry. |

### Инструменти (`scripts/*.cjs`) (35)

| Файл | Предназначение (първи ред от самия файл) |
| ---- | ----------------------------------------- |
| `scripts/api-reference.cjs` | Генерира `documentation/02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md` ОТ КОДА. |
| `scripts/artifact-smoke.cjs` | Проверка на САМОТО ИЗДАНИЕ, не на работното дърво: разопакова `dist/hapi_enterprise-<в>.tar.gz` |
| `scripts/audit-events.cjs` | КАТАЛОГ НА ОДИТНИТЕ СЪБИТИЯ — ГЕНЕРИРАН ОТ КОДА. |
| `scripts/audit-gui-compat.cjs` | Двустепенна проверка: ПЪРВО целият GUI, и само при 100 % успех — съвместимостта на пакета. |
| `scripts/bad-code-scan.cjs` | Сегментен скан за лош код. |
| `scripts/build-haoss.cjs` | Builds a standalone, HACS-compatible integration repository in release/haoss. |
| `scripts/build-release.cjs` | Строи изданието за Home Assistant в `dist/`: |
| `scripts/check-tag-version.cjs` | Проверка „таг = версия“ — тагът, който се публикува, трябва да сочи точно тази |
| `scripts/decrypt-package.cjs` | Разшифроване на криптиран експортен пакет БЕЗ add-on. |
| `scripts/dev-dashboard.cjs` | команди (запаметявани в dashboard-commands.json) |
| `scripts/docs-index.cjs` | ПЪЛНО СЪДЪРЖАНИЕ НА `documentation/` — ГЕНЕРИРАНО ОТ ДИСКА. |
| `scripts/document-empty-catches.cjs` | Еднократен инструмент: добавя КОНКРЕТНА причина във всеки празен `catch` в издавания код. |
| `scripts/error-codes.cjs` | КАТАЛОГ НА КОДОВЕТЕ ЗА ГРЕШКА — ГЕНЕРИРАН ОТ КОДА. |
| `scripts/export-release.cjs` | Изнася готовото издание в папка за качване (по подразбиране Downloads). |
| `scripts/export-tracked.cjs` | Експорт на „точно това, което би влязло в git“ — без robocopy /MIR по цялото дърво. |
| `scripts/fetch-package.cjs` | Паралелно теглене на експортен пакет (или който и да е файл с Range поддръжка). |
| `scripts/join-package.cjs` | Слепване на разделен експортен пакет БЕЗ add-on. |
| `scripts/logic-audit.cjs` | Логически одит — търси подозрителна ЛОГИКА, не синтаксис. |
| `scripts/manifest-schema.cjs` | `config/schemas/manifest.schema.json` — ГЕНЕРИРАН ОТ КОДА. |
| `scripts/openapi-admin.cjs` | МАШИННО ЧЕТИМИЯТ ДОГОВОР ЗА АДМИНИСТРАТИВНОТО API — като ФАЙЛ, а не само като код. |
| `scripts/pre-push-audit.cjs` | Одит преди качване в GitHub: какво влиза в хранилището и няма ли тайни/едри файлове. |
| `scripts/release-audit.cjs` | Одит на всички издания: какво е имало и вече го няма. |
| `scripts/release-lib.cjs` | Помощни функции за изданието на hAPI Enterprise. |
| `scripts/release-notes.cjs` | 0.69.98 — Бележките на изданието се ВЗИМАТ от CHANGELOG-а, а не се пишат на ръка. |
| `scripts/release-status.cjs` | Генерира `reports/RELEASE-STATUS.md` от РЕАЛНИТЕ артефакти, вместо да се пише на ръка. |
| `scripts/resume-package.cjs` | Възобновяване на прекъснат трансфер на експортен пакет (или който и да е файл с Range). |
| `scripts/run-tests.cjs` | Пълен пакет: пуска всеки тест във файл последователно и обобщава. |
| `scripts/script-audit.cjs` | ОБХОД НА СКРИПТОВИТЕ ФАЙЛОВЕ — търси фалшиви функции, мъртъв код, счупена логика и |
| `scripts/secret-patterns.cjs` | Общи правила за тайни, ползвани от одита (pre-push-audit) и от експорта за публикуване |
| `scripts/settings-defaults.cjs` | Генерира таблицата „Настройки по подразбиране“ от `config.yaml` и преводите, вместо |
| `scripts/source-inventory.cjs` | Инвентар на изходния код — ГЕНЕРИРАН, за да не остарява. |
| `scripts/split-styles.cjs` | РАЗДЕЛЯ `ui/styles.css` на ЧЕТИРИТЕ файла от дизайн системата (план 18 §7): tokens, layout, |
| `scripts/sync-addon-changelog.cjs` | Supervisor показва changelog само ако до `config.yaml` на add-on-а има `CHANGELOG.md`. |
| `scripts/test-matrix.cjs` | Цялостен тестов пакет: изпълнява ВСИЧКИ тестове от `tests/` и при каквато и да е |
| `scripts/verify-release.cjs` | Проверка на изданието за Home Assistant — всички сценарии на едно място. |
