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

- `server.js` ≤ **2722** реда (днес **2719** — 3 реда до портата) → нов код отива в
  `hapi_enterprise/routes/*.js`.
- Всички текстови файлове са **LF**; един CRLF чупи S08/S22.
- `dist/` съдържа точно 6 файла; `verify-release` трябва да е **22/22** (S20 е само с `--with-tests`).
- `release-status` иска зелен матрикс и **370** теста в дървото.
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

## Локална среда (тази машина, проверено 2026-11-07)

- Node е **v26.13.0**, а изданието/CI са на **Node 22.23.2**. Тестовете минават и на двете, но
  преди издание пусни поне `tests/smoke.cjs` и `verify-release` на Node 22 (`npx -y node@22 …`).
- `verify-release` S06 търси `python3`/`python` в PATH. Тук Python е в `.venv`, затова:
  `$env:PATH = "$PWD\.venv\Scripts;$env:PATH"` преди verify.
- Ограниченият файлов сандбокс не пуска дъщерни процеси с piped stdio (`spawnSync` с
  `encoding`) → `test-matrix`, `verify-release` (S05/S19) и build падат с EPERM. За тях искай
  еднократно `sandbox_permissions: danger-full-access` с обосновка. `write`/`edit` работят и в
  ограничен режим.
- След поправка на правата (2026-11-07) ограничените команди пишат в `reports/`, `dist/`, `.git`.
  Изключение: ~2 047 файла със собственик `BUILTIN\Administrators` не приемат Low integrity
  етикет — тях ги пиши с `write`/`edit`, не през shell. Възстановяване на правата:
  `D:\hAPI-acl-recovery\` (DACL) и `icacls D:\hAPI /setintegritylevel M /t` (етикети).
- `origin/main` изостава от локалния `main`; виж `dev/PROJECT-ANALYSIS-2026-11-07.md` (R1)
  преди `git push` — историята е разклонена.

## Капани

- PowerShell мачка backtick и `\u` в `node -e` → пиши временен `.cjs` в `reports/` и го трий.
- `Add-Content` и here-strings дават CRLF → нормализирай с node преди `build-release`.
- Форматер, който маха интервала около `>` в CSS, чупи exact-string тестове (затова `.vscode/settings.json`
  изключва format on save).
- Тестовете оставят папки в `%TEMP%`; матрицата вече ги чисти сама след серията.
- Браузърните инструменти не стигат до `127.0.0.1` → ползвай `gui-harness`, не Playwright.
- `--only` не пише `reports/test-matrix.json` (пази пълния отчет за `release-status`).
- **Таймер, който държи процеса.** `setTimeout(() => URL.revokeObjectURL(...), 60000)` в панела
  не пуска Node да излезе след последното твърдение: `gui-file-share` става 62 s вместо 2 s,
  `gui-journeys` 112 s вместо 20 s, матрицата — 490 s вместо 338 s (и `J53` флейква по 45 s).
  Минавай през `revokeLater(url, ms)` в `files-manager.js`, който прави `timer.unref?.()`.
- **Скрити input-и не живеят в сгъваемо тяло.** При акордеон тялото изчезва от документа и
  бутонът остава без input (тъкмо това чупеше „цяла папка“). `fm-file-input`/`fm-dir-input`
  стоят в `portalDetail()`, извън трите блока.
- **Акордеон в тестовете.** `expandPortalBlocks(host, { block: 'folders' | 'control' | 'files' })`
  иска КОЙ блок; „разгъни всички“ вече не съществува. `openBlock(name)` в `gui-journeys`
  твърди, че другите два са `aria-expanded="false"`.
- **Токенът не влиза в адрес.** Живият поток НЕ приема `?token=` (401 дори с верния токен) —
  `EventSource` носи еднократен билет от `POST /admin/api/events/ticket` (30 s, изразходва се).
  Тест: `tests/sse-ticket.cjs`. Ако добавяш нов поток, искай билет, не ключ.
- **`aria-controls` само в разгънато състояние.** Сгънатият блок не носи препратка, защото
  тялото му не е в документа (`tests/ui-block-aria.cjs`).
- **Езиковият дълг има таван.** `tests/ui-i18n-ratchet.cjs` мери българските стрингове по
  модули; нов UI модул без ред в таблицата му пада, а таванът само се сваля (DEF-49).

## Правило за промяна

1. Промяна в код → тест, който би паднал без нея.
2. Версия: `hapi_enterprise/config.yaml` + огледалата (`manifest.json`, `package.json`, `ui/data.js`,
   `README.md`, `BG.md`, `DE.md`, `hapi_enterprise/README.md`, заглавие на `KNOWN_DEFECTS.md`).
3. `CHANGELOG.md` (BG) + ред в `KNOWN_DEFECTS.md`, ако се затваря дефект.
4. Генератори → build → verify → матрикс → release-status → eslint → commit + `git tag -a vX.Y.Z`.
