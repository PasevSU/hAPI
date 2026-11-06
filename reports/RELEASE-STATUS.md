# Състояние на изданието — hAPI Enterprise 0.69.179

Версия: **0.69.179** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **367/367** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.179 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 592 файла · 104993 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 587 файла · 104055 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 367 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.179.tar.gz` | add-on архив (200 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.179.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.179.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.179

- **QR кодът в панела е ЕДИН — този на портала.** Дотук кодът се рисуваше на три места:
  в картата на портала, в „Сподели / QR“ на **всеки файл** и в менюто на **всяка папка**.
  Трите кодираха различни адреси, а двата странични не бяха годни за получател:
  - файловият код носеше подписан адрес с живот **1 час** (`ensureSigned`, `ttlSeconds: 3600`)
    или, за защитен файл, администраторски адрес, който иска вход в панела — тоест
    разпечатан, той е мъртъв или иска парола;
  - папковият код носеше JSON адреса `/api/v1/p/<slug>/tree/api.json?path=…` — точно
    адресът, който `tests/portal-chain.cjs` забранява за QR още от 0.69.106 (сървърът
    кодира `/p/<id>?folder=…`).
  Затова QR остава само в първия, винаги отворен блок „Връзка и QR код“, който носи и
  адреса, и кода, и действията по тях. Файловете и папките пазят адреса си (и `api.json`),
  но не и собствен код.
- **Панелът „Сподели / QR“ е „Сподели“.** Той дава адреса и ключа за ТОЗИ файл, а ред под
  тях казва къде е QR кодът — един, на портала. Това е и честното име.
- **Картата го казва с думи** (`portal.link.single`, BG/EN/DE): това е единственият QR
  в панела и той отваря портала заедно с папката му (`api.folderUrl`).
- Тестове: `portal-card-link.cjs` иска ТОЧНО един `.qf-svg` в картата (`#pf-portal-qr`)
  и че `qrSvg(` се среща само в `portal-control.js` (рисуване) и `files-manager.js`
  (сваляне/печат); `files-manager.cjs`, `folder-delete.cjs` и `gui-journeys.cjs` пазят
  обратното — няма `data-file-qr`/`data-folder-qr` и няма прозорец „QR · папка“.
- Дефектът е записан като **DEF-31** в `documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md`.

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S23 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
