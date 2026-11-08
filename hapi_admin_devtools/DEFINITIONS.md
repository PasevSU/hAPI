# hAPI-DEV: Central Definitions and Runtime Configuration Contract

Status: implemented in the experimental DevTools branch. Does **not** alter the live hAPI Enterprise add-on.

## Principle

Do not use mutable process-wide globals as a shortcut. Instead, use **one immutable source of truth** for cross-module definitions and a small, validated runtime configuration object:

- `definitions.js → DEFINITIONS`: deep-frozen policy constants, repository IDs, OpenPGP public key ID, service addresses, API version, limits, supported architectures, locale set, and privileged-action defaults (all false).
- `definitions.js → getRuntimeConfig()`: explicitly parsed environment values (data directory, options path, ingress port). Unknown/malformed port formats throw; constants cannot be changed by environment variables, an AI response or Home Assistant runtime options.
- `definitions.js → readAddonVersion()`: reads the existing Home Assistant `config.yaml` version rather than maintaining an independent version literal for GitHub request user-agent headers.
- `config.yaml` remains the authoritative **Home Assistant Supervisor add-on schema**, and its version/slug/image/Ingress fields are deliberately mirrored only where Supervisor itself requires them. Tests ensure they stay consistent.
- `hapi_enterprise/runtime-config.js` already handles primary Enterprise runtime settings. Do not replace it or share mutable state between the independently released add-ons.

## Modules migrated

- `server.js`: data paths, request size, configured ingress port, proxy address, hAPI probe address and challenge expiry.
- `identity.js`: GitHub username, registered GPG key ID, public-key endpoint, timeouts and size limits.
- `github-verification.js`: fixed repository, API host/version, request timeouts and size bounds.
- `github-actions-evidence.js`: same fixed repository/API configuration and response limits.
- `release-gate.js`: repository name, permitted test environments, required phases and target architectures.
- `monitor.js`: Enterprise probe host/port, timeout, local interval and log quota.

The new registry is packaged explicitly by `Dockerfile`; this matters because Node tests from checkout can succeed while production COPY layers omit required modules.

## What is deliberately not global

- OpenPGP **private** keys, GitHub access tokens or authorization results.
- A mutable global incident state, user identity, request session or agent context.
- Per-request URLs from untrusted input.
- API secrets, credentials, signed links, quarantine contents or document bytes.
- Success/probability percentages fabricated by an agent.
- The independently versioned Enterprise add-on's local runtime settings.

## Future work

1. Extend the registry with typed API error codes, incident states, release state machine identifiers and UI translation keys; keep those separately scoped to avoid one giant module.
2. Generate machine-readable schema/checks from policy definitions for AI tool inputs, with strict per-tool authorization enforced separately.
3. Introduce contract tests across both independently released add-ons. Do not hard-couple the release numbers.
4. Test parameterized host/port settings on an isolated HAOS add-on network before allowing runtime overrides; arbitrary host overrides are not enabled.
5. Add a CI check for accidental reintroduction of duplicate GitHub owner/host/port literals, taking care not to flag harmless documentation and test fixtures.

## Validation

```sh
node --check hapi_admin_devtools/definitions.js
node --test hapi_admin_devtools/tests/definitions.test.cjs
node --test hapi_admin_devtools/tests/*.test.cjs
docker build -f hapi_admin_devtools/Dockerfile hapi_admin_devtools
```

Also run the independent CI/CodeQL workflows and release-isolation tests. Never merge or install a changed add-on until the entire suite passes.
