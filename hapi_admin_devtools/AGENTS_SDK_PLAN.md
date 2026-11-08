# hAPI-DEV — OpenAI Agents SDK Architecture & Implementation Plan

Status: planning only, no SDK runtime deployed. Date: 2026-11-08.
Target: independent hAPI Admin DevTools add-on, separate from Enterprise releases.
Sources: https://github.com/openai/openai-agents-js and official examples and guides; hAPI-DEV code in PR #16.

## 1. Architecture decision

Integrate OpenAI Agents SDK only into the independent DevTools add-on, behind an opt-in worker. Never add it to the Enterprise add-on startup/runtime. The offline observer and OpenPGP login continue to work without API connectivity. Use a central manager agent with specialized read-only tools and sandbox-only code tools. A deterministic policy service, not the language model, decides what may be changed.

Current hAPI-DEV baseline: a separate Home Assistant add-on at version 0.2.0, GPG-signed owner enrollment, read-only GitHub verified-commit checks, read-only CI evidence, independent release eligibility rules, local hAPI monitor, and 9 historic Guardian protocols. Live HA diagnostic entities, the SDK engine, external recovery controller and Github release write integration are NOT yet implemented.

## 2. SDK capability assessment

- Agents, Runner, asTool, handoffs: specialist routing and controlled multi-agent delegation.
- Function tools and Zod v4: typed inputs/outputs, with separate permissions and policy checks.
- MCP: allowlisted adapters for GitHub, reports, CI and read-only runtime sources.
- Guardrails: input/output/tool checks; note that tool guardrails do not automatically wrap all hosted tools, built-in tools or handoffs.
- Human-in-the-loop and RunState: pause/resume approval flows; persist signed requests on the server and revalidate every action.
- Sessions: case-specific context; durable vetted defect knowledge remains in local evidence DB, not LLM session text.
- Sandbox Agents: beta APIs; use adapter and disposable Docker/CI workspace, never host Docker socket, HA files or GitHub secrets.
- Tracing and streaming: sanitize locally; server-side tracing is enabled by default, so disable external exporter until privacy audit.
- Model selection: quality/cost tiers, bounded turns, timeout and provider failover.
- Realtime/voice: optional, deferred; not essential to safety or release qualification.
- Requires Node.js >=22, @openai/agents and zod v4. Pin exact tested npm versions and lockfile.

Official examples suited for adaptation:
examples/agent-patterns/routing.ts; agents-as-tools.ts; parallelization.ts; deterministic.ts;
llm-as-a-judge.ts; human-in-the-loop-server.ts; input-guardrails.ts; output-guardrails.ts;
examples/mcp/tool-filter-example.ts; examples/sandbox/coding-task.ts;
examples/sandbox/docker-runner.ts; examples/memory and examples/tools/apply-patch.ts.
These are educational patterns, NOT prebuilt hAPI/HAOS recovery scripts.

## 3. System boundaries

A: Enterprise remains independent and does not host AI process.
B: DevTools Ingress authenticates HA administrators and full OpenPGP fingerprint via signed challenge.
C: Offline collector inspects ready/health, aggregated observer data, feature flags, releases, defects, sensors and locale dictionary inventory.
D: AI worker is opt-in with its own lifecycle, budgets, worker queue and redacted prompts; failure cannot stop base DevTools or Enterprise.
E: Sandbox/CI service checks out exact commit SHA, runs isolated patch/tests and returns immutable evidence.
F: Future release/recovery controller is out-of-process; holds limited GitHub App authorization and can rollback while the target add-on is stopped.

The existing independent version/tag namespaces must remain unchanged:
Enterprise v* -> hapi_enterprise; DevTools hapi-dev-v* -> hapi_admin_devtools.
An Enterprise update must not restart, upgrade, modify the DevTools database or replace its image, and vice versa.

## 4. Agent roles and privileges

