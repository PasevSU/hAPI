# Състояние на изданието — hAPI Enterprise 0.69.237

Версия: **0.69.237** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **465/465** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.237 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **217** находки в 135 файла (най-много `no-empty` 93) |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 736 файла · 132853 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 729 файла · 130751 реда · critical: 0 · high: 0 · medium: 1 · low: 217 — **има необяснени** · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 465 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.237.tar.gz` | add-on архив (237 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.237.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.237.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.237

- **Проверките на панела имат журнал с едно име и една присъда.** `check-log.js` записва всяка
  проверка като `check.<име>` (затворен договор `NAMES`: `integrity`, `integrity-job`, `token`,
  `qr`, `config`, `key`) в `GET /admin/api/logs` (`ns: 'check'`, `ctx` с `op`, `ms`, `failed`,
  `portalId`), а провалът влиза и в `GET /admin/api/errors?source=check.<име>`
  (`INTEGRITY_MISMATCH`) — тоест проблем се вижда и без някой да е гледал екрана.
- **„Има ли проблем“ се решава на едно място** — `verify-verdict.js` (`verdict`, `describe`,
  `PROBLEM_KEYS`, `WARNING_KEYS`): `MISMATCH`/`MISSING`/`INVALID_TYPE`/`ERROR` са провал,
  `WRITABLE` е само предупреждение. Присъдата се дава и в отговора на проверката за цялост
  (`verdict`), за да не я смята панелът по свои ключове. Провал на проверка вече не може да
  изчезне: обработчикът на фоновата задача броеше `out.failed`/`out.ok`, каквито полета няма,
  и записваше `ok` при подмяна (DEF-94).
- **Панелът показва броя от присъдата.** Редът „Проверка на цялостта“ четеше `summary.ok`/
  `summary.mismatch` (малки букви) и пишеше „разминават се 0“ точно когато има подмяна (DEF-93);
  сега показва `verdict.failed` и боядисва изхода като грешка при `verdict.ok === false`.
- **Функциите на портала са ЕДИН обект с чекбоксове.** Единайсет функции в `ui/portal-control.js`
  (`FUNCTIONS`) — всяка с икона от йерархията на спрайта v4 (`icons-v4-map.json`), име и резервна
  икона, в четири области (сигурност · достъп · QR · конфигурация). Всеки ред носи чекбокс за
  общо изпълнение, място за състоянието (успех/грешка/в ход) и бутон, който пази СТАРИЯ
  идентификатор (`pf-integrity`, `pf-token-new`, … — нито един сценарий не се пренаписва).
  Долният колонтитул брои избраните, изпълнява ги една след друга и обобщава; грешка в една
  функция не спира останалите.
- **Текстът е на трите езика** (11 нови ключа `pc.fn.*` в `ui/i18n.js`, BG/EN/DE) — таванът на
  `ui-i18n-ratchet` за `portal-control.js` остава 0 кирилски стринга в модула.
- **Два нови теста:** `verify-verdict.cjs` (присъдата и описанието ѝ) и `ui-portal-functions.cjs`
  (обект ↔ обработчик ↔ три езика ↔ жив екран ↔ журнал ↔ изолация на грешка ↔ подмяна се вижда
  като „проблемни 1“), плюс `check-log.cjs` и `check-log-integration.cjs` за журнала от край до
  край.
- Документацията е допълнена: договорът за проверките и обектът с функциите са в
  `PORTAL_CONFIGURATION.md`, а `SYSTEM_STATE.md` носи новите числа и редовете в таблицата на
  договорите.

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
