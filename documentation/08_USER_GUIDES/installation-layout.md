# Инсталация: коя папка къде отива

Този документ отговаря на въпроса, който най-често обърква: **след като инсталирам hAPI, кой
файл къде стои** — на домакина (Home Assistant / Windows) и какво вижда add-on-ът отвътре.
Всяко твърдение е проверяемо от `hapi_enterprise/config.yaml` (`map:`), `storage-preflight.js`,
`evidence-portal.js` и `tests/sync-local-addon.ps1` — с връзки по-долу.

> **Най-важният капан:** `/config` значи **две различни неща**. В Home Assistant (Samba, File
> editor, SSH) `/config` е конфигурацията на HA. В контейнера на add-on-а `/config` е **собствената**
> папка на add-on-а (`app_config`), а конфигурацията на HA е на `/homeassistant`. Ако сложиш ключ
> „в `/config`“, без да знаеш кой `/config` е, файлът може да отиде на съвсем друго място.

## 1. Двата свята

| Какво                                                                               | На домакина (както го виждаш в HA/Samba/File editor)                  | В контейнера на add-on-а |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------ |
| Конфигурация на Home Assistant (`configuration.yaml`, `www/`, `custom_components/`) | `/config`                                                             | **`/homeassistant`**     |
| Собствена папка на add-on-а (app_config)                                            | `/addons/hapi_enterprise/config` на хоста или `addon_configs/<slug>/` | **`/config`**            |
| Данни на add-on-а (база, файлове, одит, ключове за API)                             | вътрешна за add-on-а (Supervisor я пази)                              | **`/data`** (`DATA_DIR`) |
| Споделена папка                                                                     | `/share`                                                              | `/share`                 |
| Медия                                                                               | `/media`                                                              | `/media`                 |
| Сертификати                                                                         | `/ssl` (само за четене)                                               | `/ssl`                   |

Тези мапинги са в `hapi_enterprise/config.yaml`:

```yaml
map:
  - app_config:rw            # → /config   (собствена папка на add-on-а)
  - homeassistant_config:rw  # → /homeassistant (конфигурацията на HA)
  - media:rw                 # → /media
  - share:rw                 # → /share
  - ssl                      # → /ssl (read-only)
```

## 2. Къде отива кодът

### 2.1 Интеграция (HACS или ръчно)

