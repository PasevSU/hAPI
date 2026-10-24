# Състояние на изданието — hAPI Enterprise 0.69.69

Версия: **0.69.69** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **239/239** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.69 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 396 файла · 67231 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 392 файла · 66867 реда · critical: 0 · high: 0 · medium: 3 · low: 170 — **има необяснени** |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 40 опции, 239 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.69.tar.gz` | add-on архив (159 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.69.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.69

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
