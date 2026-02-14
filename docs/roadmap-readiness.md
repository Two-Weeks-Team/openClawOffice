# Roadmap Board And Release Readiness

## Scope
- local-only operation (`127.0.0.1`)
- max target capacity: 50 active agents
- security hardening/compliance is out of scope for this roadmap board

## Phase Board
Use these phases to place every issue on one board lane.

| Phase | Objective | Typical Outputs | Exit Signal |
| --- | --- | --- | --- |
| Foundation | deterministic fixtures, baseline budgets, local gates | generator, baseline docs, quality gate scripts | `pnpm ci:local` is reproducible |
| Realtime | stream correctness and reconnect continuity | stream bridge, cursor/backfill, resilience handling | no timeline/state divergence on reconnect |
| Visual | dense-scene readability and interaction quality | layout/timeline/stage UX features | operator can identify critical state quickly |
| Ops | workflow acceleration for day-2 operation | command palette, alerts, reports, run knowledge | daily triage flow is tool-assisted end-to-end |
| Scale | 25->50 readiness convergence and release decision | perf tuning, readiness gates, milestone checks | `v1-local50` gate can be judged objectively |

## Labeling Rules
Every new issue should include one value from each category.

| Category | Allowed Values | Rule |
| --- | --- | --- |
| `phase/*` | `foundation`, `realtime`, `visual`, `ops`, `scale` | exactly 1 |
| `priority/*` | `p0`, `p1`, `p2` | exactly 1 |
| `effort/*` | `s`, `m`, `l` | exactly 1 |
| dependency | `Depends on: #...` in issue body | required when blocked |

If multiple dependencies exist, list them on one line:
`Depends on: #20, #30, #40`

## Unified DoD Template
Copy this block to issue bodies.

```md
## Definition of Done
- [ ] feature scope implemented
- [ ] docs updated (`README` + related docs/*)
- [ ] `pnpm ci:local` passed
- [ ] capacity impact noted against `docs/capacity-baseline.md`
- [ ] follow-up risks/backlog items recorded
```

## Release Smoke Scenarios
Run before any release-readiness decision:

1. `pnpm ci:local`
2. `pnpm readiness:gate`
3. verify `.reports/perf/local25-latest.json` and `.reports/perf/local50-latest.json`
4. confirm unresolved blocking issues and explicit risk log

## Weekly Review Routine
Run once per week with a fixed owner.

1. Review open issues by dependency chain (blocked -> ready).
2. Re-rank `priority/*` by operational risk and release impact.
3. Move one phase lane forward only when exit signal is met.
4. Record decisions and carry-over risks in the active milestone issue.
5. Reconfirm that local-only constraints still hold (`127.0.0.1`, 50-agent target).
