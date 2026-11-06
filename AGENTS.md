# AGENTS.md — как се работи в това хранилище

**hAPI Enterprise** е Home Assistant add-on (Node 22+, нула runtime зависимости, `node:sqlite`)
плюс HACS интеграция. Един източник на истина за версията: `hapi_enterprise/config.yaml`.

Този файл е за агента: командите, портите и капаните, които вече са ни стрували издания.
Не е потребителска документация — тя е в `documentation/` и `README.md`.

## Команди

| Какво | Команда |
| --- | --- |
| Пълен тестов пакет | `node scripts/test-matrix.cjs --skip=release-status --attempts=1` |
| Един тест | `node tests/<име>.cjs` |
| Отчет за изданието | `node scripts/release-status.cjs` + `node tests/release-status.cjs` |
| Изграждане | `node scripts/build-release.cjs` → `node scripts/verify-release.cjs` → `node scripts/build-haoss.cjs` |
| Линт | `npx eslint hapi_enterprise tests custom_components scripts --max-warnings=0` |
| Документи | `sync-addon-changelog` · `source-inventory` · `gen-test-rules` · `docs-index` · `docs-manual` · `api-reference` · `openapi-admin` · `error-codes` · `audit-events` |

## Твърди порти (чупят изданието)

- `server.js` ≤ **2722** реда → нов код отива в `hapi_enterprise/routes/*.js`.
- Всички текстови файлове са **LF**; един CRLF чупи S08/S22.
- `dist/` съдържа точно 6 файла; `verify-release` трябва да е **22/22**.
- `release-status` иска зелен матрикс и **368** теста в дървото.
- `tests/known-defects.cjs`: затворен ред сочи съществуващ `.js`/`.cjs`, заглавието носи текущата версия.
- `ui-version`, `addon-changelog`, `docs-index`, `scenario-matrix`, `ui-css-split` — виж `tests/`.

## Карта на кода

- `hapi_enterprise/server.js` — HTTP диспечер и админ API; не расте (бюджет на редовете).
- `hapi_enterprise/routes/` — извадени договори: `folders.js` (дърво на папките), `file-transfer.js`,
  `portal-qr.js`, `portal-storage.js`, `portal-tokens.js`, `portal-archive.js`, `reports.js`, `webhooks.js`.
- `hapi_enterprise/ui/` — панелът: `files-manager.js` (оркестратор), `portal-control.js`
  (карта „Достъп и QR код“), `portal-folders.js` (дърво), `portal-files.js` (списък), `i18n.js` (BG/EN/DE).
- `hapi_enterprise/portal/` — публичната страница: `portal.html`, `portal.js`, `portal-i18n.js`, `portal.css`.
- `tests/` — един файл = едно правило; `tests/lib/gui-harness.cjs` пуска реален сървър + DOM.

## Капани

- PowerShell мачка backtick и `\u` в `node -e` → пиши временен `.cjs` в `reports/` и го трий.
- `Add-Content` и here-strings дават CRLF → нормализирай с node преди `build-release`.
- Форматер, който маха интервала около `>` в CSS, чупи exact-string тестове (затова `.vscode/settings.json`
  изключва format on save).
- Тестовете оставят папки в `%TEMP%`; матрицата вече ги чисти сама след серията.
- Браузърните инструменти не стигат до `127.0.0.1` → ползвай `gui-harness`, не Playwright.
- `--only` не пише `reports/test-matrix.json` (пази пълния отчет за `release-status`).

## Правило за промяна

1. Промяна в код → тест, който би паднал без нея.
2. Версия: `hapi_enterprise/config.yaml` + огледалата (`manifest.json`, `package.json`, `ui/data.js`,
   `README.md`, `BG.md`, `DE.md`, `hapi_enterprise/README.md`, заглавие на `KNOWN_DEFECTS.md`).
3. `CHANGELOG.md` (BG) + ред в `KNOWN_DEFECTS.md`, ако се затваря дефект.
4. Генератори → build → verify → матрикс → release-status → eslint → commit + `git tag -a vX.Y.Z`.
