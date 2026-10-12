# System Architecture — hAPI Enterprise (To-Be)

## Vision

A single codebase, three deployment targets, one behavior:

1. **Home Assistant add-on** (production, LAN/NAS storage).
2. **Windows edge** (standalone backend + pywebview desktop GUI).
3. **Evidence portal** (Phase 7, public read-only surface for courts/prosecutors).

## Layers

```text
┌────────────────────────────────────────────────────────────┐
│ L6 UI          admin.js │ portal.js │ desktop (pywebview)   │
├────────────────────────────────────────────────────────────┤
│ L5 API         versioned REST (v1/v2) │ webhooks │ SSE      │
├────────────────────────────────────────────────────────────┤
│ L4 Application services (jobs, sharing, audit, evidence)    │
├────────────────────────────────────────────────────────────┤
│ L3 Domain      registry │ directory │ cabinet │ evidence    │
├────────────────────────────────────────────────────────────┤
│ L2 Core        container │ event-bus │ plugins │ scheduler  │
├────────────────────────────────────────────────────────────┤
│ L1 Config      runtime-config │ secrets │ policy             │
├────────────────────────────────────────────────────────────┤
│ L0 Platform    SQLite │ filesystem │ crypto │ TSA │ HTTP     │
└────────────────────────────────────────────────────────────┘
```

## Cross-cutting concerns

- **Identity & RBAC** — roles + SSO (`X-Remote-User`) + TOTP for sensitive ops.
- **Observability** — bounded JSONL error log + audit chain + job progress events.
- **Compatibility** — same API contract across HA and Windows (see `INTEGRATION_CONTRACTS.md`).

## Deployment topologies

| Topology | Target | Note |
| -------- | ------ | ---- |
| HA add-on | `Dockerfile` + `run.sh` | Ingress + local volume |
| Windows | `standalone.js` + pywebview | loopback admin |
| Portal | public static + read API | judge/prosecutor access |
