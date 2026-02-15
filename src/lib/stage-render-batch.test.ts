import { describe, expect, it } from "vitest";
import type { OfficeEntity } from "../types/office";
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
      hasCriticalAlertTargets: false,
      criticalAlertRunIdSet: new Set<string>(),
      criticalAlertAgentIdSet: new Set<string>(),
      warningAlertRunIdSet: new Set<string>(),
      warningAlertAgentIdSet: new Set<string>(),
      entityZOffset: 320,
      spawnPulseWindowMs: 12_000,
      startOrbitWindowMs: 12_000,
      endSettleWindowMs: 20_000,
      cleanupFadeWindowMs: 30_000,
      errorShakeWindowMs: 18_000,
    });

    expect(models.length).toBe(1);
    expect(models[0]?.id).toBe(target?.entity.id);
    expect(models[0]?.className).toContain("entity-token");
  });

  it("applies critical-first layering and secondary dimming when critical targets exist", () => {
    const now = 1_710_000_000_000;
    const entities: OfficeEntity[] = [
      {
        id: "agent:critical",
        kind: "agent",
        label: "Critical Agent",
        agentId: "agent-critical",
        status: "idle",
        sessions: 1,
        activeSubagents: 0,
        lastUpdatedAt: now - 3_000,
      },
      {
        id: "agent:watched",
        kind: "agent",
        label: "Watched Agent",
        agentId: "agent-watched",
        status: "idle",
        sessions: 1,
        activeSubagents: 0,
        lastUpdatedAt: now - 3_000,
      },
      {
        id: "subagent:normal",
        kind: "subagent",
        label: "Normal Subagent",
        agentId: "agent-normal",
        parentAgentId: "agent-parent",
        runId: "run-normal",
        status: "idle",
        sessions: 0,
        activeSubagents: 0,
        lastUpdatedAt: now - 3_000,
      },
    ];

    const placements = entities.map((entity, index) => ({
      entity,
      roomId: "room:lobby",
      x: 100 + index * 40,
      y: 120 + index * 20,
      overflowed: false,
    }));

    const models = buildStageEntityRenderModels({
      placements,
      generatedAt: now,
      runById: new Map(),
      selectedEntityIdSet: new Set<string>(),
      pinnedEntityIdSet: new Set<string>(),
      watchedEntityIdSet: new Set<string>(["agent:watched"]),
      filteredEntityIdSet: new Set<string>(),
      hasEntityFilter: false,
      normalizedRoomFilterId: null,
      hasOpsFilter: false,
      focusMode: false,
      normalizedHighlightRunId: null,
      normalizedHighlightAgentId: null,
      highlightedRun: undefined,
      hasTimelineHighlight: false,
      hasCriticalAlertTargets: true,
      criticalAlertRunIdSet: new Set<string>(),
      criticalAlertAgentIdSet: new Set<string>(["agent-critical"]),
      warningAlertRunIdSet: new Set<string>(),
      warningAlertAgentIdSet: new Set<string>(),
      entityZOffset: 320,
      spawnPulseWindowMs: 12_000,
      startOrbitWindowMs: 12_000,
      endSettleWindowMs: 20_000,
      cleanupFadeWindowMs: 30_000,
      errorShakeWindowMs: 18_000,
    });

    const critical = models.find((model) => model.id === "agent:critical");
    const watched = models.find((model) => model.id === "agent:watched");
    const normal = models.find((model) => model.id === "subagent:normal");

    expect(critical?.priorityBand).toBe("critical");
    expect(critical?.className).toContain("priority-critical");
    expect(watched?.priorityBand).toBe("high");
    expect(normal?.className).toContain("is-secondary");
    expect((critical?.style.zIndex ?? 0)).toBeGreaterThan(watched?.style.zIndex ?? 0);
    expect((watched?.style.zIndex ?? 0)).toBeGreaterThan(normal?.style.zIndex ?? 0);
  });

  it("marks warning alert targets as high priority without secondary dim when no critical target exists", () => {
    const now = 1_710_000_010_000;
    const entities: OfficeEntity[] = [
      {
        id: "subagent:warning-target",
        kind: "subagent",
        label: "Warning Subagent",
        agentId: "agent-warning",
        parentAgentId: "agent-parent",
        runId: "run-warning",
        status: "ok",
        sessions: 0,
        activeSubagents: 0,
        lastUpdatedAt: now - 2_000,
      },
      {
        id: "agent:baseline",
        kind: "agent",
        label: "Baseline Agent",
        agentId: "agent-baseline",
        status: "idle",
        sessions: 1,
        activeSubagents: 0,
        lastUpdatedAt: now - 2_000,
      },
    ];
    const placements = entities.map((entity, index) => ({
      entity,
      roomId: "room:lobby",
      x: 120 + index * 50,
      y: 130 + index * 25,
      overflowed: false,
    }));

    const models = buildStageEntityRenderModels({
      placements,
      generatedAt: now,
      runById: new Map(),
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
      hasCriticalAlertTargets: false,
      criticalAlertRunIdSet: new Set<string>(),
      criticalAlertAgentIdSet: new Set<string>(),
      warningAlertRunIdSet: new Set<string>(["run-warning"]),
      warningAlertAgentIdSet: new Set<string>(),
      entityZOffset: 320,
      spawnPulseWindowMs: 12_000,
      startOrbitWindowMs: 12_000,
      endSettleWindowMs: 20_000,
      cleanupFadeWindowMs: 30_000,
      errorShakeWindowMs: 18_000,
    });

    const warningTarget = models.find((model) => model.id === "subagent:warning-target");
    expect(warningTarget?.priorityBand).toBe("high");
    expect(warningTarget?.className).toContain("priority-high");
    expect(warningTarget?.className).toContain("alert-warning");
    expect(warningTarget?.className).not.toContain("is-secondary");
  });

  it("stays within a local50 render batching budget", () => {
    const { snapshot } = createLocal50Scenario({ profile: "local50", seed: 101 });
    const layoutState = buildPlacements({
      entities: snapshot.entities,
      generatedAt: snapshot.generatedAt,
    });
    const params = {
      placements: layoutState.placements,
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
      hasCriticalAlertTargets: false,
      criticalAlertRunIdSet: new Set<string>(),
      criticalAlertAgentIdSet: new Set<string>(),
      warningAlertRunIdSet: new Set<string>(),
      warningAlertAgentIdSet: new Set<string>(),
      entityZOffset: 320,
      spawnPulseWindowMs: 12_000,
      startOrbitWindowMs: 12_000,
      endSettleWindowMs: 20_000,
      cleanupFadeWindowMs: 30_000,
      errorShakeWindowMs: 18_000,
    };

    for (let warmup = 0; warmup < 8; warmup += 1) {
      buildStageEntityRenderModels(params);
    }

    const samples: number[] = [];
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const startedAt = performance.now();
      buildStageEntityRenderModels(params);
      samples.push(performance.now() - startedAt);
    }

    const p95 = percentile(samples, 0.95);
    expect(p95).toBeLessThan(35);
  });
});
