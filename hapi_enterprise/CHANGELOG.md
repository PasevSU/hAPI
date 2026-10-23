# Промени в hAPI Enterprise

Тази версия: **0.69.49**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.49

Един договор за адресите и за директорията — и един модул, който ги строи.

- **Проблемът (измерен, не предположен):** адресите се строеха на **седем места по три
  различни правила** — `portalApiUrl`/`portalLandingUrl` в `server.js`, `'/s/' + id` в
  `send.js`, HTML проектите относително и веднъж с наклон в края, веднъж без,
  `${prefix}/manifest` в `api-spec.js`, `downloadUrl` в `server.js` и `report-scope.js`, и
  три различни „базови адреса“ в панела (`portals.js`, `secret-share.js`,
  `files-manager.js`). Затова един и същ портал имаше различен запис според секцията.
- **Ново:** `hapi_enterprise/links.js` — единственото място за адреси (чист модул, работи и
  в браузър): `portalLandingPath` (`/p/<id>`), `portalApiPath` (`/api/v1/p/<slug>`),
  `portalApiFilePath`, `htmlProjectPath` (`/site/<slug>/<projectId>/`),
  `htmlProjectBasePath` (същият без наклон — за `Location`/`Cookie`), `sendPath` (`/s/<id>`),
  `secretLink` (`…/secret#<id><ключ>`), `adminApiPath`, `baseFromRequest`,
  `baseFromLocation`. Всички места в сървъра и панела вече ги ползват.
- **Поправени разминавания:** HTML проектът се връщаше относително и без наклон, а се
  сервираше с наклон; `sends` в `send.js` беше относително, а в `server.js` — абсолютно;
  `publicPortal.urls` строеше `manifest`/`openapi.json`/`qr.svg`/`package` с `+`.
- **Договор:** нов `documentation/02_TO_BE_ARCHITECTURE/LINK_AND_STORAGE_CONTRACT.md` —
  таблица на всички адреси, правилата (относителен път, id срещу slug, наклон за папка,
  базов адрес от заявка/страница) и **подредбата на DATA_DIR** (файлове, прикачени, api,
  html-projects, secrets, tsa, backups, keys, jobs, qr-records, generator) + договорът за
  криптираната връзка: целият път и ключът живеят след `#`, сървърът вижда само `sha256(id)`.
- **Тест:** `tests/links-contract.cjs` — форми и кодиране, базов адрес от заявка и от
  страница (вкл. Ingress префикс), статична забрана някой друг файл да строи тези адреси, и
  жива проверка: адресите, които сървърът връща, съвпадат с builder-а и отговарят.
