# Local50 Performance Guide

## Scope
- Operating mode: local-only (`127.0.0.1`)
- Scenario size: `50 agents / 500 runs / 5,000 events`
- Security hardening: out of scope for this benchmark pass
- Baseline profiles (`10/25/50`) are defined in `docs/capacity-baseline.md`

## Budgets
| Category | Budget |
| --- | --- |
| FPS (manual target) | `>= 30` |
| TTI (manual target) | `<= 2200ms` |
| Update latency (manual target) | `<= 160ms` |
| Run parser p95 | `<= 45ms` |
| Session parser p95 | `<= 18ms` |
| Layout p95 | `<= 55ms` |
| Timeline index p95 | `<= 60ms` |
| Entity search p95 | `<= 12ms` |
| Stream merge batch p95 | `<= 70ms` |
| Heap used (Node process) | `<= 220MB` |

## Commands
```bash
pnpm benchmark:local25
pnpm benchmark:local50
pnpm ci:local
```

`benchmark:local50` automatically collects:
- parse/layout/timeline/search/stream p95 metrics
- Node `heapUsed` memory footprint
- report artifacts (`JSON`/`MD`): `.reports/perf/local50-latest.json`, `.reports/perf/local50-latest.md`

## Stream Memory Guard
`OfficeStreamBridge` applies a bounded queue and burst backpressure policy to keep memory usage stable:
- `maxQueue`: cap lifecycle backfill queue size
- `maxEmitPerSnapshot`: cap lifecycle frames emitted from a single snapshot burst
- `maxSeen`: cap deduplication id set size

Check `/api/office/metrics` stream counters during soak runs:
- `backpressureActivations`
- `droppedUnseenEvents`
- `evictedBackfillEvents`

## Profiling Template
Use this template when reporting a new measurement run.

```md
### Local50 Report - YYYY-MM-DD
- Commit:
- Machine:
- Node / pnpm:

| Metric | Budget | Result(p95) | Status |
| --- | --- | --- | --- |
| parseSessions | <= 18ms |  |  |
| parseRuns | <= 45ms |  |  |
| buildPlacements | <= 55ms |  |  |
| buildTimelineIndex | <= 60ms |  |  |
| searchEntityIds | <= 12ms |  |  |
| streamMergeBatch | <= 70ms |  |  |

Notes:
- regression risk:
- next optimization candidate:
```

## Before/After Comparison
The stream merge path was optimized from full-array sort per event to ordered insertion.
Update this section after each run:

| Variant | p95(ms) | avg(ms) | max(ms) |
| --- | --- | --- | --- |
| Legacy full sort | 1.49 | 0.72 | 1.49 |
| Optimized insert | 0.67 | 0.47 | 0.67 |
