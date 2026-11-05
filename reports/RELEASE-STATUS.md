# Състояние на изданието — hAPI Enterprise 0.69.162

Версия: **0.69.162** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **358/358** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.162 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 575 файла · 98432 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 570 файла · 97494 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 358 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 43 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.162.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.162.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.162.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.162

- **Нова глава 7 в ръководството: интеграцията и интерфейсът.** Дотук ръководството казваше
  как се добавя интеграцията, но не и какво точно получаваш в Home Assistant. Сега има списък
  на това, което интеграцията създава (едно устройство, 29 сензора и 3 binary сензора с обща
  снимка от координатора), полетата при добавяне (`backend_url`, `panel_url`, `token`,
  `scan_interval` 60 s, 10–86400), защо адресът за интеграцията е публичният listener 8099, а
  не ingress 8098, какво показва всяка група сензори, какво да правиш с трите binary сензора
  (`api_available`, `mirror_problem`, `public_gateway_security_alert`) — с пример за
  автоматизация — и таблица „когато нещо липсва в Home Assistant“.
- **Ръководството вече се намира отвсякъде.** `README.md` го сочи като първа връзка в
  Quick links, `BG.md` и `DE.md` — до стъпките за инсталация, а `hapi_enterprise/README.md` —
  в края, до пълната документация. Досега го имаше само в индекса на `documentation/`.
- **Поправени са лъжите в README-тата.** „7 сензора“ (реално 29 + 3 binary), „118 scenario
  files“ (реално 358 правила), „208 операции“ в OpenAPI (реално 211) и „20 сценария“ в
  `verify-release` (реално 23). Числата бяха остарели с месеци и никой не ги проверяваше.
- **Индексът на ръководството се строи от диска.** `scripts/docs-index.cjs` вече индексира
  **128** документа, включително новата глава; `tests/docs-manual.cjs` потвърждава
  „43 опции описани · 9 глави от индекса · приложенията в синхрон с кода“.

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
