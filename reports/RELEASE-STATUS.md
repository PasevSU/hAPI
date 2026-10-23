# Състояние на изданието — hAPI Enterprise 0.69.68

Версия: **0.69.68** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **239/239** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.68 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 396 файла · 67231 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 392 файла · 66867 реда · critical: 0 · high: 0 · medium: 3 · low: 170 — **има необяснени** |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 40 опции, 239 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.68.tar.gz` | add-on архив (159 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.68.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.68

Издание с една нова функция (избор на ключ по роля) и две поправки в самите гейтове — за да не
може код да остане извън git и за да не твърди документацията несъществуващи полета.

- **Кой ключ криптира се решава по Key Flags, не по поредност.** Досега при ключов пакет с
  отделни подключове изборът беше „първият X25519/X448, иначе RSA“ — можеше да е комуникационният
  ключ вместо ключът за данни в покой. Сега редът е договорен и се вижда: `0x08`
  (`encrypt-storage`) → `0x04` (`encrypt-comms`, с точния източник `key-flags-comms`) → по вид
  ключ за стари пакети без флагове. `GET /admin/api/pgp/keyring` връща `storageKeySource`
  (`key-flags` / `key-flags-comms` / `kind`), а всеки ключ носи `keyFlags` и `roles` — изборът
  вече не е мълчалив. `encrypt-comms` не се ползва за криптиране навън.
- **Тестове:** `tests/pgp-keyflags.cjs` (6 проверки: роли от реален self-signature; два подключа
  comms/storage → избран е storage; само comms → избран, но с точен източник; без флагове → по
  вид; генериран ключ носи `0x0F`; `encryptionKeyOf()` е съвместим) и 4 нови твърдения в
  `tests/pgp-keyring.cjs`. Общо 239 тестови файла.
- **Поправка в хигиената на хранилището:** `.gitignore` беше започнал да игнорира самите
  `hapi_enterprise/pgp.js`, `hapi_enterprise/path-crypto.js`, `tests/pgp-keyring.cjs`,
  `reports/RELEASE-STATUS.md`, `scripts/bad-code-allowlist.json` и `eslint-suppressions.json`.
  Така `git add -A` не ги вкарваше — кодът вървеше локално, но не влизаше нито в CI, нито в
  изданието. Сега се игнорира само временният `.commit-msg.txt`.
- **Поправка в документацията:** `pgp-keys-setup.md` описваше полета `encryptionKeyId`,
  `hasPrivate`, `passphraseAccepted`, които `status()` никога не е връщала. Заменени с истинските
  (`available`, `canDecrypt`, `storageKeyId`, `storageKeySource`, `primaryKeyId`,
  `passphraseSource`, `reason`). Договорът за ключовете вече не обещава ⏳ за вече излязла
  версия; `tests/docs-consistency.cjs` пази и двете правила.

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
