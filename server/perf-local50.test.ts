import { describe, expect, it } from "vitest";
import { buildEntitySearchIndex, searchEntityIds } from "../src/lib/entity-search";
import { buildPlacements } from "../src/lib/layout";
import { mergeLifecycleEvent } from "../src/lib/lifecycle-merge";
import { createLocal50Scenario } from "../src/lib/local50-scenario";
import { LOCAL50_PIPELINE_BUDGET, LOCAL50_SCENARIO, LOCAL50_UX_BUDGET } from "../src/lib/perf-budgets";
import { buildTimelineIndex } from "../src/lib/timeline";
import type { OfficeEvent, OfficeSnapshot } from "../src/types/office";
import { parseSessionsStore, parseSubagentStore } from "./runtime-parser";

type Metric = {
  name: string;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
};

function heapUsedMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

function mergeLifecycleEventLegacy(snapshot: OfficeSnapshot, event: OfficeEvent, maxEvents = 220) {
  const events = [event, ...snapshot.events.filter((item) => item.id !== event.id)]
    .sort((left, right) => {
      if (left.at !== right.at) {
        return right.at - left.at;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, maxEvents);

  return {
    ...snapshot,
    generatedAt: Math.max(snapshot.generatedAt, event.at),
    events,
  };
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function runMetric(params: {
  name: string;
  iterations: number;
  warmup?: number;
  action: () => void;
}): Metric {
  const warmup = params.warmup ?? 2;
  for (let index = 0; index < warmup; index += 1) {
    params.action();
  }

  const samples: number[] = [];
  for (let index = 0; index < params.iterations; index += 1) {
    const start = performance.now();
    params.action();
    samples.push(performance.now() - start);
  }

  const averageMs = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return {
    name: params.name,
    averageMs,
    p95Ms: percentile(samples, 0.95),
    maxMs: Math.max(...samples),
  };
}

describe("local50 benchmark smoke", () => {
  it("measures parse/layout/timeline/search/stream budgets", () => {
    const scenario = createLocal50Scenario(LOCAL50_SCENARIO);
    const { snapshot } = scenario;

    expect(snapshot.entities.length).toBe(
      LOCAL50_SCENARIO.agents + LOCAL50_SCENARIO.runs,
    );
    expect(snapshot.events.length).toBe(LOCAL50_SCENARIO.events);

    const parseSessionsMetric = runMetric({
      name: "parseSessions(50 agents)",
      iterations: 12,
      action: () => {
        for (const store of scenario.sessionStores) {
          parseSessionsStore(store.raw, store.source);
        }
      },
    });

    const parseRunsMetric = runMetric({
      name: "parseSubagentStore(500 runs)",
      iterations: 12,
      action: () => {
        parseSubagentStore(scenario.runStore.raw, scenario.runStore.source);
      },
    });

    const layoutMetric = runMetric({
      name: "buildPlacements(550 entities)",
      iterations: 10,
      action: () => {
        buildPlacements({
          entities: snapshot.entities,
          generatedAt: snapshot.generatedAt,
        });
      },
    });

    const timelineMetric = runMetric({
      name: "buildTimelineIndex(5k events)",
      iterations: 10,
      action: () => {
        buildTimelineIndex(snapshot.events, snapshot.runGraph);
      },
    });

    const searchIndex = buildEntitySearchIndex(snapshot);
    const searchMetric = runMetric({
      name: "searchEntityIds(composite query)",
      iterations: 20,
      action: () => {
        searchEntityIds(searchIndex, "agent-03 run-003 triage");
      },
    });

    const lifecycleFrames = snapshot.events.slice(0, 180).map((event, index) => ({
      ...event,
      id: `live-${index + 1}:${event.id}`,
      at: snapshot.generatedAt + index + 1,
    }));
    const streamBase: OfficeSnapshot = {
      ...snapshot,
      events: snapshot.events.slice(0, 220),
    };

    const streamMergeMetric = runMetric({
      name: "streamMerge(180 lifecycle events)",
      iterations: 12,
      action: () => {
        let current = streamBase;
        for (const frame of lifecycleFrames) {
          current = mergeLifecycleEvent(current, frame);
        }
      },
    });

    const streamLegacyMetric = runMetric({
      name: "streamMergeLegacy(180 lifecycle events)",
      iterations: 12,
      action: () => {
        let current = streamBase;
        for (const frame of lifecycleFrames) {
          current = mergeLifecycleEventLegacy(current, frame);
        }
      },
    });

    console.table([
      parseSessionsMetric,
      parseRunsMetric,
      layoutMetric,
      timelineMetric,
      searchMetric,
      streamMergeMetric,
      streamLegacyMetric,
    ]);

    const memoryFootprintMb = heapUsedMb();
    console.log("local50 heapUsedMB", memoryFootprintMb.toFixed(2));

    expect(parseSessionsMetric.p95Ms).toBeLessThanOrEqual(LOCAL50_PIPELINE_BUDGET.parseSessionsP95Ms);
    expect(parseRunsMetric.p95Ms).toBeLessThanOrEqual(LOCAL50_PIPELINE_BUDGET.parseRunsP95Ms);
    expect(layoutMetric.p95Ms).toBeLessThanOrEqual(LOCAL50_PIPELINE_BUDGET.layoutP95Ms);
    expect(timelineMetric.p95Ms).toBeLessThanOrEqual(LOCAL50_PIPELINE_BUDGET.timelineIndexP95Ms);
    expect(searchMetric.p95Ms).toBeLessThanOrEqual(LOCAL50_PIPELINE_BUDGET.entitySearchP95Ms);
    expect(streamMergeMetric.p95Ms).toBeLessThanOrEqual(
      LOCAL50_PIPELINE_BUDGET.streamMergeBatchP95Ms,
    );
    expect(memoryFootprintMb).toBeLessThanOrEqual(LOCAL50_UX_BUDGET.memoryFootprintMb);
  });
});
