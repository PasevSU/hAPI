# Project Charter — hAPI Enterprise

| Field | Value |
| ----- | ----- |
| **Project** | hAPI Enterprise (formerly `portal_enterprise`) |
| **Module / add-on slug** | `hapi_enterprise` |
| **Version** | 0.50.0 |
| **License** | Apache License 2.0 |
| **Owner** | PasevSU DEV (Home Assistant Projects, NO TRUST Cybersecurity campaign) |
| **Status** | Active — Phases 1–4 complete, Phases 5–11 planned ([unified plan v6.0](../../docs/plan/15-unified-master-plan-v6.0.md)) |

## 1. Vision

Turn a Home Assistant installation (or a Windows PC) into a **self-hosted platform for
official document processing, QR sharing, and cryptographic evidence verification** — a
document vault with *mathematical proof*, not just storage.

## 2. Mission

Give courts, notaries, law offices, and any organization that handles official documents
the ability to prove — independently of any server — **who** submitted a document, **when**,
that it has **not changed**, and that the copy on screen **is the original**.

## 3. Problem statement

A digital document is trivially forgeable. E-mail, USB, and cloud links prove nothing about
provenance, integrity, verification, or chain of custody. hAPI Enterprise answers all four
with **cryptography that can be checked independently**.

## 4. Scope

**In scope**
- Configurable DOCFLOW core (variable hierarchy, auto-generated profiles, orphan records).
- Document processing (preview, thumbnails, versioning, watermarks, PDF/OOXML extraction).
- QR sharing with a branded landing portal and revocation.
- Cryptographic evidence: SHA-256/512, receipts, PKCS#7 detached signatures, RFC 3161
  timestamps, hash-chained audit log, WORM evidence storage.
- Two runtimes: Home Assistant add-on (HACS) and self-contained Windows desktop.
- Security: RBAC, HA Ingress SSO, AES-256-GCM at rest, retention + audit.

**Out of scope (currently)**
- Multi-node / clustered deployment (single Node.js process + SQLite is the target).
- External cloud storage dependencies.

## 5. Stakeholders

| Role | Interest |
| ---- | -------- |
| End users (judges, prosecutors, clerks, investigators, experts) | Verified, auditable access to evidence |
| Administrators | Self-hosted control, security, backups |
| Developers / contributors | Configurable, testable, replaceable architecture |

## 6. Guiding principles

The eight DOCFLOW principles (P1–P8) and the §9.1 flexibility checklist govern every
decision: flexibility over fixedness, metadata-driven schemas, interfaces over concrete
implementations, events for all observable behavior, versioning, migration with rollback,
and an ADR for every architectural decision.

## 7. Success criteria

1. Every feature ships a real backend handler and an automated test — never just a UI button.
2. A judge can verify a document's integrity in the browser without trusting the server.
3. Forged or modified documents cannot pass verification; attempts are permanently recorded.
4. The add-on installs via HACS and the Windows package runs self-contained (embedded Node).

## 8. Related documents

- Master plan: `docs/plan/08-master-plan-v5.0.md`
- Execution plan: `docs/plan/09-execution-plan.md`
- Roadmap: `documentation/00_GOVERNANCE/ROADMAP.md`
