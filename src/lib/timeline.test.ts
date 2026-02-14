import { describe, expect, it } from "vitest";
import type { OfficeEvent, OfficeRun } from "../types/office";
import { buildRunGraph } from "./run-graph";
import {
  buildTimelineLanes,
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
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

  it("returns next playback id in order", () => {
    const ascending = [...makeEvents()].sort((a, b) => a.at - b.at);
    expect(nextPlaybackEventId(ascending, null)).toBe("run-a:spawn");
    expect(nextPlaybackEventId(ascending, "run-a:spawn")).toBe("run-a:start");
    expect(nextPlaybackEventId(ascending, "run-b:cleanup")).toBeNull();
    expect(nextPlaybackEventId(ascending, "run-b:error", -1)).toBe("run-a:start");
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
});
