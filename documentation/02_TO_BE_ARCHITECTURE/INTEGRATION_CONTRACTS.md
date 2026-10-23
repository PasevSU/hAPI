# Integration Contracts — hAPI Enterprise (To-Be)

## API versioning

| Version      | Scope                                   |
| ------------ | --------------------------------------- |
| `/api/v1`    | current admin API (HA + Windows)        |
| `/api/v2`    | schema-validated API (Phase 6–7 target) |
| `/verify/v1` | public evidence verification (Phase 7)  |

### Договор за административното API (от 0.69.46)

`GET /admin/api/openapi.json` връща OpenAPI 3.1 за административната повърхност:
метод, път, резюме, таг, капацитет за RBAC (`x-hapi-capability`), параметри по пътя и
отговори 200/401/403/429. Изисква токен (`Authorization: Bearer …`) или самоличност от
Ingress — договорът показва и правата, затова не е публичен.

- **Източник:** `hapi_enterprise/admin-api-spec.js` (таблица `ROUTES`).
- **Сверка:** `tests/admin-api-spec.cjs` изважда от кода всеки маршрут, записан като
  `url.pathname === '/admin/api/…'`, и изисква същите двойки метод+път да са в таблицата —
  в двете посоки. Нова пътека без ред чупи теста; ред без пътека също.
- **Обхват:** второ ниво (`/admin/api/<ресурс>`), блоковете `/v2` (core, export), `/pgp`,
  `/packages`, `/cases`, `/variables`, `/directory`, `/cabinet`, `/taxonomy`, `/portals`,
  компонентите `routes/reports.js` и `routes/generator.js` и **подресурсите с динамични
  id-та** (портал → дърво, файлове, бележки, прикачени, HTML проекти; файл → достъп,
  ключове, изпращания, подпис, версии). Подпът, който съществува в кода, но липсва в
  договора, чупи `tests/admin-api-spec.cjs` (проверка в двете посоки).
- **Публичното** портално API има отделен договор — `api-spec.js` (OpenAPI 3.1 на портал).

## HA add-on contract

| Interface      | Detail                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| Ingress        | `/` → 302 към `<ingress>/ui/` (панелът)                                   |
| Panel          | ingress панел на add-on-а (`panel_title` / `panel_icon`) → iframe на UI-я |
| HACS component | fail-closed read bridge `/api/hapi_enterprise/v1/{tail}`                  |
| Storage        | `/data` add-on volume (config-specified)                                  |
| Secrets        | `secrets.yaml` (optional, dev)                                            |

### Адрес на API-то от панела (INV-C1)

Под Ingress документът живее на `/api/hassio_ingress/<token>/ui/`, а add-on-ът е на
същия префикс. Затова **всяка** заявка от панела и от генератора се строи като
`origin + ingress префикс + път` — никога като `location.origin + път` и никога като
абсолютен `/admin/...`:

- `ui/api-base.js` е единственото място, което разпознава префикса
  (`/api/hassio_ingress/<token>`, `/hassio/ingress/<token>`, `/app/<token>`, `/hapi/<token>`);
- сървърът отрязва СЪЩИТЕ форми (`server.js`, ingress блокът): `/app/<slug>` е линкът,
  който Home Assistant дава към панела, и без отрязване `/app/<slug>/admin/api/…` връща 404;
  чужд път под префикса не се „оправя“ — остава 404;
- панелите взимат базовия адрес от `window.hapiApiBase()`, а генераторът — от
  `location.pathname`;
- `hapi.apiBase` (Настройки → Връзка) остава с предимство (standalone/външен адрес);
- при `file://` базовият адрес е празен — демо режим, без фалшива „връзка“.

Проверява се от `tests/ingress-api-base.cjs` (единични случаи за всички форми на
префикса + жива проверка, че API-то отговаря под префикса).

### Вграждане на панела (INV-C2)

Панелът на add-on-а е `iframe` към ingress адреса, затова документът на UI-я се сервира
с `Content-Security-Policy: … frame-ancestors 'self'`. `frame-ancestors 'none'` заключва
страницата срещу ВСЯКА рамка — включително панела на Home Assistant — и резултатът е
празен екран без съобщение за грешка (дефект, поправен в 0.69.41).

- `'self'` пази защитата от чужд clickjacking (вграждане от друга страница е отказано),
  но позволява на Home Assistant да покаже панела — ingress е на същия origin.
- Публичните страници остават заключени: `/p/<id>` (порталът), `/secret/<id>` и
  `/api/hapi_enterprise/portal/<slug>` в интеграцията носят `frame-ancestors 'none'` —
  те не се вграждат никъде.
- Проверява се от `tests/blackbox-security.cjs`: UI-ят има `'self'`, публичните — `'none'`.
- Проверява се и от `tests/panel-framing.cjs`, който НЕ търси текст, а прилага правилото:
  оценител на `frame-ancestors` минава случаите none/self/\*/схема/порт/няколко политики,
  статичен скенер изисква изрична политика от ВСЯКА HTML повърхност в сървъра, а живият
  сървър минава през двата адреса, които Home Assistant дава. Доказано е и в реален
  браузър (Chrome): при същия origin панелът се рисува, при чужд — конзолата казва
  „Framing … violates the following Content Security Policy directive: frame-ancestors 'self'“
  и рамката остава празна (същата икона, която потребителят виждаше).

## Windows contract

| Interface | Detail                            |
| --------- | --------------------------------- |
| Backend   | `http://127.0.0.1:8098/` loopback |
| Admin     | `/admin`                          |
| Desktop   | pywebview loads backend URL       |

## Evidence portal contract (Phase 7)

| Interface | Detail                                            |
| --------- | ------------------------------------------------- |
| Read      | `GET /verify/v1/records/{id}/manifest`            |
| Files     | `GET /verify/v1/records/{id}/files/{n}`           |
| Verify    | hash/signature/timestamp recompute client-side    |
| Auth      | time-limited token embedded in QR (never secrets) |

## Events / webhooks (target)

- `document.finalized`, `access.created`, `audit.anchored`, `job.completed`.
- Delivery: SSE (live) + optional webhook (audit consumers).
