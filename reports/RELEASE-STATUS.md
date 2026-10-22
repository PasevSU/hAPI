# Състояние на изданието — hAPI Enterprise 0.69.33

Версия: **0.69.33** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **209/209** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.33 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 339 файла · 56949 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 335 файла · 56585 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 209 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.33.tar.gz` | add-on архив (134 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.33.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.33

Затваря се последният отворен слот от W7: отчетът вече може да излезе като **пакет с
доказателства**, а статусът му не се закръгля нагоре.

- **`POST /admin/api/v2/reports/package`** връща ZIP с `report.pdf`, `manifest.json`,
  `evidence.json`, наличните `tsa/start.tsr`, `tsa/stop.tsr`, `signature.p7s` и
  `SHA256SUMS.txt`. PDF-ът се рендира от същия манифест (детерминирано), или се подава готов
  с `pdfBase64`, ако вече е подписан.
- **Три статуса, без украса:** `READY` само при налични START и STOP токени (и подпис, ако е
  поискан); `INCOMPLETE` с изброени `missing`; `DRAFT` за чернова — тя не се подпечатва.
  При рендиране от сървъра водният знак е `DRAFT`/`INCOMPLETE`, когато пакетът не е `READY`.
- **Нов `hapi_enterprise/report-package.js`** (INV-E1…E5 в
  `documentation/04_FUNCTION_SPECIFICATIONS/REPORT_EVIDENCE_PACKAGE.md`); `SHA256SUMS.txt`
  покрива всеки файл в пакета, а `evidence.json` носи `manifestSha256` и `pdfSha256`.
- **Панелът** получи „Чернова (DRAFT)“, бутон „Пакет с доказателства“ и бадж със статуса;
  обяснението в панела вече не казва, че подписът и TSA са „RS-05“ — те са налични.
- **Поправен капан:** списъкът с липси пътуваше в HTTP заглавка като кирилица, което убива
  връзката (`ERR_INVALID_CHAR`). Сега `X-Evidence-Missing` е URL-кодиран, а пълният текст е в
  `evidence.json`; тестът проверява точно това.
- **Нов `tests/report-package.cjs`:** класификацията (включително „половин“ TSA и липсващ
  подпис), съдържанието на ZIP-а, верността на сумите, 401 без токен и статус в заглавка.
- `Dockerfile` копира `report-package.js`.

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
