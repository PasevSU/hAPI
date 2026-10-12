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

| Control | Current | Target |
| ------- | ------- | ------ |
| Authentication | HA SSO + local | + TOTP for admin-ops |
| Authorization | RBAC (admin/operator/viewer) | + court/prosecutor viewer role |
| Encryption at rest | AES-256-GCM | + per-file keys |
| Integrity | SHA-256 | + SHA-512 + PKCS#7 + RFC 3161 |
| Immutability | `flag:'wx'` partial | dedicated WORM volume |
| Auditing | hash-chained log | + external anchor |
| Rate limiting | present | keep + per-role |
| Input validation | present | schema-validated API v2 |

## Role matrix

| Capability | admin | operator | viewer | court |
| ---------- |:-----:|:--------:|:------:|:-----:|
| Manage files | ✅ | ✅ | ❌ | ❌ |
| Grant access | ✅ | ❌ | ❌ | ❌ |
| View documents | ✅ | ✅ | ✅ | ✅ |
| Verify evidence | ✅ | ✅ | ✅ | ✅ |
| Export audit | ✅ | ❌ | ❌ | ❌ |
