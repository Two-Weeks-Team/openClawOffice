import type { OfficeEvent, OfficeRunGraph } from "../types/office";
import { agentIdsForRun } from "./run-graph";

export type TimelineStatusFilter = "all" | OfficeEvent["type"];

export type TimelineFilters = {
  runId: string;
  agentId: string;
  status: TimelineStatusFilter;
};

export type TimelineLaneMode = "room" | "agent" | "subagent";

export type TimelineLane = {
  key: string;
  id: string;
  mode: TimelineLaneMode;
  label: string;
  events: OfficeEvent[];
  eventCount: number;
  runCount: number;
  densityPerMinute: number;
  latestAt: number;
};

export type BuildTimelineLanesParams = {
  events: OfficeEvent[];
  mode: TimelineLaneMode;
  resolveRoomId?: (agentId: string, event: OfficeEvent) => string | null | undefined;
};

export type TimelineLaneItem =
  | {
      kind: "event";
      key: string;
      event: OfficeEvent;
    }
  | {
      kind: "summary";
      summaryKind: "run-burst" | "dense-window";
      key: string;
      label: string;
      runId: string | null;
      events: OfficeEvent[];
      eventCount: number;
      runCount: number;
      latestAt: number;
      oldestAt: number;
      spanMs: number;
    };

export type BuildTimelineLaneItemsParams = {
  lane: TimelineLane;
  enableCompression?: boolean;
  burstGroupMinSize?: number;
  burstGapMs?: number;
  denseLaneThresholdPerMinute?: number;
  denseVisibleEventBudget?: number;
};

export type TimelineSegment = {
  id: string;
  startAt: number;
  endAt: number;
  label: string;
  eventCount: number;
  runCount: number;
  latestAt: number;
  oldestAt: number;
  events: OfficeEvent[];
};

export type BuildTimelineSegmentsParams = {
  events: OfficeEvent[];
  segmentWindowMs?: number;
};

export type TimelineIndex = {
  ordered: OfficeEvent[];
  byRunId: Map<string, OfficeEvent[]>;
  byAgentId: Map<string, OfficeEvent[]>;
  byStatus: Map<OfficeEvent["type"], OfficeEvent[]>;
  agentIdsByEventId: Map<string, Set<string>>;
};

const DEFAULT_TIMELINE_SEGMENT_WINDOW_MS = 10 * 60_000;

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

export function parseEventIdDeepLink(search: string): string {
  const params = new URLSearchParams(search);
  return normalizeFilterText(params.get("eventId") ?? "");
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

export function nextReplayIndex(params: {
  currentIndex: number;
  total: number;
  direction?: 1 | -1;
  loopStartIndex?: number | null;
  loopEndIndex?: number | null;
}): number | null {
  const direction = params.direction ?? 1;
  if (!Number.isFinite(params.total) || params.total <= 0) {
    return null;
  }
  const total = Math.max(0, Math.floor(params.total));
  const maxIndex = total - 1;
  const currentIndex = Number.isFinite(params.currentIndex) ? Math.floor(params.currentIndex) : -1;
  const rawStart = params.loopStartIndex;
  const rawEnd = params.loopEndIndex;
  const hasLoop = typeof rawStart === "number" && typeof rawEnd === "number";
  const loopStart = hasLoop ? Math.min(Math.max(0, Math.floor(rawStart)), maxIndex) : null;
  const loopEnd = hasLoop
    ? Math.min(Math.max(loopStart ?? 0, Math.floor(rawEnd)), maxIndex)
    : null;

  if (direction === 1) {
    if (hasLoop && loopStart !== null && loopEnd !== null) {
      if (currentIndex < loopStart || currentIndex > loopEnd) {
        return loopStart;
      }
      const next = currentIndex + 1;
      if (next > loopEnd) {
        return loopStart;
      }
      return next;
    }
    const next = currentIndex < 0 ? 0 : currentIndex + 1;
    if (next < 0 || next >= total) {
      return null;
    }
    return next;
  }

  const prev = currentIndex < 0 ? maxIndex : currentIndex - 1;
  if (prev < 0 || prev >= total) {
    return null;
  }
  return prev;
}

function laneDescriptorForEvent(
  event: OfficeEvent,
  mode: TimelineLaneMode,
  resolveRoomId?: BuildTimelineLanesParams["resolveRoomId"],
): { id: string; label: string } {
  if (mode === "agent") {
    return {
      id: event.parentAgentId,
      label: `Agent ${event.parentAgentId}`,
    };
  }

  if (mode === "subagent") {
    return {
      id: event.agentId,
      label: `Subagent ${event.agentId}`,
    };
  }

  const roomId = resolveRoomId?.(event.agentId, event) ?? "unassigned";
  return {
    id: roomId,
    label: roomId === "unassigned" ? "Room Unassigned" : `Room ${roomId}`,
  };
}

function calculateDensityPerMinute(events: OfficeEvent[]): number {
  if (events.length === 0) {
    return 0;
  }

  let minAt = Number.POSITIVE_INFINITY;
  let maxAt = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    minAt = Math.min(minAt, event.at);
    maxAt = Math.max(maxAt, event.at);
  }

  const spanMinutes = Math.max(1, (maxAt - minAt) / 60_000);
  return Number((events.length / spanMinutes).toFixed(2));
}

