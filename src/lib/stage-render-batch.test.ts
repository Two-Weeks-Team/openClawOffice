import { describe, expect, it } from "vitest";
import { buildPlacements } from "./layout";
import { createLocal50Scenario } from "./local50-scenario";
import { buildStageEntityRenderModels } from "./stage-render-batch";

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

describe("buildStageEntityRenderModels", () => {
  it("builds render models for local50 placements with filter and highlight flags", () => {
    const { snapshot } = createLocal50Scenario({ profile: "local50", seed: 77 });
    const layoutState = buildPlacements({
      entities: snapshot.entities,
      generatedAt: snapshot.generatedAt,
    });

    const target = layoutState.placements[0];
    expect(target).toBeDefined();

    const models = buildStageEntityRenderModels({
      placements: layoutState.placements,
      occlusionByRoom: new Map(),
      generatedAt: snapshot.generatedAt,
      runById: new Map(snapshot.runs.map((run) => [run.runId, run] as const)),
      selectedEntityIdSet: new Set([target?.entity.id ?? ""]),
      pinnedEntityIdSet: new Set<string>(),
      watchedEntityIdSet: new Set<string>(),
      filteredEntityIdSet: new Set([target?.entity.id ?? ""]),
      hasEntityFilter: true,
      normalizedRoomFilterId: null,
      hasOpsFilter: true,
      focusMode: false,
      normalizedHighlightRunId: target?.entity.runId ?? null,
      normalizedHighlightAgentId: null,
      highlightedRun: undefined,
      hasTimelineHighlight: Boolean(target?.entity.runId),
      entityZOffset: 320,
      spawnPulseWindowMs: 12_000,
      runRecentWindowMs: 10_000,
      runStaleWindowMs: 120_000,
      startOrbitWindowMs: 12_000,
      endSettleWindowMs: 20_000,
      cleanupFadeWindowMs: 30_000,
      errorShakeWindowMs: 18_000,
    });

    expect(models.length).toBe(1);
    expect(models[0]?.id).toBe(target?.entity.id);
    expect(models[0]?.className).toContain("entity-token");
  });

  it("stays within a local50 render batching budget", () => {
    const { snapshot } = createLocal50Scenario({ profile: "local50", seed: 101 });
    const layoutState = buildPlacements({
      entities: snapshot.entities,
      generatedAt: snapshot.generatedAt,
    });
    const params = {
      placements: layoutState.placements,
      occlusionByRoom: new Map(),
      generatedAt: snapshot.generatedAt,
      runById: new Map(snapshot.runs.map((run) => [run.runId, run] as const)),
      selectedEntityIdSet: new Set<string>(),
      pinnedEntityIdSet: new Set<string>(),
      watchedEntityIdSet: new Set<string>(),
      filteredEntityIdSet: new Set<string>(),
      hasEntityFilter: false,
      normalizedRoomFilterId: null,
      hasOpsFilter: false,
      focusMode: false,
      normalizedHighlightRunId: null,
      normalizedHighlightAgentId: null,
      highlightedRun: undefined,
      hasTimelineHighlight: false,
      entityZOffset: 320,
      spawnPulseWindowMs: 12_000,
      runRecentWindowMs: 10_000,
      runStaleWindowMs: 120_000,
      startOrbitWindowMs: 12_000,
      endSettleWindowMs: 20_000,
      cleanupFadeWindowMs: 30_000,
      errorShakeWindowMs: 18_000,
    };

    const samples: number[] = [];
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const startedAt = performance.now();
      buildStageEntityRenderModels(params);
      samples.push(performance.now() - startedAt);
    }

    const p95 = percentile(samples, 0.95);
    expect(p95).toBeLessThan(35);
  });
});
