# Crypto Test Vectors — hAPI Enterprise

## Purpose

Deterministic, published vectors so any implementation (Node, Python, third-party)
can verify identical behavior — required for court-grade reproducibility.

## Hashing

| Input | SHA-256 (hex) |
| ----- | ------------- |
| `""` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `"abc"` | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |
| `"hAPI"` | (computed at build; fixed once Phase 7 freeze) |

## Canonical manifest (example)

```json
{
  "schema": "hapi.evidence.manifest/v1",
  "object_id": "<id>",
  "hash_sha256": "<hex>",
  "hash_sha512": "<hex>",
  "signature": "<pkcs7-base64>",
  "timestamp_token": "<rfc3161-base64>"
}
```

## Signature / timestamp vectors

- PKCS#7 detached over canonical JSON (fixed field order, no whitespace).
- RFC 3161 token from configured TSA; verified against TSA cert.

## Rules

- Vectors must never depend on wall-clock or random nonce.
- Canonicalization: UTF-8, stable key order, no trailing whitespace.
- A failing vector blocks release (see `ADR-0012`).
