# Състояние на изданието — hAPI Enterprise 0.69.65

Версия: **0.69.65** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **230/230** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.65 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 381 файла · 63701 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 377 файла · 63337 реда · critical: 0 · high: 0 · medium: 0 · low: 168 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 33 опции, 230 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.65.tar.gz` | add-on архив (152 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.65.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.65

Поправка на дефект от 0.69.64, хванат от CI: картата на структурата издаваше абсолютния път на
сървъра.

- **Проблемът:** `layout` в `/admin/api/diagnostics` връщаше абсолютни пътища (`/data/...`,
  `/app/...`). Договорът на този маршрут е да НЕ издава пътя на машината — тестът
  `tests/diagnostics.cjs` го проверява и CI го хвана.
- **Поправката:** пътищата се заместват с токени (`<данни>/files`, `<данни>/api`,
  `<приложение>`), а проверките `exists`/`writable` продължават да се правят на реалния път.
  Картата остава полезна за човек, без да разкрива вътрешната подредба на сървъра.
- Тест: `tests/layout.cjs` (картата съвпада с документа) и `tests/diagnostics.cjs` (без
  изтичане на път) минават заедно — двете изисквания се държат едновременно.

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
