# Capacity Baseline (10/25/50)

## Scope
- Operating mode: local-only (`127.0.0.1`)
- Capacity target: up to 50 active agents
- Security hardening/perimeter controls: out of scope in this baseline

## Standard Fixture Set
All capacity measurements must use the shared synthetic scenario generator:
- source: `src/lib/local50-scenario.ts`
- profile constants: `src/lib/perf-budgets.ts` (`CAPACITY_BASELINE_PROFILES`)
- option reference: `docs/synthetic-scenario-generator.md`

| Profile | Agents | Runs | Events |
| --- | --- | --- | --- |
| `local10` | 10 | 100 | 1,000 |
| `local25` | 25 | 250 | 2,500 |
| `local50` | 50 | 500 | 5,000 |

## Budget Categories
Pipeline budgets are automatically collected in benchmark tests.

| Category | Budget | Collection |
| --- | --- | --- |
| Session parser p95 | `<= 18ms` | auto (`benchmark:local50`) |
| Run parser p95 | `<= 45ms` | auto (`benchmark:local50`) |
| Layout p95 | `<= 55ms` | auto (`benchmark:local50`) |
| Timeline index p95 | `<= 60ms` | auto (`benchmark:local50`) |
| Entity search p95 | `<= 12ms` | auto (`benchmark:local50`) |
| Stream merge batch p95 | `<= 70ms` | auto (`benchmark:local50`) |
| Memory footprint (`heapUsed`) | `<= 220MB` | auto (`benchmark:local50`) |
| Render FPS | `>= 30` | manual probe |
| Update latency (UI) | `<= 160ms` | manual probe |

## Execution
```bash
pnpm benchmark:local50
pnpm ci:local
```

## Soak Guard Signals
During long-running stream checks, monitor `GET /api/office/metrics`:
- `backpressureActivations`: how often burst throttling was applied
- `droppedUnseenEvents`: lifecycle events intentionally dropped from incremental emission
- `evictedBackfillEvents`: old backfill frames evicted to stay within queue budget

## Reporting Template
```md
### Capacity Baseline Report - YYYY-MM-DD
- Commit:
- Machine:
- Profile: local10 | local25 | local50

| Metric | Budget | Result | Status |
| --- | --- | --- | --- |
| parseSessions p95 | <= 18ms |  |  |
| parseRuns p95 | <= 45ms |  |  |
| buildPlacements p95 | <= 55ms |  |  |
| buildTimelineIndex p95 | <= 60ms |  |  |
| searchEntityIds p95 | <= 12ms |  |  |
| streamMerge p95 | <= 70ms |  |  |
| heapUsed MB | <= 220MB |  |  |
| FPS (manual) | >= 30 |  |  |
| update latency (manual) | <= 160ms |  |  |
```