GuardianOrchestrator: bounded routing and synthesis; NO production write capability.
IncidentTriageAgent: identify failing function, version, error, historical DEF and current evidence; read-only.
CodeAnalysisAgent: propose minimal patch; may edit only isolated sandbox checkout.
QARegressionAgent: deterministic baseline failure and patched success in distinct real test environments.
SecurityReviewAgent: verify permissions, OpenPGP boundaries, quarantine and injection defense; read-only.
PerformanceAgent: propose cache candidates from measured latency, memory and correctness; no auto-cache.
LocalizationAgent: BG/EN/DE key and placeholder comparison; draft translations for human review only.
ReleaseReadinessAgent: exact signed SHA, 3 architecture artifacts, independent CI and recovery evidence; read-only.
RecoveryPlanningAgent: generate and verify a rollback drill in staging; production authority remains external.

Do not confuse two model-generated opinions with independent test environments. AI judgment is advice, not correctness proof.

## 5. Typed contracts / allowlisted tools

JSON schemas (via Zod) for Incident, HistoricEvidence, WatchProfile, ProposedPatch,
TestRunEvidence, CacheCandidate, LocaleChange, ReleaseIntent, RecoveryPlan.
Every record must include schema version, evidence source, exact commit SHA, timestamp, digest and status.

Read-only tools: read_hapi_health, get_aggregated_metrics, list_features,
lookup_historic_defects, read_commits, read_ci_runs, audit_languages, compare_versions,
scan_regression_tests, inspect_cache_candidates.

Sandbox-only tools: stage_candidate_diff, run_allowlisted_tests, run_two_variant_suite,
compare_baseline_vs_candidate, export_deterministic_report.

Never give agents raw git push, gh release, Supervisor token, uncontrolled shell,
database write, quarantined document access, OpenPGP private key, broad MCP or host Docker socket.

## 6. Core scenarios and acceptance criteria

S1. Historic defect intelligence: retrieve defect and release-index evidence, reproduce on
current commit, link to tested regression. Historical closed does not mean currently active.
Pass: source-backed diagnosis and a repro; no hallucinated fix claims.

S2. Candidate patch: reproduce failure on unmodified baseline; patch isolated checkout;
test changed behavior and unchanged old functions in two independent environments
(e.g. Node integration suite and disposable HAOS); record exact artifact hashes.
Pass: before/after test proof, no live mutation, independent QA/security.

S3. Cache optimization: aggregate counts, p50/p95/p99 and resource use; find duplicates;
define key, TTL, storage limits and invalidation. Run controlled cold/warm A/B tests including
permission revocations and stale-result tests.
Pass: measured benefit, zero incorrect/unauthorized cache results. Never cache security decisions,
credentials, signed URLs persistently, private documents or mutable audit results.

S4. Language/standards: BG/EN/DE dictionaries, option translations and portal strings;
BCP47 locale, Unicode NFC for indexing (not signed evidence), ICU placeholders, RFC3339 logs,
accessibility tests and locale snapshots. Unknown translation => review queue.
Pass: missing critical keys=0, placeholder parity and approved review; no silent AI publishing.

S5. Quarantine/security: observe deny events and local policy inheritance; treat internet
and repository text as untrusted data, not policy. Do not weaken fail-closed quarantine.
Pass: denied operations still denied offline; no AI access to protected files.

S6. Release review: validate trusted OpenPGP-signed release intent binding repo, exact SHA,
version, artifact hashes, architecture, expiry; verify protected CI, real test evidence,
backup, external restore drill and safe staging; no self-certified flags from LLM.
Pass: all missing/forged checks fail closed. Actual publish remains disabled until dedicated
limited GitHub App and protected workflow are reviewed and enabled.

S7. Recovery: exact last-good image/config snapshot, staging apply, post-restart readiness,
negative/failure-injection cases, independent out-of-target rollback controller.
Pass: both successful update and induced-failure restore verified with intact data.
No unbounded retries, no automatic whole-HAOS restart.

## 7. Success confidence and action policy

Never infer a success percentage from AI wording. Calculate an explicitly named empirical
lower confidence bound only when sample size and independent test artifacts support it.
Otherwise show unknown. Proposed safety tiers:
under 80% => blocked;
80% through below 90% => operator approval for eligible reversible change;
90%+ => automatic eligibility only for an explicit allowlist of minor reversible DevTools-local
maintenance (e.g. rebuild a non-sensitive diagnostic index).
Database, encryption keys, evidence, quarantine, access policies, Enterprise deployment,
GitHub release publishing and HA Supervisor/OS always require separate signed protected gates.
A high percentage does not override missing security checks or rollback proof.

