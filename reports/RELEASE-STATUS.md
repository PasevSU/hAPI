# Състояние на изданието — hAPI Enterprise 0.69.203

Версия: **0.69.203** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **382/382** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.203 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 610 файла · 108220 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 605 файла · 107296 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 382 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.203.tar.gz` | add-on архив (201 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.203.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.203.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.203

- **Криптирането на средата отново работи — с ключ, който МОЖЕ да криптира.** Опциите на
  инстанцията казват `pgp_encrypt_paths: true` и `pgp_encrypt_workdir: true`, но инсталираният
  ключ беше **Ed25519 само за подпис** (`keyId 1F5A1295EA95D45F`). `pgp.storageKeyOf()` избира
  ключ за данни в покой само от X25519/X448/RSA, затова `keyring.status()` даваше
  `available: true, canDecrypt: true`, а `storageKeyId` беше празен и `reason` казваше
  `NO_ENCRYPTION_KEY`: изглеждаше, че ключ има, а пътищата не се криптираха. Ключът е сменен с
  **RSA-3072** (`keyId ADF1F1A403065DAD`, `storageKeySource: key-flags`); старите файлове са в
  `/share/hAPI/keys/backup/`, `KEY-INFO.txt` е обновен. След `POST /admin/api/pgp/keyring/reload`
  състоянието е `reason: ""` и `storageKeyId` зададен, а в контейнера `sealPath`/`openPath` и
  `wrapSecret`/`unwrapSecret` правят кръг с истински шифротекст (`BEGIN PGP MESSAGE`, 744 B за
  51 B път). `POST /admin/api/pgp/seal-paths` не намери какво да запечата (`sealed: 0`) и
  направи копие на базата преди това — инстанцията има 1 портал и 0 файла.
- **Нов тест срещу точно този клас повреда.** `tests/pgp-keyring.cjs` (случай 8б) слага ключ
  само за подпис при включено криптиране и изисква `requireEncryptionKey()` да хвърли
  `PGP_SECRET_KEY_REQUIRED` с `detail: NO_ENCRYPTION_KEY` — тоест „включено криптиране без
  ключ за криптиране“ е **грешка**, а не тихо „не криптира“. Същият случай проверява и
  обратното: RSA ключ, генериран от самия add-on, стига и за подпис, и за криптиране.
- `KNOWN_DEFECTS.md`: **DEF-46** (Висока, затворен) — с измерените стойности и с какво копие
  разполага човек, ако се наложи връщане назад.

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
