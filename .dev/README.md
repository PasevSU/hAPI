# .dev — development workspace

In-progress work that has **not yet been merged** into the add-on lives here.

| Folder          | Content                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `ui-redesign/`  | Admin panel UI/UX redesign (Обзор dashboard, portal cards, file tables, dark mode, toasts, i18n).               |
| `docflow/`      | DOCFLOW planning — the consolidated master plan plus the earlier merged draft.                                  |

## Workflow

1. Develop and verify changes inside `.dev/`.
2. Copy the changed files into `../portal_enterprise/`.
3. Run the test suite from the repo root: `node tests/smoke.cjs` (then the rest of `tests/*.cjs`).
4. Commit and release.

> `ui-redesign/` currently differs from `../portal_enterprise/` only in `admin.html` and
> `admin.js` (the redesigned admin console). Merge those two files when the redesign is
> approved.
