import type {
  OfficeEntity,
  OfficeEvent,
  OfficeEventType,
  OfficeRun,
  OfficeSnapshot,
} from "../types/office";
import { indexRunsById, runIdsForAgent } from "./run-graph";

const MAX_DETAIL_EVENTS = 14;
const MAX_RECENT_RUNS = 6;
const MAX_MAJOR_EVENTS = 6;

type DetailSnapshotIndex = {
  runById: Map<string, OfficeRun>;
  eventsByRunId: Map<string, OfficeEvent[]>;
  eventsByAgentId: Map<string, OfficeEvent[]>;
  eventsByParentAgentId: Map<string, OfficeEvent[]>;
  modelByAgent: Map<string, string>;
};

const DETAIL_SNAPSHOT_INDEX_CACHE = new WeakMap<OfficeSnapshot, DetailSnapshotIndex>();
const DETAIL_PANEL_MODEL_CACHE = new WeakMap<OfficeSnapshot, Map<string, DetailPanelModel>>();

function cachedKeyForEntityId(selectedEntityId: string | null): string {
  return selectedEntityId ?? "__empty__";
}

function pushEvent(map: Map<string, OfficeEvent[]>, key: string, event: OfficeEvent) {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(event);
    return;
  }
  map.set(key, [event]);
}

function getDetailSnapshotIndex(snapshot: OfficeSnapshot): DetailSnapshotIndex {
  const cached = DETAIL_SNAPSHOT_INDEX_CACHE.get(snapshot);
  if (cached) {
    return cached;
  }

  const runById = indexRunsById(snapshot.runs);
  const eventsByRunId = new Map<string, OfficeEvent[]>();
  const eventsByAgentId = new Map<string, OfficeEvent[]>();
  const eventsByParentAgentId = new Map<string, OfficeEvent[]>();
  const modelByAgent = new Map<string, string>();

  for (const event of snapshot.events) {
    pushEvent(eventsByRunId, event.runId, event);
    pushEvent(eventsByAgentId, event.agentId, event);
    pushEvent(eventsByParentAgentId, event.parentAgentId, event);
  }

  for (const entity of snapshot.entities) {
    if (!entity.model || modelByAgent.has(entity.agentId)) {
      continue;
    }
    modelByAgent.set(entity.agentId, entity.model);
  }

  const index = {
    runById,
    eventsByRunId,
    eventsByAgentId,
    eventsByParentAgentId,
    modelByAgent,
  };
  DETAIL_SNAPSHOT_INDEX_CACHE.set(snapshot, index);
  return index;
}

function getDetailPanelModelCache(snapshot: OfficeSnapshot): Map<string, DetailPanelModel> {
  const existing = DETAIL_PANEL_MODEL_CACHE.get(snapshot);
  if (existing) {
    return existing;
  }
  const cache = new Map<string, DetailPanelModel>();
  DETAIL_PANEL_MODEL_CACHE.set(snapshot, cache);
  return cache;
}

function trimTrailingSeparators(pathname: string): string {
  return pathname.replace(/[\\/]+$/, "");
}

function joinStatePath(base: string, ...segments: string[]): string {
  const normalizedBase = trimTrailingSeparators(base);
  return [normalizedBase, ...segments].join("/");
}

function estimateTokens(text: string | undefined): number {
  if (!text) {
    return 0;
  }
  const compact = text.trim();
  if (!compact) {
    return 0;
  }
  return Math.max(1, Math.ceil(compact.length / 4));
}

function estimateRunLatencyMs(run: OfficeRun, now: number): number | null {
  const startedAt = run.startedAt ?? run.createdAt;
  const endedAt = run.endedAt ?? (run.status === "active" ? now : undefined);
  if (typeof startedAt !== "number" || typeof endedAt !== "number") {
    return null;
  }
  return Math.max(0, endedAt - startedAt);
}

function estimateEventDensityPerMinute(eventCount: number, latencyMs: number | null): number | null {
  if (latencyMs === null || latencyMs <= 0 || eventCount <= 0) {
    return null;
  }
  return Math.round((eventCount / (latencyMs / 60_000)) * 100) / 100;
}

function normalizedEventSignature(event: DetailPanelMajorEvent): string {
  const compactText = event.text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 96);
  return `${event.type}:${compactText}`;
}

export type DetailPanelStatus = "empty" | "missing" | "ready";

export type DetailPanelPaths = {
  runStorePath: string;
  sessionStorePath?: string;
  sessionLogPath?: string;
  childSessionLogPath?: string;
  parentSessionLogPath?: string;
};

