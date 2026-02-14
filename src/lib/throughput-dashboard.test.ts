import { describe, expect, it } from "vitest";
import type { OfficeRun, OfficeSnapshot } from "../types/office";
import { buildRunGraph } from "./run-graph";
import {
  buildAgentThroughputBreakdown,
  buildThroughputOutliers,
  buildThroughputSeries,
  buildThroughputWindowMetrics,
} from "./throughput-dashboard";

const NOW = 1_700_000_000_000;

function makeRun(input: {
  runId: string;
  agentId: string;
  status: OfficeRun["status"];
  startedOffsetMs: number;
  endedOffsetMs?: number;
}): OfficeRun {
  const startedAt = NOW + input.startedOffsetMs;
  const endedAt =
    typeof input.endedOffsetMs === "number" ? NOW + input.endedOffsetMs : undefined;

  return {
    runId: input.runId,
    childSessionKey: `agent:${input.agentId}:session:${input.runId}`,
    requesterSessionKey: `agent:root:session:${input.runId}`,
    childAgentId: input.agentId,
    parentAgentId: "root",
    status: input.status,
    task: `Task for ${input.runId}`,
    cleanup: "keep",
    createdAt: startedAt - 1_000,
    startedAt,
    endedAt,
    cleanupCompletedAt: endedAt ? endedAt + 500 : undefined,
  };
}

function makeSnapshot(runs: OfficeRun[]): OfficeSnapshot {
  const events = runs.flatMap((run) => {
    const spawnAt = run.createdAt;
    const startAt = run.startedAt ?? run.createdAt;
    const endAt = run.endedAt;

    const base = [
      {
        id: `${run.runId}:spawn`,
        type: "spawn" as const,
        runId: run.runId,
        at: spawnAt,
        agentId: run.childAgentId,
        parentAgentId: run.parentAgentId,
        text: `spawn ${run.runId}`,
      },
      {
        id: `${run.runId}:start`,
        type: "start" as const,
        runId: run.runId,
        at: startAt,
        agentId: run.childAgentId,
        parentAgentId: run.parentAgentId,
        text: `start ${run.runId}`,
      },
    ];

    if (!endAt) {
      return base;
    }

    return [
      ...base,
      {
        id: `${run.runId}:${run.status === "error" ? "error" : "end"}`,
        type: run.status === "error" ? ("error" as const) : ("end" as const),
        runId: run.runId,
        at: endAt,
        agentId: run.childAgentId,
        parentAgentId: run.parentAgentId,
        text: `${run.status} ${run.runId}`,
      },
    ];
  });

  const agents = [...new Set(runs.map((run) => run.childAgentId))];

  return {
    generatedAt: NOW,
    source: {
      stateDir: "/tmp/openclaw",
      live: true,
    },
    diagnostics: [],
    entities: [
      ...agents.map((agentId) => ({
        id: `agent:${agentId}`,
        kind: "agent" as const,
        label: agentId,
        agentId,
        status: "active" as const,
        sessions: 1,
        activeSubagents: runs.filter(
          (run) => run.childAgentId === agentId && run.status === "active",
        ).length,
      })),
      ...runs.map((run) => ({
        id: `subagent:${run.runId}`,
        kind: "subagent" as const,
        label: run.runId,
        agentId: run.childAgentId,
        parentAgentId: run.parentAgentId,
        runId: run.runId,
        status: run.status,
        sessions: 1,
        activeSubagents: 0,
      })),
    ],
    runs,
    events,
    runGraph: buildRunGraph(runs),
  };
}

