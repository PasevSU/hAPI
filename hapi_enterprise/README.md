# hAPI Enterprise — Home Assistant add-on

[![License](https://img.shields.io/badge/License-Apache%202.0-ff00d8.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Home Assistant](https://img.shields.io/badge/-HOME_ASSISTANT-blue?logo=homeassistant)](https://www.home-assistant.io/)

Self-hosted document vault for official documents: structured (DOCFLOW) records, QR
sharing with a branded portal, and cryptographic proof of integrity (SHA-256/512,
PKCS#7 receipts, RFC 3161 timestamps, hash-chained audit log).

Everything runs locally — no cloud, no external service.

## Requirements

- Home Assistant OS or Home Assistant Supervised (the add-on needs Supervisor).
- Architecture `amd64` or `aarch64`.
- An admin token with **at least 24 characters** — it is the only credential the
  console and the API accept.

## Install

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, add
   `https://github.com/PasevSU/hAPI`.
2. Install **hAPI Enterprise**, open its **Configuration** tab and set `token`.
3. **Start** the add-on, then open it from the sidebar (**hAPI Enterprise**) or from
   the add-on page via **Open Web UI**. The console lives at `/admin` behind Ingress.

An optional Home Assistant integration (public API bridge, portal page and telemetry
sensors) can be installed through HACS from the same repository — see
[`documentation/08_USER_GUIDES/install-hacs.md`](../documentation/08_USER_GUIDES/install-hacs.md).

## Configuration

| Option              | Default   | Meaning                                                                       |
| ------------------- | --------- | ----------------------------------------------------------------------------- |
| `token`             | *(empty)* | Admin token for the console and the API (≥ 24 characters). **Required.**      |
| `username`          | *(empty)* | Optional console user name stored next to the token.                          |
| `password`          | *(empty)* | Optional console password; leave empty to rely on the token only.             |
| `db_name`           | *(empty)* | Database file name inside `/config` (default name when empty).                 |
| `db_id`             | `1`       | Database/profile identifier used in composite variable keys.                   |
| `backup_folder`     | *(empty)* | Folder for scheduled backups (inside `/config` or `/share`).                   |
| `profiles`          | *(empty)* | Path or JSON with configuration profiles (folders/groups/fields definitions).  |
| `user_roles`        | *(empty)* | HA user → role map for Ingress, e.g. `{"pasev":"admin"}`.                      |
| `group_roles`       | *(empty)* | HA group → role map, when roles are assigned by group.                         |
| `public_gateway`    | `false`   | Enable the public API gateway on port `8088` (reverse-proxy it yourself).      |
| `public_same_origin`| `false`   | Emit relative URLs — the API answers on the same host/port as Home Assistant.  |
| `public_domain`     | *(empty)* | External domain for portals and QR codes, e.g. `pasev.asuscomm.com`.           |

Roles are `admin`, `operator`, `viewer`. Without a matching entry in `user_roles` /
`group_roles`, Ingress requests are rejected with `401`.

Details and troubleshooting:
[`documentation/08_USER_GUIDES/public-gateway-setup.md`](../documentation/08_USER_GUIDES/public-gateway-setup.md).

## Storage

| Path            | Access | Used for                                          |
| --------------- | ------ | ------------------------------------------------- |
| `/config`       | `rw`   | SQLite database, receipts, audit chain            |
| `/share`        | `rw`   | Documents and portal folders (`storage_root`)     |
| `/media`        | `rw`   | Optional media/documents folder                   |
| `/addon_config` | `rw`   | Add-on options and generated configuration        |

Back up `/config` and `/share` together — the database references documents by path.

## Endpoints

- **Ingress** — `/admin` (console), `/p/<portal>` (portal pages), `/api/v1/...`.
- **8099/tcp** — internal API only; do not publish it on the host.
- **8088/tcp** — public API gateway, only when `public_gateway: true`.

## Support

- Logs: add-on page → **Log**, or `Settings → System → Logs`.
- Issues: <https://github.com/PasevSU/hAPI/issues>
- Changelog: [`CHANGELOG.md`](../CHANGELOG.md)

## License

[Apache 2.0](../LICENSE)
