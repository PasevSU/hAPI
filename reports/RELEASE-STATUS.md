# Състояние на изданието — hAPI Enterprise 0.69.79

Версия: **0.69.79** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **249/249** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.79 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 417 файла · 71800 реда · **1** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 413 файла · 71436 реда · critical: 0 · high: 0 · medium: 3 · low: 175 — **има необяснени** |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 41 опции, 249 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.79.tar.gz` | add-on архив (168 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.79.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.79

Целостта на архивите: подмяна на доказателство се вижда без човешка сверка.

- **Нов модул `portal-integrity.js`** (правило `ARCHIVE_NOT_TAMPERED`). Проверява по ред и
  връща ТОЧЕН код за всяка повреда, вместо едно общо „счупено“: `file_missing`,
  `archive_hash_mismatch` (с `expected` и `actual`), `archive_unreadable`, `manifest_missing`,
  `manifest_invalid`, `manifest_hash_mismatch`, `file_missing_in_archive`,
  `file_hash_mismatch` / `file_size_mismatch` (с името на файла).
- **`POST /admin/api/portals/<id>/qr/verify`** — проверка по заявка. Резултатът се записва в
  метаданните (`db.portalIntegrity[portalId]`: `checkedAt`, `ok`, `archives`, `verified`,
  `failed[]`) и `GET …/qr` го показва като `integrity` (преди първата проверка — `null`,
  а не „здраво“).
- **Фонова проверка** през 6 часа (`HAPI_INTEGRITY_INTERVAL_MS`, `0` я изключва), с `unref`
  таймер — не държи процеса жив и не блокира старта. При провал вдига `integrity.failed` в
  одитната верига с `reasons` и `archiveIds`, за да остане следа извън екрана.
- **Сензори:** `qr.integrity` в `/admin/api/sensors` (`failures`, `portalsFailed`, `checked`,
  `lastCheckedAt`, `intervalMs`, `code`) → пети QR сензор `integrity_failed` в Home Assistant
  (**29 общо**), на три езика.
- **Панел:** бутон „Провери целостта на архивите“ показва проверени/общо и при провал —
  кой архив и с каква причина (`#pf-qr-verify`, `/qr/verify`).
- **Гейт:** `tests/portal-integrity.cjs` — всеки код на повреда поотделно (модул), запис и
  одит (сървър), `integrity.failed` в сензорите и в одитната верига. Документацията е
  обновена: нова точка 7а в `RUNTIME_EXECUTION_FLOWS.md`, а `ARCHITECTURE_COMPLIANCE_MATRIX.md`
  вече не брои целостта към липсите (§5.1).

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
