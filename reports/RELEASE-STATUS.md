# Състояние на изданието — hAPI Enterprise 0.69.50

Версия: **0.69.50** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **219/219** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.50 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 360 файла · 60070 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 356 файла · 59706 реда · critical: 0 · high: 0 · medium: 0 · low: 158 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 219 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.50.tar.gz` | add-on архив (146 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.50.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.50

Одит на всички издания: какво е имало и го няма, и какво е обещано и го няма.

- **Нов инструмент:** `node scripts/release-audit.cjs` сравнява ВСЕКИ таг (55 тага) с
  текущото дърво по файлове, функции по модул, секции в панела и опции на add-on-а и пише
  `reports/RELEASE-AUDIT.md`. Не е гейт — отчет за хора.
- **Резултат за историята:** файлове 142 → 149, функции 1430 → 1468, секции 17 (без
  промяна), опции 33 (без промяна) от v0.69.37 до сега. Няма тихо изчезнал файл или
  функция: 13-те „липсващи“ файла и 11-те функции имат документирани заместници
  (`portal_enterprise` → `hapi_enterprise`, `admin.js` → `ui/` в 0.69.8, `withSecretLock` →
  `secret-lock.js`, `merge/mergeLists/equal/giveUp` → `reconcile()`, `loginGate` → вход
  само през Supervisor/loopback, `visitor_trust_proxy` → конзолата + `TRUST_PROXY`).
- **Резултат за обещаното:** кодът сам обявява какво още не е направено — 6 експортни
  способности (`compression`, `split_archive`, `rate_limit`, `parallel_transfers`,
  `encrypt_package`, `resume_transfer`), 4 типа обекти в Report Studio (`logo`,
  `certificate`, `columns`, `dynamic`) и 5 документирани функции (FD-7 SMB, FD-8 USB,
  FD-9 Save Template, RS-06 veraPDF, W8/F9 Windows Edition).
- Проверките гледат КОД, не коментари и не етикети: „SMB / NAS“ е име на местоназначение,
  а „валидатор като veraPDF“ е описание на липсата — и двете не се броят за реализация.

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
