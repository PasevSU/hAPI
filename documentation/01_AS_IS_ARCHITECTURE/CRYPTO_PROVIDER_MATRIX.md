# Crypto Provider Matrix — hAPI Enterprise

## Current (As-Is) vs Target (To-Be)

| Capability | Current provider | Current state | Target (Phase 7) |
| ---------- | ---------------- | ------------- | ----------------- |
| Hash (integrity) | SHA-256 | ✅ `signer.js` / manifest | + SHA-512 |
| Receipt (provenance) | HMAC-SHA256 over canonical record | ✅ `signer.js` | signed by server key |
| Detached signature | — | ⏳ missing | PKCS#7 detached (X.509) |
| Timestamp | — | ⏳ missing | RFC 3161 (TSA) |
| Chain of custody | hash-chained append-only log | ✅ `audit-chain.js` | + external anchor hash |
| Encryption at rest | AES-256-GCM per file | ✅ `file-crypto.js` | + per-file key (SECRET class) |
| WORM (immutable) | `flag:'wx'` partial | ⚠️ partial | EVIDENCE mode + dedicated volume |
| Random / KDF | Node crypto + `scrypt` (passwords) | ✅ | reviewed against OpenPGP v6 / key lifecycle |

## Algorithm policy

| Purpose | Allowed | Banned / deprecated |
| ------- | ------- | ------------------- |
| Hashing | SHA-256, SHA-512 | MD5, SHA-1 |
| Symmetric | AES-256-GCM | ECB, CBC without auth |
| Signing | Ed25519 / RSA (PKCS#7) | raw RSA without padding |
| Timestamp | RFC 3161 | self-asserted time (only as fallback with warning) |

## Provider interfaces (To-Be)

- `CryptoProvider` — sign/verify abstraction (HMAC → PKCS#7 interchangeable).
- `TsaClient` — RFC 3161 client (replaceable TSA URL).
- `KeyManager` — key lifecycle (see `02_TO_BE_ARCHITECTURE/KEY_MANAGEMENT.md`).
