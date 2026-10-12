# ADR-0008: gui-runtime

- **Status:** Accepted
- **Date:** 2026-10
- **Context:** Desktop parity with the HA admin console without a second UI codebase.
- **Decision:** pywebview + Edge WebView2 wrapping the same backend/admin surface;
  1:1 feature coverage via the shared REST API.
- **Options:** (A) pywebview wrapper ✅; (B) native C# WPF rewrite ❌ (cost);
  (C) Electron ❌ (heavy, duplicate runtime).
- **Consequences:** single admin UI; WebView2/Python bootstrap handled by
  `START_hAPI_Enterprise.bat`.
- **Validation:** `tests/smoke.cjs` + manual desktop run.
