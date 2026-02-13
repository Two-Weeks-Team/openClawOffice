import type { OfficeEntity, OfficeEvent, OfficeRun, OfficeSnapshot } from "../types/office";

const MAX_DETAIL_EVENTS = 14;

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

type DetailPanelBase = {
  linkedRun: OfficeRun | null;
  relatedRuns: OfficeRun[];
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
  const runStorePath = joinStatePath(snapshot.source.stateDir, "subagents", "runs.json");
  if (!selectedEntityId) {
    return {
      status: "empty",
      selectedEntityId: null,
      entity: null,
      linkedRun: null,
      relatedRuns: [],
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
      relatedRuns: [],
      relatedEvents: [],
      models: [],
      metrics: EMPTY_METRICS,
      paths: { runStorePath },
    };
  }

  const runById = new Map<string, OfficeRun>();
  for (const run of snapshot.runs) {
    runById.set(run.runId, run);
  }

  const linkedRun =
    entity.kind === "subagent" && entity.runId ? (runById.get(entity.runId) ?? null) : null;

  let relatedRuns: OfficeRun[] = [];
  if (entity.kind === "agent") {
    relatedRuns = snapshot.runs.filter(
      (run) => run.parentAgentId === entity.agentId || run.childAgentId === entity.agentId,
    );
  } else if (linkedRun) {
    relatedRuns = [linkedRun];
  } else {
    relatedRuns = snapshot.runs.filter(
      (run) => run.childAgentId === entity.agentId && run.parentAgentId === entity.parentAgentId,
    );
  }

  relatedRuns = [...relatedRuns].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return b.createdAt - a.createdAt;
    }
    return a.runId.localeCompare(b.runId);
  });

  const relatedRunIds = new Set(relatedRuns.map((run) => run.runId));
  const relatedEvents = snapshot.events
    .filter((event) => {
      if (relatedRunIds.has(event.runId)) {
        return true;
      }
      if (entity.kind === "agent") {
        return event.agentId === entity.agentId || event.parentAgentId === entity.agentId;
      }
      return event.runId === entity.runId;
    })
    .sort((a, b) => {
      if (a.at !== b.at) {
        return b.at - a.at;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, MAX_DETAIL_EVENTS);

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
    relatedRuns,
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
