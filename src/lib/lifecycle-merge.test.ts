import { describe, expect, it } from "vitest";
import { MAX_STREAM_EVENTS, mergeLifecycleEvent } from "./lifecycle-merge";
import type { OfficeEvent, OfficeSnapshot } from "../types/office";

function makeEvent(id: string, at: number): OfficeEvent {
  return {
    id,
    type: "spawn",
    runId: `run-${id}`,
    at,
    agentId: "agent-a",
    parentAgentId: "agent-root",
    text: id,
  };
}

function makeSnapshot(events: OfficeEvent[]): OfficeSnapshot {
  return {
    generatedAt: 100,
    source: { stateDir: "/tmp/openclaw", live: true },
    diagnostics: [],
    entities: [],
    runs: [],
    events,
  };
}

describe("mergeLifecycleEvent", () => {
  it("inserts by recency and updates generatedAt", () => {
    const snapshot = makeSnapshot([makeEvent("old", 20), makeEvent("older", 10)]);
    const merged = mergeLifecycleEvent(snapshot, makeEvent("new", 30), 10);

    expect(merged.generatedAt).toBe(100);
    expect(merged.events.map((event) => event.id)).toEqual(["new", "old", "older"]);
  });

  it("replaces duplicated event id and keeps ordering", () => {
    const snapshot = makeSnapshot([makeEvent("a", 30), makeEvent("b", 20), makeEvent("c", 10)]);
    const merged = mergeLifecycleEvent(snapshot, makeEvent("b", 40), 10);

    expect(merged.events.map((event) => [event.id, event.at])).toEqual([
      ["b", 40],
      ["a", 30],
      ["c", 10],
    ]);
  });

  it("respects max event cap", () => {
    const seedEvents = Array.from({ length: MAX_STREAM_EVENTS }, (_, index) =>
      makeEvent(`seed-${index}`, MAX_STREAM_EVENTS - index),
    );
    const merged = mergeLifecycleEvent(
      makeSnapshot(seedEvents),
      makeEvent("incoming", MAX_STREAM_EVENTS + 10),
    );
    expect(merged.events.length).toBe(MAX_STREAM_EVENTS);
    expect(merged.events[0]?.id).toBe("incoming");
  });
});
