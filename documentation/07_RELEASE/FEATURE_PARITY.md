# Паритет на функциите: `PasevSU/hAPI` ↔ това хранилище

Сравнение между публичното хранилище [`PasevSU/hAPI`](https://github.com/PasevSU/hAPI)
(add-on `portal_enterprise/` + интеграция `custom_components/portal_enterprise/`) и тази
версия (add-on `hapi_enterprise/` + интеграция `custom_components/hapi_enterprise/`).

Принцип: **тази версия не се изтрива** — тя е основата. От `PasevSU/hAPI` се пренасят
функциите, които липсват тук; нищо съществуващо не се маха.

## Пренесено в 0.53.0

| Функция | В `PasevSU/hAPI` | Тук | Статус |
| ------- | ---------------- | --- | ------ |
| Config flow (UI настройка на адрес/токен) | `config_flow.py` | `config_flow.py` | ✅ пренесено |
| Options flow (смяна без преинсталация) | да | да | ✅ пренесено |
| Координатор за телеметрия | `coordinator.py` → `/admin/api/sensors` | същото | ✅ пренесено + поправено (вж. долу) |
| Сензори | 7 (`sensor.py`) | 7, същите ключове | ✅ пренесено |
| Преводи на UI | `strings.json`, `translations/` | `strings.json`, `translations/en.json`, `translations/bg.json` | ✅ пренесено + BG |
| `config_flow: true` в манифеста | да | да | ✅ пренесено |

**Поправка при пренасянето:** add-on-ът връща `fileBytes` / `databaseBytes` /
`telemetryBytes` (camelCase), а сензорите в `PasevSU/hAPI` четат `file_bytes` /
`database_bytes` / `telemetry_bytes` — три сензора щяха да са винаги `unknown`.
`coordinator.py` сега нормализира полетата и има тест за това
(`tests/ha-integration-flow.cjs`).

## Остава от тази версия (уникално тук)

| Функция | Описание |
| ------- | -------- |
| Публична страница на портала | `/p/<id портала>` с адаптивни текстове според артефактите, търсене, QR, изтегляне с ключ |
| Публичен gateway на HA адреса | `/api/public/v1/portals/<slug>`, `/api/public/v1/files/<id>/…` (PG-6) |
| Прокси на порталното API | `/api/hapi_enterprise/v1/p/<id>/…` с `X-Portal-Key` и `X-File-Key`, Range/If-Range |
| Портална страница през интеграцията | `/api/hapi_enterprise/portal/<id>` + `/api/hapi_enterprise/assets/portal.{js,css}` |
| Пакет с хешове | sha256/sha512/sha384/sha3-256/sha1/md5 в API, UI и ZIP |
| HACS структура | `hacs.json`, `brand/`, `codeowners`, HACS validation workflow |
| Издателска верига | `build-release.cjs` + `verify-release.cjs` (20 сценария), RELEASE.json, SHA256SUMS |

## Съзнателно не се пренася

| Елемент | Защо |
| ------- | ---- |
| Папка `.dev/` | междинна разработка в онова хранилище; тук има `docs/plan/` и `documentation/` |
| Имената `portal_enterprise` | домейнът тук е `hapi_enterprise`; преименуването би счупило съществуващи инсталации |
| Старата портална страница (`portal.html` от 0.50) | заменена от адаптивната версия |

## Какво да се провери при следващо сравнение

1. Нови модули в `portal_enterprise/` → `hapi_enterprise/` (сравни списъка на файловете).
2. Нови полета в `/admin/api/sensors` → `coordinator.py` (`_TELEMETRY_KEYS`).
3. Нови сензори → `sensor.py` + `strings.json` + `translations/*.json`.
4. Нови стъпки в `config_flow.py` → `strings.json` (всички езици).

Проверката е автоматизирана: `node tests/ha-integration-flow.cjs` пази договора между
константите, координатора, сензорите, преводите и манифеста.
