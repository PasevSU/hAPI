# Състояние на изданието — hAPI Enterprise 0.69.81

Версия: **0.69.81** · клон `main`

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
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.81 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 417 файла · 71854 реда · **1** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 413 файла · 71490 реда · critical: 0 · high: 0 · medium: 3 · low: 175 — **има необяснени** |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 41 опции, 249 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.81.tar.gz` | add-on архив (168 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.81.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.81

Спецификацията HAPI-ARCH-API-001 е сверена с кода; затворени са двете разминавания.

- **§10.1.7 и §19 — архивът се проверява ПРЕДИ да се отчете като успешен.** След записа
  файлът се чете ОТ ДИСКА и минава през `portal-integrity.verifyArchive()` (SHA-256 на ZIP-а,
  манифест, хеш на манифеста, всеки файл вътре). При провал файлът се изтрива, вдига се
  `qr.archive.verify.failed` в одита и отговорът е `500` — не се създава следващ QR, който да
  сочи към непроверен архив. Архивът вече носи `verificationStatus: 'verified'` и `verifiedAt`.
- **§3.4 и §10.2 — историческата връзка е видима.** Публичният `qr.json` показва за всяка
  ревизия `previousQrId`, `nextQrId` и `archive.verificationStatus`, без вътрешни бележки.
- **§20 — картата на 14-те сценария за сигурност** е добавена в
  `ARCHITECTURE_COMPLIANCE_MATRIX.md` (§7): всеки сценарий сочи към реален тест; честно
  отбелязани са само двата, които не са затворени (изолиран HTML контекст и `content_id`).
- `RUNTIME_EXECUTION_FLOWS.md` §5 — потокът на архивиране вече включва проверката като
  отделна стъпка със собствен отказ.

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
