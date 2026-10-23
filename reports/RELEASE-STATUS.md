# Състояние на изданието — hAPI Enterprise 0.69.49

Версия: **0.69.49** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **219/219** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.49 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 359 файла · 59867 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 355 файла · 59503 реда · critical: 0 · high: 0 · medium: 0 · low: 158 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 219 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.49.tar.gz` | add-on архив (146 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.49.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.49

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

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S21 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
