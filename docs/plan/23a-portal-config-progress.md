# Портално описание `configuration.yaml` — състояние на изпълнението

> Жива бележка към плана. Обновява се при всяка стъпка; кодът е истината, тук е редът.

## Готово

| Стъпка | Къде | Гейт |
| --- | --- | --- |
| Договор на файла: четец/запис на подмножеството, проверка, ефективни стойности, атомарен запис с `revision`, чекпойнт по `hash`, сверка с диска, разлика по ключ | `hapi_enterprise/portal-config.js` | `portal-config-format`, `portal-config-files`, `portal-config-registry` |
| Всяка папка на портал получава своето `configuration.yaml` с пълните подразбирания; не се презаписва; не е съдържание; артефактите се трият, описанието — не | `hapi_enterprise/portal-folder.js` (`ensure`, `ARTIFACTS`, `DESCRIPTION`) | `portal-config-seed`, `file-placement`, `folder-delete` |
| Модулът е в пакета и в сверката за цялост | `Dockerfile`, `integrity.js` (19 критични файла) | `docker-runtime`, `integrity-startup` |
| Място за новите модули в инвентара (272 → 253 реда) | `scripts/source-inventory.cjs` | `source-inventory`, `docs-size` |
| Пътища: домашна папка `<корен>/hAPI` (`paths.hapiHome`), портали в `<корен>/hAPI/portals/<slug>` (`paths.portalsRoot`/`portalRootFor`), вътрешни данни в `hAPI/data`; две стари места в preflight-а с `STORAGE_LEGACY_LOCATION` | `hapi_enterprise/paths.js`, `storage-preflight.js` | `storage-roots` §5д, `storage-default-location`, `portal-storage-fixed`, `oracle-lifecycle`, `layout` |
| Синхронизация файл → база: `portal.*` и `files[]` се сглобяват от записа при всяко `writeArtifacts` (качване, триене, местене, възстановяване); настройките от човек оцеляват; ревизия само при истинска промяна; счупен файл не се презаписва | `portal-folder.js` (`syncConfig`, `describePortal`, `describeFiles`) | `portal-config-sync`, `portal-config-seed`, `portal-config-format` §1б |
| **Плосък YAML с `id` и `off:`** (новите правила на план 26): опциите са имена, не групи; всяка присъства винаги; `off:` изключва без загуба; идентификатор `{{portal}}-{{portal_name}}-001` (кирилица → латиница, номерът не се преизползва); старият групиран файл се превежда при четене и се записва плоско | `portal-config.js` (`DEFAULTS`, `OPTION_KEYS`, `machineName`, `makeId`, `nextNumber`, `isOff`, `migrate`) | `portal-config-format`, `portal-config-ids` |
| **Общите форми са на едно място** — `SLUG`/`SHA256`/`FILE_ID`/`CONTENT_ID`/`ID_FIELD`/`ISO` се взимат от `portal-config.RULES`, а `portal-folder.js` вече не държи свой комплект | `portal-config.js`, `portal-folder.js` | `portal-config-ids`, `portal-config-files` |
| **Маршрутите** (`routes/portal-config.js`): `GET/PUT …/config`, `…/config/verify`, `…/config/adopt`, `…/config/export.yaml`, `…/config/import` (+`?dry=1`); чекпойнт в `expectHash`/`If-Match`, `409` с текущия хеш и разлика, `422` с `issues`; `PUT`/`import`/`adopt` внасят опциите в записа (файл → база) | `routes/portal-config.js`, `server.js` (един ред в диспечера) | `portal-config-api`, `server-structure`, `file-placement` |
| **Панелът**: блок „Опции“ в контролния панел — четирите раздела (Портал · Достъп · QR · Интерфейс), запис през `PUT` с чекпойнт, „Провери папката“ и разпечатка на САМИЯ файл; стойностите са ефективните, не само записаните | `ui/portal-control.js`, `ui/files-manager.js` (`loadConfig`, `saveConfig`, `verifyConfig`, `showConfigFile`), `ui/i18n.js` | `portal-config-ui`, `ui-i18n-ratchet`, `gui-file-share` |
| Началният файл носи ТЕКУЩИТЕ опции на портала (видимост, флаг, тема), не само подразбиранията | `portal-folder.js` (`ensure` + `describePortal`) | `portal-config-ui`, `portal-config-seed` |

## Остава (в този ред)

1. **`files[]` за файлове, добавени НАПРАВО в папката** (без качване през панела). Днес `verify`
   ги показва като „излишни“, а панелът — като брой. Съзнателно НЕ се внасят сами в базата:
   регистрирането на чуждо съдържание без избран режим на достъп би дало на портала файл, за
   който никой не е решил дали се вижда. Следващото действие е изричен бутон „приеми
   излишните“ (файл → запис, с одит), а не тихо внасяне.
2. **`configHash` във всяка друга мутация** (качване/триене/местване/достъп на файл). Маршрутите
   на описанието вече го връщат; останалите отговори още не. Дотогава панелът презарежда
   описанието при `force` четене на дървото (виж `loadTree`), тоест чекпойнтът не остава стар.

## Правило, което не се разхлабва

Описанието се чете и пише САМО през `portal-config.js`, а HTTP входът е САМО
`routes/portal-config.js`. Втори четец на YAML, втори начин за смятане на `sha256` (вместо
`core.api.hash.digest`) или втори запис на файла (извън `write()`) е регресия — пази го
`portal-config-format` (обратен прочит), `portal-config-registry` (атомарност и чекпойнт) и
`portal-config-api` (единственият маршрут).
