import { useEffect, useMemo, useState } from "react";
import {
  buildTimelineLaneItems,
  buildTimelineLanes,
  buildTimelineIndex,
  buildTimelineSegments,
  filterTimelineEvents,
  nextPlaybackEventId,
  nextReplayIndex,
  timelineLaneItemEventCount,
  type TimelineFilters,
  type TimelineLane,
  type TimelineLaneItem,
  type TimelineLaneMode,
  type TimelineStatusFilter,
} from "../lib/timeline";
import type { OfficeEvent, OfficeRunGraph } from "../types/office";

type LaneContext = {
  mode: TimelineLaneMode;
  laneId: string | null;
  highlightAgentId: string | null;
};

type ReplayStatus = "idle" | "playing" | "paused";

type Props = {
  roomByAgentId: Map<string, string>;
  events: OfficeEvent[];
  runGraph: OfficeRunGraph;
  now: number;
  filters: TimelineFilters;
  onFiltersChange: (next: TimelineFilters) => void;
  activeEventId: string | null;
  onActiveEventIdChange: (eventId: string | null) => void;
  onLaneContextChange?: (next: LaneContext) => void;
};

const TIMELINE_SEGMENT_WINDOW_MS = 10 * 60_000;
const INITIAL_SEGMENT_LOAD_COUNT = 2;

