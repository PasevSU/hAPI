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

## Existing coverage

`tests/access-policy.cjs`, `tests/admin-throttle.cjs`, `tests/security-defaults.cjs`,
`tests/ingress-isolation.cjs`, `tests/runtime-limits.cjs`,
`tests/upload-rollback-guard.cjs`, `tests/integrity.cjs`, `tests/node-runtime-gate.cjs`.

## Release gate

All security tests must pass; any High/Critical finding blocks release
(`ADR-0012`, `07_RELEASE/RELEASE_CRITERIA.md`).
