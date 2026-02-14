# 50-Agent Operator Playbook

## Scope
- local-only operation (`127.0.0.1`)
- target capacity: up to 50 active agents
- audience: operators handling daily checks and incident response

## Daily Check Routine
1. Run baseline gate:
   - `pnpm ci:local`
2. Run readiness rehearsal:
   - `pnpm readiness:gate`
3. Confirm artifacts were updated:
   - `.reports/perf/local25-latest.json`
   - `.reports/perf/local50-latest.json`
   - `.reports/readiness/readiness-latest.md`
4. Open `GET /api/office/metrics` and verify no abnormal growth in:
   - base URL: `http://127.0.0.1:5179` (dev server running)
   - example: `curl http://127.0.0.1:5179/api/office/metrics`
   - `stream.backpressureActivations`
   - `stream.droppedUnseenEvents`
   - `stream.evictedBackfillEvents`
5. Log the daily verdict using this one-line format:
   - `daily verdict: pass | hold (reason)`

## Incident Triage Procedure
1. Classify severity:
   - `P0`: stream/API unavailable or integrity mismatch
   - `P1`: workflow degraded but service still usable
   - `P2`: cosmetic or non-blocking regression
2. Capture evidence:
   - failing command output
   - related report artifacts under `.reports/`
   - correlation id (`x-correlation-id`) from failed requests
3. Reproduce with focused command:
   - timeline/reconnect: `pnpm e2e:workflow`
   - perf suspicion: `pnpm benchmark:local25` then `pnpm benchmark:local50`
   - release impact: `pnpm readiness:gate`
4. Decide action:
   - fix immediately if safe in current scope
   - otherwise create follow-up issue with dependency line:
     - `Depends on: #<blocking issue>`

## Replay And Reporting
Artifact rule:
- daily checks: attach `.json` artifacts
- operator/review reports: attach `.md` artifacts
- release decision reviews: attach both `.json` and `.md`

1. Build replay evidence from workflow suite:
   - `pnpm e2e:workflow`
2. Attach readiness summary:
   - `.reports/readiness/readiness-latest.json`
   - `.reports/readiness/readiness-latest.md`
3. Attach perf snapshots:
   - `.reports/perf/local25-latest.json`
   - `.reports/perf/local25-latest.md`
   - `.reports/perf/local50-latest.json`
   - `.reports/perf/local50-latest.md`
4. Use this report skeleton:

```md
### Incident/Day Report - YYYY-MM-DD
- context:
- commands:
- readiness result: pass | fail
- key metrics deltas:
- root-cause hypothesis:
- follow-up actions:
```

## Failure Pattern Guide
| Pattern | Signals | First Action |
| --- | --- | --- |
| Reconnect mismatch | timeline gaps, stream backpressure spikes | run `pnpm e2e:workflow`, inspect `server/stream-bridge.ts` behavior |
| Perf regression | p95 over budget in local25/local50 reports | run `pnpm readiness:gate`, compare latest vs previous report |
| Panel responsiveness drop | high heap footprint + slow detail interactions | inspect `heapUsed footprint` and panel-related workflow assertions |
| Snapshot/API parse failures | `SNAPSHOT_STATE_*` errors in API responses | verify state path integrity and parser inputs |

## Onboarding Quick Start
1. Read:
   - `docs/roadmap-readiness.md`
   - `docs/readiness-gate.md`
2. Run:
   - `pnpm ci:local`
   - `pnpm readiness:gate`
3. Review latest readiness markdown and one recent closed release PR for reference.