function relativeTime(timestamp: number, now: number) {
  const ms = Math.max(0, now - timestamp);
  if (ms < 60_000) {
    return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ago`;
  }
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function eventBadge(type: OfficeEvent["type"]) {
  if (type === "spawn") {
    return "SPAWN";
  }
  if (type === "start") {
    return "START";
  }
  if (type === "cleanup") {
    return "CLEAN";
  }
  if (type === "error") {
    return "ERR";
  }
  return "DONE";
}

function summaryBadge(kind: "run-burst" | "dense-window") {
  if (kind === "run-burst") {
    return "BURST";
  }
  return "DENSE";
}

function laneHighlightAgentId(lane: TimelineLane | null): string | null {
  if (!lane) {
    return null;
  }
  if (lane.mode === "agent") {
    return lane.id;
  }
  if (lane.mode === "subagent") {
    return lane.events[0]?.agentId ?? lane.id;
  }
  return null;
}

export function EventRail({
  roomByAgentId,
  events,
  runGraph,
  now,
  filters,
  onFiltersChange,
  activeEventId,
  onActiveEventIdChange,
  onLaneContextChange,
}: Props) {
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>("idle");
  const [playbackMs, setPlaybackMs] = useState(800);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopRange, setLoopRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [laneMode, setLaneMode] = useState<TimelineLaneMode>("room");
  const [manualLaneKey, setManualLaneKey] = useState<string | null>(null);
  const [collapsedLaneKeys, setCollapsedLaneKeys] = useState<string[]>([]);
  const [compressionEnabled, setCompressionEnabled] = useState(true);
  const [expandedSummaryKeys, setExpandedSummaryKeys] = useState<string[]>([]);
  const [loadedSegmentCount, setLoadedSegmentCount] = useState(INITIAL_SEGMENT_LOAD_COUNT);

  const index = useMemo(() => buildTimelineIndex(events, runGraph), [events, runGraph]);
  const filteredDesc = useMemo(() => filterTimelineEvents(index, filters), [index, filters]);
  const timelineSegments = useMemo(
    () =>
      buildTimelineSegments({
        events: filteredDesc,
        segmentWindowMs: TIMELINE_SEGMENT_WINDOW_MS,
      }),
    [filteredDesc],
  );
  const effectiveLoadedSegmentCount = Math.min(
    timelineSegments.length,
    Math.max(1, loadedSegmentCount),
  );
  const loadedSegments = useMemo(
    () => timelineSegments.slice(0, effectiveLoadedSegmentCount),
    [effectiveLoadedSegmentCount, timelineSegments],
  );
  const loadedDesc = useMemo(
    () => loadedSegments.flatMap((segment) => segment.events),
    [loadedSegments],
  );
  const lanes = useMemo(
    () =>
      buildTimelineLanes({
        events: loadedDesc,
        mode: laneMode,
        resolveRoomId: (agentId) => roomByAgentId.get(agentId),
      }),
    [laneMode, loadedDesc, roomByAgentId],
  );
  const laneKeyByActiveEvent = useMemo(() => {
    if (!activeEventId) {
      return null;
    }
    return lanes.find((lane) => lane.events.some((event) => event.id === activeEventId))?.key ?? null;
  }, [activeEventId, lanes]);
  const selectedLaneKey = useMemo(() => {
    if (laneKeyByActiveEvent && lanes.some((lane) => lane.key === laneKeyByActiveEvent)) {
      return laneKeyByActiveEvent;
    }
    if (manualLaneKey && lanes.some((lane) => lane.key === manualLaneKey)) {
      return manualLaneKey;
    }
    return lanes[0]?.key ?? null;
  }, [laneKeyByActiveEvent, lanes, manualLaneKey]);
  const selectedLane = useMemo(
    () => lanes.find((lane) => lane.key === selectedLaneKey) ?? null,
    [lanes, selectedLaneKey],
  );
  const laneItemsByKey = useMemo(() => {
    const map = new Map<string, TimelineLaneItem[]>();
    for (const lane of lanes) {
      map.set(
        lane.key,
        buildTimelineLaneItems({
          lane,
          enableCompression: compressionEnabled,
        }),
      );
    }
    return map;
  }, [compressionEnabled, lanes]);
  const summaryKeyByEventId = useMemo(() => {
    const map = new Map<string, string>();
    for (const items of laneItemsByKey.values()) {
      for (const item of items) {
        if (item.kind !== "summary") {
          continue;
        }
        for (const event of item.events) {
          map.set(event.id, item.key);
        }
      }
    }
    return map;
  }, [laneItemsByKey]);
  const summaryKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const items of laneItemsByKey.values()) {
      for (const item of items) {
        if (item.kind === "summary") {
          keys.add(item.key);
        }
      }
    }
    return keys;
  }, [laneItemsByKey]);
  const effectiveExpandedSummaryKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of expandedSummaryKeys) {
      if (summaryKeys.has(key)) {
        keys.add(key);
      }
    }
    const activeSummaryKey = activeEventId ? summaryKeyByEventId.get(activeEventId) : undefined;
    if (activeSummaryKey && summaryKeys.has(activeSummaryKey)) {
      keys.add(activeSummaryKey);
    }
    return keys;
  }, [activeEventId, expandedSummaryKeys, summaryKeyByEventId, summaryKeys]);
  const playbackEvents = useMemo(
    () => [...loadedDesc].sort((a, b) => a.at - b.at),
    [loadedDesc],
  );
  const activePlaybackIndex = playbackEvents.findIndex((event) => event.id === activeEventId);
  const normalizedLoopRange = useMemo(() => {
    if (!loopRange || playbackEvents.length === 0) {
      return null;
    }
    const maxIndex = playbackEvents.length - 1;
    const startIndex = Math.min(Math.max(0, loopRange.startIndex), maxIndex);
    const endIndex = Math.min(Math.max(startIndex, loopRange.endIndex), maxIndex);
    return {
      startIndex,
      endIndex,
    };
  }, [loopRange, playbackEvents.length]);
  const isPlaying = replayStatus === "playing" && playbackEvents.length > 0;
  const hasLoopRange = Boolean(normalizedLoopRange);

  useEffect(() => {
    if (playbackEvents.length === 0) {
      if (activeEventId !== null) {
        onActiveEventIdChange(null);
      }
      return;
    }
    const hasCurrent = activeEventId
      ? playbackEvents.some((event) => event.id === activeEventId)
      : false;
    if (!hasCurrent) {
      onActiveEventIdChange(playbackEvents[0]?.id ?? null);
    }
  }, [activeEventId, onActiveEventIdChange, playbackEvents]);

  useEffect(() => {
    if (!isPlaying || playbackEvents.length === 0) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      const currentIndex = activeEventId
        ? playbackEvents.findIndex((event) => event.id === activeEventId)
        : -1;
      const nextIndex = nextReplayIndex({
        currentIndex,
        total: playbackEvents.length,
        direction: 1,
        loopStartIndex: loopEnabled ? normalizedLoopRange?.startIndex : null,
        loopEndIndex: loopEnabled ? normalizedLoopRange?.endIndex : null,
      });

      if (nextIndex === null || nextIndex < 0 || nextIndex >= playbackEvents.length) {
        setReplayStatus("paused");
        return;
      }
      onActiveEventIdChange(playbackEvents[nextIndex]?.id ?? null);
    }, playbackMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    activeEventId,
    isPlaying,
    loopEnabled,
    normalizedLoopRange,
    onActiveEventIdChange,
    playbackEvents,
    playbackMs,
  ]);

  useEffect(() => {
    if (!onLaneContextChange) {
      return;
    }
    onLaneContextChange({
      mode: laneMode,
      laneId: selectedLane?.id ?? null,
      highlightAgentId: laneHighlightAgentId(selectedLane),
    });
  }, [laneMode, onLaneContextChange, selectedLane]);

  const activeEvent = activeEventId
    ? playbackEvents.find((event) => event.id === activeEventId) ?? null
    : null;
  const isEveryLaneCollapsed =
    lanes.length > 0 && lanes.every((lane) => collapsedLaneKeys.includes(lane.key));
  const replayRunOptions = useMemo(
    () => [...index.byRunId.keys()].sort((left, right) => left.localeCompare(right)),
    [index],
  );

  return (
    <aside className="event-rail">
      <header>
        <h2>Lifecycle Timeline</h2>
        <p>Multi-lane timeline with room/agent/subagent grouping, filters, and playback.</p>
      </header>

      <section className="timeline-filters">
        <label>
          Run
          <input
            type="text"
            placeholder="runId"
            list="timeline-run-options"
            value={filters.runId}
            onChange={(event) => {
              onFiltersChange({ ...filters, runId: event.target.value });
              setLoadedSegmentCount(INITIAL_SEGMENT_LOAD_COUNT);
            }}
          />
          <datalist id="timeline-run-options">
            {replayRunOptions.map((runId) => (
              <option key={runId} value={runId} />
            ))}
          </datalist>
        </label>
        <label>
          Agent
          <input
            type="text"
            placeholder="agentId"
            value={filters.agentId}
            onChange={(event) => {
              onFiltersChange({ ...filters, agentId: event.target.value });
              setLoadedSegmentCount(INITIAL_SEGMENT_LOAD_COUNT);
            }}
          />
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => {
              onFiltersChange({
                ...filters,
                status: event.target.value as TimelineStatusFilter,
              });
              setLoadedSegmentCount(INITIAL_SEGMENT_LOAD_COUNT);
            }}
          >
            <option value="all">ALL</option>
            <option value="spawn">SPAWN</option>
            <option value="start">START</option>
            <option value="end">END</option>
            <option value="error">ERROR</option>
            <option value="cleanup">CLEANUP</option>
          </select>
        </label>
        <button
          type="button"
          className="timeline-clear"
          onClick={() => {
            onFiltersChange({ runId: "", agentId: "", status: "all" });
            onActiveEventIdChange(null);
            setManualLaneKey(null);
            setReplayStatus("idle");
            setLoopEnabled(false);
            setLoopRange(null);
            setExpandedSummaryKeys([]);
            setLoadedSegmentCount(INITIAL_SEGMENT_LOAD_COUNT);
          }}
        >
          Clear
        </button>
      </section>

      <section className="timeline-controls">
        <div className="timeline-buttons">
          <button
            type="button"
            onClick={() => {
              const prevId = nextPlaybackEventId(playbackEvents, activeEventId, -1);
              if (prevId) {
                onActiveEventIdChange(prevId);
                setReplayStatus("paused");
              }
            }}
            disabled={playbackEvents.length === 0 || activePlaybackIndex <= 0}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => {
              setReplayStatus((value) => (value === "playing" ? "paused" : "playing"));
            }}
            disabled={playbackEvents.length === 0}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => {
              const nextId = nextPlaybackEventId(playbackEvents, activeEventId, 1);
              if (nextId) {
                onActiveEventIdChange(nextId);
                setReplayStatus("paused");
              }
            }}
            disabled={playbackEvents.length === 0 || activePlaybackIndex >= playbackEvents.length - 1}
          >
            Next
          </button>
        </div>
        <label className="timeline-speed">
          Speed
          <select
            value={playbackMs}
            onChange={(event) => {
              setPlaybackMs(Number(event.target.value));
            }}
          >
            <option value={1200}>0.8x</option>
            <option value={800}>1x</option>
            <option value={450}>2x</option>
          </select>
        </label>
        <div className="timeline-loop-controls">
          <button
            type="button"
            onClick={() => {
              if (activePlaybackIndex < 0) {
                return;
              }
              setLoopRange((prev) => ({
                startIndex: activePlaybackIndex,
                endIndex:
                  prev && prev.endIndex >= activePlaybackIndex ? prev.endIndex : activePlaybackIndex,
              }));
            }}
            disabled={activePlaybackIndex < 0}
          >
            Set A
          </button>
          <button
            type="button"
            onClick={() => {
              if (activePlaybackIndex < 0) {
                return;
              }
              setLoopRange((prev) => ({
                startIndex:
                  prev && prev.startIndex <= activePlaybackIndex ? prev.startIndex : activePlaybackIndex,
                endIndex: activePlaybackIndex,
              }));
            }}
            disabled={activePlaybackIndex < 0}
          >
            Set B
          </button>
          <label className="timeline-loop-toggle">
            <input
              type="checkbox"
              checked={loopEnabled}
              onChange={(event) => {
                const checked = event.target.checked;
                setLoopEnabled(checked);
                if (checked && !normalizedLoopRange && activePlaybackIndex >= 0) {
                  setLoopRange({
                    startIndex: activePlaybackIndex,
                    endIndex: activePlaybackIndex,
                  });
                }
              }}
              disabled={activePlaybackIndex < 0}
            />
            Loop
          </label>
          <button
            type="button"
            onClick={() => {
              setLoopEnabled(false);
              setLoopRange(null);
            }}
            disabled={!hasLoopRange}
          >
            Clear Loop
          </button>
        </div>
      </section>

      <section className="timeline-scrubber">
        <input
          type="range"
          min={0}
          max={Math.max(0, playbackEvents.length - 1)}
          value={Math.max(0, activePlaybackIndex)}
          onChange={(event) => {
            const indexValue = Number(event.target.value);
            onActiveEventIdChange(playbackEvents[indexValue]?.id ?? null);
          }}
          disabled={playbackEvents.length === 0}
        />
        <div className="timeline-scrubber-meta">
          <span>{playbackEvents.length} events</span>
          <span>{activeEvent ? new Date(activeEvent.at).toLocaleTimeString() : "-"}</span>
          <span>
            {normalizedLoopRange
              ? `loop ${normalizedLoopRange.startIndex + 1}-${normalizedLoopRange.endIndex + 1}${loopEnabled ? " on" : " off"}`
              : "loop off"}
          </span>
        </div>
      </section>

      <section className="timeline-lane-mode">
        <label>
          Lane
          <select
            value={laneMode}
            onChange={(event) => {
              setLaneMode(event.target.value as TimelineLaneMode);
              setManualLaneKey(null);
              setCollapsedLaneKeys([]);
              setLoadedSegmentCount(INITIAL_SEGMENT_LOAD_COUNT);
            }}
          >
            <option value="room">ROOM</option>
            <option value="agent">AGENT</option>
            <option value="subagent">SUBAGENT</option>
          </select>
        </label>
        <label className="timeline-compression-toggle">
          <input
            type="checkbox"
            checked={compressionEnabled}
            onChange={(event) => {
              setCompressionEnabled(event.target.checked);
            }}
          />
          Compress dense lanes
        </label>
        <button
          type="button"
          className="timeline-lane-action"
          onClick={() => {
            if (isEveryLaneCollapsed) {
              setCollapsedLaneKeys([]);
              return;
            }
            setCollapsedLaneKeys(lanes.map((lane) => lane.key));
          }}
          disabled={lanes.length === 0}
        >
          {isEveryLaneCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </section>

      <section className="timeline-segments">
        <header>
          <strong>Segments</strong>
          <span>
            loaded {loadedSegments.length}/{timelineSegments.length}
          </span>
        </header>
        {timelineSegments.length > 0 ? (
          <ol className="timeline-segment-list">
            {timelineSegments.slice(0, 6).map((segment, index) => {
              const loaded = index < loadedSegments.length;
              return (
                <li key={segment.id} className={loaded ? "is-loaded" : ""}>
                  <button
                    type="button"
                    onClick={() => {
                      setLoadedSegmentCount((prev) =>
                        Math.max(prev, index + 1),
                      );
                    }}
                  >
                    <strong>{segment.label}</strong>
                    <span>
                      {segment.eventCount} events | {segment.runCount} runs
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="timeline-empty">No timeline segments to load.</p>
        )}
        {loadedSegments.length < timelineSegments.length ? (
          <button
            type="button"
            className="timeline-segment-load"
            onClick={() => {
              setLoadedSegmentCount((prev) => prev + 1);
            }}
          >
            Load older segment
          </button>
        ) : null}
      </section>

      {lanes.length === 0 ? (
        <p className="timeline-empty">No events match current timeline filters.</p>
      ) : (
        <ol className="timeline-lane-list">
          {lanes.map((lane) => {
            const collapsed = collapsedLaneKeys.includes(lane.key);
            const laneItems = laneItemsByKey.get(lane.key) ?? [];
            const summarizedEventCount = laneItems.reduce((count, item) => {
              if (item.kind !== "summary") {
                return count;
              }
              return count + Math.max(0, item.eventCount - 1);
            }, 0);
            return (
              <li
                key={lane.key}
                className={`timeline-lane ${selectedLaneKey === lane.key ? "is-selected" : ""}`}
              >
                <div className="timeline-lane-header">
                  <button
                    type="button"
                    className="timeline-lane-select"
                    onClick={() => {
                      setManualLaneKey(lane.key);
                      onActiveEventIdChange(lane.events[0]?.id ?? null);
                    }}
                  >
                    <strong>{lane.label}</strong>
                    <span className="timeline-lane-meta">
                      {lane.eventCount} events | {lane.runCount} runs | {lane.densityPerMinute}/min
                      {summarizedEventCount > 0 ? ` | ${summarizedEventCount} summarized` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="timeline-lane-toggle"
                    onClick={() => {
                      setCollapsedLaneKeys((prev) =>
                        prev.includes(lane.key)
                          ? prev.filter((key) => key !== lane.key)
                          : [...prev, lane.key],
                      );
                    }}
                  >
                    {collapsed ? "Expand" : "Collapse"}
                  </button>
                </div>
                {!collapsed ? (
                  <ol className="timeline-lane-events">
                    {laneItems.map((item) => {
                      if (item.kind === "event") {
                        const event = item.event;
                        return (
                          <li
                            key={item.key}
                            className={`event event-${event.type} ${
                              activeEventId === event.id ? "is-current" : ""
                            }`}
                          >
                            <button
                              type="button"
                              className="event-hit"
                              onClick={() => {
                                setManualLaneKey(lane.key);
                                onActiveEventIdChange(event.id);
                              }}
                            >
                              <span className="badge">{eventBadge(event.type)}</span>
                              <div className="event-body">
                                <strong>
                                  {event.parentAgentId} {"->"} {event.agentId}
                                </strong>
                                <p>{event.text}</p>
                                <p className="event-meta">
                                  run {event.runId} | {relativeTime(event.at, now)}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      }

                      const expanded = effectiveExpandedSummaryKeys.has(item.key);
                      return (
                        <li key={item.key} className={`event event-summary event-summary-${item.summaryKind}`}>
                          <div className="event-hit">
                            <span className="badge">{summaryBadge(item.summaryKind)}</span>
                            <div className="event-body">
                              <strong>{item.label}</strong>
                              <p className="event-meta">
                                {item.eventCount} events | {item.runCount} runs |{" "}
                                {relativeTime(item.latestAt, now)}
                              </p>
                              <button
                                type="button"
                                className="timeline-summary-toggle"
                                onClick={() => {
                                  setExpandedSummaryKeys((previous) =>
                                    previous.includes(item.key)
                                      ? previous.filter((key) => key !== item.key)
                                      : [...previous, item.key],
                                  );
                                }}
                              >
                                {expanded
                                  ? "Hide grouped events"
                                  : `Show grouped events (${timelineLaneItemEventCount(item)})`}
                              </button>
                            </div>
                          </div>
                          {expanded ? (
                            <ol className="timeline-summary-events">
                              {item.events.map((event) => (
                                <li
                                  key={`${item.key}:${event.id}`}
                                  className={`event event-${event.type} ${
                                    activeEventId === event.id ? "is-current" : ""
                                  }`}
                                >
                                  <button
                                    type="button"
                                    className="event-hit"
                                    onClick={() => {
                                      setManualLaneKey(lane.key);
                                      onActiveEventIdChange(event.id);
                                    }}
                                  >
                                    <span className="badge">{eventBadge(event.type)}</span>
                                    <div className="event-body">
                                      <strong>
                                        {event.parentAgentId} {"->"} {event.agentId}
                                      </strong>
                                      <p>{event.text}</p>
                                      <p className="event-meta">
                                        run {event.runId} | {relativeTime(event.at, now)}
                                      </p>
                                    </div>
                                  </button>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
