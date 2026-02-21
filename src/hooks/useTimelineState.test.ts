// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeEvent, OfficeSnapshot } from "../types/office";
import { useTimelineState } from "./useTimelineState";

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<OfficeEvent> = {}): OfficeEvent {
  return {
    id: "evt-1",
    type: "start",
    runId: "run-1",
    at: 1000,
    agentId: "agent-1",
    parentAgentId: "",
    text: "",
    ...overrides,
  };
}

function makeSnapshot(events: OfficeEvent[] = []): OfficeSnapshot {
  return {
    generatedAt: Date.now(),
    source: { stateDir: "/tmp", live: false },
    diagnostics: [],
    entities: [],
    runs: [],
    runGraph: {
      nodes: [],
      edges: [],
      index: {
        runNodeIdByRunId: {},
        runIdsByAgentId: {},
        agentIdsByRunId: {},
        timeRangeByRunId: {},
        spawnedByRunId: {},
        spawnedChildrenByRunId: {},
      },
      diagnostics: [],
    },
    events,
  };
}

const noopToast = vi.fn();

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function setSearch(search: string) {
  Object.defineProperty(window, "location", {
    value: new URL(`http://localhost/${search}`),
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTimelineState — URL parameter initialisation", () => {
  afterEach(() => {
    setSearch("");
    vi.restoreAllMocks();
  });

  it("initialises activeEventId from ?eventId= param", () => {
    setSearch("?eventId=evt-42");
    const { result } = renderHook(() => useTimelineState(null, noopToast));
    expect(result.current.activeEventId).toBe("evt-42");
  });

  it("initialises timelineFilters.runId from ?runId= param", () => {
    setSearch("?runId=run-99");
    const { result } = renderHook(() => useTimelineState(null, noopToast));
    expect(result.current.timelineFilters.runId).toBe("run-99");
  });

  it("initialises activeEventId to null when ?eventId is absent", () => {
    setSearch("");
    const { result } = renderHook(() => useTimelineState(null, noopToast));
    expect(result.current.activeEventId).toBeNull();
  });

  it("initialises timelineFilters.runId to empty string when ?runId is absent", () => {
    setSearch("");
    const { result } = renderHook(() => useTimelineState(null, noopToast));
    expect(result.current.timelineFilters.runId).toBe("");
  });
});

describe("useTimelineState — URL sync (useEffect)", () => {
  beforeEach(() => {
    setSearch("");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes runId to URL when timelineFilters.runId is set", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => {
      result.current.setTimelineFilters({ runId: "run-abc", agentId: "", status: "all" });
    });

    const lastCall = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[2]).toContain("runId=run-abc");
  });

  it("writes eventId to URL when activeEventId is set", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => {
      result.current.setActiveEventId("evt-xyz");
    });

    const lastCall = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[2]).toContain("eventId=evt-xyz");
  });

  it("sets replay=1 when either runId or eventId is present", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => {
      result.current.setActiveEventId("evt-1");
    });

    const lastCall = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[2]).toContain("replay=1");
  });

  it("removes replay param when both runId and eventId are cleared", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => {
      result.current.setActiveEventId("evt-1");
    });
    act(() => {
      result.current.setActiveEventId(null);
    });

    const lastCall = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[2]).not.toContain("replay");
  });
});

