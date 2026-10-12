# ADR-0026: Портал за криптографски доказателства с WORM хранилище и съдебни роли (Фаза 7)

- **Status:** Accepted
- **Дата:** 2026-10-12

## Контекст
Фаза 7 (`docs/plan/14-phase-7-evidence-portal.md`) изисква портал, към който QR код
препраща съд, прокурори и вещи лица, за качване и проверка не само на документи, но и на
криптографски доказателства. Доказателствата трябва да са неизменни (WORM), да имат
проверим произход (chain of custody) и да се верифицират без доверие в сървъра
(SHA-256 + SHA-512 + подписан receipt). Достъпът се разграничава по съдебна роля,
отделна от административния `rbac.js` слой, и никога не използва `ADMIN_TOKEN`.

## Решение
Въведени са два модула и разширени маршрути под `/api/v1/p/{slug}/evidence`:

### `portal-auth.js` — роли и ограничени по дело пълномощия
- Роли: `judge`, `prosecutor`, `clerk`, `investigator`, `expert`, `public`.
- Матрица на правата (§3): `judge` чете/верифицира/издава решения, но не качва;
  `prosecutor` качва/чете/верифицира; `clerk` добавя `manage` (индексиране/QR);
  `investigator` и `expert` са допълнително ограничени до `caseIds`, изброени в
  пълномощието; `public` няма достъп до съдържание.
- Пълномощието е краткотраен HMAC-SHA256 подписан токен `{sub, role, caseIds, exp}`
  с подпис `base64url`. `issue/verify/authorized` + `can(role, action)`. Това е
  fallback интерфейсът от §13 (OIDC/PKCE в производство; настоящият слой е IdP-агностичен).

### `evidence-store.js` — WORM неизменно хранилище
- `store()`: запис с изключителен `wx` флаг (никога не презаписва), `fsync`, SHA-256 +
  SHA-512, HMAC receipt над каноничен низ, append към hash-верижен одитен лог
  (`evidence.upload`), атомарно записване на индекса. При грешка частично записаният
  файл се изтрива — няма осиротели артефакти.
- `verify()`: преизчислява двата дайджеста и подписа на receipt; връща
  `{valid, reason, sha256, sha512, size, receiptValid}`; записва `evidence.verify`
  (включително резултата) в лога — създава проследима история на всяка проверка.
- `custodyChain()`: филтрира верижния лог по `fileId` и връща `integrity` от
  `audit-chain.verify()`; корупцията в лога се разпознава (tamper-evident).
- Класификация: `PUBLIC/INTERNAL/CONFIDENTIAL/SECRET/EVIDENCE` (EVIDENCE е immutable).

### Маршрути (всички зад portal credential)
`POST /evidence` (upload), `GET /evidence` (list, филтър `?case=`), `GET /evidence/{id}`,
`GET /evidence/{id}/verify`, `GET /evidence/{id}/chain` (само judge/prosecutor),
`GET /evidence/{id}/download`, `GET /evidence/{id}/package` (receipt + chain + verification).
Събития `evidence.uploaded`, `evidence.verify` и `evidence.download` влизат в одитния лог;
`evidence.uploaded` се показва и в Notification Center (Фаза 5).

## Последици
- Плюс: неизменност (WORM), независима проверка, проследимост (chain of custody),
  ролеви достъп по дело, пълно отделяне от административната равнина.
- Минус: HMAC receipt е симетричен (изисква споделен `secret`); независима проверка от
  трета страна днес разчита на преизчисляване на дайджестите срещу публикувания receipt.
  PKCS#7 detached подпис и RFC 3161 TSA (X.509) са следващи етапи на Фаза 7, както и
  OIDC/PKCE и PDF доклад.

## Checklist за гъвкавост (§9.1)
- [x] Изключва се през config? — да, `portal-auth` и `evidence-store` се създават лениво; маршрутите активират само с credential.
- [x] Заменя се с алтернатива? — `create()` връща сменяем интерфейс; `portal-auth` е IdP-агностичен (OIDC/PKCE зад същия `authorized()`).
- [x] Има интерфейс, не конкретна имплементация? — да (`ROLES/ACTIONS/MATRIX`, `CLASSIFICATIONS`).
- [x] Излъчва събитие? — `evidence.uploaded` + `audit('evidence.*')`.
- [x] Има миграция с rollback? — `store()` изтрива частичния файл при грешка; `verify()` не променя данни.
- [x] Документиран е в ADR? — да (настоящият ADR).
- [x] Тестван изолирано? — `portal-roles`, `portal-auth`, `portal-upload-evidence`, `portal-verify`, `portal-chain-of-custody`, `portal-report`, `portal-evidence-api`.
