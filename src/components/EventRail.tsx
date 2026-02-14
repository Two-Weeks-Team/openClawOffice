import { useEffect, useMemo, useState } from "react";
import { buildPlacements } from "../lib/layout";
import {
  buildTimelineLanes,
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
  type TimelineFilters,
  type TimelineLane,
  type TimelineLaneMode,
  type TimelineStatusFilter,
} from "../lib/timeline";
import type { OfficeEntity, OfficeEvent, OfficeRunGraph } from "../types/office";

type LaneContext = {
  mode: TimelineLaneMode;
  laneId: string | null;
  highlightAgentId: string | null;
};

type Props = {
  entities: OfficeEntity[];
  events: OfficeEvent[];
  runGraph: OfficeRunGraph;
  now: number;
  filters: TimelineFilters;
  onFiltersChange: (next: TimelineFilters) => void;
  activeEventId: string | null;
  onActiveEventIdChange: (eventId: string | null) => void;
  onLaneContextChange?: (next: LaneContext) => void;
};

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
  entities,
  events,
  runGraph,
  now,
  filters,
  onFiltersChange,
  activeEventId,
  onActiveEventIdChange,
  onLaneContextChange,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(800);
  const [laneMode, setLaneMode] = useState<TimelineLaneMode>("room");
  const [manualLaneKey, setManualLaneKey] = useState<string | null>(null);
  const [collapsedLaneKeys, setCollapsedLaneKeys] = useState<string[]>([]);

  const index = useMemo(() => buildTimelineIndex(events, runGraph), [events, runGraph]);
  const filteredDesc = useMemo(() => filterTimelineEvents(index, filters), [index, filters]);
  const roomByAgentId = useMemo(() => {
    const roomMap = new Map<string, string>();
    const layoutState = buildPlacements({
      entities,
      generatedAt: now,
    });
    for (const placement of layoutState.placements) {
      if (!roomMap.has(placement.entity.agentId)) {
        roomMap.set(placement.entity.agentId, placement.roomId);
      }
    }
    return roomMap;
  }, [entities, now]);
  const lanes = useMemo(
    () =>
      buildTimelineLanes({
        events: filteredDesc,
        mode: laneMode,
        resolveRoomId: (agentId) => roomByAgentId.get(agentId),
      }),
    [filteredDesc, laneMode, roomByAgentId],
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
  const playbackEvents = useMemo(
    () => [...filteredDesc].sort((a, b) => a.at - b.at),
    [filteredDesc],
  );
  const activePlaybackIndex = playbackEvents.findIndex((event) => event.id === activeEventId);

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
      const nextId = nextPlaybackEventId(playbackEvents, activeEventId, 1);
      if (!nextId) {
        setIsPlaying(false);
        return;
      }
      onActiveEventIdChange(nextId);
    }, playbackMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeEventId, isPlaying, onActiveEventIdChange, playbackEvents, playbackMs]);

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
            value={filters.runId}
            onChange={(event) => {
              onFiltersChange({ ...filters, runId: event.target.value });
            }}
          />
        </label>
        <label>
          Agent
          <input
            type="text"
            placeholder="agentId"
            value={filters.agentId}
            onChange={(event) => {
              onFiltersChange({ ...filters, agentId: event.target.value });
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
            setIsPlaying(false);
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
              }
            }}
            disabled={playbackEvents.length === 0 || activePlaybackIndex <= 0}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying((value) => !value);
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
            }}
          >
            <option value="room">ROOM</option>
            <option value="agent">AGENT</option>
            <option value="subagent">SUBAGENT</option>
          </select>
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

      {lanes.length === 0 ? (
        <p className="timeline-empty">No events match current timeline filters.</p>
      ) : (
        <ol className="timeline-lane-list">
          {lanes.map((lane) => {
            const collapsed = collapsedLaneKeys.includes(lane.key);
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
                    {lane.events.map((event) => (
                      <li
                        key={event.id}
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
      )}
    </aside>
  );
}
