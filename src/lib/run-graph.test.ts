import { describe, expect, it } from "vitest";
import type { OfficeRun } from "../types/office";
import { buildRunGraph } from "./run-graph";

describe("buildRunGraph", () => {
  it("builds spawnedBy edges and indexes by runId/agentId/time range", () => {
    const runs: OfficeRun[] = [
      {
        runId: "run-root",
        childSessionKey: "agent:research:subagent:root",
        requesterSessionKey: "agent:main:session:1",
        childAgentId: "research",
        parentAgentId: "main",
        status: "active",
        task: "root",
        cleanup: "keep",
        createdAt: 100,
        startedAt: 105,
      },
      {
        runId: "run-child",
        childSessionKey: "agent:ops:subagent:child",
        requesterSessionKey: "agent:research:subagent:root",
        childAgentId: "ops",
        parentAgentId: "research",
        status: "ok",
        task: "child",
        cleanup: "delete",
        createdAt: 120,
        startedAt: 130,
        endedAt: 160,
        cleanupCompletedAt: 180,
      },
      {
        runId: "run-orphan",
        childSessionKey: "agent:qa:subagent:orphan",
        requesterSessionKey: "agent:ghost:subagent:missing",
        childAgentId: "qa",
        parentAgentId: "ghost",
        status: "error",
        task: "orphan",
        cleanup: "keep",
        createdAt: 140,
        startedAt: 145,
        endedAt: 150,
      },
    ];

    const graph = buildRunGraph(runs);

    expect(graph.index.runNodeIdByRunId["run-root"]).toBe("subagent:run-root");
    expect(graph.index.runIdsByAgentId.main).toEqual(["run-root"]);
    expect(graph.index.runIdsByAgentId.research).toEqual(["run-child", "run-root"]);
    expect(graph.index.agentIdsByRunId["run-child"]).toEqual(["research", "ops"]);
    expect(graph.index.timeRangeByRunId["run-child"]).toEqual({ startAt: 130, endAt: 180 });
    expect(graph.index.spawnedByRunId["run-child"]).toBe("run-root");
    expect(graph.index.spawnedChildrenByRunId["run-root"]).toEqual(["run-child"]);

    expect(graph.edges.some((edge) => edge.kind === "spawnedBy" && edge.runId === "run-child")).toBe(true);
    expect(graph.diagnostics.map((entry) => entry.code)).toContain("missing_parent");
    expect(graph.diagnostics.map((entry) => entry.code)).toContain("orphan_run");
  });

  it("detects cycle in spawnedBy chain", () => {
    const runs: OfficeRun[] = [
      {
        runId: "run-a",
        childSessionKey: "agent:alpha:subagent:a",
        requesterSessionKey: "agent:beta:subagent:b",
        childAgentId: "alpha",
        parentAgentId: "main",
        status: "active",
        task: "a",
        cleanup: "keep",
        createdAt: 100,
      },
      {
        runId: "run-b",
        childSessionKey: "agent:beta:subagent:b",
        requesterSessionKey: "agent:alpha:subagent:a",
        childAgentId: "beta",
        parentAgentId: "main",
        status: "active",
        task: "b",
        cleanup: "keep",
        createdAt: 110,
      },
    ];

    const graph = buildRunGraph(runs);
    const cycleDiagnostics = graph.diagnostics.filter((entry) => entry.code === "cycle_detected");
    expect(cycleDiagnostics.length).toBeGreaterThan(0);
    expect(cycleDiagnostics[0]?.message).toContain("run-a");
    expect(cycleDiagnostics[0]?.message).toContain("run-b");
  });
});
