# hAPI Evidence View — QR-scoped standalone GUI

A dependency-free HTML/CSS/ES-module front end. Open `portal.html?folder=demo-evidence` from a static web server for the demo. The demo displays **synthetic metadata and illustrative hashes, not verified evidence**. No original files are included.

## Where the package lives

By default the portal is published **into the data folder itself**:

- `/share/hAPI/data/` — documents and folders (add-on `storage_location: share`, `storage_subdirectory: hAPI/data`)
- `/share/hAPI/data/portal/` — this package (page, assets, demo data)

A copy is also written to `<HA config>/www/hapi/data` when a Home Assistant configuration is present,
because only `www/` is served by Home Assistant at `/local/`. Without HA, the share copy is the only one
and the add-on serves it. On Windows the share root is only used when `EVIDENCE_PORTAL_SHARE` is set —
`/share` there would resolve to a different drive.

## Requested URL format

`/portal.html:ime_na_papka` is **not** an HTML parameter. Your reverse proxy must internally rewrite that exact path to `/portal.html` while preserving the original request path visible to JavaScript. Example Nginx location:

```nginx
location ~ ^/portal\.html:[A-Za-z0-9_-]{1,90}$ {
    rewrite ^/portal\.html:[A-Za-z0-9_-]{1,90}$ /portal.html break;
    root /var/www/hapi-evidence;
    add_header Cache-Control "no-store" always;
}
```

This is a routing example, **not** a complete secure deployment configuration. Configure the normal `/portal.html` and `/assets/` routes separately. The alternative `portal.html?folder=demo-evidence` is supported for testing.

## Backend contract (required for production)

`GET /api/evidence/:folder/manifest` — return **only authorized** folder and file metadata, with `items` in the same schema as `data/demo-evidence.json`.

`POST /api/evidence/:folder/access` with `{ "fileId":"...", "action":"preview|download", "password":"..." }` — authenticate/authorize on every request and return `{ "url":"/api/evidence/opaque-single-use-token" }` only on success. Token endpoint must recheck authorization, bind the token to the exact file and action, use short expiry, and return files as safe attachments (or sandboxed preview). Password verification and decryption must be server-side, never stored in the manifest.

**Never** resolve `folder` or `fileId` directly to a filesystem path. Use random unguessable capabilities plus server-side ACLs and allowlists. The folder slug alone is not authentication. Keep admin APIs on a separate origin/service and ensure the Evidence API cannot access other packages or private keys. Prevent traversal, symlinks, IDOR, MIME sniffing, HTML/JS execution from evidence, and cache leaks. Require TLS, no-store for private responses, rate limiting, access logging and session expiry. A read-only UI is not a security boundary. Public QR links are bearer capabilities unless an additional password or authentication step is enforced.

Created/modified timestamps in the UI are claims from the manifest and must not be treated as cryptographically proven creation dates. Hashes are metadata until computed and compared with the actual bytes. Licensed software fields are descriptive metadata and do not imply that the viewer possesses a software license.

## File information and QR

Besides the tree, the portal shows **information about each file**: a package summary (files,
folders, total size, protection, package date), search across name/tags/description, filters by
access and protection, a MIME column, and a details panel with sections *Основни*, *Време*,
*Цялост*, *Достъп и произход*, the QR block and the file's raw JSON.

Two QR codes are produced **locally** by `assets/qrcode.js` (vendored MIT encoder, the same file the
admin panel uses) — no network call, no CDN:

| QR | Contents | Notes |
| --- | --- | --- |
| Package | portal URL + `folder=<slug>` | opens the package |
| File | portal URL + `#file=<fileId>` | opens that file's details directly |

Rules that must not be broken:

- A QR code carries **navigation only**. Never a password, an access token, a session or a hash
  presented as proof.
- The base URL is `package.publicUrl` when the manifest provides it, otherwise `location`. That way the
  printed code points at the address a person actually uses (reverse proxy, Home Assistant ingress),
  not at whatever the server happens to see.
- SVG is built as DOM nodes (no `innerHTML`), PNG is drawn to a canvas; both are downloadable.
- A QR code does **not** replace authorization: every file view/download still goes through
  `POST /api/evidence/{folder}/access`.

## Contents

- `portal.html` — entry page (loads `assets/qrcode.js`, then `assets/app.js` as an ES module)
- `assets/app.js` — tree, filters, file information panel, QR block, access states, API calls
- `assets/qrcode.js` — vendored QR encoder (MIT, Kazuhiko Arase), browser build
- `assets/consent.js` — first-visit consent gate
- `assets/style.css` — responsive enterprise UI, including the details panel and QR block
- `data/demo-evidence.json` — the demo manifest the page actually fetches (`./data/demo-evidence.json`)
- `sample-evidence.json` — the flat layout of the same demo data (compatibility with old links)

## Smoke test

From the package directory: `python -m http.server 8080`, then open `http://localhost:8080/portal.html?folder=demo-evidence`. The demo intentionally does not enable real file download because the production API is not provided.

## Consent Gate v1.1

`assets/consent.js` implements the first-visit modal. In the demo (`?folder=demo-evidence`), acceptance is kept in sessionStorage only for UI testing. No security claim applies to demo mode. For any other package, the portal sends `POST /api/evidence/{folder}/consent` with JSON `{"terms_version":"1.0","optional_analytics":false}` and `credentials: include`. The server MUST validate the QR capability, store consent event and policy version, bind an HttpOnly Secure SameSite session cookie to the package and enforce authorization on every manifest/file request. The backend must also validate the password and log denied requests; frontend-only consent does not protect files.

Suggested server endpoints: `GET /api/evidence/{folder}/manifest`, `POST /api/evidence/{folder}/consent`, `POST /api/evidence/{folder}/access`. Manifest must be returned only after server-side consent and package authorization. The gateway should generate an append-only audit record for `PORTAL_OPEN`, `TERMS_ACCEPTED`, `FILE_VIEW`, `FILE_DOWNLOAD`, `ACCESS_DENIED` with UTC timestamps, session and file IDs, result and bytes served. Do not put QR bearer tokens or session secrets into Home Assistant sensor attributes.

Production prerequisites: published real privacy notice (controller, lawful basis, retention, recipients, rights), legal review of terms, CSRF protections, CSP, rate limiting, access revocation, audit retention, secure deployment and HTTPS. A URL of the form `/portal.html:folder_name` requires reverse-proxy routing/rewrite and server-side path validation; it is not supported automatically by a static web server. The `demo-evidence` mode MUST be disabled in production.
