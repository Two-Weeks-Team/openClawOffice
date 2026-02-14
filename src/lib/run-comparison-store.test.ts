import { describe, expect, it } from "vitest";
import {
  parseSavedRunComparisons,
  removeSavedRunComparison,
  upsertSavedRunComparison,
  type SavedRunComparison,
} from "./run-comparison-store";

function makeSaved(partial?: Partial<SavedRunComparison>): SavedRunComparison {
  return {
    id: partial?.id ?? "cmp-1",
    entityId: partial?.entityId ?? "agent:main",
    baselineRunId: partial?.baselineRunId ?? "run-ok",
    candidateRunId: partial?.candidateRunId ?? "run-error",
    createdAt: partial?.createdAt ?? 1000,
  };
}

describe("run comparison store", () => {
  it("parses and sorts saved comparisons by latest first", () => {
    const parsed = parseSavedRunComparisons(
      JSON.stringify([
        makeSaved({ id: "cmp-1", createdAt: 1000 }),
        makeSaved({ id: "cmp-2", createdAt: 1200 }),
      ]),
    );
    expect(parsed.map((item) => item.id)).toEqual(["cmp-2", "cmp-1"]);
  });

  it("ignores invalid records while parsing", () => {
    const parsed = parseSavedRunComparisons(
      JSON.stringify([
        makeSaved({ id: "cmp-1" }),
        { foo: "bar" },
        { id: "cmp-2", entityId: "agent:main", baselineRunId: "a", candidateRunId: "b" },
      ]),
    );
    expect(parsed.map((item) => item.id)).toEqual(["cmp-1"]);
  });

  it("upserts and deduplicates same entity/run pair", () => {
    const before = [
      makeSaved({ id: "cmp-1", createdAt: 1000 }),
      makeSaved({ id: "cmp-2", createdAt: 1100, baselineRunId: "run-ok-2", candidateRunId: "run-error-2" }),
    ];
    const next = upsertSavedRunComparison(
      before,
      makeSaved({ id: "cmp-3", createdAt: 1300, baselineRunId: "run-ok", candidateRunId: "run-error" }),
    );
    expect(next).toHaveLength(2);
    expect(next.map((item) => item.id)).toEqual(["cmp-3", "cmp-2"]);
  });

  it("removes a saved comparison by id", () => {
    const next = removeSavedRunComparison(
      [makeSaved({ id: "cmp-1" }), makeSaved({ id: "cmp-2", createdAt: 1200 })],
      "cmp-2",
    );
    expect(next.map((item) => item.id)).toEqual(["cmp-1"]);
  });
});
