# Office Workflow E2E Scenario Suite

## Goal
Provide reproducible workflow checks for local operation (`127.0.0.1`) before release decisions.

## Commands
```bash
pnpm e2e:workflow
pnpm e2e:smoke
pnpm ux:verify
```

- `e2e:workflow`: scenario suite (`server/workflow-e2e.test.ts`)
- `e2e:smoke`: dev-server API/SSE smoke used by `ci:local`
- `ux:verify`: Playwright-based UX regression gate (`scripts/ux-verify.mjs`)

## Covered Scenarios
1. spawn success workflow (`errorRate: 0`) + timeline status filters
2. spawn failure workflow (`errorRate: 1`) + error-focused filtering
3. stream reconnect/backfill cursor flow (`OfficeStreamBridge`)
4. panel exploration flow (agent/subagent detail model)
5. timeline deep-link (`runId`) + playback stepping flow
6. UX regression gate:
   - sticky global status bar
   - stage overlap pair count (`overlap == 0`)
   - replay detail tab persistence (`Runs` tab)
   - operator core flow latency/click budget (`search -> select -> jump`)

## Fixture Policy
- deterministic scenario generator: `src/lib/local50-scenario.ts`
- profile for workflow suite: `local10`
- seed-based reproducibility required for all added scenarios

## CI Smoke Subset
`ci:local` runs both `pnpm e2e:smoke` and `pnpm ux:verify`.
The workflow suite is designed to stay fast and can be run standalone (`pnpm e2e:workflow`) when triaging failures.

## Failure Triage Guide
1. Run `pnpm e2e:workflow` and capture the failing test name.
2. If failure is `reconnect/backfill`, inspect `server/stream-bridge.ts` queue/cursor behavior first.
3. If failure is `panel exploration`, inspect `src/lib/detail-panel.ts` mapping from entity -> related runs/events.
4. If failure is `timeline` filtering/playback, inspect `src/lib/timeline.ts`.
5. If failure is `ux:verify`, inspect `output/ux-verify/report.json` and attached screenshots.
6. Re-run `pnpm ci:local` after fixes before opening/updating a PR.
