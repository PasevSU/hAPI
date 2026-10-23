# Промени в hAPI Enterprise

Тази версия: **0.69.68**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.68

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
