# Local Quality Gate

## Goal
Keep local operations reproducible while features continue to expand.

## Commands
```bash
pnpm ci:local
pnpm e2e:smoke
pnpm e2e:workflow
pnpm ux:verify
pnpm readiness:gate
```

`ci:local` runs:
1. `pnpm lint`
2. `pnpm test`
3. `pnpm benchmark:local50`
4. `pnpm build`
5. `pnpm e2e:smoke`
6. `pnpm ux:verify`

Workflow scenario suite reference: `docs/e2e-workflow.md`
Readiness gate reference: `docs/readiness-gate.md`

## UX Verify Gate
`pnpm ux:verify` runs a browser-based regression gate and fails when any threshold is violated:
- Global status bar stickiness check (`Global status bar` remains pinned).
- Stage overlap pair count check (`overlap` badge and measured entity collisions must both be `0`).
- Replay tab persistence check (`Runs` tab remains selected while replay `eventId` advances).
- Core flow check (`search -> select -> jump`) with budget limits (`<= 8000ms`, `<= 4 clicks`).

Failure artifacts are written to `output/ux-verify/report.json` and screenshots under `output/ux-verify/`.

## API Error Classification
The API returns structured errors under `error.code` with `requestId`.

| Code | Meaning |
| --- | --- |
| `SNAPSHOT_BUILD_FAILED` | Unexpected snapshot build failure |
| `SNAPSHOT_STATE_NOT_FOUND` | State files/directories not found |
| `SNAPSHOT_STATE_ACCESS_DENIED` | State path permission denied |
| `SNAPSHOT_STATE_PARSE_FAILED` | Snapshot source parse failure |
| `STREAM_INIT_FAILED` | Initial stream bootstrap failure |
| `STREAM_RUNTIME_FAILED` | Stream polling/emit runtime failure |
| `METRICS_READ_FAILED` | Metrics endpoint payload build failure |

## Correlation ID
- request header: `x-correlation-id`
- response header: `x-correlation-id` (`X-Correlation-Id` casing may appear on the wire)
- every API log line carries `requestId` to trace failure scenarios
