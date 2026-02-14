# 50-Agent Readiness Gate

## Scope
- local-only runtime (`127.0.0.1`)
- staged rehearsal: `local25 -> local50`
- objective: decide if release candidate is operationally ready

## Gate Categories
| Category | Signals |
| --- | --- |
| Data integrity | `parseSessions p95`, `parseRuns p95` |
| Render performance | `buildPlacements p95`, `searchEntityIds p95` |
| Timeline reliability | `buildTimelineIndex p95`, `streamMergeBatch p95` |
| Panel responsiveness | `heapUsed footprint` (capacity proxy) |

All signals are evaluated for both stages (`local25`, `local50`).

## Rehearsal Commands
```bash
pnpm readiness:rehearsal
pnpm readiness:gate
```

- `readiness:rehearsal`:
  - runs benchmark at `local25`
  - runs benchmark at `local50`
  - runs workflow suite (`pnpm e2e:workflow`)
- `readiness:gate`:
  - runs rehearsal
  - evaluates stage reports and writes readiness summary

## Output Artifacts
- perf stage reports:
  - `.reports/perf/local25-latest.json`
  - `.reports/perf/local50-latest.json`
- readiness summary:
  - `.reports/readiness/readiness-latest.json`
  - `.reports/readiness/readiness-latest.md`

## Release Decision Template
Use this template for milestone review notes.

```md
### Release Readiness Decision - YYYY-MM-DD
- Candidate:
- Reviewer:
- Rehearsal command: `pnpm readiness:gate`

| Gate | local25 | local50 | Result |
| --- | --- | --- | --- |
| Data integrity |  |  |  |
| Render performance |  |  |  |
| Timeline reliability |  |  |  |
| Panel responsiveness |  |  |  |

Decision: go | hold
Remaining risks:
- 
Follow-up issues:
- 
```
