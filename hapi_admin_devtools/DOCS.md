# hAPI Admin DevTools — OpenPGP owner authorization

**Experimental standalone add-on** in the same `PasevSU/hAPI` repository. hAPI Enterprise and its SSH connection to Home Assistant remain independent and unchanged.

## GitHub's Verified status and OpenPGP

The reference is [GitHub: Displaying verification statuses for all of your commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/displaying-verification-statuses-for-all-of-your-commits).

GitHub's `Verified` means it verified a particular commit/tag signature. That label **does not automatically grant** a process permission to edit a repository, sign new commits or publish releases. A separate GitHub App token with limited repository permissions, branch protection, CI and release approval gates are required for mutation.

From the provided GitHub screenshot: **OpenPGP/GPG key ID `4FC0B2596C68DCB9`**, added November 8, 2026. **This short key ID is not the full OpenPGP fingerprint**. The RSA SSH key and its SHA256 fingerprint previously provided are separate and are no longer used to unlock Admin DevTools. PGPony's displayed encryption subkey is not necessarily the signing subkey for commits.

## Installation versus activation

Home Assistant stores install add-ons before reading their runtime options. The Store's **Install** button cannot be protected by a fingerprint supplied afterward. Accordingly, the add-on installs in locked mode and unlocks administrator functionality only after a full OpenPGP signature check. `panel_admin: true` restricts the add-on sidebar entry to Home Assistant administrators.

### 1. Obtain the full fingerprint locally

Using GnuPG with the public/secret key imported:

```sh
gpg --list-keys --with-fingerprint --with-subkey-fingerprint
gpg --list-secret-keys --with-fingerprint --with-subkey-fingerprint
```

Select the **primary OpenPGP fingerprint** for the GitHub key with key ID `4FC0B2596C68DCB9`, not a displayed SSH SHA256 fingerprint or the fingerprint of an unrelated encryption subkey. The add-on accepts a valid 40- or 64-hex full fingerprint only when it ends with that exact registered GPG key ID.

The GitHub public certificate is fetched over HTTPS from `https://github.com/PasevSU.gpg` and validated in a temporary isolated GnuPG keyring. The full primary fingerprint must match the configured value. Internet is required for initial enrollment.

### 2. Configure add-on options

```yaml
github_username: PasevSU
openpgp_fingerprint: "YOUR_FULL_OPENPGP_PRIMARY_FINGERPRINT"
```

Do not paste the shortened key ID in place of the full fingerprint.

### 3. Prove private-key possession without uploading it

In the administrator Ingress panel click **Generate OpenPGP challenge**, copy the one-time text *including its final newline* into a UTF-8 `challenge.txt` file, then produce a detached signature locally:

```sh
gpg --armor --detach-sign --local-user YOUR_FULL_OPENPGP_PRIMARY_FINGERPRINT challenge.txt
```

Paste the entire `-----BEGIN PGP SIGNATURE----- ... -----END PGP SIGNATURE-----` block from `challenge.txt.asc` into the add-on and click **Verify and activate**.

PGPony can be used when it supports detached signature creation/export. The **private key is never uploaded**. Unlike SSH authorization or GitHub's existing SSH integration, this is a separate OpenPGP challenge bound to a 5-minute nonce. Replay attempts are rejected.

The add-on stores the signed enrollment record and corresponding GitHub public certificate locally with restricted permissions. It verifies the record at restart. A changed GitHub key membership or revocation cannot be reliably established offline; future privileged GitHub actions must perform fresh online verification.

## Repository edits and updates — restricted by design

This initial build is read-only and contains nine historical Guardian protocols plus a local hAPI health monitor. It does **not** yet deploy updates or hold GitHub write credentials.

A release-capable follow-up must implement:

1. GitHub App installation authorization with short-lived repository-scoped tokens; no developer SSH private key stored in add-on and no permanent high-privilege PAT.
2. Exact OpenPGP-signed authorization for a proposed source commit, version, change set, target repository and expiry.
3. Two independent CI environments, regression/integrity checks, verified backup and external rollback controller, plus reproducible release artifacts.
4. Branch protection, verified commit/tag signatures, and a release-only workflow with protected GitHub Environments and scoped permissions.
5. Separate release verification and post-deployment monitoring. Failure triggers external rollback; no repeated unbounded loops.
6. Immutable audit evidence and explicit denial if key validation, GitHub API, tests, or rollback controller are unavailable.

A GitHub `Verified` badge alone is not sufficient to trigger a write action.

## Current tests

```sh
node --test hapi_admin_devtools/tests/*.test.cjs
docker build -f hapi_admin_devtools/Dockerfile hapi_admin_devtools
```

Do not merge PR #16 into main or deploy until the new CI, CodeQL and Home Assistant OS qualification checks pass. No changes to the installed hAPI Enterprise app are needed for the prototype.
