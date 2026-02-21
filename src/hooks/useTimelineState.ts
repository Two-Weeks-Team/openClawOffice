import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
  parseEventIdDeepLink,
  parseRunIdDeepLink,
  type TimelineFilters,
} from "../lib/timeline";
import type { OfficeSnapshot } from "../types/office";
import type { ShowToast } from "./useToast";

export function useTimelineState(snapshot: OfficeSnapshot | null, showToast: ShowToast) {
  const [activeEventId, setActiveEventId] = useState<string | null>(() => {
    const eventId = parseEventIdDeepLink(window.location.search);
    return eventId.length > 0 ? eventId : null;
  });

  const [timelineFilters, setTimelineFilters] = useState<TimelineFilters>(() => ({
    runId: parseRunIdDeepLink(window.location.search),
    agentId: "",
    status: "all",
  }));

  const [timelineRoomByAgentId, setTimelineRoomByAgentId] = useState<Map<string, string>>(
    () => new Map(),
  );

  const [timelineLaneHighlightAgentId, setTimelineLaneHighlightAgentId] = useState<string | null>(
    null,
  );

  // Sync timeline state to URL search params
  useEffect(() => {
    const url = new URL(window.location.href);
    const runId = timelineFilters.runId.trim();
    if (runId) {
      url.searchParams.set("runId", runId);
    } else {
      url.searchParams.delete("runId");
    }
    const eventId = activeEventId?.trim();
    if (eventId) {
      url.searchParams.set("eventId", eventId);
    } else {
      url.searchParams.delete("eventId");
    }
    if (runId || eventId) {
      url.searchParams.set("replay", "1");
    } else {
      url.searchParams.delete("replay");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeEventId, timelineFilters.runId]);

  const timelinePlaybackEvents = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const index = buildTimelineIndex(snapshot.events, snapshot.runGraph);
    return [...filterTimelineEvents(index, timelineFilters)].sort((left, right) => left.at - right.at);
  }, [snapshot, timelineFilters]);

  const activeTimelineIndex = useMemo(
    () => timelinePlaybackEvents.findIndex((event) => event.id === activeEventId),
    [activeEventId, timelinePlaybackEvents],
  );

  const clearTimelineFilters = useCallback(() => {
    setTimelineFilters({ runId: "", agentId: "", status: "all" });
    setActiveEventId(null);
    showToast("info", "Timeline filters reset.");
  }, [showToast]);

  const moveTimelineEvent = useCallback(
    (direction: 1 | -1) => {
      const nextId = nextPlaybackEventId(timelinePlaybackEvents, activeEventId, direction);
      if (!nextId) {
        showToast(
          "info",
          direction === 1
            ? "Already at the latest timeline event."
            : "Already at the earliest timeline event.",
        );
        return;
      }
      setActiveEventId(nextId);
    },
    [activeEventId, showToast, timelinePlaybackEvents],
  );

  const handleLaneContextChange = useCallback((next: { highlightAgentId: string | null }) => {
    setTimelineLaneHighlightAgentId(next.highlightAgentId);
  }, []);

  const handleRoomAssignmentsChange = useCallback((next: Map<string, string>) => {
    setTimelineRoomByAgentId(next);
  }, []);

  return {
    activeEventId,
    setActiveEventId,
    timelineFilters,
    setTimelineFilters,
    timelineRoomByAgentId,
    timelineLaneHighlightAgentId,
    timelinePlaybackEvents,
    activeTimelineIndex,
    clearTimelineFilters,
    moveTimelineEvent,
    handleLaneContextChange,
    handleRoomAssignmentsChange,
  };
}
