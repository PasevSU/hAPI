# Промени в hAPI Enterprise

Тази версия: **0.69.203**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.203

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
