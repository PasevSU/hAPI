# Security Tests — hAPI Enterprise

## Threat-driven cases

| Threat                 | Test                                    | Expect                                         |
| ---------------------- | --------------------------------------- | ---------------------------------------------- |
| Unauthenticated access | hit admin API w/o token                 | 401                                            |
| Privilege escalation   | viewer calls admin endpoint             | 403                                            |
| SSO spoof              | forge `X-Remote-User-Name` from outside | rejected (peer allowlist + trusted proxy only) |
| SQL injection          | crafted input to search/profile         | parameterized (no error/leak)                  |
| Path traversal         | `../` in filename/path                  | rejected                                       |
| XSS                    | malicious name rendered                 | escaped                                        |
| Tampering              | flip a byte, re-verify                  | hash mismatch detected                         |
| Replay                 | reuse expired share token               | rejected                                       |
| Weak encryption        | plaintext key/secret in log/audit       | never present                                  |
| WORM bypass            | overwrite evidence file                 | refused                                        |
| Secret echo (0.69.165) | read every admin surface + debug logs   | token/password/PGP/S3 never appear             |
| Half-applied rotation  | `npm run audit:ha` on the live add-on   | gate 200/401 and options == secrets.yaml       |

## Existing coverage

`tests/access-policy.cjs`, `tests/admin-throttle.cjs`, `tests/security-defaults.cjs`,
`tests/ingress-isolation.cjs`, `tests/runtime-limits.cjs`,
`tests/secret-exposure.cjs`,
`tests/upload-rollback-guard.cjs`, `tests/integrity.cjs`, `tests/node-runtime-gate.cjs`.

## Debugging gate for fixes

Every fix lands with the test that would have caught it, and the whole series is the gate:

- `npm test` runs `scripts/test-matrix.cjs`, which reruns **every** test from the start after any
  failure until the run is 100% green (default 5 attempts), then writes `reports/test-matrix.json`.
- `npm run audit:ha` checks the live add-on over SSH (read-only): state, version, `/health`, the
  200/401 token gate on the published port, and that Supervisor options and `secrets.yaml` hold
  the same token. It exits 2 when there is no connection — that is never a pass.
- `tests/secret-exposure.cjs` is proven sensitive by mutation: logging the admin token makes it
  fail with the offending log line, and it passes again once the log line is removed.

## Release gate

All security tests must pass; any High/Critical finding blocks release
(`ADR-0012`, `07_RELEASE/RELEASE_CRITERIA.md`).
