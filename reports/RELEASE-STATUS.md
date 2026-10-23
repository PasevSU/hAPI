# Състояние на изданието — hAPI Enterprise 0.69.51

Версия: **0.69.51** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **220/220** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.51 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 361 файла · 60219 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 357 файла · 59855 реда · critical: 0 · high: 0 · medium: 0 · low: 158 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 220 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.51.tar.gz` | add-on архив (146 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.51.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.51

Първата от шестте липсващи експортни способности е реална: **нива на компресия**.

- **Проблемът:** `export-rules.capabilities()` връщаше `compression: implemented: false`, а ZIP
  писателят винаги компресираше с подразбирането на zlib — тоест „нива на компресия“
  съществуваше само като етикет „планирано (v2)“.
- **Ново:** `POST /admin/api/packages` приема `compression`: `none`/`store` (0 — без
  компресия), `fast` (1), `default`/`normal` (6), `max`/`best` (9) или число 0–9.
  Невалидно ниво е **400**, а не тихо подразбиране. Нивото се записва в
  `PACKAGE_INDEX.json` и в метаданните (`compression: { level, method, name }`) — получателят
  вижда с какво е направен архивът, вместо да гадае от размера.
- `ooxml.zip(entries, { level })`: `level: 0` → ZIP method 0 (store), 1–9 → deflate с това ниво;
  без `level` поведението остава като преди, за да не се сменят вече направени пакети.
- Панелът (Износ → Пакет) има избор „Компресия на пакета“ (без/обичайна/максимална) и го
  подава при създаване; способността се показва като „готово“ (беше „планирано“).
- Тест: `tests/package-compression.cjs` — измерва реалния ефект (store 323 309 B срещу
  deflate 2 780 B за един и същ вход), проверява ZIP метода на записите, четенето на архива
  и в двата случая, записа на нивото в индекса и отказа при невалидно ниво.

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