export type DetailPanelMetrics = {
  sessions: number;
  activeSubagents: number;
  runCount: number;
  errorRuns: number;
  eventCount: number;
  tokenEstimate: number;
};

export type DetailPanelRunInsight = {
  run: OfficeRun;
  model: string;
  tokenEstimate: number;
  latencyMs: number | null;
  eventCount: number;
  eventDensityPerMinute: number | null;
  errorPointMs: number | null;
  majorEvents: DetailPanelMajorEvent[];
};

export type DetailPanelMajorEvent = {
  id: string;
  type: OfficeEventType;
  at: number;
  offsetMs: number;
  text: string;
};

export type DetailPanelRunComparisonSelection = {
  baselineRunId: string;
  candidateRunId: string;
};

export type DetailPanelRunDiff = {
  baseline: DetailPanelRunInsight;
  candidate: DetailPanelRunInsight;
  modelChanged: boolean;
  taskChanged: boolean;
  tokenEstimateDelta: number;
  latencyDeltaMs: number | null;
  eventCountDelta: number;
  eventDensityPerMinuteDelta: number | null;
  errorPointDeltaMs: number | null;
  majorEvents: {
    baselineOnly: DetailPanelMajorEvent[];
    candidateOnly: DetailPanelMajorEvent[];
  };
};

type DetailPanelBase = {
  linkedRun: OfficeRun | null;
  runInsights: DetailPanelRunInsight[];
  relatedRuns: OfficeRun[];
  recentRuns: DetailPanelRunInsight[];
  runDiff: DetailPanelRunDiff | null;
  relatedEvents: OfficeEvent[];
  models: string[];
  metrics: DetailPanelMetrics;
  paths: DetailPanelPaths;
};

export type DetailPanelModel =
  | ({
      status: "empty";
      selectedEntityId: null;
      entity: null;
    } & DetailPanelBase)
  | ({
      status: "missing";
      selectedEntityId: string;
      entity: null;
    } & DetailPanelBase)
  | ({
      status: "ready";
      selectedEntityId: string;
      entity: OfficeEntity;
    } & DetailPanelBase);

export function selectDefaultRunComparison(
  runInsights: DetailPanelRunInsight[],
): DetailPanelRunComparisonSelection | null {
  if (runInsights.length < 2) {
    return null;
  }

  const latestErrorRun = runInsights.find((item) => item.run.status === "error");
  const latestSuccessRun = runInsights.find((item) => item.run.status === "ok");
  if (latestErrorRun && latestSuccessRun && latestErrorRun.run.runId !== latestSuccessRun.run.runId) {
    return {
      baselineRunId: latestSuccessRun.run.runId,
      candidateRunId: latestErrorRun.run.runId,
    };
  }

  return {
    baselineRunId: runInsights[1].run.runId,
    candidateRunId: runInsights[0].run.runId,
  };
}

function buildRunDiff(
  baseline: DetailPanelRunInsight,
  candidate: DetailPanelRunInsight,
): DetailPanelRunDiff {
  const baselineEventSignatures = new Set(baseline.majorEvents.map((event) => normalizedEventSignature(event)));
  const candidateEventSignatures = new Set(
    candidate.majorEvents.map((event) => normalizedEventSignature(event)),
  );
  return {
    baseline,
    candidate,
    modelChanged: baseline.model !== candidate.model,
    taskChanged: baseline.run.task !== candidate.run.task,
    tokenEstimateDelta: candidate.tokenEstimate - baseline.tokenEstimate,
    latencyDeltaMs:
      baseline.latencyMs === null || candidate.latencyMs === null
        ? null
        : candidate.latencyMs - baseline.latencyMs,
    eventCountDelta: candidate.eventCount - baseline.eventCount,
    eventDensityPerMinuteDelta:
      baseline.eventDensityPerMinute === null || candidate.eventDensityPerMinute === null
        ? null
        : Math.round((candidate.eventDensityPerMinute - baseline.eventDensityPerMinute) * 100) / 100,
    errorPointDeltaMs:
      baseline.errorPointMs === null || candidate.errorPointMs === null
        ? null
        : candidate.errorPointMs - baseline.errorPointMs,
    majorEvents: {
      baselineOnly: baseline.majorEvents.filter(
        (event) => !candidateEventSignatures.has(normalizedEventSignature(event)),
      ),
      candidateOnly: candidate.majorEvents.filter(
        (event) => !baselineEventSignatures.has(normalizedEventSignature(event)),
      ),
    },
  };
}

