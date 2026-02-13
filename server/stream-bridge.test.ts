import { describe, expect, it } from "vitest";
import type { OfficeEvent, OfficeSnapshot } from "./office-types";
import { OfficeStreamBridge, parseLifecycleCursor } from "./stream-bridge";

function makeEvent(input: {
  id: string;
  type: OfficeEvent["type"];
  runId: string;
  at: number;
  agentId?: string;
  parentAgentId?: string;
}): OfficeEvent {
  return {
    id: input.id,
    type: input.type,
    runId: input.runId,
    at: input.at,
    agentId: input.agentId ?? "child",
    parentAgentId: input.parentAgentId ?? "parent",
    text: `${input.type}:${input.runId}`,
  };
}

function makeSnapshot(events: OfficeEvent[]): OfficeSnapshot {
  return {
    generatedAt: Date.now(),
    source: {
      stateDir: "/tmp/.openclaw",
      live: true,
    },
    diagnostics: [],
    entities: [],
    runs: [],
    events,
  };
}

describe("OfficeStreamBridge", () => {
  it("seeds first snapshot without emitting lifecycle frames", () => {
    const bridge = new OfficeStreamBridge();
    const first = makeSnapshot([
      makeEvent({ id: "run-a:spawn:10", type: "spawn", runId: "run-a", at: 10 }),
      makeEvent({ id: "run-a:start:11", type: "start", runId: "run-a", at: 11 }),
    ]);

    const frames = bridge.ingestSnapshot(first);
    expect(frames).toEqual([]);
    expect(bridge.getLatestSnapshot()).toEqual(first);
    expect(bridge.getBackfill(0)).toEqual([]);
  });

  it("emits unseen events sorted by timestamp and runId", () => {
    const bridge = new OfficeStreamBridge();

    bridge.ingestSnapshot(
      makeSnapshot([makeEvent({ id: "run-a:spawn:10", type: "spawn", runId: "run-a", at: 10 })]),
    );

    const second = makeSnapshot([
      makeEvent({ id: "run-b:spawn:12", type: "spawn", runId: "run-b", at: 12 }),
      makeEvent({ id: "run-a:start:12", type: "start", runId: "run-a", at: 12 }),
      makeEvent({ id: "run-a:spawn:10", type: "spawn", runId: "run-a", at: 10 }),
      makeEvent({ id: "run-a:error:13", type: "error", runId: "run-a", at: 13 }),
    ]);

    const frames = bridge.ingestSnapshot(second);
    expect(frames.map((frame) => frame.event.id)).toEqual([
      "run-a:start:12",
      "run-b:spawn:12",
      "run-a:error:13",
    ]);
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2, 3]);
    expect(bridge.getBackfill(1).map((frame) => frame.seq)).toEqual([2, 3]);
  });

  it("caps queue/backfill memory", () => {
    const bridge = new OfficeStreamBridge({ maxQueue: 2, maxSeen: 4 });

    bridge.ingestSnapshot(makeSnapshot([makeEvent({ id: "seed:1", type: "spawn", runId: "seed", at: 1 })]));
    bridge.ingestSnapshot(makeSnapshot([makeEvent({ id: "ev:2", type: "spawn", runId: "x", at: 2 })]));
    bridge.ingestSnapshot(makeSnapshot([makeEvent({ id: "ev:3", type: "start", runId: "x", at: 3 })]));
    bridge.ingestSnapshot(makeSnapshot([makeEvent({ id: "ev:4", type: "end", runId: "x", at: 4 })]));

    const backfill = bridge.getBackfill(0);
    expect(backfill).toHaveLength(2);
    expect(backfill[0]?.event.id).toBe("ev:3");
    expect(backfill[1]?.event.id).toBe("ev:4");
  });
});

describe("parseLifecycleCursor", () => {
  it("normalizes invalid cursors to zero", () => {
    expect(parseLifecycleCursor(null)).toBe(0);
    expect(parseLifecycleCursor(undefined)).toBe(0);
    expect(parseLifecycleCursor("bad")).toBe(0);
    expect(parseLifecycleCursor("-4")).toBe(0);
  });

  it("returns integer cursor", () => {
    expect(parseLifecycleCursor("8")).toBe(8);
    expect(parseLifecycleCursor("8.8")).toBe(8);
  });
});
