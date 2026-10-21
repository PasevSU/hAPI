# Work Breakdown Structure — hAPI Enterprise

## 1. Core & domain

- 1.1 Registry (metadata-driven profiles/fields).
- 1.2 Variable store (composite-key variables).
- 1.3 Groups / profiles / records lifecycle.
- 1.4 Orphan records and association.
- 1.5 DI container + Event Bus.
- 1.6 Repository interface → SQLite implementation.

## 2. Security & crypto

- 2.1 RBAC (admin / operator / viewer).
- 2.2 Home Assistant Ingress SSO (X-Remote-User).
- 2.3 Token bootstrap + timing-safe comparison.
- 2.4 AES-256-GCM encryption at rest.
- 2.5 Signing (HMAC-SHA256 → PKCS#7 detached).
- 2.6 RFC 3161 timestamping (TSA).
- 2.7 Key management / lifecycle.
- 2.8 Audit chain (hash-chained, append-only).

## 3. Documents

- 3.1 Preview + thumbnails.
- 3.2 Versioning.
- 3.3 PDF watermarks.
- 3.4 PDF images + tables.
- 3.5 xlsx / pptx extraction.

## 4. Sharing & portal

- 4.1 QR artifact generation.
- 4.2 Branded landing page.
- 4.3 QR revocation / expiry.
- 4.4 Evidence portal (roles, verification, chain of custody).
- 4.5 Case report (PDF) generation.

## 5. Operations

- 5.1 Backup / restore.
- 5.2 Job queue with progress + cancel/pause.
- 5.3 Storage checks.
- 5.4 Retention + audit export.
- 5.5 Diagnostics + error log.
- 5.6 Migration (zero-damage, hash-verified).

## 6. Packaging

- 6.1 HA add-on (Supervisor + Dockerfile).
- 6.2 HACS custom component (fail-closed bridge).
- 6.3 Windows installer + portable ZIP (embedded Node).
- 6.4 Desktop GUI (pywebview).
