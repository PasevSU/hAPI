# hAPI-DEV — Static and Dynamic Development

Status: **experimental implementation in PR #16**. The original hAPI Enterprise runtime and deployed Home Assistant installation remain unchanged.

## 1. Two independent operating modes

| Component | Static Development | Dynamic Development |
| --- | --- | --- |
| Trigger | Explicit issue, GitHub change, technical objective | Continuous measurement + configurable periodic analysis |
| Coordinator | AI Development Director | Dynamic analysis engine → AI Development Director |
| Analysis owner | Strategy, Reliability, Delivery leads and their specialist agents | Offline metric collector and specialist routing |
| Historical knowledge | Known defects, watches, cache candidates, releases | Sample history + historic function catalog |
| Output | Structured plan and sandbox-only candidate tasks | Evidence-backed improvement proposals assigned to the static specialists |
| Production modifications | Not authorized | Not authorized |
| Actual LLM execution | SDK adapter prepared, **not active** | No external model needed for deterministic findings |

The dynamic mode **does not replace** the static mode. It discovers new work, and the static mode owns the design, testing, review and future release preparation.

## 2. Categories for dynamic improvements

| Dynamic category | Trigger from trusted aggregate evidence | Static specialist |
| --- | --- | --- |
| `optimization` · Оптимизация | Measured p95 latency above baseline threshold | Performance Agent / Delivery Lead |
| `outcome-improvement` · Подобрение на резултата | Actual counted successes/attempts below target, not inferred from response status | Incident Agent / Reliability Lead |
| `bug-fix` · Поправки | Repeat readiness failures with recorded sample count | Incident Agent / Reliability Lead |
| `reliability` · Надеждност | Flapping or repeated health state changes | Incident Agent / Reliability Lead |
| `coverage` · Покритие на мониторинга | Functions without directly verified runtime sensors | Architecture Agent / Strategy Lead |
| `security` · Сигурност | Future safe, sanitized policy-denial sensor | Security Agent / Reliability Lead |
| `localization` · Езикови пакети | Future locale key/placeholder audit sensor | Locale Agent / Strategy Lead |

Not every possible category has a live producer yet: security and localization producers are **planned**, not simulated. Current measurements are readiness status, response latency and consecutive failures from the existing independent hAPI-DEV monitor.

## 3. User options

```yaml
dynamic_monitor_enabled: true
dynamic_analysis_interval_minutes: 360
```

The sampling interval is currently 30 seconds in the existing monitor. The **analysis period** defaults to 360 minutes (6 hours), with supported configuration between 15 minutes and 10080 minutes (7 days). These are distinct intervals. Startup with no OpenPGP enrollment does not activate runtime monitoring. Invalid dynamic settings disable dynamic analysis without disabling protected Admin DevTools Ingress.

The dynamic engine stores bounded, private JSONL files:
- `/data/dynamic/samples.jsonl` — timestamp, sensor ID, readiness state, HTTP status, observed latency, aggregate counters when actually supplied.
- `/data/dynamic/analyses.jsonl` — timestamp, observation count, improvement categories and aggregate evidence.

Journals are created with restrictive file permissions, have bounded rotation and contain no IP, token, filename, document payload or SSH/PGP private material. The JSONL journal is a development prototype; a production retention design should include crash recovery, safe multi-process locking, corruption handling and long-term rollups. Periodic analysis persists the last analysis timestamp across restarts to avoid constantly restarting the interval.

## 4. Honest function and sensor coverage

`ai/function-coverage.js` imports the historical function catalog (358 functions claimed at baseline 0.69.203). The baseline may differ from the current Enterprise release, and new functions must be discovered by a refreshed catalog.

**A function name in a catalog is not a runtime sensor.** Until independently instrumented, every historical function has `coverage: unobserved`, not `healthy`.

To achieve actual monitoring of **every** function and Home Assistant sensor, the next implementation must:
1. Establish a versioned and authenticated, read-only telemetry contract from Enterprise and the HA integration to DevTools.
2. Emit stable, low-cardinality function metrics (function ID, invocation count, error count, duration histogram, feature availability), with no document bodies, keys, arbitrary path labels or private visitor IDs.
3. Register new functions automatically, flag missing instrumentation, identify functions not called during the observation window as `not-observed`.
4. Refresh existing legacy catalog + new release diffs on every Enterprise update, preserving historical IDs and recording unknown/removed functions.
5. Provide real Home Assistant diagnostic entities via the HA integration/discovery layer with stable unique IDs, poll coordinator and state freshness, not via a JSON-only pseudo sensor.
6. Feed measured function outcomes into `dynamic-analysis.js` and validate the retention, cardinality and throughput impact on actual HAOS.
7. Keep access control, quarantine, storage, WORM and secrets separate from the telemetry collector. Do not weaken controls to make observation possible.

At present the **hAPI readiness probe is instrumented**. The 358 catalog functions are not independently instrumented and cannot truthfully be reported as monitored.

## 5. Implemented components

- `ai/operating-modes.js` — formalized static/dynamic modes and configuration limits.
- `ai/function-coverage.js` — stable historical function IDs and honest coverage reporting.
- `ai/dynamic-analysis.js` — bounded local journal, aggregate classification, recurrence and time scheduling.
- `ai/dynamic-routing.js` — new dynamic findings become specialist-assigned static development plans.
- `monitor.js` — records actual readiness response latency and dispatches samples to dynamic engine.
- `server.js` — authenticated read-only endpoints `/api/work-modes`, `/api/dynamic/status`, `/api/dynamic/findings`, `/api/dynamic/coverage`.
- `dashboard.html` / `dashboard.js` — separate static/dynamic dashboard views, analysis period, findings and coverage.
- `config.yaml` and BG/EN/DE config translations — independent dynamic runtime options.
- Automated tests for parsing, sensor coverage, observed improvement categories, safe persistence and division routing.

## 6. Next delivery gates

**Phase D1 (this PR):** read-only persistence and categorized recommendations from measured readiness signals. Unit tests and Docker build. Do not claim all functions have sensors.

**Phase D2:** authenticated Enterprise metrics adapter, automatic per-function instrumentation and refresh of the function inventory. Prove overhead and privacy controls.

**Phase D3:** actual Home Assistant native diagnostic entities and sensor coverage dashboard, with correct unavailable/stale states.

**Phase D4:** long-window trend analysis, baseline vs release comparisons, p95/p99 and metric-quality checks; create developer tasks with exact evidence hashes.

**Phase D5:** optional Agents SDK analysis of findings, using restricted and redacted observations, followed by isolated test runs.

**Phase D6:** signed release pipeline and independent recovery, only after production permissions and real HAOS staging/restore testing.

## 7. Non-negotiable boundaries

- Enterprise and DevTools maintain separate versions, GHCR images, release tags and runtime data.
- No AI-generated confidence percentage is treated as a measured chance of success.
- Dynamic proposals never directly update Enterprise, the GitHub repository, keys, access rules or Home Assistant Supervisor.
- Tracing and model export remain disabled until explicit configuration and data-protection review.
- The OpenPGP owner gate remains independent of the existing Home Assistant SSH connection.
- No automated release action without verified CI, exact signed artifact intent and out-of-process rollback.
