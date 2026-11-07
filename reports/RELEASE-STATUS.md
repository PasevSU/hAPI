# Състояние на изданието — hAPI Enterprise 0.69.190

Версия: **0.69.190** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **370/370** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.190 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 596 файла · 105889 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 591 файла · 104965 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 370 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.190.tar.gz` | add-on архив (201 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.190.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.190.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.190

- **Дебъгинг инструмент: разпознава обектите в живия панел и прилага законите върху тях.**
  Дотук проверките на оформлението гледаха изходния код („има ли `var(--sp-3)` в този блок“) —
  това пази договора, но не казва нищо за ЖИВИЯ екран. Новият `ui/debug-objects.js` държи два
  централизирани списъка: **обекти** (`panel`, `block`, `card`, `field`, `control`,
  `icon-button`, `field-control`, `checkbox`, `table`, `chip` — по договор, не по догадка) и
  **закони** (`spacing-grid` 2px решетка · `symmetry` ляво=дясно/горе=долу · `named` име за
  екранен четец · `touch-target` ≥20px · `no-inline-layout` без инлайн оформление ·
  `one-qr` един QR код), и един `scan()`/`report()`, който ги прилага и печата отчет с
  причина и стойност.
- Включва се **само** при `window.HAPI_DEBUG`, `?debug=1` или `localStorage['hapi.debug']='1'`;
  без флаг не сканира, не пише в конзолата и не слага слушатели. Липсваща стойност се
  прескача, а не се брои за нарушение — затова „0 нарушения“ значи „няма нарушение по
  измереното“, не „всичко е наред завинаги“.
- Проверява се от `gui-debug-objects.cjs`: в живия панел се разпознават **100 обекта** от
  9 вида; всеки от четирите закона, които могат да се измерят в тестов DOM, хваща нарочно
  поставено нарушение (нечетно отстояние, асиметрия, инлайн стил, безименен бутон) и
  посочва ТОЧНО обекта; без флаг инструментът мълчи.
- Документация: `documentation/04_FUNCTION_SPECIFICATIONS/DEBUG_OBJECTS.md`.

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
