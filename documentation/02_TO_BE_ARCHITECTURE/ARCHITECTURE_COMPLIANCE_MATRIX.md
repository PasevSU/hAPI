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
| 10 | Номер в комбинирания отчет ↔ едно съдържание | няма връзка | — | ⛔ (виж §5, ред 2) |
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
| Allowlist за публичния слушател | `public-route-allowlist.js` (27 правила) | `public-route-allowlist` (35 разрешени, 33 отказани) |
| Без изтекли токени в имената на маршрути | `observer.normalizePath` (`/t/:token`) | `portal-tokens` |

## 4. Експлоатация и интеграция (§15–§16)

| Изискване | Код | Тест |
| --- | --- | --- |
| Сензори с реални числа, едно изчисление | `security` + `qr` + `guidance` в `/admin/api/sensors` | `decision-sensors`, `portal-qr-archive` |
| Home Assistant без втора логика | `coordinator._normalize_*`, 28 сензора | `ha-integration-flow` |
| Грешки без вътрешни пътища | `fail()` в маршрутите; 404 при липса на право | `portal-order`, `public-route-allowlist` |
| API договор, който не се разминава | `admin-api-spec.js` + `scripts/api-reference.cjs` | `admin-api-spec`, `api-reference` |

## 5. Липсваща функционалност (честен списък)

| # | Липсва | Какво значи | Следваща стъпка |
| --- | --- | --- | --- |
| 1 | Периодична проверка на целостта | няма `integrity.failed` събитие и сензор; подмяна на байтове се вижда само при ръчна сверка | фонова задача „провери манифеста на активния QR“ + сензор |
| 2 | `report_entry_id → content_id` | номерът в отчета не сочи версия | поле `contentId` при публикуване + тест за две версии |
| 3 | Договор `file` като самостоятелна страница | има QR към файл, но не и страница с неговия списък | `serveFile()` до `serveOrder()` |
| 4 | Изолация на недоверен HTML | CSP има, sandbox няма | отделен origin/iframe с `sandbox` |
| 5 | Възстановяване от архив | архивът се сваля, но няма „върни това състояние“ | `POST …/qr/{qrId}/restore` (изрично, с нов QR) |
| 6 | GUI бадж „QR vN / Архиви“ в списъка на порталите | има го в контролния панел, не в реда на портала | малък бадж до `API/QR` |

## 6. Регресионна база

| Показател | Стойност |
| --- | --- |
| Тестови файлове | 247 (`reports/RELEASE-STATUS.md`) |
| Матрица | `node scripts/test-matrix.cjs` — 100 % при 1 опит е целта; флейки при паралелни портове се отчитат изрично |
| Проверки на изданието | `verify-release` 20/20 · `audit-gui-compat` 33/33 · `logic-audit --gate` · `bad-code-scan --gate` · `eslint` 0 |
| Твърд бюджет | `server.js` ≤ 2722 реда, 9 компонента в `routes/` |

> Когато ред от §5 се затвори, тук се сменя статусът и се добавя тестът, който го пази. Матрицата не е „документ за четене“, а списък на това, което още не е направено.
