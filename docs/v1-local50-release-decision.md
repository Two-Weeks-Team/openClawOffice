# v1-local50 Release Decision (2026-02-14)

## Scope
- local-only runtime (`127.0.0.1`)
- target capacity: 50 active agents
- release gate reference: `docs/readiness-gate.md`

## Milestone Checklist
- [x] Core prerequisite issues verified
- [x] Final rehearsal executed (`local25 -> local50`)
- [x] Result report documented
- [x] Release decision recorded

## Predecessor Issue Aggregation (`#31`-`#49`)

| Issue | Status | Note |
| --- | --- | --- |
| #31 | CLOSED | capacity baseline + measurement spec |
| #32 | CLOSED | render batch/memo/cache optimization |
| #33 | CLOSED | timeline compression/summarization |
| #34 | CLOSED | room capacity + auto spread policy |
| #35 | CLOSED | panel responsiveness optimization |
| #36 | CLOSED | reconnect consistency (`lastEventId`/backfill) |
| #37 | CLOSED | critical-first rendering policy |
| #38 | CLOSED | synthetic scenario generator |
| #39 | CLOSED | queue/latency hotspot analytics |
| #40 | CLOSED | readiness gate definition |
| #41 | CLOSED | dense-scene entity clustering |
| #42 | CLOSED | memory budget guard + backpressure |
| #43 | CLOSED | `benchmark:local50` automation |
| #44 | CLOSED | zoom-based LOD rendering |
| #45 | CLOSED | timeline segment archive + lazy load |
| #46 | CLOSED | run notes/tag local knowledge |
| #47 | CLOSED | split-view workspace layout |
| #48 | CLOSED | corrupted state snapshot recovery |
| #49 | CLOSED | operator playbook |

## Rehearsal + Gate Evidence

Executed on **2026-02-14 (UTC)**:
- `pnpm ci:local` -> PASS (`2026-02-14T09:34:45Z`)
- `pnpm readiness:gate` -> PASS (`2026-02-14T09:42:15.536Z`)

Readiness artifacts:
- `.reports/perf/local25-latest.json`
- `.reports/perf/local50-latest.json`
- `.reports/readiness/readiness-latest.json`
- `.reports/readiness/readiness-latest.md`

Gate matrix:

| Gate | local25 | local50 |
| --- | --- | --- |
| Data integrity | PASS | PASS |
| Render performance | PASS | PASS |
| Timeline reliability | PASS | PASS |
| Panel responsiveness | PASS | PASS |

Overall readiness gate result: **PASS**

## Key Metrics Snapshot

| Metric | local25 | local50 | Budget |
| --- | --- | --- | --- |
| parseSessions p95 | 0.05ms | 0.11ms | <= 18ms |
| parseRuns p95 | 1.15ms | 0.63ms | <= 45ms |
| buildPlacements p95 | 2.01ms | 3.79ms | <= 55ms |
| buildTimelineIndex p95 | 0.98ms | 1.91ms | <= 60ms |
| searchEntityIds p95 | 0.09ms | 0.16ms | <= 12ms |
| streamMergeBatch p95 | 0.89ms | 0.57ms | <= 70ms |
| heapUsed footprint | 13.96MB | 27.36MB | <= 220MB |

Interpretation note:
- `parseRuns p95` and `streamMergeBatch p95` are lower in `local50` than `local25` for this run. This benchmark is a short local micro-batch and can show non-monotonic variance from runtime warm-up, scheduler timing, and sample distribution differences. Release judgement uses budget pass/fail and repeated trend monitoring, not a single-run monotonic expectation.

## Remaining Risks And Follow-up Plan
- No blocking risk identified for current local50 gate.
- Soak stability beyond benchmark/e2e scope should continue under the weekly review routine.
- Follow-up operational rule: rerun `pnpm readiness:gate` for weekly release health and track drift in `.reports/`.

## Release Verdict
- Decision: **GO**
- Rationale: all prerequisite issues are closed and readiness gates passed for both rehearsal stages with significant budget headroom.
