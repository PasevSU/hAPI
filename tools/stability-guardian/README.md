# hAPI Stability Guardian — foundation (experimental)

This is an **isolated opt-in prototype**, not an active monitor and not an autonomous repair agent.
It does not modify the running Home Assistant add-on. Core incident capture is fully offline;
AI analysis requires a configured provider and internet access when using OpenAI API.

## Goals
1. Collect sanitized structured errors from hAPI, Supervisor, and tests.
2. Group repeat failures into incidents with stable fingerprints.
3. Journal observations, proposed fixes, and verified resolutions separately.
4. Use OpenAI Agents SDK **only to suggest** root causes, tests and remediation.
5. Never allow the agent to run shell commands, mutate repositories, restart the add-on,
   handle sensitive document bytes, or change quarantine policies.

## Demo (local, offline)
Create an event JSON file containing:
```json
{"source":"supervisor","code":"REPO_METADATA_STALE","message":"Store version stale","severity":"warning"}
```
Then:
```bash
node tools/stability-guardian/cli.cjs ingest ./event.json
node tools/stability-guardian/cli.cjs list
node tools/stability-guardian/cli.cjs decision <incident-id> investigating "Checking Supervisor metadata"
```
Use `HAPI_GUARDIAN_JOURNAL=/some/private/path/events.jsonl` to select an output path.
The default is `reports/stability-incidents.jsonl`; do not commit runtime incident data.

## Optional agent
```bash
cd tools/stability-guardian
npm install
export OPENAI_API_KEY=...
cd ../..
node tools/stability-guardian/cli.cjs analyze <incident-id>
```
This opt-in action may transmit the sanitized incident summary to the selected AI provider.
The SDK's tracing is disabled on analysis calls to avoid duplicating sensitive diagnostic content.

## Integration roadmap
- Emit explicit event objects from hAPI health checks and supervised log ingestion;
  do **not** scrape full unredacted logs.
- Add SQLite-backed incident storage with limits, retention, and audit linking.
- Add alert thresholds, dedup windows, resource usage probes, and incident lifecycle UI.
- Add read-only tool adapters for bounded diagnostics, gated by RBAC.
- Create fix proposals and regression tests as draft PRs only after human review.
- Define offline checks, queueing, backpressure, no-key mode, cost limits, and opt-in telemetry.
- Integrate with existing known-defects, audit-chain and CI quality gates.
- Add integration tests under HAOS with network disabled and restart/crash scenarios.

## Non-goals of this foundation
- No automatic code edits or restarts.
- No production daemon or monitoring claim.
- No guarantee that regex redaction catches all secrets. Integrators must allowlist fields
  and prevent raw document contents or sensitive request bodies from reaching this component.
