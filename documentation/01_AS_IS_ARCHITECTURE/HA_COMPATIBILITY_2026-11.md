# Съвместимост с Home Assistant и с маркетплейса — 0.69.209 (измерено 2026-11-15)

> **Клас:** жив · **Собственик на факта:** състояние днес · **Проверен към:** 0.69.242

Този документ отговаря на един въпрос: **какво точно ни приема Home Assistant и какво —
маркетплейсът (HACS + новият каталог)**, с доказателство за всяко твърдение. Всяко число тук
идва от изход на команда или от лог на валидатора; нищо не е „по принцип“.

## 1. С какво е измерено

| Източник | Какво дава | Резултат |
| --- | --- | --- |
| `hassfest` (`home-assistant/actions/hassfest`) в `.github/workflows/validate.yml` на `PasevSU/hapi-enterprise-integration` | официалният валидатор на Home Assistant | **24 валидатора, всички „done“**, job зелен (run 43655425136) |
| `hacs/action@main` (същия run) | проверките на HACS | **11 проверки завършени**, 1 предупреждение (`categories`) — **поправено** в 0.69.210 |
| `gh api repos/PasevSU/hapi-enterprise-integration` | метаданни на хранилището | public · Apache-2.0 · issues включени · теми `hacs, home-assistant, integration` |
| локални тестове | същото правило без интернет | `tests/hassfest-local.cjs`, `tests/hacs-structure.cjs`, `tests/ha-marketplace.cjs`, `tests/ha-support-matrix.cjs` |

## 2. Add-on (Home Assistant OS / Supervised)

| Какво изисква HA | Какво имаме | Къде е измерено |
| --- | --- | --- |
| `name`, `version`, `slug`, `description`, `url` | всичките; `version: "0.69.209"` е единственият източник на истина | `hapi_enterprise/config.yaml` |
| `arch` с реални образи | `amd64`, `aarch64`, `armv7`; образът е предварително построен (`image: ghcr.io/pasevsu/{arch}-addon-hapi_enterprise`) | `config.yaml` + `addon-image.yml` (job **success** за v0.69.209) |
| база на образа | `node:22.23.2-alpine3.24` (Node 22 + `node:sqlite`) | `hapi_enterprise/Dockerfile` |
| `ingress` + панел в страничната лента | `ingress: true`, `ingress_port: 8098`, `ingress_entry: /`, `panel_icon: mdi:file-document-multiple` | `config.yaml`, пазено от `ha-support-matrix` |
| достъп до HA API (известия) | `homeassistant_api: true` | `config.yaml` |
| надзор и рестарт | `watchdog: http://[HOST]:[PORT:8099]/health`, `boot: auto`, `startup: application` | `config.yaml` |
| резервни копия | `backup: cold` | `config.yaml` |
| настройки с валидация | **44** настройки, `options` + `schema` | `scripts/settings-defaults.cjs --check` |
| пълнота на образа | всеки модул в COPY | `verify-release` **S04**, 22/22 |

Забелязано (не е дефект, но е риск): Supervisor вече смята `armv7` за deprecated — приема го с
предупреждение. Държим го, защото `node:22-alpine` още публикува `linux/arm/v7`.

## 3. Интеграция (`custom_components/hapi_enterprise`)

