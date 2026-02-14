# Synthetic Scenario Generator

`src/lib/local50-scenario.ts` provides a deterministic fixture generator for local load tests and UX experiments.

## Presets

`SYNTHETIC_SCENARIO_PRESETS` includes standard profiles:

| Preset | Agents | Runs | Events |
| --- | --- | --- | --- |
| `local10` | 10 | 100 | 1,000 |
| `local25` | 25 | 250 | 2,500 |
| `local50` | 50 | 500 | 5,000 |

## Usage

```ts
import { createLocal50Scenario } from "./local50-scenario";

const scenario = createLocal50Scenario({
  profile: "local50",
  seed: 42,
  seedTime: 1_765_280_000_000,
  pattern: {
    errorRate: 0.1,
    activeRate: 0.3,
    eventBurstEvery: 18,
    eventBurstSize: 5,
  },
});
```

If `profile` is omitted, it defaults to `local50`.

## Pattern Options

- `errorRate`: share of runs emitted as `error`
- `activeRate`: share of runs emitted as `active` (remaining runs become `ok`)
- `runSpacingMs`: run timestamp interval
- `eventIntervalMs`: base event timestamp interval
- `eventBurstEvery`: periodic burst cycle size
- `eventBurstSize`: number of burst events inside each cycle

Default values:

| Option | Default |
| --- | --- |
| `errorRate` | `1 / 11` |
| `activeRate` | `1 / 3` |
| `runSpacingMs` | `9000` |
| `eventIntervalMs` | `700` |
| `eventBurstEvery` | `18` |
| `eventBurstSize` | `5` |

## Determinism

- Same `seed` + same options => identical runs/events/entities.
- Different `seed` => different distribution while keeping total counts.
- Reproducibility tests: `src/lib/local50-scenario.test.ts`.
