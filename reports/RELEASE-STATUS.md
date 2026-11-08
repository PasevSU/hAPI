# Състояние на изданието — hAPI Enterprise 0.69.201

Версия: **0.69.201** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **382/382** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.201 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 610 файла · 108216 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 605 файла · 107292 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 382 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.201.tar.gz` | add-on архив (201 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.201.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.201.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.201

- **Документацията в add-on пакета вече описва новата карта на портала.** `hapi_enterprise/ui/README.md`
  е част от издадения архив (201 файла) и още описваше махнатия блок „Достъп и QR код“: блок
  `data-block="link"`, `#pf-portal-qr`, `#pf-open-portal`, `#pf-refresh-access`,
  `#pf-qr-download`, `#pf-qr-print`, `#pf-open-folder`. Сега разделът „Карта на портала“ описва
  действителния код: бутон `[data-qr-portal]` в заглавния ред (последен, тоест горе вдясно),
  панелче `[data-qr-pop]` с `position: absolute; right: var(--sp-4)` и връзка
  `.pf-qr-pop-link` към публичния портал; действията са в `.pf-portal-head-actions`.
  Същото е поправено и в ръководството `documentation/08_USER_GUIDES/portals-contacts-cases.md`
  (§2а и списъкът с действия по файла). Поведение не се променя — само текстове.
- **`KNOWN_DEFECTS.md`**: добавен е DEF-45 (картата на портала — блокът е махнат, QR кодът е
  бутон и връзка), затворен при 0.69.200.

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
