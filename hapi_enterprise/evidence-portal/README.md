# hAPI Evidence View — QR-scoped standalone GUI

A dependency-free HTML/CSS/ES-module front end. Open `portal.html?folder=demo-evidence` from a static web server for the demo. The demo displays **synthetic metadata and illustrative hashes, not verified evidence**. No original files are included.

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

## Contents

- `portal.html` — entry page
- `assets/app.js` — tree, metadata, access states, modal, API calls
- `assets/style.css` — responsive enterprise UI
- `sample-evidence.json` — synthetic sample package (в корена, не в `data/`: тази папка се пропуска от експорта)

## Smoke test

From the package directory: `python -m http.server 8080`, then open `http://localhost:8080/portal.html?folder=demo-evidence`. The demo intentionally does not enable real file download because the production API is not provided.

## Consent Gate v1.1

`assets/consent.js` implements the first-visit modal. In the demo (`?folder=demo-evidence`), acceptance is kept in sessionStorage only for UI testing. No security claim applies to demo mode. For any other package, the portal sends `POST /api/evidence/{folder}/consent` with JSON `{"terms_version":"1.0","optional_analytics":false}` and `credentials: include`. The server MUST validate the QR capability, store consent event and policy version, bind an HttpOnly Secure SameSite session cookie to the package and enforce authorization on every manifest/file request. The backend must also validate the password and log denied requests; frontend-only consent does not protect files.

Suggested server endpoints: `GET /api/evidence/{folder}/manifest`, `POST /api/evidence/{folder}/consent`, `POST /api/evidence/{folder}/access`. Manifest must be returned only after server-side consent and package authorization. The gateway should generate an append-only audit record for `PORTAL_OPEN`, `TERMS_ACCEPTED`, `FILE_VIEW`, `FILE_DOWNLOAD`, `ACCESS_DENIED` with UTC timestamps, session and file IDs, result and bytes served. Do not put QR bearer tokens or session secrets into Home Assistant sensor attributes.

Production prerequisites: published real privacy notice (controller, lawful basis, retention, recipients, rights), legal review of terms, CSRF protections, CSP, rate limiting, access revocation, audit retention, secure deployment and HTTPS. A URL of the form `/portal.html:folder_name` requires reverse-proxy routing/rewrite and server-side path validation; it is not supported automatically by a static web server. The `demo-evidence` mode MUST be disabled in production.
