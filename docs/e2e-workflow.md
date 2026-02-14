# Office Workflow E2E Scenario Suite

## Goal
Provide reproducible workflow checks for local operation (`127.0.0.1`) before release decisions.

## Commands
```bash
pnpm e2e:workflow
pnpm e2e:smoke
```

- `e2e:workflow`: scenario suite (`server/workflow-e2e.test.ts`)
- `e2e:smoke`: dev-server API/SSE smoke used by `ci:local`

## Covered Scenarios
1. spawn success workflow (`errorRate: 0`) + timeline status filters
2. spawn failure workflow (`errorRate: 1`) + error-focused filtering
3. stream reconnect/backfill cursor flow (`OfficeStreamBridge`)
4. panel exploration flow (agent/subagent detail model)
5. timeline deep-link (`runId`) + playback stepping flow

## Fixture Policy
- deterministic scenario generator: `src/lib/local50-scenario.ts`
- profile for workflow suite: `local10`
- seed-based reproducibility required for all added scenarios

## CI Smoke Subset
`ci:local` keeps `pnpm e2e:smoke` as the lightweight always-on gate.
The workflow suite is designed to stay fast and can be run standalone (`pnpm e2e:workflow`) when triaging failures.

## Failure Triage Guide
1. Run `pnpm e2e:workflow` and capture the failing test name.
2. If failure is `reconnect/backfill`, inspect `server/stream-bridge.ts` queue/cursor behavior first.
3. If failure is `panel exploration`, inspect `src/lib/detail-panel.ts` mapping from entity -> related runs/events.
4. If failure is `timeline` filtering/playback, inspect `src/lib/timeline.ts`.
5. Re-run `pnpm ci:local` after fixes before opening/updating a PR.
