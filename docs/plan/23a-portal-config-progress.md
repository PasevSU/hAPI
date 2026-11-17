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

## Остава (в този ред)

1. **Синхронизация файл → база**: качване/триене/преместване обновяват `files[]` и вдигат
   `revision`; ръчна промяна на файла се вдига при следващия прочит (mtime + sha256).
2. **Маршрутите** (`routes/portal-config.js`): `GET/PUT …/config`, `…/config/verify`,
   `…/config/adopt`, `…/config/export.yaml`, `…/config/import`; `configHash` във всяка мутация.
3. **Панелът** (`ui/portal-control.js`): блок „Опции“ с четирите раздела + жива разпечатка на
   файла; дървото и списъкът да идват от описанието.
4. **Пълен `files[]`**: днес описанието се създава с празен списък — файловете още се броят в
   базата; запълването е стъпка 1.

## Правило, което не се разхлабва

Описанието се чете и пише САМО през `portal-config.js`. Втори четец на YAML, втори начин за
смятане на `sha256` (вместо `core.api.hash.digest`) или втори запис на файла (извън
`write()`) е регресия — пази го `portal-config-format` (обратен прочит) и `portal-config-registry`
(атомарност и чекпойнт).
