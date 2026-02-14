import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_SCENARIO_PRESETS,
  createLocal50Scenario,
} from "./local50-scenario";

describe("createLocal50Scenario", () => {
  it("reproduces identical fixtures with the same seed", () => {
    const first = createLocal50Scenario({
      profile: "local10",
      seed: 42,
      seedTime: 1_700_000_000_000,
    });
    const second = createLocal50Scenario({
      profile: "local10",
      seed: 42,
      seedTime: 1_700_000_000_000,
    });

    expect(first).toEqual(second);
  });

  it("changes run/event patterns when seed changes", () => {
    const first = createLocal50Scenario({
      profile: "local10",
      seed: 1,
      seedTime: 1_700_000_000_000,
    });
    const second = createLocal50Scenario({
      profile: "local10",
      seed: 2,
      seedTime: 1_700_000_000_000,
    });

    expect(first.snapshot.runs).not.toEqual(second.snapshot.runs);
    expect(first.snapshot.events).not.toEqual(second.snapshot.events);
  });

  it("supports burst and error-rate pattern options", () => {
    const allError = createLocal50Scenario({
      profile: "local10",
      seed: 7,
      pattern: {
        errorRate: 1,
        activeRate: 0,
        eventBurstEvery: 6,
        eventBurstSize: 3,
      },
    });

    expect(allError.snapshot.runs.every((run) => run.status === "error")).toBe(true);

    const timestamps = allError.snapshot.events
      .map((event) => event.at)
      .sort((left, right) => right - left);
    const deltas = timestamps
      .slice(1)
      .map((at, index) => timestamps[index] - at);
    expect(deltas.some((delta) => delta < 700)).toBe(true);
  });

  it("exposes standard local10/local25/local50 presets", () => {
    const profiles = Object.keys(SYNTHETIC_SCENARIO_PRESETS).sort();
    expect(profiles).toEqual(["local10", "local25", "local50"]);

    const local25 = createLocal50Scenario({ profile: "local25", seed: 11 });
    const local50 = createLocal50Scenario({ profile: "local50", seed: 11 });

    expect(local25.snapshot.runs).toHaveLength(SYNTHETIC_SCENARIO_PRESETS.local25.runs);
    expect(local50.snapshot.runs).toHaveLength(SYNTHETIC_SCENARIO_PRESETS.local50.runs);
  });
});
