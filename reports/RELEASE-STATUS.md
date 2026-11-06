# Състояние на изданието — hAPI Enterprise 0.69.181

Версия: **0.69.181** · клон `main`

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
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.181 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 592 файла · 105058 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 587 файла · 104120 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 367 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.181.tar.gz` | add-on архив (200 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.181.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.181.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.181

- **Линкът в картата на портала е премахнат.** Адресът се показваше като табелка в картата
  (с меню „Копирай“ / „Отвори“ / „Изтегли“) и като поле с „Копирай“ в блока — но стойността
  беше адресът на API-то (`/api/v1/p/<slug>?expires=…&sig=…`), тоест „Копирай“ даваше JSON,
  а не портала, „Отвори“ отваряше същия JSON, а „Изтегли api.json“ не сваляше файл (за частен
  портал без подпис API адресът е 404). Затова табелката, полето, „Копирай“ и „Свали api.json“
  са махнати — остава QR кодът, който е входът към портала.
- **QR кодът стои най-в дясно в блока „Достъп и QR код“** (`#pf-portal-qr` +
  `margin-inline-start: auto`): един код, 176 px, сканируем, носи адреса на страницата в
  `data-portal-url`. **Двоен клик** върху него отваря портала в СЪЩИЯ таб; **единичното**
  щракване не прави нищо — иначе човек, който само разглежда кода, излиза от панела. За
  клавиатура: Enter/Space (роля `button`, `tabindex=0`).
- Действията остават в една лента до кода: „Отвори“, „Обнови достъпа“, „Свали QR“, „Печат на
  QR“, „Отвори папката“. Бутонът и кодът викат ЕДНА функция (`openPortalPage`), тоест водят
  до един и същ адрес; единичното щракване върху кода също не навигира.
- Тестове: `portal-card-link.cjs` пази новия договор (няма `#pf-link-url`, `#pf-copy-portal`
  и `#pf-dl-api`; кодът е един и последен; двоен клик отваря портала, единичен — не);
  `files-manager.cjs` пази, че в картата няма `pf-address-*`; `gui-portal-refs.cjs`,
  `gui-open-portal-link.cjs` и `gui-csp-guard.cjs` четат адреса от `data-portal-url`;
  `ui-i18n.cjs` пази преводите BG/EN/DE (158 ключа).
- Дефектът е записан като **DEF-33** в `documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md`.

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
