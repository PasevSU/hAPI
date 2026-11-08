# hAPI Admin DevTools

An **independent, optional Home Assistant add-on** in the same repository as hAPI Enterprise. It exposes an administrator-only Ingress panel, reads the historical Guardian protocols, and checks the primary hAPI service without changing it.

**Installation vs activation:** Home Assistant installs add-ons before allowing their configuration. Installation cannot technically be gated by a fingerprint entered later. **Activation is gated:** no diagnostics, hAPI access or developer functionality is available until the full GitHub-registered OpenPGP primary fingerprint is checked and a fresh challenge has a valid detached OpenPGP signature from the corresponding GPG signing key.

This is a separate Home Assistant sidebar panel titled **hAPI Admin DevTools**, not an unreviewed injection into the existing hAPI app. The primary hAPI add-on, SQLite database, portals and UI remain unchanged.

For setup, see [DOCS.md](DOCS.md). No autonomous changes or restarts are implemented.

## Two development modes

- **Static Development** — the AI Development Director assigns explicit work to specialist agents, with fixed plans and security/release gates.
- **Dynamic Development** — the local monitor stores time-series health observations and, every configured interval (default 360 minutes), produces evidence-backed improvement categories: optimization, outcome improvement, bug fixes, reliability, missing function coverage and more. Dynamic findings are routed into static development proposals.
- Configuration: `dynamic_monitor_enabled` and `dynamic_analysis_interval_minutes` (15–10080 minutes).
- The **historical 358-function catalog is not full runtime instrumentation**. Currently only the independent hAPI readiness/latency signal has direct continuous telemetry. All other functions remain explicitly `unobserved` until an authenticated metrics bridge and real HA native sensor entities are implemented.

See [STATIC_DYNAMIC_ARCHITECTURE.md](STATIC_DYNAMIC_ARCHITECTURE.md) for implementation and test details. The optional OpenAI Agents SDK manager has a safe adapter, but the actual AI runtime is **not yet enabled** in this add-on.