## 8. Home Assistant sensors (not implemented yet)

Implement real registered entities via separately tested HA integration/discovery, not only
JSON in a DevTools panel. Suggested: guardian_state, open_incidents, detected_regressions,
cache_candidates, locale_missing_keys, last_analysis, release_readiness,
ai_provider_available, ai_cost_today and guardian_problem binary sensor.
Use stable unique IDs and device grouping, translated names and correct stale/unknown behavior.
Do not expose high-cardinality incident data or secrets as entity attributes.

## 9. Privacy, offline and cost boundaries

Tracing SDK on server is enabled by default. Begin with OPENAI_AGENTS_DISABLE_TRACING=1,
tracingDisabled=true, and only local redacted audit; external traces require explicit
data-protection review. Redact IPs, authorization headers, raw documents, signed URLs,
keys, filenames revealing identities and quarantine contents before external AI.
All external content is untrusted, including log messages and MCP returns. Add prompt-injection
negative tests. Limit model turns, timeouts, concurrency, rate, retries and daily budget.
Offline monitor, OpenPGP lock and local incident evidence must survive provider outage.
No model API keys in frontend, incident journal, Docker build context or GitHub PR comments.

## 10. Phased implementation / milestones

P0: SDK compatibility spike, pin package/lockfile, option default-off, worker boundary,
three-architecture Docker smoke, threat review. Exit: baseline add-on and offline locked UI pass.
P1: Offline collector and real HA diagnostic entities. Exit: HAOS entity registry integration
and stale/unavailable tests pass without AI.
P2: Triage + Security agents and source-grounded historical retrieval. Exit: run benchmark
against known historical defects plus negative cases; explain uncertainty, no mutation.
P3: Code + QA agents inside disposable sandbox; two independent test variants. Exit: deterministic
failure-before/pass-after, legacy regression, rollback drill and evidence hashes.
P4: Cache, i18n, quarantine agents. Exit: measured A/B, locale parity, permission negative tests.
P5: Signed release intent and CI provenance review UI. Exit: forged/missing inputs always block.
P6: Scoped GitHub App, protected release runner, external rollback staging. Exit: successful
HAOS staging for both release channels and injected-failure recovery before enabling any write.
P7: Narrow automatic reversible DevTools-local maintenance; limits, undo, audit, kill switch.
P8: Optional realtime/voice and advanced providers after safety/cost review.

Each phase ships in a DevTools-only prerelease; Enterprise release stays independent.
Do not merge an experimental sandbox agent into live release privileges.

## 11. Measurable quality gates

- Known-incident recall and false-positive rate on seeded tests.
- All claimed fixes backed by actual baseline+patched test outcomes and exact hashes.
- No leaked secrets, unapproved GitHub writes, unexpected hAPI restarts or HA data mutation.
- Cache p95 improvement under reproducible load and zero stale authorization success.
- Full BG/EN/DE key and placeholder coverage and human-reviewed translations.
- Independent rollback simulation success; both release-channel cross-upgrade matrices pass.
- Real HA entity availability and stability, plus offline read-only service continuity.
- Auditable per-incident model-token/cost budget and stop conditions.

## 12. Outstanding dependencies

Confirm full primary OpenPGP fingerprint; finish real HAOS Ingress and identity enrollment tests.
Validate API and hostname connectivity to Enterprise (current code assumes hapi_enterprise:8099).
Approve dedicated GitHub App permissions, branch rulesets and protected environments.
Provide external HAOS staging/recovery environment; the SDK cannot deliver rollback by itself.
Pin actual tested npm SDK version, not an inferred latest GitHub tag. The SDK sandbox layer
is in beta. Never claim the proposed multi-agent system is already running in production.

Decision: implement P0–P2 first; do not enable automatic fixes, releases or Supervisor restarts.
