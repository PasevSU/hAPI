# Donor Comparison — hAPI Enterprise

> Compares candidate "donor" sources (legacy locations) to decide migration order.

## Candidate donors

| Donor | Type | Risk | Priority |
| ----- | ---- | ---- | -------- |
| `addon_configs/local_portal_enterprise` (old) | legacy add-on data | high (unstructured) | 1 |
| Windows document folders (pointer targets) | referenced files | medium (paths) | 2 |
| NAS shares (`\\192.168.50.4\...`) | network storage | medium (latency) | 3 |
| In-place active store | current canonical | low | — (baseline) |

## Comparison criteria

| Criterion | Weight | Notes |
| --------- | ------ | ----- |
| Data volume | 3 | total bytes + file count |
| File type spread | 2 | docs, images, PDFs |
| Duplication | 2 | dedupe by hash |
| Path stability | 2 | UNC vs local |
| Sensitivity | 3 | evidence vs working |
| Recoverability | 2 | backup exists? |

## Decision rule

Migrate smallest, most-sensitive, most-stable donors first; largest/latency-heavy
last. Baseline (canonical) is never "migrated", only referenced.
