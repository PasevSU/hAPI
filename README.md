<p align="center">
  <img src="img/banner-thin.png" alt="hAPI Enterprise — document vault with verifiable integrity, powered by PasevSU" width="100%">
</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FPasevSU%2FhAPI">
    <img src="https://img.shields.io/badge/ADD_REPOSITORY-my.home--assistant-41BDF5?style=for-the-badge&logo=homeassistant" alt="Add repository to Home Assistant">
  </a>
  <a href="https://my.home-assistant.io/redirect/supervisor_addon/?addon=hapi_enterprise&repository_url=https%3A%2F%2Fgithub.com%2FPasevSU%2FhAPI">
    <img src="https://img.shields.io/badge/OPEN_ADD--ON-my.home--assistant-18BC9C?style=for-the-badge&logo=homeassistant" alt="Open the add-on">
  </a>
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=PasevSU&repository=hAPI&category=integration">
    <img src="https://img.shields.io/badge/HACS-Integration-41BDF5?style=for-the-badge&logo=homeassistant" alt="Open in HACS">
  </a>
</p>

# hAPI Enterprise — Home Assistant add-on

[![License](https://img.shields.io/badge/License-Apache%202.0-ff00d8.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Version](https://img.shields.io/badge/version-0.69.15-ff00d8.svg)](https://github.com/PasevSU/hAPI)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-blue?logo=nodedotjs)](https://nodejs.org)
[![Architectures](https://img.shields.io/badge/arch-amd64%20%7C%20aarch64%20%7C%20armv7-informational)](hapi_enterprise/README.md#raspberry-pi-and-small-boards)
[![Home Assistant](https://img.shields.io/badge/.-HOME_ASSISTANT-blue?logo=homeassistant)](https://www.home-assistant.io/)
[![Български](https://img.shields.io/badge/BG-ЕЗИК-green?logo=translate&labelColor=gray&style=flat-square)](BG.md)
[![Deutsch](https://img.shields.io/badge/DE-SPRACHE-green?logo=translate&labelColor=gray&style=flat-square)](DE.md)

**hAPI Enterprise** (Home Assistant Portal Enterprise) is a self-hosted platform for
**official document processing, QR sharing, and cryptographic evidence verification**.
It runs on the edge between **Home Assistant** and **Windows** — one shared Node.js
backend, one admin console, two environments.

It is *not* another file browser. It is a **document vault with mathematical proof**: the
moment an official document is submitted, its integrity becomes verifiable by a judge or
prosecutor in a court — without trusting the server that stores it.

---

## The idea

A court, a notary, a law office, or any organization dealing with official documents needs
one thing more than storage: **proof**. Proof of who submitted a document, when, that it
has not been altered since, and that the copy you are looking at is the real one.

hAPI Enterprise turns an ordinary Home Assistant installation (or a Windows PC) into that
machine:

- **Structured core** — every document, person, and case lives in a configurable
  *variable hierarchy* (DOCFLOW), not in a flat folder of loose files.
- **QR sharing** — each case or document gets a **QR code**. Scanning it opens a branded
  portal where the recipient can view and, crucially, **verify** the document.
- **Cryptographic proof** — uploads are fingerprinted, sealed with signatures and
  timestamps, and recorded in a tamper-evident audit chain.

## The problem it solves — forged documents

A digital document is trivial to forge. A PDF, a photo, or a scan can be edited with no
visible trace. In a legal context, "I received it by e-mail" or "I downloaded it from a
cloud link" proves **nothing** about:

1. **Who** submitted it and **when** — provenance.
2. **Whether it changed** after submission — integrity.
3. **Whether the copy on screen is identical** to the original — verification.
4. **Whether the chain of custody is unbroken** and auditable — custody.

E-mail, USB sticks, and cloud links answer none of these. hAPI Enterprise answers all four
with **cryptography that anyone can check independently**, not with promises.

## How the QR code proves a document is genuine

When an authorized person (prosecutor, clerk, investigator) submits an official document:

1. **Fingerprint.** SHA-256/SHA-512 hashes are computed *before* upload in the browser and
   *again* on the server; they must match.
2. **Receipt.** A cryptographic receipt is issued — hash, size, uploader, and time — sealed
   with a **PKCS#7 detached signature** and an **RFC 3161 timestamp** (for evidence).
3. **Chain of custody.** The event is appended to a **hash-chained, append-only audit log**:
   every record carries the hash of the previous one, so altering history visibly breaks
   the chain.
4. **QR code.** A QR is generated. Scanning it opens the branded portal for that case/file.

The judge scans the QR, signs in (court identity provider or PKCE + MFA), and sees every
document with its integrity status. A **Verify** action recomputes the hash **in the
browser** via WebCrypto and compares it against the receipt — a green "integrity confirmed"
appears only on an exact match. A **verification package** (receipt + signature + timestamp
+ chain) can be downloaded and archived by the court.

Because evidence is **immutable (WORM)** and the audit log is hash-chained, a forged or
modified document **cannot pass verification**, and every attempt is permanently recorded.
In hAPI Enterprise, forged documents are a **solved problem** — enforced by math, not by
trusting a server.

## Why hAPI Enterprise

- **Self-hosted on the edge.** No cloud. Documents stay under your control, in Home
  Assistant or on a Windows PC.
- **Zero Trust.** RBAC, Home Assistant Ingress SSO, AES-256-GCM encryption at rest,
  timing-safe token comparison.
- **Nothing to leak.** Shared secrets are encrypted in the browser and the whole link lives
  after `#`; the add-on is sent only `sha256(id)` and stores an opaque envelope, so it can
  neither read the secret nor tell which record a visitor opened.
- **Configurable core, not a template.** DOCFLOW's variable hierarchy means new profiles
  are *data*, not new code.
- **Real features, real tests.** Every feature ships a backend handler and an automated
  test — never just a UI button.
- **Two packages, one backend.** Home Assistant add-on (HACS) and a self-contained
  Windows runtime.
- **Multi-language.** BG / DE / EN.

---

## Overview

hAPI Enterprise is built around a **configurable core, not an enterprise template**. The
center is the *variable hierarchy*: every field of every profile is a variable with a
composite key `{prefix}-{ID_db}-{id_gruppe}-{field}`, grouped under a stable `id_gruppe`.
Profiles are generated automatically when a folder (group) is created; records can exist
without a folder (orphan) and be associated later.

| Layer          | What it provides                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core**       | DI container, Event Bus, metadata-driven Registry, groups/profiles/records/variables                                                                                    |
| **Data**       | Transactional SQLite store (`node:sqlite` `DatabaseSync`) behind a Repository interface                                                                                 |
| **Documents**  | Preview, thumbnails, versioning, PDF watermarks, PDF images + tables, xlsx/pptx extraction                                                                              |
| **Sharing**    | QR artifacts, branded landing page, QR revocation, dispatch via Home Assistant notify, NFC/QR tag and universal link for the Companion app, zero-knowledge secret links |
| **Security**   | RBAC + HA Ingress SSO, AES-256-GCM encryption at rest, retention + audit export                                                                                         |
| **Operations** | Backup/restore, job queue with progress, load control, storage checks, diagnostics, error log, config profiles                                                          |

Every feature ships with a real backend handler and an automated test — never just a UI
button. Architecture decisions are recorded as ADRs and every feature passes the §9.1
flexibility checklist (config-off, replaceable, interface, event, migration+rollback,
ADR, isolated test).

**Roadmap status:** Phases 1–4 are complete (core, flexibility, document processing, QR
sharing). Phases 5–11 are planned — settings + progress center, zero-damage migration, the
**evidence portal** for judges and prosecutors, a **public API v2 + SDK**, unified
packaging (incl. Windows WebView2), the **Enterprise Control Center** UI, and
**Report Studio** (manifest-driven reports inside a locked `RFC 3161 START → STOP` scope).
[`docs/plan/15-unified-master-plan-v6.0.md`](docs/plan/15-unified-master-plan-v6.0.md) is
the **single source of truth** (phases 0–11, backlog, traceability); `08`–`14` remain as
history and detailed annexes.

## Repository layout

| Path                                 | Purpose                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `hapi_enterprise/`                   | The Home Assistant add-on (source, ready to build and run)                                                       |
| `custom_components/hapi_enterprise/` | HA custom integration: public API bridge + portal page, UI setup (config/options flow) and telemetry sensors     |
| `hacs.json`                          | HACS manifest — add this repository as a custom repository (Integration)                                         |
| `tests/`                             | Automated test suite (`npm test`, 118 scenario files, 100% gate)                                                 |
| `scripts/`                           | Test runner (`test-matrix.cjs`), dev dashboard and the release tools (`build-release.cjs`, `verify-release.cjs`) |
| `docs/`                              | Documentation, plans (`docs/plan/15` is canonical) and ADR links                                                 |
| `documentation/`                     | Governance, ADR registry, migration, testing, release, user guides                                               |
| `archive/`                           | Read-only history: old plans, `ANALYSIS.md`, first SDK client                                                    |
| `hapi_enterprise/ui/`                | Enterprise Control Center GUI — 13 panels + Report Studio (plain JS, no server, no npm)                          |
| `START_HAPI_GUI.bat`                 | Opens `hapi_enterprise/ui/index.html` from disk (Edge/Chrome app window) — GUI for testing                       |
| `api/` *(planned, phase 8)*          | Postman collection + published OpenAPI contract (generated by `api-spec.js`)                                     |
| `sdk/` *(planned, phase 8)*          | Public client SDK (from `archive/SDK/client.mjs`)                                                                |
| `img/`                               | Brand banners, logo and icons used by the documentation                                                          |
| `CHANGELOG.md`                       | Release notes for the add-on and the integration                                                                 |
| `dist/` *(generated)*                | Release artifacts from `node scripts/build-release.cjs` (git-ignored)                                            |

## Requirements

- Node.js `>= 22.13` (required for the built-in `node:sqlite` `DatabaseSync` API)
- Home Assistant Supervisor for the add-on, or Windows for the desktop runtime

## Install

**Integration (HACS).** HACS → ⋮ → Custom repositories → `https://github.com/PasevSU/hAPI`,
category **Integration** → install **hAPI Enterprise** → restart Home Assistant. Then either
add it from **Settings → Devices & Services** (admin API URL + token → 7 telemetry sensors)
or keep using YAML for the portal proxy. Details: [`documentation/08_USER_GUIDES/install-hacs.md`](documentation/08_USER_GUIDES/install-hacs.md).

**Add-on.** Supervisor → Add-on Store → ⋮ → Repositories → `https://github.com/PasevSU/hAPI`,
then install **hAPI Enterprise** and set an admin token (≥ 24 characters). Details:
[`documentation/08_USER_GUIDES/public-gateway-setup.md`](documentation/08_USER_GUIDES/public-gateway-setup.md).

**Local add-on and integration (no GitHub).** Both parts can be deployed from this working
copy, so Home Assistant lists the add-on under **Local apps** instead of the GitHub
repository version:

```powershell
npm run sync:local                                              # add-on + integration
pwsh -NoProfile -File scripts/sync-local-addon.ps1 -VerifyOnly   # checks only
pwsh -NoProfile -File scripts/sync-local-addon.ps1 -Backup       # keep the previous copy
```

The script copies `hapi_enterprise/` → `/addons/hapi_enterprise` and
`custom_components/hapi_enterprise/` → `/config/custom_components/hapi_enterprise`
(`robocopy /MIR`, overridable with `-Target` / `-IntegrationTarget`) and refuses to finish
when the layout is broken: `config.yaml` keys, every `Dockerfile` `COPY` source and
`exec node /app/server.js` for the add-on; `manifest.domain === hapi_enterprise`, SemVer
version, `__init__.py`, `config_flow.py`, `sensor.py`, `strings.json` for the integration.
The same actions exist as VS Code tasks (`hAPI: синхронизирай локалния add-on`,
`hAPI: провери локалния add-on`, `hAPI: пълен тестов пакет`). After a sync:
**Settings → Add-ons → ⋮ → Check for updates → Rebuild**; remove
`https://github.com/PasevSU/hAPI` from **⋮ → Repositories** if the GitHub copy (0.54.0)
should not show up next to the local one. Home Assistant only loads a custom component
whose folder name equals the `domain` in its `manifest.json` — a copy under
`custom_components/hAPI Enterptice` is ignored silently.

**Before the first start** — token, storage location (`addon_config` vs `share`), network
mounts, public address and admin role mapping: see
[`hapi_enterprise/README.md` → Recommended settings](hapi_enterprise/README.md#recommended-settings-before-you-install).

**Release artifacts.** `node scripts/build-release.cjs` writes `dist/`
(`hapi_enterprise-<version>.tar.gz`, `hapi_enterprise-integration-<version>.zip`,
`repository.yaml`, `RELEASE.json`, `SHA256SUMS.txt`). `node scripts/verify-release.cjs`
checks 20 scenarios before anything is published. Tagging `v<version>` runs the same
build + verification in GitHub Actions and attaches the artifacts to the release.

## Quick links

- [Documentation](docs/)
- [Unified master plan v6.0 (canonical)](docs/plan/15-unified-master-plan-v6.0.md)
- [Architecture decisions (ADR)](documentation/03_ADR/)
- [Evidence portal plan (Phase 7)](docs/plan/14-phase-7-evidence-portal.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Release qualification](RELEASE_QUALIFICATION.md)

## License

[Apache 2.0](LICENSE)
