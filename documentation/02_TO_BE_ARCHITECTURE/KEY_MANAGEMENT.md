# Key Management — hAPI Enterprise (To-Be)

## Key classes

| Class | Purpose | Storage |
| ----- | ------- | ------- |
| `SIGNING` | PKCS#7 detached signatures | HSM / TPM / encrypted keystore |
| `ENC_FILE` | per-file AES-256-GCM keys | wrapped by master key |
| `TSA` | trust anchors (TSA certs) | trust store (read-only) |
| `HMAC` | legacy receipts (backward compat) | derived from master secret |

## Lifecycle

```text
generate → store (wrapped) → use → rotate → revoke/retire → audit
```

- **Rotation** — new key signs new docs; old key kept for verify-only (trust store).
- **Revocation** — CRL/OCSP or local revocation list; old signatures remain valid under old key.
- **Master key** — AES-256, wrapped by `scrypt`-derived key from a passphrase or OS-protected store.

## Storage options (ranked)

1. TPM/HSM (preferred, hardware-backed).
2. Encrypted keystore file (PKCS#8, passphrase-protected).
3. HA `secrets.yaml` (lowest, dev only).

## Invariants

- Private keys never in plaintext on disk, never in logs, never in audit entries.
- Public certs/keys are public; only private material is secret.
