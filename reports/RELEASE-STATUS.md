# Състояние на изданието — hAPI Enterprise 0.69.26

Версия: **0.69.26** · клон `main` · архив изграден 2026-10-22

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **205/205** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.26, изградено 2026-10-22 |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 331 файла · 55238 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 327 файла · 54874 реда · critical: 0 · high: 0 · medium: 0 · low: 149 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 23 RBAC способности, 34 опции, 205 тестови файла |

## 2. Артефакти (`dist/`)

| Файл | Обем | sha256 |
| --- | --- | --- |
| `hapi_enterprise-0.69.26.tar.gz` | 129 файла · 1.47 MB | `b48cb776718b` |
| `hapi_enterprise-integration-0.69.26.zip` | 22 файла · 0.22 MB | `25b8c59d1ec2` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | сумите вътре |

## 3. Какво влезе във 0.69.26

`reports/RELEASE-STATUS.md` — отчетът, който трябва да доказва състоянието на изданието — беше
писан на ръка и изостана с шест версии (стоеше на 0.69.19 с 182 теста, докато изданието беше
0.69.25 с 204). Документ, който изглежда като доказателство, но е спомен, е по-лош от никакъв.

- **Нов `scripts/release-status.cjs`** — строи отчета от артефактите, а не от памет:
  `reports/test-matrix.json` (брой тестове, опити, време), `dist/RELEASE.json` (архиви, обем,
  отпечатък, дата), JSON изходите на `logic-audit` и `bad-code-scan`, `docs-consistency`,
  `sync-addon-changelog --check` и `scenario-matrix`. Датата също идва от артефактите, за да е
  възпроизводим резултатът.
- **`--check`** не пише нищо и връща код 1 с първия разминаващ се ред — така остарял отчет не
  може да мине незабелязано. **`--out`** пише на друго място (за тестовете).
- **Изданието се вижда, ако е старо:** когато `dist/RELEASE.json` е за друга версия, отчетът
  казва точно това, вместо да покаже стари числа като нови.
- **Нов `tests/release-status.cjs`:** сравнява отчета в дървото с прясно генерирания (байт по
  байт), проверява че числата идват от отчетите и че `--check` хваща умишлено повредено и
  липсващо копие. Това е и причината отчетът да се регенерира след промени в кода — стъпката е
  добавена в `documentation/07_RELEASE/RELEASE_CHECKLIST.md`.
- **`npm run status` / `npm run status:check`** за същото без дългата команда.

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