export function buildRunDiffForSelection(
  runInsights: DetailPanelRunInsight[],
  selection: DetailPanelRunComparisonSelection,
): DetailPanelRunDiff | null {
  if (!selection.baselineRunId || !selection.candidateRunId) {
    return null;
  }
  if (selection.baselineRunId === selection.candidateRunId) {
    return null;
  }
  const runInsightsById = new Map(runInsights.map((item) => [item.run.runId, item] as const));
  const baseline = runInsightsById.get(selection.baselineRunId);
  const candidate = runInsightsById.get(selection.candidateRunId);
  if (!baseline || !candidate) {
    return null;
  }
  return buildRunDiff(baseline, candidate);
}

const EMPTY_METRICS: DetailPanelMetrics = {
  sessions: 0,
  activeSubagents: 0,
  runCount: 0,
  errorRuns: 0,
  eventCount: 0,
  tokenEstimate: 0,
};

export function buildDetailPanelModel(
  snapshot: OfficeSnapshot,
  selectedEntityId: string | null,
): DetailPanelModel {
  const detailIndex = getDetailSnapshotIndex(snapshot);
  const runStorePath = joinStatePath(snapshot.source.stateDir, "subagents", "runs.json");
  if (!selectedEntityId) {
    return {
      status: "empty",
      selectedEntityId: null,
      entity: null,
      linkedRun: null,
      runInsights: [],
      relatedRuns: [],
      recentRuns: [],
      runDiff: null,
      relatedEvents: [],
      models: [],
      metrics: EMPTY_METRICS,
      paths: { runStorePath },
    };
  }

  const entity = snapshot.entities.find((item) => item.id === selectedEntityId);
  if (!entity) {
    return {
      status: "missing",
      selectedEntityId,
      entity: null,
      linkedRun: null,
      runInsights: [],
      relatedRuns: [],
      recentRuns: [],
      runDiff: null,
      relatedEvents: [],
      models: [],
      metrics: EMPTY_METRICS,
      paths: { runStorePath },
    };
  }

  const runById = detailIndex.runById;

  const linkedRun =
    entity.kind === "subagent" && entity.runId ? (runById.get(entity.runId) ?? null) : null;

  let relatedRuns: OfficeRun[] = [];
  if (entity.kind === "agent") {
    relatedRuns = runIdsForAgent(snapshot.runGraph, entity.agentId)
      .map((runId) => runById.get(runId))
      .filter((run): run is OfficeRun => Boolean(run));
  } else if (linkedRun) {
    relatedRuns = [linkedRun];
  } else {
    relatedRuns = runIdsForAgent(snapshot.runGraph, entity.agentId)
      .map((runId) => runById.get(runId))
      .filter((run): run is OfficeRun => {
        if (!run) {
          return false;
        }
        return run.childAgentId === entity.agentId && run.parentAgentId === entity.parentAgentId;
      });
  }

  relatedRuns = [...relatedRuns].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }
    return a.runId.localeCompare(b.runId);
  });

  const relatedRunIds = new Set(relatedRuns.map((run) => run.runId));
  const runEvents = new Map<string, OfficeEvent[]>();
  for (const runId of relatedRunIds) {
    const events = detailIndex.eventsByRunId.get(runId);
    if (!events || events.length === 0) {
      continue;
    }
    runEvents.set(runId, [...events]);
  }

  const relatedEventById = new Map<string, OfficeEvent>();
  for (const runId of relatedRunIds) {
    const events = detailIndex.eventsByRunId.get(runId) ?? [];
    for (const event of events) {
      relatedEventById.set(event.id, event);
    }
  }
  if (entity.kind === "agent") {
    const directEvents = detailIndex.eventsByAgentId.get(entity.agentId) ?? [];
    for (const event of directEvents) {
      relatedEventById.set(event.id, event);
    }
    const parentEvents = detailIndex.eventsByParentAgentId.get(entity.agentId) ?? [];
    for (const event of parentEvents) {
      relatedEventById.set(event.id, event);
    }
  } else if (entity.runId && !relatedRunIds.has(entity.runId)) {
    const linkedEvents = detailIndex.eventsByRunId.get(entity.runId) ?? [];
    for (const event of linkedEvents) {
      relatedEventById.set(event.id, event);
    }
  }

  const relatedEvents = [...relatedEventById.values()]
    .sort((a, b) => {
      if (a.at !== b.at) {
        return b.at - a.at;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, MAX_DETAIL_EVENTS);

  const modelByAgent = detailIndex.modelByAgent;

  const runInsights = relatedRuns.map((run) => {
    const runScopedEvents = runEvents.get(run.runId) ?? [];
    runScopedEvents.sort((a, b) => {
      if (a.at !== b.at) {
        return a.at - b.at;
      }
      return a.id.localeCompare(b.id);
    });
    const runTokenEstimate =
      estimateTokens(run.task) +
      runScopedEvents.reduce((sum, event) => sum + estimateTokens(event.text), 0);
    const latencyMs = estimateRunLatencyMs(run, snapshot.generatedAt);
    const runStartedAt = run.startedAt ?? run.createdAt;
    const firstErrorEvent = runScopedEvents.find((event) => event.type === "error");
    const majorEvents = runScopedEvents.slice(0, MAX_MAJOR_EVENTS).map((event) => ({
      id: event.id,
      type: event.type,
      at: event.at,
      offsetMs: Math.max(0, event.at - runStartedAt),
      text: event.text,
    }));
    return {
      run,
      model: modelByAgent.get(run.childAgentId) ?? "unknown",
      tokenEstimate: runTokenEstimate,
      latencyMs,
      eventCount: runScopedEvents.length,
      eventDensityPerMinute: estimateEventDensityPerMinute(runScopedEvents.length, latencyMs),
      errorPointMs: firstErrorEvent ? Math.max(0, firstErrorEvent.at - runStartedAt) : null,
      majorEvents,
    };
  });
  const recentRuns = runInsights.slice(0, MAX_RECENT_RUNS);

  const defaultSelection = selectDefaultRunComparison(recentRuns);
  const runDiff =
    defaultSelection === null ? null : buildRunDiffForSelection(runInsights, defaultSelection);

  const models = entity.model ? [entity.model] : [];
  const estimatedTexts = [
    entity.task,
    entity.bubble,
    ...relatedRuns.map((run) => run.task),
    ...relatedEvents.map((event) => event.text),
  ];
  const tokenEstimate = estimatedTexts.reduce((sum, text) => sum + estimateTokens(text), 0);

  const paths: DetailPanelPaths = { runStorePath };
  if (entity.kind === "agent") {
    paths.sessionStorePath = joinStatePath(
      snapshot.source.stateDir,
      "agents",
      entity.agentId,
      "sessions",
      "sessions.json",
    );
    paths.sessionLogPath = joinStatePath(snapshot.source.stateDir, "agents", entity.agentId, "sessions");
  } else if (linkedRun) {
    paths.childSessionLogPath = joinStatePath(
      snapshot.source.stateDir,
      "agents",
      linkedRun.childAgentId,
      "sessions",
    );
    paths.parentSessionLogPath = joinStatePath(
      snapshot.source.stateDir,
      "agents",
      linkedRun.parentAgentId,
      "sessions",
    );
  }

  return {
    status: "ready",
    selectedEntityId,
    entity,
    linkedRun,
    runInsights,
    relatedRuns,
    recentRuns,
    runDiff,
    relatedEvents,
    models,
    metrics: {
      sessions: entity.sessions,
      activeSubagents: entity.activeSubagents,
      runCount: relatedRuns.length,
      errorRuns: relatedRuns.filter((run) => run.status === "error").length,
      eventCount: relatedEvents.length,
      tokenEstimate,
    },
    paths,
  };
}

export function buildDetailPanelModelCached(
  snapshot: OfficeSnapshot,
  selectedEntityId: string | null,
): DetailPanelModel {
  const normalizedSelection = selectedEntityId?.trim() || null;
  const cache = getDetailPanelModelCache(snapshot);
  const cacheKey = cachedKeyForEntityId(normalizedSelection);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const model = buildDetailPanelModel(snapshot, normalizedSelection);
  cache.set(cacheKey, model);
  return model;
}

export function prefetchDetailPanelModels(snapshot: OfficeSnapshot, selectedEntityIds: string[]) {
  if (selectedEntityIds.length === 0) {
    return;
  }
  const cache = getDetailPanelModelCache(snapshot);
  for (const entityId of selectedEntityIds) {
    const normalized = entityId.trim();
    if (!normalized) {
      continue;
    }
    const key = cachedKeyForEntityId(normalized);
    if (cache.has(key)) {
      continue;
    }
    cache.set(key, buildDetailPanelModel(snapshot, normalized));
  }
}
