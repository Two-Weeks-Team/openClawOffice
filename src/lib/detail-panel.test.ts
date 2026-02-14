import { describe, expect, it } from "vitest";
import {
  buildDetailPanelModel,
  buildDetailPanelModelCached,
  buildRunDiffForSelection,
  prefetchDetailPanelModels,
  selectDefaultRunComparison,
} from "./detail-panel";
import { buildRunGraph } from "./run-graph";
import type { OfficeSnapshot } from "../types/office";

function makeSnapshot(): OfficeSnapshot {
  const runs: OfficeSnapshot["runs"] = [
    {
      runId: "run-1",
      childSessionKey: "agent:research:session:1",
      requesterSessionKey: "agent:main:session:1",
      childAgentId: "research",
      parentAgentId: "main",
      status: "active",
      task: "Gather layout benchmarks and compare anomalies.",
      cleanup: "keep",
      createdAt: 900_000,
      startedAt: 901_000,
    },
    {
      runId: "run-2",
      childSessionKey: "agent:ops:session:2",
      requesterSessionKey: "agent:main:session:2",
      childAgentId: "ops",
      parentAgentId: "main",
      status: "error",
      task: "Inspect stream reconnection gaps and stale cursors.",
      cleanup: "delete",
      createdAt: 910_000,
      startedAt: 911_000,
      endedAt: 912_000,
    },
    {
      runId: "run-3",
      childSessionKey: "agent:main:session:3",
      requesterSessionKey: "agent:ops:session:3",
      childAgentId: "main",
      parentAgentId: "ops",
      status: "ok",
      task: "Warm cache for agent dashboard boot.",
      cleanup: "keep",
      createdAt: 905_000,
      startedAt: 905_000,
      endedAt: 909_000,
    },
  ];

  return {
    generatedAt: 1_000_000,
    source: {
      stateDir: "/tmp/openclaw",
      live: true,
    },
    diagnostics: [],
    entities: [
      {
        id: "agent:main",
        kind: "agent",
        label: "main",
        agentId: "main",
        status: "active",
        sessions: 4,
        activeSubagents: 1,
        model: "openai/gpt-5",
        lastUpdatedAt: 999_000,
      },
      {
        id: "subagent:run-1",
        kind: "subagent",
        label: "worker-a",
        agentId: "research",
        parentAgentId: "main",
        runId: "run-1",
        status: "active",
        sessions: 1,
        activeSubagents: 0,
        task: "Gather layout benchmarks and compare anomalies.",
        lastUpdatedAt: 999_400,
      },
    ],
    runs,
    runGraph: buildRunGraph(runs),
    events: [
      {
        id: "run-2:error:1",
        type: "error",
        runId: "run-2",
        at: 912_000,
        agentId: "ops",
        parentAgentId: "main",
        text: "run-2 failed",
      },
      {
        id: "run-1:start:1",
        type: "start",
        runId: "run-1",
        at: 901_000,
        agentId: "research",
        parentAgentId: "main",
        text: "run-1 started",
      },
      {
        id: "run-3:spawn:1",
        type: "spawn",
        runId: "run-3",
        at: 905_000,
        agentId: "main",
        parentAgentId: "ops",
        text: "run-3 spawned",
      },
    ],
  };
}

