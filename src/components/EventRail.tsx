import { useEffect, useMemo, useState } from "react";
import type { OfficeEvent } from "../types/office";
import {
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
  type TimelineFilters,
  type TimelineStatusFilter,
} from "../lib/timeline";

type Props = {
  events: OfficeEvent[];
  now: number;
  filters: TimelineFilters;
  onFiltersChange: (next: TimelineFilters) => void;
  activeEventId: string | null;
  onActiveEventIdChange: (eventId: string | null) => void;
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

export function EventRail({
  events,
  now,
  filters,
  onFiltersChange,
  activeEventId,
  onActiveEventIdChange,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(800);

  const index = useMemo(() => buildTimelineIndex(events), [events]);
  const filteredDesc = useMemo(() => filterTimelineEvents(index, filters), [index, filters]);
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

  const activeEvent = activeEventId
    ? playbackEvents.find((event) => event.id === activeEventId) ?? null
    : null;

  return (
    <aside className="event-rail">
      <header>
        <h2>Lifecycle Timeline</h2>
        <p>Filter by run/agent/status and replay events with deep-linkable run context.</p>
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

      <ol>
        {playbackEvents.map((event) => (
          <li
            key={event.id}
            className={`event event-${event.type} ${activeEventId === event.id ? "is-current" : ""}`}
          >
            <button
              type="button"
              className="event-hit"
              onClick={() => {
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
    </aside>
  );
}
