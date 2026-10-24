# Промени в hAPI Enterprise

Тази версия: **0.69.69**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.69

Издание с една промяна в подредбата: целият публичен портал (страница, скрипт, стилове и речник)
вече живее в собствена папка, за да може видът и опциите му да се сменят, без да се пипа
останалият код на add-on-а.

- **`hapi_enterprise/portal/`** — четирите файла на портала (`portal.html`, `portal.js`,
  `portal.css`, `portal-i18n.js`) излизат от корена на add-on-а и заживяват заедно.
  Причината е практическа: още не е решено какви опции трябва да има порталът и как точно да
  изглежда, а така промяната е в една папка, а не из целия код.
- **Адресите не се променят.** `server.js` чете файловете от `portal/`, но маршрутите остават
  същите (`/p/<id>`, `/portal.html`, `/portal.js`, `/portal.css`, `/portal-i18n.js`) — стари
  QR кодове, отметки и линкове продължават да работят.
- **Dockerfile:** порталът има собствен `COPY portal /app/portal/` вместо да е ред в общия
  списък — така се вижда, че това е отделна част от add-on-а.
- **Проверките са обновени:** `build-release` и `verify-release` (вкл. S12) сочат
  `portal/portal.*`, `tests/portal-page.cjs`, `tests/portal-i18n.cjs`, `tests/layout.cjs`,
  `tests/docker-runtime.cjs` и `tests/ha-compatibility.cjs` (HA-I05) четат новите пътища,
  `eslint.config.mjs` дава browser-среди за `portal/**/*.js`, а
  `documentation/01_AS_IS_ARCHITECTURE/STORAGE_LAYOUT.md` показва `/app/portal/portal.html`.
- **Тестове:** 238 тестови файла в матрицата (239 с `release-status`), 100 % успех.
