# Changelog — hAPI Enterprise

Всички забележими промени в add-on-а (`hapi_enterprise`) и в custom интеграцията
(`custom_components/hapi_enterprise`). Версията има един източник на истина —
`hapi_enterprise/config.yaml`; `manifest.json` трябва да носи същата стойност.

## 0.54.0 — 2026-10-21

Порталната страница през интеграцията е същата адаптивна страница като в add-on-а.

- `custom_components/hapi_enterprise/portal.html|portal.js|portal.css` са подменени с
  адаптивната версия: текстовете зависят от артефактите („Документи“ / „Снимки“ /
  „Документи и снимки“ / „Файлове“), правилни числителни форми, търсене само при повече
  от 3 файла, SHA-256 с копиране, изтегляне с ключ (`X-File-Key`), QR панел.
- Заявките минават през fail-closed моста на интеграцията
  (`/api/hapi_enterprise/v1/p/<id>`); ключът за достъп се държи **само във фрагмента**
  (`#token=…`) и се праща като `X-Portal-Key` — не като query параметър.
- Мостът вече разрешава и `qr.svg`, за да показва страницата своя QR код.
- `tests/ha-integration-flow.cjs` пази тези инварианти (адаптивни маркери, фрагмент-токен,
  разрешен `qr.svg`, без `innerHTML` за данните).

## 0.53.1 — 2026-10-21

Поправка в UI настройката на интеграцията.

- Смяната на опциите (адрес, токен, интервал) вече се прилага **веднага** —
  `entry.add_update_listener(async_update_entry)` е регистриран в `async_setup_entry` и се
  отписва при unload. Преди промяната `async_update_entry` съществуваше, но никога не се
  извикваше, т.е. опциите влизаха в сила само след преинсталиране на интеграцията.
- `tests/ha-integration-flow.cjs` пази това: изисква listener-а и отписването му.

## 0.53.0 — 2026-10-21

Пълният набор функции на интеграцията от `PasevSU/hAPI` (portal_enterprise) е пренесен
в `custom_components/hapi_enterprise`, без да се маха нищо от тази версия.

- **UI настройка**: `config_flow.py` с config и options flow (адрес, административен токен,
  интервал на обновяване); уникален запис по адрес, валидация на URL, дължина на токена
  (24–512) и интервал (10–86400 s).
- **Телеметрия**: `coordinator.py` пита `/admin/api/sensors` с Bearer токен и превежда
  camelCase полетата на add-on-а (`fileBytes`, `databaseBytes`, `telemetryBytes`) към
  ключовете на сензорите; `sensor.py` създава 7 сензора (посещения, изтегляния, файлове,
  портали, място за файлове, размер на базата, размер на телеметрията).
- **Преводи**: `strings.json` + `translations/en.json` и `translations/bg.json`.
- `manifest.json`: `config_flow: true`, `iot_class: local_polling`.
- `async_setup` вече не блокира UI настройката, когато няма `backend_url` в YAML; порталната
  страница и активите (`/api/hapi_enterprise/portal/<id>`, `/api/hapi_enterprise/assets/*`)
  се регистрират винаги.
- Нови тестове: `tests/ha-integration-flow.cjs` (договор между const/coordinator/sensor/
  преводи/манифест) и разширени `tests/hacs-structure.cjs` + сценарии S06/S07 в
  `scripts/verify-release.cjs` (всички Python модули, config flow в архива).

## 0.52.1 — 2026-10-21

Инсталиране през HACS.

- `hacs.json` в корена на хранилището (`content_in_root: false`, `homeassistant: 2024.6.0`,
  `domains: [hapi_enterprise]`), така че хранилището се добавя като custom repository в HACS.
- Brand изображения в `custom_components/hapi_enterprise/brand/` (icon/logo) — новото място,
  което Home Assistant и HACS очакват; старите копия до `manifest.json` остават за съвместимост.
- `manifest.json`: `codeowners: ["@PasevSU"]`, `documentation` и `issue_tracker` сочат
  GitHub хранилището, добавени `after_dependencies` и `loggers`.
- GitHub Actions `HACS validation` (`hacs/action`, category `integration`) + локален тест
  `tests/hacs-structure.cjs`; нов сценарий S21 в `scripts/verify-release.cjs`.
- Кешовете на Python (`__pycache__`, `*.pyc`) се изключват от изданието и се проверяват.

## 0.52.0 — 2026-10-21

Издание с изцяло автоматизиран build и проверка.

**Публичен портал**

- Публичната страница и QR кодът се адресират с **id на портала** (`/p/<id>`), не с име;
  `/p/<slug>` и `/api/v1/p/<slug>` продължават да работят (`resolvePortal`).
- Текстовете на страницата се променят според артефактите в портала: „Документи“,
  „Снимки“, „Документи и снимки“ или „Файлове“; правилни числителни форми
  („1 документ“, „5 снимки“), търсене само при повече от 3 артефакта, бележки под QR
  кода само за наличните функции (SHA-256, ключ, спряно изтегляне).
- Празен портал показва „Съдържание“ и „издателят още не е публикувал файлове“.

**Публични адреси**

- Опцията `public_domain` на add-on-а се подава като `PUBLIC_BASE_URL` (чрез `run.sh`),
  така че QR кодът и адресите от административния панел сочат външния домейн, дори
  когато панелът се отваря по вътрешния адрес.
- Невалиден публичен адрес се игнорира (пада към адреса на заявката) — както за
  настройката `limits.publicBaseUrl`, така и за средата.
- QR прозорецът в панела предупреждава, когато адресът е вътрешен (LAN/localhost).

**Издание и проверка**

- `scripts/build-release.cjs` строи `dist/`: add-on `tar.gz`, интеграция `zip`,
  `repository.yaml`, `RELEASE.json` (с хеш на всеки файл) и `SHA256SUMS.txt`, без
  външни зависимости.
- `scripts/verify-release.cjs` проверява 19 сценария: версия, add-on схема, файлове,
  Dockerfile, JS/Python синтаксис, манифест на интеграцията, двата архива, манифеста
  на изданието, тайни, портални активи, `run.sh`, опции↔схема, `repository.yaml`,
  документация, хигиена на архива, четене със системен `tar` и (по избор) целия
  тестов набор.
- GitHub Actions `release.yml` строи и проверява изданието при таг `v*` и качва
  артефактите.

## 0.51.0 — 2026-10-20

- Пълен пакет хешове за файловете (sha256/sha512/sha384/sha3-256/sha1/md5) в API, в
  интерфейса и в ZIP пакета (`hashes/sha256sum.txt`, `hashes/checksums.txt`).
- Единна SVG икона система в интерфейса вместо емоджита; заключване/видимост и
  контекстно меню на файловете.

## 0.50.0 — 2026-10-19

- Публична страница на портала (`/p/<slug>`), QR код към нея, контакт на издателя,
  търсене и изтегляне с ключ (`X-File-Key`).