describe("throughput dashboard metrics", () => {
  it("computes core KPI windows (5m / 1h / 24h)", () => {
    const snapshot = makeSnapshot([
      makeRun({ runId: "run-a", agentId: "agent-a", status: "ok", startedOffsetMs: -120_000, endedOffsetMs: -60_000 }),
      makeRun({ runId: "run-b", agentId: "agent-a", status: "active", startedOffsetMs: -240_000 }),
      makeRun({ runId: "run-c", agentId: "agent-b", status: "error", startedOffsetMs: -600_000, endedOffsetMs: -480_000 }),
      makeRun({ runId: "run-d", agentId: "agent-b", status: "ok", startedOffsetMs: -2_400_000, endedOffsetMs: -1_200_000 }),
      makeRun({ runId: "run-e", agentId: "agent-c", status: "ok", startedOffsetMs: -10_800_000, endedOffsetMs: -7_200_000 }),
    ]);

    const metrics = buildThroughputWindowMetrics(snapshot, { now: NOW });

    expect(metrics["5m"].startedRuns).toBe(2);
    expect(metrics["5m"].completedRuns).toBe(1);
    expect(metrics["5m"].completionRate).toBe(0.5);
    expect(metrics["5m"].avgDurationMs).toBe(60_000);
    expect(metrics["5m"].activeConcurrency).toBe(2);

    expect(metrics["1h"].startedRuns).toBe(4);
    expect(metrics["1h"].completedRuns).toBe(3);
    expect(metrics["1h"].completionRate).toBe(0.75);
    expect(metrics["1h"].errorRatio).toBeCloseTo(1 / 3);
    expect(metrics["1h"].avgDurationMs).toBe(460_000);

    expect(metrics["24h"].startedRuns).toBe(5);
    expect(metrics["24h"].completedRuns).toBe(4);
    expect(metrics["24h"].completionRate).toBe(0.8);
  });

  it("builds bucketed series and preserves started run totals", () => {
    const snapshot = makeSnapshot([
      makeRun({ runId: "run-a", agentId: "agent-a", status: "ok", startedOffsetMs: -290_000, endedOffsetMs: -230_000 }),
      makeRun({ runId: "run-b", agentId: "agent-a", status: "ok", startedOffsetMs: -180_000, endedOffsetMs: -100_000 }),
      makeRun({ runId: "run-c", agentId: "agent-b", status: "error", startedOffsetMs: -60_000, endedOffsetMs: -15_000 }),
    ]);

    const series = buildThroughputSeries(snapshot, "5m", {
      now: NOW,
      bucketCount: 5,
    });

    expect(series).toHaveLength(5);
    expect(series.reduce((sum, bucket) => sum + bucket.startedRuns, 0)).toBe(3);
    expect(series.some((bucket) => bucket.errorRuns > 0)).toBe(true);
    expect(Math.max(...series.map((bucket) => bucket.maxConcurrency))).toBeGreaterThan(0);
  });

  it("supports agent drill-down and slow-run outlier highlighting", () => {
    const snapshot = makeSnapshot([
      makeRun({ runId: "run-fast-1", agentId: "agent-a", status: "ok", startedOffsetMs: -3_000_000, endedOffsetMs: -2_940_000 }),
      makeRun({ runId: "run-fast-2", agentId: "agent-a", status: "ok", startedOffsetMs: -2_800_000, endedOffsetMs: -2_730_000 }),
      makeRun({ runId: "run-fail-1", agentId: "agent-b", status: "error", startedOffsetMs: -2_700_000, endedOffsetMs: -2_640_000 }),
      makeRun({ runId: "run-fail-2", agentId: "agent-b", status: "error", startedOffsetMs: -2_500_000, endedOffsetMs: -2_430_000 }),
      makeRun({ runId: "run-slow", agentId: "agent-c", status: "ok", startedOffsetMs: -3_500_000, endedOffsetMs: -600_000 }),
    ]);

    const breakdown = buildAgentThroughputBreakdown(snapshot, "1h", { now: NOW });
    expect(breakdown.map((item) => item.agentId)).toEqual(
      expect.arrayContaining(["agent-a", "agent-b", "agent-c"]),
    );

    const focused = buildThroughputWindowMetrics(snapshot, {
      now: NOW,
      agentId: "agent-b",
    });
    expect(focused["1h"].startedRuns).toBe(2);
    expect(focused["1h"].errorRatio).toBe(1);

    const outliers = buildThroughputOutliers(snapshot, "1h", { now: NOW });
    expect(outliers.some((item) => item.id === "slow:run-slow")).toBe(true);
    expect(outliers.some((item) => item.id === "error:agent-b")).toBe(true);
  });
});
