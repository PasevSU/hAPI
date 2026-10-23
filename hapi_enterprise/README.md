<p align="center">
  <img src="https://raw.githubusercontent.com/PasevSU/hAPI/HEAD/img/banner-thin.png" alt="hAPI Enterprise — document vault with verifiable integrity" width="100%">
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

<p align="center">
  <a href="https://github.com/PasevSU/hAPI"><img src="https://img.shields.io/badge/version-0.69.45-ff00d8.svg" alt="Version"></a>
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-ff00d8.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Home%20Assistant-2024.6%2B-41BDF5?logo=homeassistant" alt="Home Assistant 2024.6+">
  <img src="https://img.shields.io/badge/arch-amd64%20%7C%20aarch64-informational" alt="Architectures">
</p>

# hAPI Enterprise — Home Assistant add-on

A self-hosted document vault for official documents: structured (DOCFLOW) records, QR
sharing through a branded portal, and **cryptographic proof of integrity** — SHA-256/512
fingerprints, signed receipts, trusted timestamps and a hash-chained audit log.

Everything runs on your own Home Assistant host. No cloud, no external service, no
account.

## What it gives you

- **Structured records** — people, cases and documents live in a configurable variable
  hierarchy instead of a flat folder of loose files.
- **QR sharing** — every case or document gets a QR code that opens a branded portal on
  your Home Assistant address. The recipient can view the document and verify it.
- **Tags for the phone** — each portal also gets a Home Assistant tag
  (`https://www.home-assistant.io/tag/<id>`) and a universal link
  (`https://www.home-assistant.io/ios/nfc/?url=<…>`), so an NFC sticker or a printed QR opens
  the portal from the Companion app. The console shows the tag id and a ready-to-paste
  automation for the `tag_scanned` event.
- **Share a secret — zero-knowledge** — the console encrypts the text in your browser
  (AES-GCM 256) and the add-on stores only an opaque envelope. The whole link lives in the
  fragment — `/secret#<id><key>` — so the path carries no identifier and the server is sent
  only `sha256(id)`: it cannot tell which record you open and cannot rebuild the link. One
  view and 24 hours by default; the record is deleted after the last view or when it
  expires. An optional **second password** wraps the envelope in another AES-GCM layer
  (PBKDF2-SHA256, 600 000 iterations) — without it even the full link is not enough.
- **Proof, not promises** — each upload is fingerprinted, sealed and timestamped, and the
  audit trail is hash-chained, so tampering is detectable.
- **One backend, two worlds** — the same Node.js service runs as a Home Assistant add-on
  and on a Windows edge machine.
- **Home Assistant native** — Ingress console in the sidebar, Supervisor watchdog, cold
  backups, RBAC mapped to HA users/groups.

## How it works

1. A document is uploaded to a portal (console, API or folder import).
2. The add-on stores it under the portal's vault and records size + SHA-256.
3. The record is sealed (signature, optional RFC 3161 timestamp) and appended to the
   hash-chained audit log.
4. The portal gets a QR code pointing at `/p/<portal>` on your Home Assistant address.
5. The recipient opens the portal, downloads the file and can re-check the hash — the
   numbers must match.

## Install

**Fast path:** use the **ADD REPOSITORY** button above, then install **hAPI Enterprise**
from the add-on store.

Manual path:

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, add
   `https://github.com/PasevSU/hAPI`.
