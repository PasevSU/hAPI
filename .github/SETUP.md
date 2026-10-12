# Repository rules — hAPI Enterprise

Records the repository rules and how to enable them on GitHub.

## Remote

Canonical remote: `https://github.com/PasevSU/hAPI.git` (local remote `origin`).

## Branch & PR policy (recommended ruleset)

Apply via **Settings → Rules → Rulesets** targeting the `main` branch. Classic
branch protection is unavailable for private repositories on a Free plan.

| Rule | Value |
| ---- | ----- |
| Require a pull request before merging | Enabled |
| Required approvals | 1 |
| Dismiss stale pull request approvals | Enabled |
| Require status checks | Enabled |
| Required checks | `Integration tests (Ubuntu · Node 22)`, `Smoke + edge runtime (Windows · Node 22)` |
| Require conversation resolution | Enabled |
| Block force pushes | Enabled |
| Restrict deletions | Enabled |
| Block branch creation | Enabled |

Add `CodeQL` as a required check only when GitHub Advanced Security is enabled.

## Automation

- `workflows/ci.yml` — full `tests/*.cjs` suite (Ubuntu) + Windows smoke/edge runtime.
- `workflows/codeql.yml` — security analysis (requires GitHub Advanced Security for
  a private repository; remove this file if unavailable).
- `dependabot.yml` — keeps GitHub Actions up to date.

## Community health

- `CODEOWNERS` — `@PasevSU` owns the repository.
- `PULL_REQUEST_TEMPLATE.md` — PR checklist.
- `ISSUE_TEMPLATE/` — bug and feature forms.
- `SECURITY.md` / `CONTRIBUTING.md` — at repository root.

## Enabling

1. Push the `main` branch.
2. Create the ruleset above.
3. Confirm the required checks appear in branch protection.