describe("useTimelineState — moveTimelineEvent", () => {
  beforeEach(() => {
    setSearch("");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    noopToast.mockClear();
  });

  it("shows toast and does not change activeEventId when playbackEvents is empty", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => result.current.moveTimelineEvent(1));

    expect(noopToast).toHaveBeenCalledWith("info", expect.stringContaining("latest"));
    expect(result.current.activeEventId).toBeNull();
  });

  it("moves forward from null to the first event (delta = 1)", () => {
    const events = [
      makeEvent({ id: "a", at: 1000 }),
      makeEvent({ id: "b", at: 2000 }),
    ];
    const { result } = renderHook(() =>
      useTimelineState(makeSnapshot(events), noopToast),
    );

    act(() => result.current.moveTimelineEvent(1));

    // events sorted ascending by at → first is "a" (at: 1000)
    expect(result.current.activeEventId).toBe("a");
    expect(noopToast).not.toHaveBeenCalled();
  });

  it("shows 'earliest' toast when already at first event and delta = -1", () => {
    const events = [makeEvent({ id: "only", at: 1000 })];
    const { result } = renderHook(() =>
      useTimelineState(makeSnapshot(events), noopToast),
    );

    // navigate to first event
    act(() => result.current.moveTimelineEvent(1));
    noopToast.mockClear();

    // try to go further back
    act(() => result.current.moveTimelineEvent(-1));

    expect(noopToast).toHaveBeenCalledWith("info", expect.stringContaining("earliest"));
  });

  it("shows 'latest' toast when already at last event and delta = 1", () => {
    const events = [makeEvent({ id: "only", at: 1000 })];
    const { result } = renderHook(() =>
      useTimelineState(makeSnapshot(events), noopToast),
    );

    // navigate to the only event
    act(() => result.current.moveTimelineEvent(1));
    noopToast.mockClear();

    // try to advance past end
    act(() => result.current.moveTimelineEvent(1));

    expect(noopToast).toHaveBeenCalledWith("info", expect.stringContaining("latest"));
  });
});

describe("useTimelineState — clearTimelineFilters", () => {
  beforeEach(() => {
    setSearch("?runId=run-1&eventId=evt-1");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    noopToast.mockClear();
  });

  it("resets runId, agentId, status and activeEventId", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => {
      result.current.setTimelineFilters({ runId: "run-1", agentId: "a", status: "start" });
      result.current.setActiveEventId("evt-1");
    });

    act(() => result.current.clearTimelineFilters());

    expect(result.current.timelineFilters).toEqual({ runId: "", agentId: "", status: "all" });
    expect(result.current.activeEventId).toBeNull();
  });

  it("shows info toast after clearing filters", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => result.current.clearTimelineFilters());

    expect(noopToast).toHaveBeenCalledWith("info", expect.any(String));
  });
});

describe("useTimelineState — handleLaneContextChange", () => {
  beforeEach(() => setSearch(""));
  afterEach(() => vi.restoreAllMocks());

  it("updates timelineLaneHighlightAgentId", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => result.current.handleLaneContextChange({ highlightAgentId: "agent-x" }));
    expect(result.current.timelineLaneHighlightAgentId).toBe("agent-x");

    act(() => result.current.handleLaneContextChange({ highlightAgentId: null }));
    expect(result.current.timelineLaneHighlightAgentId).toBeNull();
  });
});

describe("useTimelineState — handleRoomAssignmentsChange", () => {
  beforeEach(() => setSearch(""));
  afterEach(() => vi.restoreAllMocks());

  it("sets room assignment map in state", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));
    const assignments = new Map([["agent-1", "room-A"]]);

    act(() => result.current.handleRoomAssignmentsChange(assignments));

    expect(result.current.timelineRoomByAgentId.get("agent-1")).toBe("room-A");
  });

  it("replaces previous assignments on subsequent calls", () => {
    const { result } = renderHook(() => useTimelineState(null, noopToast));

    act(() => result.current.handleRoomAssignmentsChange(new Map([["agent-1", "room-A"]])));
    act(() => result.current.handleRoomAssignmentsChange(new Map([["agent-2", "room-B"]])));

    expect(result.current.timelineRoomByAgentId.has("agent-1")).toBe(false);
    expect(result.current.timelineRoomByAgentId.get("agent-2")).toBe("room-B");
  });
});

describe("useTimelineState — activeTimelineIndex", () => {
  beforeEach(() => {
    setSearch("");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns -1 when no event is active", () => {
    const events = [makeEvent({ id: "a", at: 1000 })];
    const { result } = renderHook(() =>
      useTimelineState(makeSnapshot(events), noopToast),
    );
    expect(result.current.activeTimelineIndex).toBe(-1);
  });

  it("returns correct index after moveTimelineEvent", () => {
    const events = [
      makeEvent({ id: "a", at: 1000 }),
      makeEvent({ id: "b", at: 2000 }),
    ];
    const { result } = renderHook(() =>
      useTimelineState(makeSnapshot(events), noopToast),
    );

    act(() => result.current.moveTimelineEvent(1));

    // null → moveTimelineEvent(1) selects the first event → index 0
    expect(result.current.activeTimelineIndex).toBe(0);
  });
});