2. Install **hAPI Enterprise**.
3. **Start** the add-on and open the console from the sidebar or via **Open Web UI**.
   The console lives at `/admin` behind Ingress. There is nothing to paste: the panel is
   an ordinary sidebar button and signs you in with your Home Assistant account.
   The values in [Recommended settings](#recommended-settings-before-you-install) are a
   safe starting point.

Optional: the Home Assistant integration (public API bridge, portal page and telemetry
sensors) is installed through HACS from the same repository — see
[`documentation/08_USER_GUIDES/install-hacs.md`](../documentation/08_USER_GUIDES/install-hacs.md).

## Requirements

- Home Assistant OS or Home Assistant Supervised (the add-on needs the Supervisor).
- Architecture `amd64` or `aarch64`.
- No credential to prepare: the console authenticates with the Home Assistant user who
  opens it. There is no admin token in the options — the encryption and signing key is
  generated once, stored in `/data/admin-token` and never shown.

## Recommended settings before you install

Five minutes of preparation avoids almost every first-start surprise.

1. **Take a Home Assistant snapshot first** — Settings → System → Backups → *Create
   backup*. The add-on uses `backup: cold`, so future snapshots stop it for a moment.
2. **Decide where documents live.**
   - `addon_config` (default) — the vault stays inside the add-on's own folder
     (`/addon_configs/hapi_enterprise` on the host) and survives add-on updates.
   - `share` — documents land in the shared folder, visible over Samba and to other
     add-ons; pick this when `/share` is what you already back up.
3. **For network storage**, create the mount in Settings → System → Storage **before**
   starting the add-on. With `storage_mode: ha_network` the add-on refuses to start when
   the mount is inactive instead of silently writing to the boot disk.
4. **Decide who is admin.** The user who installs the add-on is an administrator; every
   other Home Assistant user is `admin` as well unless you map them in `user_roles` or
   `group_roles`. No token is generated, copied or stored by hand.
   Do not reuse a human password.
5. **Decide the public address.** With the HACS integration the public channel runs on
   the Home Assistant address itself (`public_same_origin: true`, `public_gateway: false`).
   Set `public_gateway: true` only if you will reverse-proxy port `8088` yourself.
   `public_domain` must be an address a phone can reach — otherwise the QR codes open
   nothing.
6. **Admin is the default.** The console opens with full admin rights for any Home
   Assistant user who reaches the Ingress panel; no mapping is needed to start working.
   Roles are **optional**: add `user_roles` / `group_roles` only to *demote* specific
   people (for example `{"guest": "viewer"}`). Anyone you do not map stays `admin`,
   so protect the add-on at the Home Assistant user level.

### Starting point (copy into the Configuration tab, YAML mode)

```yaml
storage_location: addon_config
storage_subdirectory: hapi_enterprise
storage_mode: local
min_free_mb: 200
log_level: info
public_domain: ""
public_same_origin: true
public_gateway: false
user_roles: '{"your_ha_username":"admin"}'
backup_folder: ""
config_dir: ""
db_id: "1"
profiles: ""
tsa_enabled: true
tsa_start_url: "https://zeitstempel.dfn.de/"
tsa_stop_url: "http://timestamp.digicert.com"
sign_packages: false
signing_key: ""
encrypt_files: true
tls_cert: ""
tls_key: ""
```

| Option                 | Recommended                | Why                                                                   |
| ---------------------- | -------------------------- | --------------------------------------------------------------------- |
| `storage_location`     | `addon_config`             | Isolated by default; switch to `share` only for cross-add-on access.  |
| `storage_subdirectory` | `hapi_enterprise`          | One predictable folder under the chosen location.                     |
| `storage_mode`         | `local`                    | `ha_network` only with an active mount, otherwise startup fails.      |
| `min_free_mb`          | `200` (500+ for scans)     | Fails closed before a half-written upload fills the disk.             |
| `log_level`            | `info`                     | `debug` writes one line per request — use it only while diagnosing.   |
| `public_domain`        | your external host         | QR codes are absolute URLs; empty domain = LAN-only portals.          |
| `public_same_origin`   | `true`                     | The integration serves the public API on HA's own host and port.      |
| `public_gateway`       | `false`                    | Avoids publishing an extra port; enable only with your own proxy.     |
| `user_roles`           | *(empty → admin)*          | Optional: demote individual HA users, e.g. `{"guest": "viewer"}`.     |
| `backup_folder`        | *(empty)*                  | Empty → `<storage>/backups`, inside the tree you already back up.     |
| `backup_mirror`        | *(empty)*                  | Optional second copy target; every copy is verified with SHA-256.     |
| `storage_mirror`       | *(empty)*                  | Optional second copy of every uploaded file; verified and repairable. |
| `memory_limit_mb`      | `0` (Node default)         | Heap cap (`--max-old-space-size`); `256`–`384` on a Raspberry Pi.     |
| `config_dir`           | *(empty)*                  | Empty → `/config/rules`, editable over Samba/SSH without a restart.   |
| `db_id`                | `1`                        | Change only for a second, independent database.                       |
| `profiles`             | *(empty)*                  | Add later from the console; invalid JSON is ignored at startup.       |
| `tsa_enabled`          | `true`                     | Real RFC 3161 tokens for START/STOP; `false` disables the endpoint.   |
| `tsa_start_url`        | DFN                        | START TSA for the manifest hash; any RFC 3161 http(s) endpoint.       |
| `tsa_stop_url`         | DigiCert                   | STOP TSA for the closing digest of the report scope.                  |
| `sign_packages`        | `false` until a key exists | Signs every package; enable only after attaching a private key.       |
| `signing_key`          | *(empty)*                  | Fingerprint/key ID; empty = the key selected in the console.          |
| `encrypt_files`        | `true`                     | Uploads are encrypted at rest (AES-256-GCM) unless a header says no.  |
| `tls_cert` / `tls_key` | *(empty)*                  | Set both to serve the add-on's own listeners over HTTPS.              |

### First two minutes after start

- The add-on log shows `rules.seeded` (or `rules.defaults`) and `listening` for ports
  `8099` and `8098` — `8088` only when the public gateway is enabled.
- The console opens from the sidebar; **Settings → storage check** is green.
- `GET /health` on `8099` answers `{"status":"ok"}`.
- Create one portal, open `/p/<portal>` on the same address, scan the QR code from a
  phone — if the page does not load, `public_domain` is wrong.

## Configuration

All options are optional and have a default — a fresh installation works without editing
this tab. Options apply on add-on restart.

<!-- SETTINGS-DEFAULTS:START — генерира се от scripts/settings-defaults.cjs; не се редактира на ръка -->

| Setting | Key | Default | What the default means |
| --- | --- | --- | --- |
| Console user name | `username` | — | Empty: a standalone console user `api` is created on first start. Under Ingress the Home Assistant account is used. |
| Console password | `password` | — | Empty: a random password is generated on first start and written to `api-credentials.txt` (mode 0600). |
| Database and portal name | `db_name` | `Files` | Names the first portal (`Files`, slug `files`). Change it before the first start to get another name. |
| Backup folder | `backup_folder` | — | Empty: `<storage>/backups` inside the add-on data folder. A relative path resolves inside `/share`. |
| Backup mirror folder | `backup_mirror` | — | Empty: no second copy of the database backups. Every configured copy is verified with SHA-256. |
| File mirror folder | `storage_mirror` | — | Empty: no second copy of uploaded files. A configured mirror is verified and repairable. |
| Node heap limit (MB) | `memory_limit_mb` | `0` | `0` keeps the Node.js default heap. `256`-`384` is the sane range on a Raspberry Pi. |
| Database id | `db_id` | `1` | `1` is the default namespace for composite keys. Change it only for a second, independent database. |
| Configuration profiles | `profiles` | — | Empty: the built-in profile set is used. A path or JSON replaces it; invalid JSON is ignored. |
| Public domain | `public_domain` | — | Empty: relative links only — portals and QR codes work on the local network, not from the internet. |
| Public API gateway | `public_gateway` | `false` | `false`: port `8088` stays unpublished. `true` opens the add-on gateway for your own reverse proxy. |
| Same-origin URLs | `public_same_origin` | `false` | `false`: absolute URLs are built from `public_domain`. `true` emits relative URLs on the HA host and port. |
| User roles | `user_roles` | — | Empty: every Ingress user is `admin`. The map is for demotion, e.g. `{"guest": "viewer"}`. |
| Group roles | `group_roles` | — | Empty: no group mapping. Home Assistant does not send groups; a reverse proxy that adds them can. |
| Storage location | `storage_location` | `addon_config` | `addon_config`: documents live in the add-on folder. `media` and `share` are shared HA folders. |
| Storage subdirectory | `storage_subdirectory` | `hapi_enterprise` | `hapi_enterprise`: one predictable subfolder inside the chosen storage location. |
| Storage mode | `storage_mode` | `local` | `local`: the mounted folder is used directly. `ha_network` refuses to start when the mount is inactive. |
| Network storage name | `storage_mount_name` | — | Empty: only meaningful with `storage_mode: ha_network`, where the mount name is required. |
| Minimum free space (MB) | `min_free_mb` | `100` | `100`: startup fails below 100 MB free. Raise it to `500`+ when you scan large folders. |
| Log level | `log_level` | `info` | `info`: no per-request lines. `debug` logs one line per HTTP request; `trace` is for deep diagnostics. |
| Rules directory | `config_dir` | — | Empty: `/config/rules`, where the built-in rules are copied on first start and can be edited. |
| Publish the QR evidence portal | `evidence_portal_deploy` | `true` | `true`: the Evidence View page is copied to `www/hapi/data` in the Home Assistant configuration (`/config/www/hapi/data` for HA, `/homeassistant/www/hapi/data` inside the add-on) and served at `/local/hapi/data/`. |
| RFC 3161 timestamps | `tsa_enabled` | `false` | `false`: the RFC 3161 endpoints answer `409` and no tokens are created. Nothing is ever faked. |
| START TSA URL | `tsa_start_url` | `https://zeitstempel.dfn.de/` | DFN timestamp service for the START boundary (the manifest digest). |
| STOP TSA URL | `tsa_stop_url` | `http://timestamp.digicert.com` | DigiCert timestamp service for the STOP boundary (the closing digest). |
| Sign export packages | `sign_packages` | `false` | `false`: packages are not signed until a private key is attached in the console. |
| Signing key | `signing_key` | — | Empty: signing uses the key selected in the console (Settings → PGP keys). |
| Encrypt stored files | `encrypt_files` | `false` | `false`: uploads are stored as they are; `X-File-Encrypt` still wins per request. |
| TLS certificate | `tls_cert` | — | Empty: HTTPS is off. Certificate and private key must be set together, otherwise startup fails. |
| TLS private key | `tls_key` | — | Empty: HTTPS is off. Both `tls_cert` and `tls_key` or neither. |
| Sensors · IP mode | `visitor_ip_mode` | `hashed` | `hashed`: visitor addresses are stored as SHA-256 hashes. `masked` keeps the subnet, `full` the raw address. |
| Sensors · record lifetime (days) | `visitor_retention_days` | `90` | `90`: visitor records are removed after 90 days. Set `0` to inherit the runtime default. |
| Sensors · geo database file | `visitor_geoip_path` | — | Empty: no offline geo database, so the country stays unknown. An absolute path enables it. |

### Console settings (Settings tab)

Written to `config/settings.json` on the first start. `—` means “inherits from the add-on option or the built-in default”, not “off”.

| Setting | Default |
| --- | --- |
| `artifactDirectory` | `qr-records` |
| `databaseFile` | `db.json` |
| `databaseDirectory` | `.` |
| `organization` | `PasevSU DEV` |
| `project` | `Home Assistant Projects` |
| `campaign` | `NO TRUST Cybersecurity` |
| `backupSchedule.enabled` | `false` |
| `backupSchedule.intervalMinutes` | `1440` |
| `backupSchedule.maxBackups` | `10` |
| `limits.maxUploadMb` | — |
| `limits.maxDownloadStreams` | — |
| `limits.maxJobs` | — |
| `limits.storageCheckMinutes` | — |
| `limits.publicBaseUrl` | `` |
| `limits.corsOrigin` | `` |
| `limits.requirePortalToken` | — |
| `limits.storeRawIp` | — |
| `data.conflictPolicy` | `queue` |
| `data.strictTaxonomy` | `false` |
| `data.defaultCategory` | `` |
| `data.defaultGroup` | `` |
| `data.maxTags` | `30` |
| `retention.enabled` | `false` |
| `retention.fileDays` | — |
| `retention.auditDays` | — |
| `retention.fileAction` | `disable` |
| `preview.enabled` | `true` |
| `preview.thumbnails` | `true` |
| `sensors.ipMode` | — |
| `sensors.trustProxy` | — |
| `sensors.retentionDays` | — |
| `sensors.geoipPath` | `` |

<!-- SETTINGS-DEFAULTS:END -->

### Roles

Roles are `admin`, `operator` and `viewer`. **Admin is the default:** every Home
Assistant user who reaches the Ingress listener is treated as `admin`, so a fresh
installation needs no role configuration.
`user_roles` / `group_roles` are *optional overrides* — a mapped identity uses exactly
that role, which means an explicit mapping can also demote (`bob` → `operator` → writes
allowed, admin-only routes → `403`). A user or group that is not mapped always falls back
to `admin`. `DEFAULT_ROLE=viewer` in the add-on environment flips the fallback for
installations that prefer deny-by-default at the Home Assistant account level.
`GET /admin/api/whoami` reports the effective `role`, `ingress` and `defaultRole`.

### Mirrors and backups

With `storage_mirror` set, every upload is written twice and the copy is compared
byte-for-byte. `POST /admin/api/storage/mirror/verify` re-hashes both sides
(`ok` / `primaryMissing` / `mirrorMissing` / `mismatch` / `lost`) and `{"repair":true}`
restores the broken side from the healthy one; reading a file whose original vanished
falls back to the copy and puts it back on disk. Deleting a file or a portal removes
its mirror copy too.

Every backup is written to `backup_folder` and then copied to `backup_mirror`. The
copy is hashed again and compared with the original; a copy that does not match is
deleted and logged (`backup.mirror.mismatch`), so a broken mirror can never look like
a valid archive. `POST /admin/api/database/backups/verify` re-hashes every archive and
reports `primary` / `mirror` state (`ok`, `mismatch`, `missing`).

## Storage layout

| Path      | Access | Used for                                                                                              |
| --------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `/config` | `rw`   | Add-on folder (`app_configs/<slug>` on the host): SQLite database, receipts, audit chain, rules, logs |
| `/share`  | `rw`   | Documents and portal folders (`storage_root`)                                                         |
| `/media`  | `rw`   | Optional media/documents folder (`storage_location: media`)                                           |

The add-on folder comes from `map: app_config:rw`; there is no `/addon_config` mount.
The database, documents and logs live under `/config/<storage_subdirectory>`
(default `/config/hapi_enterprise`). Back up `/config` and `/share` together — the
database references documents by path.

## Document Generator (`/generator/`)

A self-contained HTML/CSS/JS document editor: pick a template on the left, edit freely in the
A4 sheet, insert tables, images, warnings or a page break, then print to PDF or save the work
as JSON. It has no build step and no state of its own — everything it shows comes from the
server.

- **Templates are files, not code.** Every `*.html` in `<storage>/generator/temp` is a
  template. Drop one there over Samba/SSH, or upload it with **＋ Шаблон** in the app — it
  appears in the list immediately. There is no `build-index.mjs` and no restart: the index is
  built from the folder on every request (`GET /admin/api/generator/templates`).
- **Nothing is hard-coded.** The add-on ships an empty `temp/`; no court, DSGVO or other
  template is baked into the code. Title for the list comes from `<title>`, then `<h1>`, then
  the file name.
- **Templates never execute on the server.** They are served as `text/plain` with `nosniff`,
  and the editor strips scripts, frames, forms, styles, `on*` attributes and unsafe URLs
  before showing one — the same rule as the standalone generator.
- **Access.** `/generator/` is on the administrative (Ingress) listener and the API sits
  behind the `generator` capability: reading needs any role, uploading or deleting needs
  `admin` or `operator`. Under Ingress the URL is the panel address with `/ui/` replaced by
  `/generator/`; a standalone deployment uses a Bearer token.
- **Storage.** Templates live in the add-on folder, so they survive add-on updates and are
  covered by the `/config` backup. Only `[A-Za-z0-9_.-]{1,80}.html` is accepted and each file
  is capped at 512 KiB.

## Endpoints

- **Ingress** — `/admin` (console), `/p/<portal>` (portal pages), `/api/v1/...`.
  `ingress_stream: true` streams large uploads through the Supervisor instead of
  buffering them in its memory.
- **`/admin/api/portals/<id>/api-info`** returns the portal's landing/API addresses, the QR
  SVG and `links`: the Home Assistant tag id and URL, the universal link, what to write on
  an NFC sticker and a `tag_scanned` automation. `tests/share-links.cjs` pins the two URL
  formats to the Companion documentation.
- **8099/tcp** — internal API only; do not publish it on the host.
- **8088/tcp** — the add-on's own public gateway, only when `public_gateway: true`.
- **Home Assistant port (8123)** — with the optional integration the public channel is
  served by Home Assistant itself:
  `/api/hapi_enterprise/public/v1/portals/<slug>` and
  `/api/hapi_enterprise/public/v1/files/<id>/download`. No additional port is opened;
  `/api/public/v1/...` remains as a deprecated alias.
- **`/health`** — unauthenticated liveness probe on 8099, used by the watchdog.
- **`/secret`** — public page for a shared secret, modelled on scrt.link v2. The whole
  link is the fragment (`/secret#<id><key>`, 22 + 43 chars); `/secret/<anything>` serves the
  same shell so a truncated or old link is not a 404. The page is an empty shell plus
  `/secret-view.js`: the viewer computes `sha256(id)` in the browser, asks
  `GET /api/v2/secrets/<sha256(id)>` what to expect (remaining views, expiry, hint, whether
  a password is needed — **without spending a view**), then `POST /api/v2/secrets/<sha256(id)>
  /reveal` for the envelope and decrypts it locally. With a password the envelope is
  encrypted twice and the request carries `{proof: sha256(PBKDF2(password))}`; a wrong
  proof is `403` and does **not** use up a view. The admin side is
  `GET`/`POST /admin/api/v2/secrets` (create takes `envelope`, `idHash`, `hint`,
  `expires_in`, `max_views` and returns a `receipt`) and `DELETE /admin/api/v2/secrets/<sha256(id)>`
  to revoke. Records live in `<data>/secrets/<sha256(id)>.json` with mode `0600`; neither the
  identifier nor the key is ever written there, and the list returns metadata only.
- **`/ready`** — readiness probe: write access to the storage, a `PRAGMA quick_check` on
  the database and loaded rules. `checks` stays a stable boolean contract
  (`storage`, `db`, `rules`); the database state is reported separately as
  `db.state` = `ok` | `degraded` | `failed` (+ `db.detail`). `degraded` and `failed`
  answer `503`, so a replica with a damaged database is drained instead of writing over
  corrupted pages.
- **Resilience knobs** — `TSA_BREAKER_THRESHOLD` (default `3`) and
  `TSA_BREAKER_COOLDOWN_MS` (default `60000`) control the RFC 3161 circuit breaker: a
  TSA that keeps failing is skipped for the cooldown while the next endpoint in the list
  is used. `GET /admin/api/v2/rfc3161` reports the breaker state. When the configured
  signing key no longer exists, package signing falls back to the available key and
  records `signingFallback` in the package metadata and the audit trail.
- **One instance per data directory** — the add-on takes
  `<storage>/.hapi-instance.json` (id, pid, `pidStart`, host, heartbeat) at start. A second
  process on the same data directory exits with code `1` and names the holder instead of
  corrupting metadata, the audit chain or the TSA archive. A lock left by a dead process is
  taken over automatically: a different `pidStart` (`/proc/<pid>/stat`, field 22) means the
  pid was reused by a newer process, and without `/proc` the decision falls back to
  `startedAt` plus heartbeat freshness. `INSTANCE_ID` names the instance and
  `INSTANCE_STRICT=0` downgrades the refusal to a warning. `/ready` reports `instance.id`,
  so a load balancer can tell replicas apart. If a lock is ever left behind, the refusal
  message names the file to delete.

## Sensors and monitoring

`GET /admin/api/sensors` returns the classic per-portal counters plus an `observer`
aggregate built by `hapi_enterprise/observer.js`:

| Group       | What it answers                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `http`      | requests per listener (`public`/`admin`/`gateway`), status classes, in/out bytes, latency (avg, p50, p95, max) |
| `routes`    | calls per **route template** (`GET /admin/api/portals/:id`), errors, avg/max ms, bytes out                     |
| `files`     | uploads, uploaded bytes, encrypted uploads, deletions, mirror write failures                                   |
| `downloads` | successful downloads and bytes, refused attempts                                                               |
| `visits`    | portal page visits, QR scans, visits per portal                                                                |
| `system`    | restarts, start time, uptime                                                                                   |

Everything is an aggregate: no IP addresses, tokens or file names are stored, and route
templates replace 24-hex ids, UUIDs and slugs, so cardinality stays bounded (200 routes,
then `… other`). Counters survive a restart through `<storage>/sensors.json`
(`restarts` grows on every start); a graceful stop flushes them immediately.

`GET /admin/api/sensors/prometheus` exposes the same data in the Prometheus text format
(`hapi_http_requests_total`, `hapi_http_status_total`, `hapi_http_request_duration_ms`,
`hapi_route_requests_total`, `hapi_route_errors_total`, `hapi_files_uploaded_total`,
`hapi_files_uploaded_bytes_total`, `hapi_downloads_total`, `hapi_download_bytes_total`,
`hapi_visits_total`, `hapi_restarts_total`, `hapi_up`). Both endpoints require the
`sensors` capability: anonymous requests get `401`, while `viewer`/`operator` tokens may
read them for monitoring.

Scrape example (Home Assistant or any Prometheus-compatible agent):

```yaml
- job_name: hapi_enterprise
  scrape_interval: 60s
  metrics_path: /admin/api/sensors/prometheus
  authorization:
    type: Bearer
    # The add-on has no user-facing token. This is the internal key, generated once:
    # host path /mnt/data/supervisor/addons/data/hapi_enterprise/admin-token
    credentials: !secret hapi_internal_key
  static_configs:
    - targets: ['homeassistant.local:8099']
```

## Raspberry Pi and small boards

The add-on builds from `node:22.16.0-alpine3.21`, an official multi-architecture image
(`linux/amd64`, `linux/arm64`, `linux/arm/v7`). There is no `--platform` pin, no `apk`
package and no `npm install`: every dependency is a Node built-in, so the same
`Dockerfile` produces a working image on each architecture.

| Board / OS                                 | `arch`    | Notes                                            |
| ------------------------------------------ | --------- | ------------------------------------------------ |
| Raspberry Pi 4/5, 64-bit Raspberry Pi OS   | `aarch64` | Recommended — most RAM, best throughput.         |
| Raspberry Pi 3/4/5, 32-bit Raspberry Pi OS | `armv7`   | Works; keep the heap cap and portals modest.     |
| Raspberry Pi 2 with 32-bit Raspberry Pi OS | `armv7`   | Works, but 1 GB RAM: set `memory_limit_mb: 256`. |
| Raspberry Pi Zero / Pi 1 (`armhf`, armv6)  | —         | **Not supported**: Node 22 has no armv6 build.   |

Recommendations for a Pi installation:

- **Memory.** Set `memory_limit_mb: 256` (1 GB boards) or `384` (2 GB and more). Without
  a cap a large folder scan can be killed by the OOM killer. The value becomes
  `--max-old-space-size`; `0` keeps the Node default.
- **Storage on USB SSD.** Put `storage_location` on `share`/`media` backed by the SSD and
  keep `min_free_mb` at `200`; SD-card write latency is what makes the console feel slow.
- **Load control.** Keep the defaults; the add-on already lowers its own limits when heap
  pressure rises. Avoid `log_level: debug` on a Pi — it writes one line per request.
- **Encryption and signing.** `encrypt_files: true` and PGP package signing work on ARM
  (pure JavaScript, no native modules); they cost CPU time, not compatibility.
- **Timestamps.** RFC 3161 requests are network-bound; a slow link is not a Pi problem,
  the TSA circuit breaker (`TSA_BREAKER_THRESHOLD`) already skips a dead endpoint.
- **Backups.** Use `backup_mirror` and `storage_mirror` pointing at the SSD (or a NAS
  mount), never at the SD card only.

## Debug logging

- `log_level` selects `error`, `warn`, `info` (default), `debug` or `trace`. `debug`
  writes one access-log line per request with method, path, status and duration.
- Files: `<storage>/logs/debug-YYYY-MM-DD[.n].jsonl`, 5 MB per file, 5 newest kept.
  Each line is JSON with `at`, `level`, `ns`, `msg` and `ctx`.
- Console: `warn`/`error` go to stderr, everything else to stdout, so the same entries
  appear in the Home Assistant add-on log.
- Correlation: every request gets an `X-Request-Id` (a valid client value is reused) and
  the access-log line carries the same `reqId`.
- Redaction: keys such as `token`, `password`, `authorization`, `portal_key` and
  `signature` are written as `***`; bearer tokens inside messages are masked too.
- Live control: `GET /admin/api/logs?level=debug&limit=100` (any role with read access)
  and `POST /admin/api/logs/level` with `{"level":"debug"}` (admin only).
- `LOG_LEVEL`, `LOG_MAX_BYTES`, `LOG_MAX_FILES` and `LOG_MAX_ENTRIES` override the stored
  option and the sink limits for a one-off session.

## Access rules

Public access and export decisions come from JSON rule files, resolved in this order:

1. `config_dir` (or `HAPI_CONFIG_DIR`) — the folder you point the add-on to;
2. `/config/rules` — the add-on's own folder (editable over Samba / SSH / file editor);
3. `rules/` inside the add-on image — the built-in defaults.

On first start the built-in files are copied into `/config/rules` and are **never
overwritten**, so you can edit them in place. A file that is missing everywhere falls
back to the built-in default and is reported in the add-on log (`rules.defaults`) and by
`GET /admin/api/rules` (admin role or the internal key). Apply edits without a restart with
`POST /admin/api/rules/reload`.

## Keys and cryptography

Four independent controls, each with its own option:

| Concern                      | Option(s)                                      | What actually happens                                                                          |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Signing replies and packages | `sign_packages`, `signing_key`                 | Detached OpenPGP signature (`.asc`) created by `pgp.js` (RFC 4880 + RFC 9580).                 |
| Timestamping                 | `tsa_enabled`, `tsa_start_url`, `tsa_stop_url` | RFC 3161 TSQ/TSR; the token is stored as `.tsr`, never invented.                               |
| Encryption at rest           | `encrypt_files`                                | AES-256-GCM with an internal auto-generated key; plaintext is served only to authorised reads. |
| Communication encryption     | `tls_cert`, `tls_key`                          | The add-on's own listeners (8099/8098/8088) switch to HTTPS. HA Ingress keeps its own TLS.     |

Keys are **never** stored in the add-on options. Attach a key in the console
(**Settings → PGP keys**) as an ASCII-armored `PRIVATE KEY BLOCK`: the server keeps the
secret part encrypted with the admin key, exposes only the fingerprint and signs with it.
`signing_key` then selects that key by fingerprint or key ID.

### OpenPGP v6 (RFC 9580)

| Capability                                                                       | Status                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| v6 keys: Ed25519 (algo 27), Ed448 (algo 28), SHA-256 fingerprints, 64-bit key ID | supported — `pgp.js` parses, generates and describes them            |
| v6 signatures (salted, issuer-fingerprint subpacket, raw Ed25519)                | supported — used for package signing; verified in `tests/pgp-v6.cjs` |
| v4 keys and v4 signatures                                                        | still supported (backward compatibility)                             |
| v6 **encryption** (PKESK v6 + SEIPD v2 AEAD)                                     | **not implemented** — deliberately                                   |

Encryption at rest cannot use a v6 key: asymmetric encryption keeps the service from
reading its own files, and storing the private key next to the data gains nothing. At
rest the add-on therefore uses AES-256-GCM with the internal key. Encrypting *to a
recipient* with SEIPD v2 will be added only when the output can be validated against an
RFC 9580 implementation — GnuPG 2.5 offers v4 and the RFC 4880bis draft only, so a
hand-written implementation would ship unverified crypto.

A key bundle in the CryptoSAK layout is used as-is:

```
keys/<N>-<fingerprint>/public.asc      public material (safe to share)
keys/<N>-<fingerprint>/private.asc     private material — attach, then keep the file offline
keys/<N>-<fingerprint>/subkeys/*.json  subkey roles: sign, encrypt-comms, encrypt-storage, authenticate
```

Unzip the bundle into `<storage>/keys/` (for example `/config/hapi_enterprise/keys/`): the\nadd-on imports every `private.asc`/`public.asc` pair at start, records the roles and\nnever overwrites an existing fingerprint. `POST /admin/api/pgp/keys/import` re-scans the\nfolder on demand and reports what was imported or skipped.\n\nPoint `signing_key` at the fingerprint of the primary key: the signing subkey is chosen
automatically. `encrypt-comms` / `encrypt-storage` subkeys are reserved for PGP-level
encryption, which this add-on does not implement yet — file encryption at rest uses
AES-256-GCM, and transport encryption uses TLS. Nothing pretends otherwise.

## RFC 3161 timestamps (START / STOP)

Report Studio has a locked cryptographic scope: `rfc3161-start` is always the first
block and `rfc3161-stop` the last (ADR-0025). The **RFC 3161 TSA** panel turns those
boundaries into real tokens — the interface never invents one.

- **START** — `POST /admin/api/v2/rfc3161` with `{"phase":"start","manifest":{…}}`.
  The server hashes the normalised manifest and sends a TimeStampReq to the START TSA
  (`TSA_START_URL`, default `https://zeitstempel.dfn.de/`). Several TSAs can be listed
  comma-separated: they are tried in order and the first granted token wins, while every
  failed attempt stays in the record (`attempts`) for the audit log.
- **STOP** — `{"phase":"stop"}` closes the scope: the digest is
  `SHA-256(startDigest | startTokenSha256)`. Send an explicit `digest` to stamp
  something else.
- **Status** — `GET /admin/api/v2/rfc3161` returns the configured URLs and the last 40
  records.
- Tokens are stored as `<storage>/tsa/<phase>-<time>-<digest>.tsr` with a `.json`
  sidecar (imprint, `genTime`, serial, token SHA-256). A refused timestamp returns
  `502` and writes nothing.
- Every token is checked before it is reported: the `messageImprint` inside TSTInfo
  must match the request (`imprintMatches`). Admin role only — the endpoint is never
  reachable on the public listener.
- **Evidence lifetime** — the archive keeps the newest `TSA_KEEP` records (default
  `200`); older `.tsr`/`.json` pairs are removed after a successful stamp
  (`rfc3161.pruned` in the log and the audit chain), so timestamps cannot fill the disk.
- **Evidence check** — `POST|GET /admin/api/v2/rfc3161/verify` re-hashes every stored
  `.tsr` and compares it with the fingerprint in its sidecar: `200` when all match,
  `409` with `status: tampered|missing|unreadable` for any file that does not. A stored
  token is never taken on trust.

## Health, backups and stop behaviour

- `watchdog: http://[HOST]:[PORT:8099]/health` — the Supervisor restarts the add-on when
  the process stops answering.
- `backup: cold` — the add-on is stopped for the snapshot because SQLite runs in WAL
  mode and a hot copy can capture a torn database.
- `timeout: 30` — the process gets time to close SQLite on `SIGTERM`.
- Downloads beyond the stream limit wait in a short queue (15 s) instead of failing, so
  opening two or three links at once is safe.

## Security notes

- The console and the admin API accept only a Home Assistant identity from the Ingress
  listener: any other peer is refused, and the RBAC role decides what the identity may do.
  There is no admin token to leak, guess or reuse.
- Administrative routes are reachable only on the Ingress listener. The public listener
  never serves `/admin`.
- Public access is fail-closed: an unauthorised portal answers `404`, so the existence of
  private portals is not disclosed.
- Portal keys travel in `X-Portal-Key` / `X-File-Key`, never in query strings that end up
  in logs.
- `storage_root` is restricted to `/share` and `/media`; `/config`, `/ssl` and `/backup`
  are refused.

## Troubleshooting

| Symptom                        | Check                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Add-on stops right after start | The log states the reason — most often an unavailable storage mount or an unwritable `/data`.                                   |
| Console shows 403              | The HA user (or one of their groups) is explicitly mapped to `operator`/`viewer`, or `DEFAULT_ROLE` is set to a non-admin role. |
| QR code opens a blank page     | `public_domain` is empty or the portal has no reachable address; set the external domain.                                       |
| Large upload fails             | Uploads go through Ingress; check free space (`min_free_mb`) and the Supervisor log.                                            |
| Rules seem ignored             | `GET /admin/api/rules` shows which file was used; missing files fall back to defaults.                                          |

## Support

- Logs: add-on page → **Log**, or **Settings → System → Logs**.
- Rules and log status: `GET /admin/api/rules`, `GET /admin/api/logs`.
- Issues: <https://github.com/PasevSU/hAPI/issues>
- Changelog: [`CHANGELOG.md`](../CHANGELOG.md)
- Full documentation: [`documentation/`](../documentation/README.md)

## License

[Apache 2.0](../LICENSE)