function timelineSegmentLabel(startAt: number, endAt: number): string {
  const startLabel = new Date(startAt).toISOString().slice(11, 16);
  const endLabel = new Date(endAt).toISOString().slice(11, 16);
  return `${startLabel}-${endLabel}`;
}

export function buildTimelineSegments({
  events,
  segmentWindowMs = DEFAULT_TIMELINE_SEGMENT_WINDOW_MS,
}: BuildTimelineSegmentsParams): TimelineSegment[] {
  if (events.length === 0) {
    return [];
  }

  const windowMs = Math.max(60_000, Math.floor(segmentWindowMs));
  const sorted = [...events].sort((left, right) => {
    if (left.at !== right.at) {
      return right.at - left.at;
    }
    return left.id.localeCompare(right.id);
  });
  const bySegmentStart = new Map<number, OfficeEvent[]>();

  for (const event of sorted) {
    const startAt = Math.floor(event.at / windowMs) * windowMs;
    const bucket = bySegmentStart.get(startAt);
    if (bucket) {
      bucket.push(event);
    } else {
      bySegmentStart.set(startAt, [event]);
    }
  }

  return [...bySegmentStart.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([startAt, segmentEvents]) => {
      const latestAt = segmentEvents[0]?.at ?? startAt;
      const oldestAt = segmentEvents[segmentEvents.length - 1]?.at ?? latestAt;
      const endAt = startAt + windowMs - 1;
      const runCount = new Set(segmentEvents.map((event) => event.runId)).size;
      return {
        id: `segment:${startAt}`,
        startAt,
        endAt,
        label: timelineSegmentLabel(startAt, endAt),
        eventCount: segmentEvents.length,
        runCount,
        latestAt,
        oldestAt,
        events: segmentEvents,
      } satisfies TimelineSegment;
    });
}

export function buildTimelineLanes({
  events,
  mode,
  resolveRoomId,
}: BuildTimelineLanesParams): TimelineLane[] {
  const laneMap = new Map<string, TimelineLane>();

  for (const event of events) {
    const descriptor = laneDescriptorForEvent(event, mode, resolveRoomId);
    const key = `${mode}:${descriptor.id}`;
    const existing = laneMap.get(key);
    if (existing) {
      existing.events.push(event);
      continue;
    }

    laneMap.set(key, {
      key,
      id: descriptor.id,
      mode,
      label: descriptor.label,
      events: [event],
      eventCount: 0,
      runCount: 0,
      densityPerMinute: 0,
      latestAt: 0,
    });
  }

  const lanes = [...laneMap.values()].map((lane) => {
    const sortedEvents = [...lane.events].sort((left, right) => {
      if (left.at !== right.at) {
        return right.at - left.at;
      }
      return left.id.localeCompare(right.id);
    });
    const runCount = new Set(sortedEvents.map((event) => event.runId)).size;
    return {
      ...lane,
      events: sortedEvents,
      eventCount: sortedEvents.length,
      runCount,
      densityPerMinute: calculateDensityPerMinute(sortedEvents),
      latestAt: sortedEvents[0]?.at ?? 0,
    };
  });

  return lanes.sort((left, right) => {
    if (left.eventCount !== right.eventCount) {
      return right.eventCount - left.eventCount;
    }
    if (left.latestAt !== right.latestAt) {
      return right.latestAt - left.latestAt;
    }
    return left.label.localeCompare(right.label);
  });
}

function formatSummaryWindow(spanMs: number): string {
  if (spanMs < 60_000) {
    return `${Math.max(1, Math.round(spanMs / 1000))}s`;
  }
  return `${Math.max(1, Math.round(spanMs / 60_000))}m`;
}

