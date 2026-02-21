import { describe, expect, it } from "vitest";
import {
  buildTokenMetrics,
  estimateCost,
  resolveModelPrice,
} from "./token-dashboard";
import type { OfficeSnapshot } from "../types/office";

function makeSnapshot(overrides: Partial<OfficeSnapshot> = {}): OfficeSnapshot {
  return {
    generatedAt: Date.now(),
    source: { stateDir: "/tmp", live: false },
    entities: [],
    runs: [],
    runGraph: {
      nodes: [],
      edges: [],
      index: {
        runNodeIdByRunId: {},
        runIdsByAgentId: {},
        agentIdsByRunId: {},
        timeRangeByRunId: {},
        spawnedByRunId: {},
        spawnedChildrenByRunId: {},
      },
      diagnostics: [],
    },
    events: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("resolveModelPrice", () => {
  it("returns opus price for opus models", () => {
    const price = resolveModelPrice("claude-opus-4-6");
    expect(price.inputPerMTok).toBe(15);
    expect(price.outputPerMTok).toBe(75);
  });

  it("returns sonnet price for sonnet models", () => {
    const price = resolveModelPrice("claude-sonnet-4-6");
    expect(price.inputPerMTok).toBe(3);
    expect(price.outputPerMTok).toBe(15);
  });

  it("returns haiku price for haiku models", () => {
    const price = resolveModelPrice("claude-haiku-4-5-20251001");
    expect(price.inputPerMTok).toBe(0.8);
    expect(price.outputPerMTok).toBe(4);
  });

  it("returns default (sonnet) price for unknown models", () => {
    const price = resolveModelPrice("some-unknown-model");
    expect(price.inputPerMTok).toBe(3);
    expect(price.outputPerMTok).toBe(15);
  });

  it("returns default price when model is undefined", () => {
    const price = resolveModelPrice(undefined);
    expect(price.inputPerMTok).toBe(3);
    expect(price.outputPerMTok).toBe(15);
  });
});

describe("estimateCost", () => {
  it("computes cost correctly for 1M input + 1M output at default price", () => {
    const cost = estimateCost(1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18, 5); // $3 + $15
  });

  it("computes cost for partial tokens", () => {
    const cost = estimateCost(500_000, 100_000);
    // 0.5 * $3 + 0.1 * $15 = $1.5 + $1.5 = $3.0
    expect(cost).toBeCloseTo(3.0, 5);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCost(0, 0)).toBe(0);
  });

  it("uses custom price when provided", () => {
    const cost = estimateCost(1_000_000, 0, { inputPerMTok: 10, outputPerMTok: 0 });
    expect(cost).toBeCloseTo(10, 5);
  });
});

describe("buildTokenMetrics", () => {
  it("returns hasData=false when no entities have token usage", () => {
    const snapshot = makeSnapshot({
      entities: [
        {
          id: "e1",
          kind: "agent",
          agentId: "a1",
          label: "Agent A",
          status: "active",
          sessions: 1,
          activeSubagents: 0,
        },
      ],
    });
    const metrics = buildTokenMetrics(snapshot);
    expect(metrics.hasData).toBe(false);
    expect(metrics.totalTokens).toBe(0);
    expect(metrics.agentMetrics).toHaveLength(0);
  });

  it("aggregates token usage from agent entity", () => {
    const snapshot = makeSnapshot({
      entities: [
        {
          id: "e1",
          kind: "agent",
          agentId: "a1",
          label: "Agent A",
          status: "active",
          sessions: 2,
          activeSubagents: 0,
          tokenUsage: { inputTokens: 1000, outputTokens: 500 },
        },
      ],
    });
    const metrics = buildTokenMetrics(snapshot);
    expect(metrics.hasData).toBe(true);
    expect(metrics.totalInputTokens).toBe(1000);
    expect(metrics.totalOutputTokens).toBe(500);
    expect(metrics.totalTokens).toBe(1500);
    expect(metrics.agentMetrics).toHaveLength(1);
    expect(metrics.agentMetrics[0].tokensPerSession).toBe(750); // 1500 / 2
  });

  it("aggregates subagent token usage under parent agent", () => {
    const snapshot = makeSnapshot({
      entities: [
        {
          id: "e1",
          kind: "agent",
          agentId: "a1",
          label: "Agent A",
          status: "active",
          sessions: 1,
          activeSubagents: 1,
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        },
        {
          id: "e2",
          kind: "subagent",
          agentId: "a1-sub",
          parentAgentId: "a1",
          runId: "run1",
          label: "Sub A",
          status: "ok",
          sessions: 0,
          activeSubagents: 0,
          tokenUsage: { inputTokens: 200, outputTokens: 100 },
        },
      ],
    });
    const metrics = buildTokenMetrics(snapshot);
    expect(metrics.agentMetrics).toHaveLength(1);
    const agentA = metrics.agentMetrics[0];
    expect(agentA.inputTokens).toBe(300); // 100 + 200
    expect(agentA.outputTokens).toBe(150); // 50 + 100
  });

  it("sorts agents by total tokens descending", () => {
    const snapshot = makeSnapshot({
      entities: [
        {
          id: "e1",
          kind: "agent",
          agentId: "a1",
          label: "Agent A",
          status: "active",
          sessions: 1,
          activeSubagents: 0,
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        },
        {
          id: "e2",
          kind: "agent",
          agentId: "a2",
          label: "Agent B",
          status: "active",
          sessions: 1,
          activeSubagents: 0,
          tokenUsage: { inputTokens: 1000, outputTokens: 500 },
        },
      ],
    });
    const metrics = buildTokenMetrics(snapshot);
    expect(metrics.agentMetrics[0].agentId).toBe("a2"); // highest usage first
    expect(metrics.agentMetrics[1].agentId).toBe("a1");
  });

  it("estimates total cost", () => {
    const snapshot = makeSnapshot({
      entities: [
        {
          id: "e1",
          kind: "agent",
          agentId: "a1",
          label: "Agent A",
          status: "active",
          sessions: 1,
          activeSubagents: 0,
          tokenUsage: { inputTokens: 1_000_000, outputTokens: 0 },
        },
      ],
    });
    const metrics = buildTokenMetrics(snapshot);
    // Default Sonnet pricing: $3 per M input tokens
    expect(metrics.totalEstimatedCostUsd).toBeCloseTo(3, 5);
  });
});