describe("buildDetailPanelModel", () => {
  it("returns empty status when nothing is selected", () => {
    const model = buildDetailPanelModel(makeSnapshot(), null);
    expect(model.status).toBe("empty");
    expect(model.paths.runStorePath).toBe("/tmp/openclaw/subagents/runs.json");
    expect(model.recentRuns).toHaveLength(0);
    expect(model.runDiff).toBeNull();
  });

  it("returns missing status when selected id is not present", () => {
    const model = buildDetailPanelModel(makeSnapshot(), "agent:ghost");
    expect(model.status).toBe("missing");
    expect(model.entity).toBeNull();
    expect(model.recentRuns).toHaveLength(0);
    expect(model.runDiff).toBeNull();
  });

  it("builds agent cross references for runs and events", () => {
    const model = buildDetailPanelModel(makeSnapshot(), "agent:main");
    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }

    expect(model.relatedRuns.map((run) => run.runId)).toEqual(["run-2", "run-3", "run-1"]);
    expect(model.runInsights).toHaveLength(3);
    expect(model.recentRuns.map((item) => item.run.runId)).toEqual(["run-2", "run-3", "run-1"]);
    expect(model.metrics.errorRuns).toBe(1);
    expect(model.metrics.runCount).toBe(3);
    expect(model.paths.sessionStorePath).toBe("/tmp/openclaw/agents/main/sessions/sessions.json");
    expect(model.relatedEvents.map((event) => event.id)).toEqual([
      "run-2:error:1",
      "run-3:spawn:1",
      "run-1:start:1",
    ]);
    expect(model.runDiff?.baseline.run.runId).toBe("run-3");
    expect(model.runDiff?.candidate.run.runId).toBe("run-2");
    expect(model.runDiff?.eventCountDelta).toBe(0);
    expect(model.runDiff?.eventDensityPerMinuteDelta).toBe(45);
    expect(model.runDiff?.errorPointDeltaMs).toBeNull();
    expect(model.runDiff?.majorEvents.baselineOnly.map((event) => event.id)).toEqual([
      "run-3:spawn:1",
    ]);
    expect(model.runDiff?.majorEvents.candidateOnly.map((event) => event.id)).toEqual([
      "run-2:error:1",
    ]);
  });

  it("builds subagent references using linked run", () => {
    const model = buildDetailPanelModel(makeSnapshot(), "subagent:run-1");
    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }

    expect(model.linkedRun?.runId).toBe("run-1");
    expect(model.relatedRuns.map((run) => run.runId)).toEqual(["run-1"]);
    expect(model.recentRuns.map((item) => item.run.runId)).toEqual(["run-1"]);
    expect(model.runDiff).toBeNull();
    expect(model.relatedEvents.map((event) => event.runId)).toEqual(["run-1"]);
    expect(model.paths.childSessionLogPath).toBe("/tmp/openclaw/agents/research/sessions");
    expect(model.paths.parentSessionLogPath).toBe("/tmp/openclaw/agents/main/sessions");
  });

  it("falls back to latest two runs when success vs error pair is not available", () => {
    const snapshot = makeSnapshot();
    snapshot.runs = snapshot.runs.map((run) =>
      run.status === "ok" ? { ...run, status: "active" as const } : run,
    );
    snapshot.runGraph = buildRunGraph(snapshot.runs);

    const model = buildDetailPanelModel(snapshot, "agent:main");
    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    expect(model.recentRuns.length).toBeGreaterThan(0);
    expect(model.runDiff?.baseline.run.runId).toBe("run-3");
    expect(model.runDiff?.candidate.run.runId).toBe("run-2");
  });

  it("reuses cached detail models for repeated selections", () => {
    const snapshot = makeSnapshot();
    const first = buildDetailPanelModelCached(snapshot, "agent:main");
    const second = buildDetailPanelModelCached(snapshot, "agent:main");
    expect(first).toBe(second);
  });

  it("prefetches and warms model cache for related entities", () => {
    const snapshot = makeSnapshot();
    prefetchDetailPanelModels(snapshot, ["agent:main", "subagent:run-1"]);
    const prefetched = buildDetailPanelModelCached(snapshot, "subagent:run-1");
    const rebuilt = buildDetailPanelModelCached(snapshot, "subagent:run-1");
    expect(prefetched).toBe(rebuilt);
    expect(prefetched.status).toBe("ready");
  });
});

describe("run comparison helpers", () => {
  it("selects latest success/error pair by default", () => {
    const model = buildDetailPanelModel(makeSnapshot(), "agent:main");
    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    const selected = selectDefaultRunComparison(model.runInsights);
    expect(selected).toEqual({
      baselineRunId: "run-3",
      candidateRunId: "run-2",
    });
  });

  it("builds run diff for an explicit run pair", () => {
    const model = buildDetailPanelModel(makeSnapshot(), "agent:main");
    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    const diff = buildRunDiffForSelection(model.runInsights, {
      baselineRunId: "run-1",
      candidateRunId: "run-2",
    });
    expect(diff?.baseline.run.runId).toBe("run-1");
    expect(diff?.candidate.run.runId).toBe("run-2");
    expect(diff?.taskChanged).toBe(true);
  });

  it("returns null when baseline and candidate are the same run", () => {
    const model = buildDetailPanelModel(makeSnapshot(), "agent:main");
    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    const diff = buildRunDiffForSelection(model.runInsights, {
      baselineRunId: "run-2",
      candidateRunId: "run-2",
    });
    expect(diff).toBeNull();
  });
});
