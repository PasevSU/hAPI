# Security Model — hAPI Enterprise (To-Be)

## Principles

- **Zero trust** — every request authenticated, authorized, audited.
- **Defense in depth** — encryption, signing, WORM, RBAC, throttling.
- **Fail-closed** — bridges and portals deny by default.

## Trust boundaries

```text
┌──────────┐  HTTPS/Ingress   ┌───────────────┐   WORM    ┌───────────────┐
│ Browser  │ ───────────────▶ │ hAPI backend  │ ────────▶ │ Evidence store│
└──────────┘                  └───────┬───────┘           └───────────────┘
                                      │ RFC 3161
                                      ▼
                                  External TSA
```

## Controls matrix

| Control            | Current                                                          | Target                         |
| ------------------ | ---------------------------------------------------------------- | ------------------------------ |
| Authentication     | HA SSO + local                                                   | + TOTP for admin-ops           |
| Authorization      | RBAC (admin/operator/viewer)                                     | + court/prosecutor viewer role |
| Encryption at rest | AES-256-GCM                                                      | + per-file keys                |
| Integrity          | SHA-256                                                          | + SHA-512 + PKCS#7 + RFC 3161  |
| Immutability       | `flag:'wx'` partial                                              | dedicated WORM volume          |
| Auditing           | hash-chained log                                                 | + external anchor              |
| Rate limiting      | present, **по самоличност** (токен / HA user / акаунт), не по IP | keep + per-role                |
| Input validation   | present                                                          | schema-validated API v2        |
| Untrusted HTML     | sandbox без `allow-same-origin`, `connect-src 'none'` (`site-csp.js`) | отделен origin за проектите |

> **Администраторският токен не е HA токен (0.69.87).** Опцията `token` е admin токенът на
> hAPI; Home Assistant long-lived access token (JWT с `iss`, без `sub`/`scope`) отваря целия
> HA API, тоест едно изтичане на hAPI токена става изтичане на Home Assistant и ротацията на
> едното чупи другото. Затова `start.js` разпознава формата (`runtime-config.tokenShape`) и
> пише `ADMIN_TOKEN_LOOKS_LIKE_HA_LLAT` — **предупреждение, не отказ**, за да не се чупят
> работещи инсталации. Тест: `admin-token-shape`. Ръководство: `08_USER_GUIDES/admin-token.md`.

> Защо не по IP (`BUG-05`, 0.69.15): зад Home Assistant Ingress всички заявки идват от
> един и същ peer (проксирането на Supervisor), затова лимит по IP заключва целия панел
> заради един грешен клиент. Броячът е по `sha256` на предявения Bearer токен, по HA
> самоличност (`X-Remote-User-Id/-Name`) или по акаунт при вход. Peer-ът остава втори,
> висок таван (200/мин за админ API, 60/мин за вход) само срещу заливка с ротиращи се
> токени; истинските граници са 12 грешки/мин на токен и 10 грешки/мин на акаунт.

## Role matrix

| Capability      | admin | operator | viewer | court |
| --------------- | :---: | :------: | :----: | :---: |
| Manage files    |   ✅   |    ✅     |   ❌    |   ❌   |
| Grant access    |   ✅   |    ❌     |   ❌    |   ❌   |
| View documents  |   ✅   |    ✅     |   ✅    |   ✅   |
| Verify evidence |   ✅   |    ✅     |   ✅    |   ✅   |
| Export audit    |   ✅   |    ❌     |   ❌    |   ❌   |
