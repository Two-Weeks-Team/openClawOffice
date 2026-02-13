# Entity Deep Inspector v2

`EntityDetailPanel` now provides four tabs for run investigation:

- `Overview`: entity identity, lifecycle summary, recent messages, and core metrics.
- `Sessions`: session keys and log/store paths with copy actions.
- `Runs`: recent run cards (latest 6) with model/token/latency/event metadata, plus copy/jump actions.
- `Diff`: success vs error run comparison with model/token/latency/event deltas.

## Investigation Scenarios

Use these scenarios to validate operator workflow in local mode (`127.0.0.1`):

1. `runId` trace
- Select a subagent.
- Open `Runs` tab.
- Copy `runId` from a recent run card and verify timeline filtering.

2. Session/log trace
- Open `Sessions` tab.
- Copy child/requester session keys and session log paths.
- Confirm those identifiers resolve to runtime state files.

3. Error run root-cause baseline
- Open `Diff` tab for an entity with at least one `ok` and one `error` run.
- Confirm baseline (`ok`) and candidate (`error`) run IDs and deltas are shown.

4. Timeline handoff
- In `Runs` tab, click `Jump` on an error run.
- Confirm timeline run filter updates to that run immediately.

5. Missing pair fallback
- Open `Diff` tab for an entity without an `ok`/`error` pair.
- Confirm the panel shows a clear non-blocking guidance message.
