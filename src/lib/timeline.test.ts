import { describe, expect, it } from "vitest";
import type { OfficeEvent, OfficeRun } from "../types/office";
import { buildRunGraph } from "./run-graph";
import {
  buildTimelineLaneItems,
  buildTimelineLanes,
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
  nextReplayIndex,
  parseEventIdDeepLink,
  parseRunIdDeepLink,
} from "./timeline";

function makeEvents(): OfficeEvent[] {
  return [
    {
      id: "run-a:spawn",
      type: "spawn",
      runId: "run-a",
      at: 100,
      agentId: "child-a",
      parentAgentId: "parent-a",
      text: "spawn a",
    },
    {
      id: "run-a:start",
      type: "start",
      runId: "run-a",
      at: 110,
      agentId: "child-a",
      parentAgentId: "parent-a",
      text: "start a",
    },
    {
      id: "run-b:error",
      type: "error",
      runId: "run-b",
      at: 120,
      agentId: "child-b",
      parentAgentId: "parent-a",
      text: "error b",
    },
    {
      id: "run-b:cleanup",
      type: "cleanup",
      runId: "run-b",
      at: 130,
      agentId: "child-b",
      parentAgentId: "parent-a",
      text: "cleanup b",
    },
  ];
}

function makeRuns(): OfficeRun[] {
  return [
    {
      runId: "run-a",
      childSessionKey: "agent:child-a:session:1",
      requesterSessionKey: "agent:parent-a:session:1",
      childAgentId: "child-a",
      parentAgentId: "parent-a",
      status: "active",
      task: "run a",
      cleanup: "keep",
      createdAt: 90,
      startedAt: 95,
    },
    {
      runId: "run-b",
      childSessionKey: "agent:child-b:session:1",
      requesterSessionKey: "agent:parent-b:session:1",
      childAgentId: "child-b",
      parentAgentId: "parent-b",
      status: "ok",
      task: "run b",
      cleanup: "keep",
      createdAt: 100,
      startedAt: 105,
      endedAt: 120,
    },
  ];
}

describe("timeline index", () => {
  it("indexes events by run, agent, and status", () => {
    const index = buildTimelineIndex(makeEvents());
    expect(index.ordered.map((event) => event.id)).toEqual([
      "run-b:cleanup",
      "run-b:error",
      "run-a:start",
      "run-a:spawn",
    ]);
    expect(index.byRunId.get("run-a")?.length).toBe(2);
    expect(index.byAgentId.get("parent-a")?.length).toBe(4);
    expect(index.byStatus.get("error")?.[0]?.id).toBe("run-b:error");
  });

  it("filters events with runId/agentId/status combinations", () => {
    const index = buildTimelineIndex(makeEvents());
    const filtered = filterTimelineEvents(index, {
      runId: "run-b",
      agentId: "parent-a",
      status: "error",
    });
    expect(filtered.map((event) => event.id)).toEqual(["run-b:error"]);
  });

  it("uses run graph agent mapping when provided", () => {
    const graph = buildRunGraph(makeRuns());
    const index = buildTimelineIndex(makeEvents(), graph);
    const filteredParentA = filterTimelineEvents(index, {
      runId: "",
      agentId: "parent-a",
      status: "all",
    });
    expect(filteredParentA.map((event) => event.id)).toEqual(["run-a:start", "run-a:spawn"]);

    const filteredParentB = filterTimelineEvents(index, {
      runId: "",
      agentId: "parent-b",
      status: "all",
    });
    expect(filteredParentB.map((event) => event.id)).toEqual(["run-b:cleanup", "run-b:error"]);
  });
});

describe("timeline helpers", () => {
  it("parses runId from deep link query", () => {
    expect(parseRunIdDeepLink("?runId=run-123")).toBe("run-123");
    expect(parseRunIdDeepLink("?agentId=main")).toBe("");
  });

  it("parses eventId from deep link query", () => {
    expect(parseEventIdDeepLink("?eventId=run-1:start:1700000000")).toBe("run-1:start:1700000000");
    expect(parseEventIdDeepLink("?runId=run-123")).toBe("");
  });

  it("returns next playback id in order", () => {
    const ascending = [...makeEvents()].sort((a, b) => a.at - b.at);
    expect(nextPlaybackEventId(ascending, null)).toBe("run-a:spawn");
    expect(nextPlaybackEventId(ascending, "run-a:spawn")).toBe("run-a:start");
    expect(nextPlaybackEventId(ascending, "run-b:cleanup")).toBeNull();
    expect(nextPlaybackEventId(ascending, "run-b:error", -1)).toBe("run-a:start");
  });

  it("calculates next replay index with optional loop range", () => {
    expect(nextReplayIndex({ currentIndex: -1, total: 4 })).toBe(0);
    expect(nextReplayIndex({ currentIndex: 2, total: 4 })).toBe(3);
    expect(nextReplayIndex({ currentIndex: 3, total: 4 })).toBeNull();
    expect(nextReplayIndex({ currentIndex: 2, total: 4, loopStartIndex: 1, loopEndIndex: 2 })).toBe(1);
    expect(nextReplayIndex({ currentIndex: 0, total: 4, loopStartIndex: 1, loopEndIndex: 2 })).toBe(1);
  });
});