function eventItemKey(laneKey: string, event: OfficeEvent): string {
  return `${laneKey}:event:${event.id}`;
}

function toEventItem(laneKey: string, event: OfficeEvent): TimelineLaneItem {
  return {
    kind: "event",
    key: eventItemKey(laneKey, event),
    event,
  };
}

function toSummaryItem(input: {
  laneKey: string;
  summaryKind: "run-burst" | "dense-window";
  runId: string | null;
  events: OfficeEvent[];
}): TimelineLaneItem {
  const latest = input.events[0];
  const oldest = input.events[input.events.length - 1];
  const latestAt = latest?.at ?? 0;
  const oldestAt = oldest?.at ?? latestAt;
  const spanMs = Math.max(0, latestAt - oldestAt);
  const runCount = new Set(input.events.map((event) => event.runId)).size;

  const label =
    input.summaryKind === "run-burst"
      ? `run ${input.runId ?? "unknown"} burst: ${input.events.length} events in ${formatSummaryWindow(spanMs)}`
      : `${input.events.length} events compressed (${runCount} runs / ${formatSummaryWindow(spanMs)})`;

  return {
    kind: "summary",
    summaryKind: input.summaryKind,
    key: `${input.laneKey}:${input.summaryKind}:${latest?.id ?? "none"}:${oldest?.id ?? "none"}`,
    label,
    runId: input.runId,
    events: input.events,
    eventCount: input.events.length,
    runCount,
    latestAt,
    oldestAt,
    spanMs,
  };
}

function buildBurstItems(
  lane: TimelineLane,
  burstGroupMinSize: number,
  burstGapMs: number,
): TimelineLaneItem[] {
  if (lane.events.length === 0) {
    return [];
  }

  const items: TimelineLaneItem[] = [];
  let contiguous: OfficeEvent[] = [];

  const flushContiguous = () => {
    if (contiguous.length === 0) {
      return;
    }
    if (contiguous.length >= burstGroupMinSize) {
      items.push(
        toSummaryItem({
          laneKey: lane.key,
          summaryKind: "run-burst",
          runId: contiguous[0]?.runId ?? null,
          events: contiguous,
        }),
      );
    } else {
      for (const event of contiguous) {
        items.push(toEventItem(lane.key, event));
      }
    }
    contiguous = [];
  };

  for (const event of lane.events) {
    const previous = contiguous[contiguous.length - 1];
    if (!previous) {
      contiguous = [event];
      continue;
    }

    const sameRun = previous.runId === event.runId;
    const gapMs = Math.max(0, previous.at - event.at);
    if (sameRun && gapMs <= burstGapMs) {
      contiguous.push(event);
      continue;
    }

    flushContiguous();
    contiguous = [event];
  }

  flushContiguous();
  return items;
}

export function timelineLaneItemEventCount(item: TimelineLaneItem): number {
  if (item.kind === "event") {
    return 1;
  }
  return item.eventCount;
}

export function buildTimelineLaneItems({
  lane,
  enableCompression = true,
  burstGroupMinSize = 3,
  burstGapMs = 45_000,
  denseLaneThresholdPerMinute = 12,
  denseVisibleEventBudget = 10,
}: BuildTimelineLaneItemsParams): TimelineLaneItem[] {
  if (!enableCompression) {
    return lane.events.map((event) => toEventItem(lane.key, event));
  }

  const burstItems = buildBurstItems(lane, Math.max(2, burstGroupMinSize), Math.max(1_000, burstGapMs));
  const shouldDenseCollapse =
    lane.densityPerMinute >= denseLaneThresholdPerMinute &&
    lane.events.length > denseVisibleEventBudget;
  if (!shouldDenseCollapse) {
    return burstItems;
  }

  const visibleItems: TimelineLaneItem[] = [];
  const hiddenEvents: OfficeEvent[] = [];
  let consumedEvents = 0;

  for (const item of burstItems) {
    const itemEventCount = timelineLaneItemEventCount(item);
    if (consumedEvents < denseVisibleEventBudget) {
      visibleItems.push(item);
      consumedEvents += itemEventCount;
      continue;
    }

    if (item.kind === "event") {
      hiddenEvents.push(item.event);
    } else {
      hiddenEvents.push(...item.events);
    }
  }

  if (hiddenEvents.length === 0) {
    return burstItems;
  }

  const denseSummary = toSummaryItem({
    laneKey: lane.key,
    summaryKind: "dense-window",
    runId: null,
    events: hiddenEvents,
  });

  return [...visibleItems, denseSummary];
}
