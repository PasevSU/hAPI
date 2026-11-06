# Състояние на изданието — hAPI Enterprise 0.69.178

Версия: **0.69.178** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **367/367** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.178 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 592 файла · 104990 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 587 файла · 104052 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 367 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.178.tar.gz` | add-on архив (200 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.178.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.178.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.178

- **Хранилището има име: „ПАП БОКС“.** То стои на публичната страница на портала (там,
  където води QR кодът) и в картата на портала в панела — на трите езика, защото е
  собствено име и не се превежда.
- **Криптографската защита е изписана ЯВНО на български, английски и немски:**
  „Криптографска защита: SHA-256 за всеки файл, подписан достъп и AES-256-GCM при
  шифроване“ / „Cryptographic protection: SHA-256 for every file, signed access, and
  AES-256-GCM when encrypted“ / „Kryptografischer Schutz: SHA-256 für jede Datei,
  signierter Zugang und AES-256-GCM bei Verschlüsselung“. Дотук това се виждаше само
  косвено — като отпечатъци в списъка и като бележка за подписания достъп.
- **Тестът го пази:** `portal-i18n.cjs` и `ui-i18n.cjs` искат и трите езика да съдържат
  SHA-256 и AES-256-GCM в този ред, а марката да е „ПАП БОКС“; изключението за кирилица
  в DE/EN е само за марката (собствено име), не за текстовете.
- Оформление: марката е тих надпис над заглавието, а редът за защита — под резюмето, с
  катинар; в картата е един ред под адреса, за да не се бие с действията.

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
