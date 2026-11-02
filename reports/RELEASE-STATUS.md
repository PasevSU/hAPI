# Състояние на изданието — hAPI Enterprise 0.69.110

Версия: **0.69.110** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **330/330** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.110 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 532 файла · 89170 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 527 файла · 88580 реда · critical: 0 · high: 0 · medium: 0 · low: 197 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 330 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.110.tar.gz` | add-on архив (192 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.110.zip` | интеграция за HACS (24 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.110.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.110

- **Планът на Evidence View не изреждаше файл, който се публикува.** `evidence-portal.js`
  качва в `<HA>/www/hapi/data/` и `data/demo-evidence.json` — файлът, който `assets/app.js`
  РЕАЛНО тегли при `folder=demo-evidence`, — а `EVIDENCE_VIEW_PORTAL.md` твърдеше, че демо
  данните са „нарочно в корена, а не в `data/`“, и изобщо не споменаваше този файл. Документът
  вече изрежда и двата демо файла с ролята им (плоска подредба в корена за стари връзки и
  `data/demo-evidence.json` за фронтенда) и казва защо `evidence-portal.js` изрежда файловете
  си изрично вместо да обхожда папката.
- **Тестът вече пази инвентара на пакета.** `tests/evidence-portal.cjs` иска всеки файл от
  `FILES` да е ред в таблицата на плана и файлът, който `app.js` тегли, да е в `FILES` —
  иначе публикуваното демо щеше да дава 404, а никой нямаше да разбере от тестовете.
  Проверено и обратно: при преименуван ред в плана тестът пада с името на файла.
- Никаква промяна в поведението на add-on-а: това е точност на плана и проверка, не поправка.

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
