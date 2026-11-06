# Кодове за грешка — каталог

> **Генериран документ.** Версия на кода: **0.69.184**. Пише се от
> `node scripts/error-codes.cjs`, проверява се от `tests/error-codes.cjs`.
> Значението идва от текста на самото изключение — ръчна редакция се губи при следващото
> генериране и не може да измисли поведение, което кодът не изпълнява.

Общо: **67** кода, излъчвани от `hapi_enterprise/`. От тях **48** носят
собствено обяснение в кода; останалите се разпознават по кода и файла.

## Кодове по азбучен ред

| Код | Значение (от кода) | Къде се излъчва |
| --- | ------------------ | --------------- |
| `ADMIN_TOKEN_LOOKS_LIKE_HA_LLAT` | the "token" option is shaped like a Home Assistant | `hapi_enterprise/start.js` |
| `ADMIN_TOKEN_REQUIRED` | the "token" option still contains a "!secret …" reference, so Supervisor did not | `hapi_enterprise/start.js` |
| `BACKUP_FAILED` | — | `hapi_enterprise/workdir-migrate.js` |
| `BAD_KEY` | Отрязан ключов пакет | `hapi_enterprise/pgp.js` |
| `BAD_MESSAGE` | Отрязано съобщение | `hapi_enterprise/pgp.js` |
| `BAD_MPI` | Отрязан MPI | `hapi_enterprise/pgp.js` |
| `BAD_PACKET` | Невалиден OpenPGP пакет | `hapi_enterprise/pgp.js` |
| `BAD_SESSION_KEY` | RSA блокът не е PKCS#1 v1.5 тип 2 | `hapi_enterprise/pgp.js` |
| `CHANGED_WHILE_SIGNING` | файл се е променил между четенето и подписа (409) | `hapi_enterprise/pgp-sign.js` |
| `CHECKSUM_MISMATCH` | CRC24 на armor не съвпада | `hapi_enterprise/pgp.js` |
| `DATA_TOO_LONG` | Данните не се побират в един RSA блок | `hapi_enterprise/pgp.js` |
| `DECRYPT_FAILED` | Съобщението не може да бъде декриптирано | `hapi_enterprise/pgp.js` |
| `INVALID_ARMOR` | Очаква се ASCII armor текст | `hapi_enterprise/pgp.js` |
| `INVALID_DATA` | Очаква се Buffer за подпис | `hapi_enterprise/pgp.js` |
| `INVALID_ID` | невалиден идентификатор на архив | `hapi_enterprise/pgp-sign.js` |
| `INVALID_PATH` | пътят липсва, съдържа нулев байт или не е абсолютен и не е под /share или /media | `hapi_enterprise/pgp-sign.js` |
| `KEY_TOO_LARGE` | Ключът е твърде голям | `hapi_enterprise/pgp.js` |
| `KEYRING_UNAVAILABLE` | — | `hapi_enterprise/routes/pgp-keyring.js` |
| `LOCK_REASON_REQUIRED` | заключването иска основание | `hapi_enterprise/routes/folders.js` · `hapi_enterprise/server.js` |
| `MAX_BRANCH_DEPTH_3` | максималната дълбочина е 3 подпапки под корена | `hapi_enterprise/routes/folders.js` · `hapi_enterprise/server.js` |
| `MDC_MISMATCH` | Контролната сума не съвпада — съобщението е подменено | `hapi_enterprise/pgp.js` |
| `MDC_MISSING` | Липсва контрола за цялост (MDC) — съобщението е подменено или от стар формат | `hapi_enterprise/pgp.js` |
| `NO_ENCRYPTION_KEY` | Няма ключ за криптиране (X25519, X448 или RSA) | `hapi_enterprise/pgp.js` |
| `NO_KEY` | В блока няма ключов пакет | `hapi_enterprise/pgp.js` |
| `NO_PATHS` | — | `hapi_enterprise/path-crypto.js` |
| `NO_SECRET_KEY` | Няма секретен ключ за подписване | `hapi_enterprise/pgp.js` |
| `NO_SIGNING_KEY` | няма ключ за подписване — задай pgp_path_secret или прикачи ключ | `hapi_enterprise/pgp-sign.js` |
| `NOT_A_FILE` | в списъка с файлове има папка | `hapi_enterprise/pgp-sign.js` |
| `NOT_A_FOLDER` | подай папка, а не файл | `hapi_enterprise/pgp-sign.js` |
| `NOT_ENCRYPTED` | Съобщението няма PKESK пакет (криптирано е само с парола) | `hapi_enterprise/pgp.js` |
| `NOT_FOUND` | пътят не съществува | `hapi_enterprise/pgp-sign.js` |
| `NOTHING_TO_SIGN` | няма нито папка, нито файлове | `hapi_enterprise/pgp-sign.js` |
| `OPTION_SECRET_NOT_EXPANDED` | тези опции съдържат "!secret" без замяна → | `hapi_enterprise/start.js` |
| `PASSPHRASE_REQUIRED` | Секретният ключ е защитен с парола (AEAD) — нужна е паролата (опция `pgp_key_pass` или `PGP_KEY_PASS`) | `hapi_enterprise/pgp.js` |
| `PASSPHRASE_WRONG` | Паролата на секретния ключ не е вярна (AEAD тагът не се провери; опити: | `hapi_enterprise/pgp.js` |
| `PATH_OUTSIDE_STORAGE` | пътят сочи извън /share и /media (вкл. през „..“ или симв. връзка) | `hapi_enterprise/pgp-sign.js` |
| `PGP_SECRET_KEY_REQUIRED` | — | `hapi_enterprise/path-crypto.js` |
| `PUBLIC_UNREADABLE` | — | `hapi_enterprise/path-crypto.js` |
| `RESPONSE_ALREADY_SENT` | втори отговор е отказан (първият вече е изпратен), код | `hapi_enterprise/respond.js` |
| `S2K_AEAD_UNSUPPORTED` | Платформата няма поддръжка на AEAD режима на този ключ ( | `hapi_enterprise/pgp.js` |
| `S2K_ARGON2_UNSUPPORTED` | Секретният ключ е защитен с Argon2 (S2K тип 4) — hAPI поддържа iterated-salted (тип 3). Експортирай ключа с `--s2k-mode 3` или без парола. | `hapi_enterprise/pgp.js` |
| `SEAL_WORKDIR_NEEDS_CONFIRM` | добави ?confirm=1 (действието пипа файловете в работните папки) | `hapi_enterprise/routes/pgp-keyring.js` |
| `SECRET_NAME_HAS_SPACE` | — | `hapi_enterprise/path-crypto.js` |
| `SECRET_NOT_EXPANDED` | — | `hapi_enterprise/path-crypto.js` |
| `SECRET_PATH_RELATIVE` | — | `hapi_enterprise/path-crypto.js` |
| `SECRET_UNREADABLE` | — | `hapi_enterprise/path-crypto.js` |
| `STORAGE_LEGACY_LOCATION` | намерени са данни в | `hapi_enterprise/storage-preflight.js` |
| `TOO_LARGE` | над 128 MB наведнъж — подпиши подпапка | `hapi_enterprise/pgp-sign.js` |
| `TOO_MANY_FILES` | над 500 файла — подпиши подпапка | `hapi_enterprise/pgp-sign.js` |
| `TSA_INSECURE_TRANSPORT` | — | `hapi_enterprise/crypto-options.js` |
| `UNSUPPORTED_AEAD` | Този режим не е наличен за заключване | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_ALGO` | — | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_ALGORITHM` | — | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_CIPHER` | — | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_COMPRESSION` | Съобщението е компресирано преди криптиране — криптирай без компресия (`gpg -z 0` или hAPI) | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_CURVE` | Поддържа се само Ed25519 | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_FORMAT` | Липсва SEIPD пакет (компресирано съобщение не се поддържа) | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_HASH` | — | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_KEY_USAGE` | — | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_KEY_VERSION` | — | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_PKESK` | — | `hapi_enterprise/pgp.js` |
| `UNSUPPORTED_S2K` | — | `hapi_enterprise/pgp.js` |
| `WEAK_KEY` | — | `hapi_enterprise/pgp.js` |
| `WORKDIR_CORRUPT` | Отрязан контейнер (липсва ключ) | `hapi_enterprise/workdir-crypto.js` |
| `WORKDIR_LOCKED` | Файлът е криптиран, но ключът не е достъпен: | `hapi_enterprise/workdir-crypto.js` |
| `WORKDIR_NOT_SEALED` | Файлът не е криптиран от hAPI | `hapi_enterprise/workdir-crypto.js` |
| `WORKDIR_VERSION` | Неподдържана версия на контейнера | `hapi_enterprise/workdir-crypto.js` |

## Защо това е договор

Кодът за грешка е това, което клиентът проверява програмно: той е стабилен, докато текстът
се променя. Затова код не се преименува тихо — смяната е промяна в договора и се записва в
`CHANGELOG.md`. HTTP статусът и формата на тялото са в `API_ARCHITECTURE_SPEC.md` §4.4a
(RFC 9457).
