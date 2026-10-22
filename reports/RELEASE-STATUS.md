# Състояние на изданието — hAPI Enterprise 0.69.27

Версия: **0.69.27** · клон `main` · архив изграден 2026-10-22

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **205/205** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.27, изградено 2026-10-22 |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 331 файла · 55325 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 327 файла · 54961 реда · critical: 0 · high: 0 · medium: 0 · low: 149 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 23 RBAC способности, 33 опции, 205 тестови файла |

## 2. Артефакти (`dist/`)

| Файл | Обем | sha256 |
| --- | --- | --- |
| `hapi_enterprise-0.69.27.tar.gz` | 129 файла · 1.47 MB | `3de0eac3474d` |
| `hapi_enterprise-integration-0.69.27.zip` | 22 файла · 0.22 MB | `a18c7b0a8505` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | сумите вътре |

## 3. Какво влезе във 0.69.27

Add-on-ът отказа старт след 0.69.26 с „Невалидна конфигурация: value must be one of
['full', 'hashed', 'masked']“. Причината беше моя: четирите нови опции имаха празни
подразбирания (`""`, `null`), а Supervisor валидира `options` срещу `schema`.

- **`visitor_ip_mode`** вече е `match(^(hashed|masked|full)?$)?` с подразбиране `hashed`.
  `list(...)` не може да изрази празно, а старата инсталация има записано точно `""` —
  затова `match` приема и него, за да не се счупи обновяването.
- **`visitor_trust_proxy` е премахната като add-on опция.** HA схемата не може да изрази
  `null`, а точно `null` е записано в старите инсталации; ключът остава в конзолата
  (Настройки → Сензори) и в средата като `TRUST_PROXY`. Позицията е в
  `VISITOR_SENSORS.md` (INV-S10, INV-S11).
- **`tests/addon-config.cjs` валидира всяка стойност по подразбиране срещу собствената ѝ
  схема** — `str`/`password`/`bool`/`int(min,max)`/`list(a|b)`/`match(re)` — и изрично
  проверява, че старите `""` минават, а непознат режим се отказва. Самата проверка се
  тества с три умишлено невалидни двойки, за да не е декорация.
- Преводите (`bg`, `en`) са синхронизирани с премахнатата опция.

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