describe("timeline lanes", () => {
  it("groups by room/agent/subagent with stable summary values", () => {
    const baseAt = 1_700_000_000_000;
    const laneEvents: OfficeEvent[] = [
      {
        id: "a:spawn",
        type: "spawn",
        runId: "run-a",
        at: baseAt,
        agentId: "child-a",
        parentAgentId: "parent-a",
        text: "spawn a",
      },
      {
        id: "a:start",
        type: "start",
        runId: "run-a",
        at: baseAt + 60_000,
        agentId: "child-a",
        parentAgentId: "parent-a",
        text: "start a",
      },
      {
        id: "b:spawn",
        type: "spawn",
        runId: "run-b",
        at: baseAt + 120_000,
        agentId: "child-b",
        parentAgentId: "parent-b",
        text: "spawn b",
      },
      {
        id: "b:error",
        type: "error",
        runId: "run-b",
        at: baseAt + 180_000,
        agentId: "child-b",
        parentAgentId: "parent-b",
        text: "error b",
      },
      {
        id: "c:spawn",
        type: "spawn",
        runId: "run-c",
        at: baseAt + 240_000,
        agentId: "child-c",
        parentAgentId: "parent-a",
        text: "spawn c",
      },
    ];

    const roomLanes = buildTimelineLanes({
      events: laneEvents,
      mode: "room",
      resolveRoomId: (agentId) => {
        if (agentId === "child-c") {
          return "lounge";
        }
        return "ops";
      },
    });
    expect(roomLanes.map((lane) => [lane.id, lane.eventCount])).toEqual([
      ["ops", 4],
      ["lounge", 1],
    ]);
    expect(roomLanes[0]?.runCount).toBe(2);
    expect(roomLanes[0]?.densityPerMinute).toBeCloseTo(1.33, 2);

    const agentLanes = buildTimelineLanes({
      events: laneEvents,
      mode: "agent",
    });
    expect(agentLanes.map((lane) => [lane.id, lane.eventCount])).toEqual([
      ["parent-a", 3],
      ["parent-b", 2],
    ]);

    const subagentLanes = buildTimelineLanes({
      events: laneEvents,
      mode: "subagent",
    });
    expect(subagentLanes.map((lane) => [lane.id, lane.eventCount])).toEqual([
      ["child-b", 2],
      ["child-a", 2],
      ["child-c", 1],
    ]);
  });

  it("groups contiguous same-run bursts into summary items", () => {
    const baseAt = 1_700_000_100_000;
    const burstEvents: OfficeEvent[] = [
      {
        id: "run-z:cleanup",
        type: "cleanup",
        runId: "run-z",
        at: baseAt + 30_000,
        agentId: "child-z",
        parentAgentId: "parent-z",
        text: "cleanup z",
      },
      {
        id: "run-z:end",
        type: "end",
        runId: "run-z",
        at: baseAt + 20_000,
        agentId: "child-z",
        parentAgentId: "parent-z",
        text: "end z",
      },
      {
        id: "run-z:error",
        type: "error",
        runId: "run-z",
        at: baseAt + 10_000,
        agentId: "child-z",
        parentAgentId: "parent-z",
        text: "error z",
      },
      {
        id: "run-y:spawn",
        type: "spawn",
        runId: "run-y",
        at: baseAt,
        agentId: "child-y",
        parentAgentId: "parent-y",
        text: "spawn y",
      },
    ];

    const lane = buildTimelineLanes({
      events: burstEvents,
      mode: "room",
      resolveRoomId: () => "ops",
    })[0];
    expect(lane).toBeDefined();

    const items = buildTimelineLaneItems({ lane: lane! });
    expect(items.length).toBe(2);
    expect(items[0]?.kind).toBe("summary");
    if (items[0]?.kind === "summary") {
      expect(items[0].summaryKind).toBe("run-burst");
      expect(items[0].eventCount).toBe(3);
      expect(items[0].runCount).toBe(1);
    }
    expect(items[1]?.kind).toBe("event");
  });

  it("auto-collapses dense tails into a lane summary item", () => {
    const baseAt = 1_700_000_200_000;
    const denseEvents: OfficeEvent[] = Array.from({ length: 14 }, (_, index) => {
      const runId = index % 2 === 0 ? "run-a" : "run-b";
      return {
        id: `${runId}:${index}`,
        type: index % 5 === 0 ? "error" : "start",
        runId,
        at: baseAt - index * 5_000,
        agentId: `child-${runId}`,
        parentAgentId: "parent-dense",
        text: `event ${index}`,
      } satisfies OfficeEvent;
    });

    const lane = buildTimelineLanes({
      events: denseEvents,
      mode: "agent",
    })[0];
    expect(lane).toBeDefined();

    const compressed = buildTimelineLaneItems({
      lane: lane!,
      burstGroupMinSize: 3,
      denseLaneThresholdPerMinute: 2,
      denseVisibleEventBudget: 6,
    });
    expect(compressed.some((item) => item.kind === "summary" && item.summaryKind === "dense-window")).toBe(
      true,
    );

    const uncompressed = buildTimelineLaneItems({
      lane: lane!,
      enableCompression: false,
    });
    expect(uncompressed.every((item) => item.kind === "event")).toBe(true);
    expect(uncompressed.length).toBe(denseEvents.length);
  });
});