| От хранилището                       | Къде отива при инсталация                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom_components/hapi_enterprise/` | `<HA config>/custom_components/hapi_enterprise/` — папката **трябва** да се казва точно `hapi_enterprise` (равна на `domain` в `manifest.json`), иначе HA я игнорира без съобщение |

### 2.2 Add-on от GitHub (Supervisor)

Supervisor строи образа от това хранилище; нищо не се копира ръчно. Вътре в контейнера:

| От хранилището                                                                                 | Къде отива в образа                                                     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `hapi_enterprise/*.js`, `ui/`, `routes/`, `evidence-portal/`, `fonts/`, `rules/`, `generator/` | `/app/…` (работна директория на процеса)                                |
| `hapi_enterprise/config.yaml`                                                                  | `/app/config.yaml` (опциите идват от Supervisor в `/data/options.json`) |

### 2.3 Add-on от локално копие (разработка)

```powershell
npm run sync:local    # = pwsh -NoProfile -File scripts/sync-local-addon.ps1
```

| Източник                             | Цел на хоста                                    |
| ------------------------------------ | ----------------------------------------------- |
| `hapi_enterprise/`                   | `/addons/hapi_enterprise`                       |
| `custom_components/hapi_enterprise/` | `<HA config>/custom_components/hapi_enterprise` |

Скриптът работи с `robocopy /MIR` и **отказва да приключи**, ако структурата е счупена
(липсващ ключ в `config.yaml`, липсващ `COPY` източник в `Dockerfile`, грешен `domain`).
След синхронизация: **Settings → Add-ons → ⋮ → Check for updates → Rebuild**.

### 2.4 Windows (самостоятелна среда)

| Какво                            | Къде                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| Данни и локален admin токен      | `%LOCALAPPDATA%\hAPI_enterprise\`                                    |
| Интерфейс от диска (без backend) | `START_HAPI_GUI.bat`                                                 |
| Backend + админ конзола          | `node hapi_enterprise\standalone.js` → `http://127.0.0.1:8098/admin` |

Инсталаторът и портативният ZIP са **отделна дистрибуция** и не са в това хранилище.

## 3. Къде отиват данните (най-важната таблица)

`DATA_DIR` е `/data` в add-on-а и `%LOCALAPPDATA%\hAPI_enterprise` в Windows. Вътре:

| Път в `DATA_DIR`                                               | Какво има                                              | Кой го създава                |
| -------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `db.json` (или SQLite файл, ако е избран)                      | портали, файлове, метаданни, ключове за API            | `core-store` / `sqlite-store` |
| `files/<portalId>/<fileId>`                                    | **байтовете** на качените файлове (защитено хранилище) | качване                       |
| `internal/<portalId>/<fileId>/…`                               | версии, вътрешни артефакти                             | версиониране                  |
| `api/<slug>/api.json`, `openapi.json`, `qr.svg`, `portal.html` | публикуваното API и страницата на портала              | `api-registry`                |
| `audit-chain.jsonl`                                            | hash-chained одит                                      | одит                          |
| `secrets/…`                                                    | пликове на тайните връзки (`/secret#…`)                | `secret-links`                |
| `sensors.json`, `jobs/`, `errors.jsonl`, `backups/`            | телеметрия, задачи, грешки, резервни копия             | съответните модули            |

### Работната папка (там, където работиш с файловете)

Зависи от `storage_location` (по подразбиране `addon_config`):

| `storage_location`               | Корен в контейнера | Какво виждаш на домакина      |
| -------------------------------- | ------------------ | ----------------------------- |
| `addon_config` (по подразбиране) | `/config`          | собствената папка на add-on-а |
| `media`                          | `/media`           | `/media` на HA                |
| `share`                          | `/share`           | `/share` на HA (Samba)        |

Всеки портал получава **своя** папка `<корен>/<slug>` (напр. `/share/<slug>`). Там стоят
файловете с оригиналните им имена — това е „работната папка на портала“. Пълната карта и
правилата (миграция от общ `/share`, изключване на шифрованите файлове) са в
[`STORAGE_LAYOUT.md`](../01_AS_IS_ARCHITECTURE/STORAGE_LAYOUT.md); защитата на тази папка е в
[`PGP_KEYRING_AND_WORK_FOLDER.md`](../02_TO_BE_ARCHITECTURE/PGP_KEYRING_AND_WORK_FOLDER.md).

## 4. Къде отиват ключовете (PGP)

| Какво виждаш в HA                        | В контейнера                            | Защо там                                                     |
| ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| `<HA config>/_openpgpV6/public.asc`      | `/homeassistant/_openpgpV6/public.asc`  | ключът трябва да е достъпен за add-on-а, но извън `DATA_DIR` |
| `<HA config>/_openpgpV6/private.asc`     | `/homeassistant/_openpgpV6/private.asc` | същото; права `600`                                          |
| `<HA config>/_openpgpV6/.env` (по избор) | `/homeassistant/_openpgpV6/.env`        | паролата, ако не е зададена като опция                       |

**Не** слагай ключовете в `/config/_openpgpV6` в контейнера, освен ако наистина искаш те да са в
собствената папка на add-on-а (там `/config` = `app_config`, не HA конфигурацията). Пътищата се
задават **изрично** (виж §4.1) — файлът може да се казва `secret.asc` или `private.asc`, важното е
пътят да сочи към него.

Подробности, роли и `.env.example`: [`PGP_KEYRING_AND_WORK_FOLDER.md`](../02_TO_BE_ARCHITECTURE/PGP_KEYRING_AND_WORK_FOLDER.md)
и практическото ръководство [`pgp-keys-setup.md`](pgp-keys-setup.md).

### 4.1 Задължителни полета при старт (стандартни настройки)

Когато API-то се изгражда при инсталация, тези четири стойности са **част от конфигурацията на
add-on-а**, а не „по-късно от панела“. Стандартните имена (същите, които ползваш в
`secrets.yaml`) и какво точно съдържат:

| `!secret` име          | Какво съдържа стойността                       | Опция на add-on-а (ключ) | Пример (път в контейнера) |
| ---------------------- | ---------------------------------------------- | ------------------------ | ------------------------- |
| `hapi_token`           | админ токенът (стойност, ≥ 24 знака)           | `token`                  | — (стойност, не път) |
| `hapi_pgp_path_public` | **пълен път** до публичния ключ                | `pgp_path_public`        | `/homeassistant/_openpgpV6/public.asc` |
| `hapi_pgp_path_secret` | **пълен път** до частния ключ                  | `pgp_path_secret`        | `/homeassistant/_openpgpV6/secret.asc` |
| `hapi_pgp_path_pass`   | **пълен път** до файла с паролата (`.env`)     | `pgp_path_pass`          | `/homeassistant/_openpgpV6/.env` |

Три неща, които измерването налага да се кажат точно:

1. **`!secret` не се разширява в опциите на add-on-а.** Home Assistant замества `!secret` само в
   YAML, който сам зарежда. Затова имената горе са **стандарт за именуване** (за твои YAML
   файлове и за справка), а в Configuration на add-on-а влизат **стойностите**. Ако въведеш
   буквално `!secret hapi_token` в поле на add-on-а, то ще бъде отхвърлено като слаб токен.
2. **`hapi_pgp_path_pass` сочи към `.env`, не към `.env.example`.** Примерният файл е шаблон с
   празна стойност; ако сочиш към него, паролата е празна и стартът трябва да откаже
   (`PASSPHRASE_REQUIRED`), вместо да „работи“ с празна парола.
3. **Пътищата са абсолютни и от гледна точка на контейнера.** `config/_openpgpV6/secret.asc`
   (относително) е двусмислено: работната директория на процеса е `/app`, а `/config` в
   контейнера е папката на add-on-а, не HA конфигурацията.

**Какво прави стартът днес (измерено в `hapi_enterprise/start.js`):** ако `token` липсва или е
слаб (< 24 знака, стойност-заглушка, очевиден шаблон), той **генерира** случаен токен и го пази в
`/data/admin-token` с права `0600`. Тоест токенът **не е** задължително поле днес.

**Целево (⏳ 0.69.67):** четирите полета стават задължителни при старт и add-on-ът **отказва да
стартира** с точно съобщение кое липсва — без генериране и без подразбиране:

| Липсва / невалидно | Поведение (целево) |
| ------------------ | ------------------ |
| `token` липсва или < 24 знака | отказ: `ADMIN_TOKEN_REQUIRED` |
| `pgp_path_public` липсва или файлът го няма | отказ: `PGP_PUBLIC_KEY_REQUIRED` |
| `pgp_path_secret` липсва, но `pgp_encrypt_*` е включено | отказ: `PGP_SECRET_KEY_REQUIRED` |
| `pgp_path_pass` сочи липсващ файл или `.env.example` | отказ: `PGP_PASSPHRASE_REQUIRED` |
| ключът е с Argon2 или неподдържана крива | отказ: `S2K_ARGON2_UNSUPPORTED` / `UNSUPPORTED_CURVE` |

## 5. Къде отива порталът, който показва файловете и данните

Има **три** различни страници и лесно се бъркат. Пълното описание е в
[`EVIDENCE_VIEW_PORTAL.md`](../04_FUNCTION_SPECIFICATIONS/EVIDENCE_VIEW_PORTAL.md); ето къде
стоят файловете им:

| Страница                                     | Файлове                                                           | Къде стоят                                                                 | Адрес                                              |
| -------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Портален изглед на add-on-а                  | `hapi_enterprise/portal.html` + `portal.js` + `ui/portal-i18n.js` | `/app/…` в образа                                                          | `/p/<slug>` (данни от `/api/v1/p/<slug>/api.json`) |
| Страница на папката на портала               | генерира се                                                       | `DATA_DIR/api/<slug>/portal.html`                                          | `/portal.html?folder=<slug>`                       |
| **Evidence View** (QR портал, самостоятелен) | `hapi_enterprise/evidence-portal/**`                              | копира се в `<HA config>/www/hapi/data/` = `/homeassistant/www/hapi/data/` | `/local/hapi/data/portal.html?folder=<slug>`       |

Evidence View се публикува, защото Home Assistant сервира **само** `<HA config>/www` на
`/local/…`. Затова add-on-ът копира пакета там при старт (опция `evidence_portal_deploy: true`)
и има административни маршрути `GET /admin/api/evidence-portal/status` и
`POST /admin/api/evidence-portal/deploy`. Ръчното копиране не е нужно и се отказва, ако целта е
симлинк — иначе „публикуването“ може да пише извън `www`.

## 6. Какво НЕ се копира и защо

| Нещо                                            | Защо                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tests/`, `scripts/`, `documentation/`, `dist/` | не участват в работата на add-on-а; влизат само в изданието/хранилището                                         |
| `node_modules`                                  | hAPI няма runtime зависимости                                                                                   |
| `hapi_enterprise/CHANGELOG.md`                  | генерира се от коренния `CHANGELOG.md` (`node scripts/sync-addon-changelog.cjs`) — ръчна редакция се презаписва |
| Частни ключове                                  | никога не влизат в образа или в хранилището; `.gitignore` блокира `**/private.asc`, `*.pem`, `*.key`            |

## 7. Проверка след инсталация

| Проверка                      | Как                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Интеграцията е заредена       | Settings → Devices & Services → hAPI Enterprise; 7+ сензора                                                                                          |
| Add-on-ът работи              | Ingress панелът се отваря; `GET /health` → 200                                                                                                       |
| Данните са на мястото си      | `GET /admin/api/diagnostics` → `layout.entries` показва `data`, `files`, `internal`, `api`, `portal-folder`, `evidence-portal` с `exists`/`writable` |
| Порталът на папката се отваря | `/portal.html?folder=<slug>` (личен портал → 404, това е правилното поведение)                                                                       |
| Evidence View е публикуван    | `GET /admin/api/evidence-portal/status` → целта и хешовете; отваря се на `/local/hapi/data/portal.html?folder=<slug>`                                |
| Ключовете са намерени         | `GET /admin/api/pgp/keyring` → `available: true` (⏳ 0.69.67)                                                                                         |

Ако нещо липсва, `layout` казва **кое** и **дали е записваемо** — вместо да се гадае.

## 8. Свързани документи

- [`STORAGE_LAYOUT.md`](../01_AS_IS_ARCHITECTURE/STORAGE_LAYOUT.md) — картата на местата и адресите.
- [`EVIDENCE_VIEW_PORTAL.md`](../04_FUNCTION_SPECIFICATIONS/EVIDENCE_VIEW_PORTAL.md) — порталът, който показва файловете и данните.
- [`PGP_KEYRING_AND_WORK_FOLDER.md`](../02_TO_BE_ARCHITECTURE/PGP_KEYRING_AND_WORK_FOLDER.md) — ключове и криптиране.
- [`install-hacs.md`](install-hacs.md) — инсталация през HACS.
- [`public-gateway-setup.md`](public-gateway-setup.md) — публичен адрес, reverse proxy.
