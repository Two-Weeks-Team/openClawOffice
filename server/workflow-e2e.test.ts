import { describe, expect, it } from "vitest";
import { buildDetailPanelModel } from "../src/lib/detail-panel";
import { createLocal50Scenario } from "../src/lib/local50-scenario";
import {
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
  parseRunIdDeepLink,
} from "../src/lib/timeline";
import type { OfficeEvent, OfficeSnapshot } from "./office-types";
import { OfficeStreamBridge, parseLifecycleCursor } from "./stream-bridge";

function makeScenario(seed: number, options?: Parameters<typeof createLocal50Scenario>[0]) {
  return createLocal50Scenario({
    profile: "local10",
    agents: 10,
    runs: 40,
    events: 220,
    seed,
    ...options,
  });
}

function appendEvents(snapshot: OfficeSnapshot, events: OfficeEvent[]): OfficeSnapshot {
  // Reconnect tests only depend on lifecycle queue ordering; runGraph is unchanged on purpose.
  const latestAt = events.reduce((max, event) => Math.max(max, event.at), snapshot.generatedAt);
  return {
    ...snapshot,
    generatedAt: Math.max(snapshot.generatedAt, latestAt),
    events: [...snapshot.events, ...events],
  };
}

describe("office workflow e2e scenarios", () => {
  it("covers spawn success workflow with timeline filters", () => {
    const { snapshot } = makeScenario(101, {
      pattern: {
        errorRate: 0,
        activeRate: 0,
      },
    });

    expect(snapshot.runs.every((run) => run.status === "ok")).toBe(true);

    const timeline = buildTimelineIndex(snapshot.events, snapshot.runGraph);
    const spawnEvents = filterTimelineEvents(timeline, { runId: "", agentId: "", status: "spawn" });
    const endEvents = filterTimelineEvents(timeline, { runId: "", agentId: "", status: "end" });

    expect(spawnEvents.length).toBeGreaterThan(0);
    expect(spawnEvents.every((event) => event.type === "spawn")).toBe(true);
    expect(endEvents.length).toBeGreaterThan(0);
    expect(endEvents.every((event) => event.type === "end")).toBe(true);
  });

  it("covers spawn failure workflow with error-focused filtering", () => {
    const { snapshot } = makeScenario(202, {
      pattern: {
        errorRate: 1,
        activeRate: 0,
      },
    });

    expect(snapshot.runs.every((run) => run.status === "error")).toBe(true);

    const timeline = buildTimelineIndex(snapshot.events, snapshot.runGraph);
    const errorEvents = filterTimelineEvents(timeline, { runId: "", agentId: "", status: "error" });
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents.every((event) => event.type === "error")).toBe(true);

    const failedRun = snapshot.runs.find((run) => run.status === "error");
    expect(failedRun).toBeDefined();
    const runEvents = filterTimelineEvents(timeline, {
      runId: failedRun?.runId ?? "",
      agentId: "",
      status: "all",
    });
    expect(runEvents.length).toBeGreaterThan(0);
  });

  it("covers reconnect/backfill workflow with lifecycle cursor", () => {
    const { snapshot } = makeScenario(303, { events: 80 });
    const bridge = new OfficeStreamBridge({
      maxQueue: 24,
      maxSeen: 200,
      maxEmitPerSnapshot: 24,
    });

    const initialFrames = bridge.ingestSnapshot(snapshot);
    expect(initialFrames).toEqual([]);
    expect(bridge.consumePressureStats()).toEqual({
      backpressureActivations: 0,
      droppedUnseenEvents: 0,
      evictedBackfillEvents: 0,
    });

    const run = snapshot.runs[0];
    expect(run).toBeDefined();
    const tailEvents: OfficeEvent[] = [
      {
        id: "reconnect:spawn",
        type: "spawn",
        runId: run?.runId ?? "run-0000",
        at: snapshot.generatedAt + 10,
        agentId: run?.childAgentId ?? "agent-01",
        parentAgentId: run?.parentAgentId ?? "agent-01",
        text: "spawn reconnect flow",
      },
      {
        id: "reconnect:start",
        type: "start",
        runId: run?.runId ?? "run-0000",
        at: snapshot.generatedAt + 11,
        agentId: run?.childAgentId ?? "agent-01",
        parentAgentId: run?.parentAgentId ?? "agent-01",
        text: "start reconnect flow",
      },
      {
        id: "reconnect:end",
        type: "end",
        runId: run?.runId ?? "run-0000",
        at: snapshot.generatedAt + 12,
        agentId: run?.childAgentId ?? "agent-01",
        parentAgentId: run?.parentAgentId ?? "agent-01",
        text: "end reconnect flow",
      },
    ];

    const updatedSnapshot = appendEvents(snapshot, tailEvents);
    const frames = bridge.ingestSnapshot(updatedSnapshot);

    expect(frames.map((frame) => frame.event.id)).toEqual([
      "reconnect:spawn",
      "reconnect:start",
      "reconnect:end",
    ]);

    const cursor = parseLifecycleCursor(String(frames[0]?.seq ?? 0));
    const replay = bridge.getBackfill(cursor);
    expect(replay.map((frame) => frame.event.id)).toEqual(["reconnect:start", "reconnect:end"]);
    expect(parseLifecycleCursor("invalid")).toBe(0);
  });

  it("covers panel exploration workflow for agent and subagent entities", () => {
    const { snapshot } = makeScenario(404);
    const agent = snapshot.entities.find((entity) => entity.kind === "agent");
    const subagent = snapshot.entities.find((entity) => entity.kind === "subagent");

    expect(agent).toBeDefined();
    expect(subagent).toBeDefined();

    const agentPanel = buildDetailPanelModel(snapshot, agent?.id ?? null);
    expect(agentPanel.status).toBe("ready");
    expect(agentPanel.metrics.runCount).toBeGreaterThan(0);
    expect(agentPanel.relatedEvents.length).toBeGreaterThan(0);

    const subagentPanel = buildDetailPanelModel(snapshot, subagent?.id ?? null);
    expect(subagentPanel.status).toBe("ready");
    expect(subagentPanel.relatedRuns.length).toBeGreaterThan(0);
  });

  it("covers timeline deep-link filtering and playback stepping", () => {
    const { snapshot } = makeScenario(505, { events: 260 });
    const targetRun = snapshot.runs[0];
    expect(targetRun).toBeDefined();

    const timeline = buildTimelineIndex(snapshot.events, snapshot.runGraph);
    const deepLinkedRunId = parseRunIdDeepLink(`?runId=${targetRun?.runId ?? ""}`);
    const runFiltered = filterTimelineEvents(timeline, {
      runId: deepLinkedRunId,
      agentId: "",
      status: "all",
    });

    expect(runFiltered.length).toBeGreaterThan(0);
    expect(runFiltered.every((event) => event.runId === deepLinkedRunId)).toBe(true);

    const ordered = [...runFiltered].sort((left, right) => left.at - right.at);
    const firstId = nextPlaybackEventId(ordered, null, 1);
    const secondId = nextPlaybackEventId(ordered, firstId, 1);
    expect(firstId).not.toBeNull();
    if (ordered.length > 1) {
      expect(secondId).not.toBeNull();
    }

    const agentScoped = filterTimelineEvents(timeline, {
      runId: "",
      agentId: targetRun?.childAgentId ?? "",
      status: "all",
    });
    expect(agentScoped.length).toBeGreaterThan(0);
    const status = agentScoped[0]?.type;
    expect(status).toBeDefined();
    const statusScoped = filterTimelineEvents(timeline, {
      runId: "",
      agentId: targetRun?.childAgentId ?? "",
      status: status ?? "spawn",
    });
    expect(statusScoped.length).toBeGreaterThan(0);
    expect(statusScoped.every((event) => event.type === status)).toBe(true);
  });
});
