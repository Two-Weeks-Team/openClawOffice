# Local Quality Gate

## Goal
Keep local operations reproducible while features continue to expand.

## Commands
```bash
pnpm ci:local
pnpm e2e:smoke
pnpm e2e:workflow
```

`ci:local` runs:
1. `pnpm lint`
2. `pnpm test`
3. `pnpm benchmark:local50`
4. `pnpm build`
5. `pnpm e2e:smoke`

Workflow scenario suite reference: `docs/e2e-workflow.md`

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
