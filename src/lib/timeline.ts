import type { OfficeEvent, OfficeRunGraph } from "../types/office";
import { agentIdsForRun } from "./run-graph";

export type TimelineStatusFilter = "all" | OfficeEvent["type"];

export type TimelineFilters = {
  runId: string;
  agentId: string;
  status: TimelineStatusFilter;
};

export type TimelineIndex = {
  ordered: OfficeEvent[];
  byRunId: Map<string, OfficeEvent[]>;
  byAgentId: Map<string, OfficeEvent[]>;
  byStatus: Map<OfficeEvent["type"], OfficeEvent[]>;
  agentIdsByEventId: Map<string, Set<string>>;
};

function normalizeFilterText(value: string): string {
  return value.trim();
}

export function normalizeTimelineFilters(input: Partial<TimelineFilters>): TimelineFilters {
  return {
    runId: normalizeFilterText(input.runId ?? ""),
    agentId: normalizeFilterText(input.agentId ?? ""),
    status: input.status ?? "all",
  };
}

function pushToMap(map: Map<string, OfficeEvent[]>, key: string, event: OfficeEvent) {
  const existing = map.get(key);
  if (existing) {
    existing.push(event);
    return;
  }
  map.set(key, [event]);
}

export function buildTimelineIndex(events: OfficeEvent[], runGraph?: OfficeRunGraph): TimelineIndex {
  const ordered = [...events].sort((a, b) => {
    if (a.at !== b.at) {
      return b.at - a.at;
    }
    return a.id.localeCompare(b.id);
  });

  const byRunId = new Map<string, OfficeEvent[]>();
  const byAgentId = new Map<string, OfficeEvent[]>();
  const byStatus = new Map<OfficeEvent["type"], OfficeEvent[]>();
  const agentIdsByEventId = new Map<string, Set<string>>();

  for (const event of ordered) {
    pushToMap(byRunId, event.runId, event);
    const graphAgentIds = runGraph ? agentIdsForRun(runGraph, event.runId) : [];
    if (graphAgentIds.length > 0) {
      agentIdsByEventId.set(event.id, new Set(graphAgentIds));
      for (const agentId of graphAgentIds) {
        pushToMap(byAgentId, agentId, event);
      }
    } else {
      const eventAgentIds = new Set<string>([event.agentId, event.parentAgentId]);
      agentIdsByEventId.set(event.id, eventAgentIds);
      for (const agentId of eventAgentIds) {
        pushToMap(byAgentId, agentId, event);
      }
    }

    const statusEvents = byStatus.get(event.type);
    if (statusEvents) {
      statusEvents.push(event);
    } else {
      byStatus.set(event.type, [event]);
    }
  }

  return { ordered, byRunId, byAgentId, byStatus, agentIdsByEventId };
}

export function filterTimelineEvents(index: TimelineIndex, rawFilters: TimelineFilters): OfficeEvent[] {
  const filters = normalizeTimelineFilters(rawFilters);
  const hasRunId = filters.runId.length > 0;
  const hasAgentId = filters.agentId.length > 0;
  const statusFilter = filters.status === "all" ? null : filters.status;

  let candidates = index.ordered;
  if (hasRunId) {
    candidates = index.byRunId.get(filters.runId) ?? [];
  } else if (hasAgentId) {
    candidates = index.byAgentId.get(filters.agentId) ?? [];
  } else if (statusFilter) {
    candidates = index.byStatus.get(statusFilter) ?? [];
  }

  return candidates.filter((event) => {
    if (hasRunId && event.runId !== filters.runId) {
      return false;
    }
    if (hasAgentId) {
      const eventAgentIds = index.agentIdsByEventId.get(event.id);
      if (!eventAgentIds?.has(filters.agentId)) {
        return false;
      }
    }
    if (statusFilter && event.type !== statusFilter) {
      return false;
    }
    return true;
  });
}

export function parseRunIdDeepLink(search: string): string {
  const params = new URLSearchParams(search);
  return normalizeFilterText(params.get("runId") ?? "");
}

export function nextPlaybackEventId(
  orderedEvents: OfficeEvent[],
  currentEventId: string | null,
  direction: 1 | -1 = 1,
): string | null {
  if (orderedEvents.length === 0) {
    return null;
  }
  if (!currentEventId) {
    return orderedEvents[0]?.id ?? null;
  }

  const currentIndex = orderedEvents.findIndex((event) => event.id === currentEventId);
  if (currentIndex < 0) {
    return orderedEvents[0]?.id ?? null;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= orderedEvents.length) {
    return null;
  }
  return orderedEvents[nextIndex]?.id ?? null;
}