| Какво изисква HA/HACS | Какво имаме | Къде е измерено |
| --- | --- | --- |
| `domain` = име на папката | `hapi_enterprise` | `manifest.json`, `hacs-structure` |
| `version` SemVer | `0.69.209` (същата като `config.yaml`) | `tests/ha-marketplace.cjs` |
| `documentation` / `issue_tracker` (https) | да | `hassfest-local` |
| `codeowners` | `@PasevSU` | `hassfest-local` |
| `config_flow: true` + работещ flow | да; `VERSION = 1`, `unique_id` = backend URL, `_abort_if_unique_id_configured()` | `config_flow.py` |
| съвременно състояние на вписването | `entry.runtime_data = coordinator` (2024.6+) | `__init__.py`, `tests/integration-runtime-data.cjs` |
| `integration_type`, `iot_class` | `hub`, `local_polling` | `manifest.json` |
| `requirements` без тежести | `[]` (само стандартна библиотека + HA) | `hassfest-local`: 11 вноса, всички позволени |
| **`categories`** (новото изискване на каталога) | **`productivity_information.documents_photos`** — разделът „Productivity & information → Documents & photos“ от официалния списък (28 раздела) | поправено в 0.69.210; `tests/ha-marketplace.cjs` |
| преводи | `strings.json` + `translations/en.json` (71 низа) + `translations/bg.json`; `en` покрива `strings` | `hassfest-local`, `ha-marketplace` |
| бранд | `icon.png` + `logo.png` в папката на интеграцията; `brand/` в хранилището | HACS action: `<Validation brands> completed` |
| `hacs.json` | `name`, `render_readme`, `homeassistant: 2024.6.0`, `content_in_root: false`, `country: ["BG"]` | `hacs-structure` (позволени ключове) |
| долна граница на HA | `2024.6.0` — точно колкото иска `entry.runtime_data`; по-ниска би била лъжа, по-висока — излишно ограничение | `tests/ha-marketplace.cjs` |

`manifest.json` днес носи **14** ключа, всички от позволените от hassfest; локалният
`hassfest-local` пази това, преди кодът да стигне до GitHub.

## 4. Какво каза валидаторът (и какво се поправи)

`hassfest` — зелено, без нито едно предупреждение за интеграцията: `application_credentials`,
`bluetooth`, `codeowners`, `conditions`, `config_schema`, `dependencies`, `dhcp`, `icons`,
`integration_info`, `integration_type`, `json`, `labs`, `lorawan`, `manifest`, `mqtt`,
`quality_scale`, `requirements`, `services`, `ssdp`, `translations`, `triggers`, `usb`,
`zeroconf`, `config_flow`.

`hacs/action` — зелено, но с едно предупреждение:

> `The integration manifest has no categories, see https://contributors.home-assistant.io/core/integrations/categories/`

Причината е измерима: в `script/hassfest/manifest.py` (home-assistant/core) `categories` е
`Optional("categories")` с 1–3 стойности, формат `^[a-z0-9_]+(\.[a-z0-9_]+)?$`. В core
интеграциите го пишат с подраздел (`"categories": ["security_safety.cameras"]`,
`"categories": ["diy_makers.web_data_connectors"]`). Затова нашият запис е
`["productivity_information.documents_photos"]` — 1 стойност, от официалния списък, с подраздел.

## 5. Какво остава (по матрицата, не по желание)

1. **`translations/de.json` липсва.** Интерфейсът на панела има DE, но преводите на
   интеграцията (HA UI: config flow, опции, сензори) са само `en` и `bg`. Hassfest не го иска,
   но за каталога е непълнота.
2. **`quality_scale` не е обявен.** Валидаторът `quality_scale` минава (ключът е по избор), но
   без него интеграцията не носи „ниво на качество“ в картата.
3. **`connectivity` не е обявен** — по избор е; при `hub` без облак не е задължителен.
4. **`armv7` е deprecated от Supervisor** — остава, докато има официален `node:22` за `arm/v7`.
5. **PR към `hacs/default`** не е отварян: изисква зелено `Validate` (днес е зелено) и е отделно
   решение, не техническа стъпка.
6. **`preview_features` / `labs`** не се ползват — няма какво да обявим.

## 6. Как се проверява

```powershell
node tests/hassfest-local.cjs      # манифест, преводи, вноси — преди GitHub
node tests/hacs-structure.cjs      # hacs.json, brand, manifest
node tests/ha-marketplace.cjs      # categories, версия, долна граница, преводи
node tests/ha-support-matrix.cjs   # add-on: ingress, портове, watchdog, map
gh run list -R PasevSU/hapi-enterprise-integration -L 5   # Validate (hassfest + HACS)
```
