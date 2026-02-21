import { describe, expect, it } from "vitest";
import {
  buildEventsFromRuns,
  extractMeaningfulLabel,
  resolveAgentStatus,
  truncateMiddle,
} from "./office-state";
import type { OfficeRun } from "./office-types";

// ---------------------------------------------------------------------------
// truncateMiddle
// ---------------------------------------------------------------------------
describe("truncateMiddle", () => {
  it("returns value unchanged when within limit", () => {
    expect(truncateMiddle("abc", 16)).toBe("abc");
    expect(truncateMiddle("abcdefghijklmnop", 16)).toBe("abcdefghijklmnop");
  });

  it("truncates with '...' in middle when over limit", () => {
    const result = truncateMiddle("abcdefghijklmnopqrstuvwxyz", 16);
    // keep = floor((16-3)/2) = 6; 6 + 3 + 6 = 15 chars
    expect(result.length).toBeLessThanOrEqual(16);
    expect(result).toContain("...");
    // should preserve beginning and end
    expect(result.startsWith("abc")).toBe(true);
    expect(result.endsWith("xyz")).toBe(true);
  });

  it("uses 16 as default max (result is <= 16 chars)", () => {
    const long = "a".repeat(20);
    const result = truncateMiddle(long);
    // keep = floor((16-3)/2) = 6, so result = 6 + 3 + 6 = 15
    expect(result.length).toBeLessThanOrEqual(16);
    expect(result).toContain("...");
  });
});

// ---------------------------------------------------------------------------
// extractMeaningfulLabel
// ---------------------------------------------------------------------------
describe("extractMeaningfulLabel", () => {
  it("returns the last dash-separated segment when length 3–12", () => {
    expect(extractMeaningfulLabel("prefix-suffix")).toBe("suffix");
    expect(extractMeaningfulLabel("a-b-c-abc")).toBe("abc");
  });

  it("returns last two segments when last segment is too short", () => {
    // Last segment "ab" is < 3 chars → use last two segments "agent-ab"
    expect(extractMeaningfulLabel("some-agent-ab")).toBe("agent-ab");
  });

  it("truncates when no segment combination fits within 16 chars", () => {
    // "some-verylongsegment": last segment = "verylongsegment" (15 chars, > 12)
    // last two segments = "some-verylongsegment" (20 chars, > 16)
    // → truncateMiddle
    const result = extractMeaningfulLabel("some-verylongsegment");
    expect(result.length).toBeLessThanOrEqual(16);
    expect(result).toContain("...");
  });

  it("falls back to truncateMiddle for very long single-segment names", () => {
    const long = "averylongsingleword";
    const result = extractMeaningfulLabel(long);
    // Should be truncated to 16
    expect(result.length).toBeLessThanOrEqual(16);
  });
});

// ---------------------------------------------------------------------------
// resolveAgentStatus
// ---------------------------------------------------------------------------
describe("resolveAgentStatus", () => {
  const now = Date.now();

  it("returns 'error' when hasRecentError is true (overrides others)", () => {
    expect(
      resolveAgentStatus({
        hasRecentError: true,
        activeSubagents: 5,
        lastUpdatedAt: now,
      }),
    ).toBe("error");
  });

  it("returns 'active' when activeSubagents > 0", () => {
    expect(
      resolveAgentStatus({
        hasRecentError: false,
        activeSubagents: 2,
        lastUpdatedAt: now,
      }),
    ).toBe("active");
  });

  it("returns 'offline' when no lastUpdatedAt", () => {
    expect(
      resolveAgentStatus({
        hasRecentError: false,
        activeSubagents: 0,
        lastUpdatedAt: undefined,
      }),
    ).toBe("offline");
  });

  it("returns 'active' when updated very recently", () => {
    expect(
      resolveAgentStatus({
        hasRecentError: false,
        activeSubagents: 0,
        lastUpdatedAt: now - 30_000, // 30s ago (within 2 min active window)
      }),
    ).toBe("active");
  });

  it("returns 'idle' when updated within idle window (2–8 min)", () => {
    expect(
      resolveAgentStatus({
        hasRecentError: false,
        activeSubagents: 0,
        lastUpdatedAt: now - 5 * 60_000, // 5m ago
      }),
    ).toBe("idle");
  });

  it("returns 'offline' when updated too long ago", () => {
    expect(
      resolveAgentStatus({
        hasRecentError: false,
        activeSubagents: 0,
        lastUpdatedAt: now - 20 * 60_000, // 20m ago
      }),
    ).toBe("offline");
  });
});

// ---------------------------------------------------------------------------
// buildEventsFromRuns
// ---------------------------------------------------------------------------
describe("buildEventsFromRuns", () => {
  function makeRun(overrides: Partial<OfficeRun> = {}): OfficeRun {
    return {
      runId: "run-1",
      childSessionKey: "child:run-1",
      requesterSessionKey: "parent:run-1",
      childAgentId: "agent-child",
      parentAgentId: "agent-parent",
      status: "ok",
      task: "do something",
      cleanup: "keep",
      createdAt: 1000,
      ...overrides,
    };
  }

  it("always emits a spawn event", () => {
    const events = buildEventsFromRuns([makeRun()]);
    const spawn = events.find((e) => e.type === "spawn");
    expect(spawn).toBeDefined();
    expect(spawn!.runId).toBe("run-1");
    expect(spawn!.at).toBe(1000);
  });

  it("emits a start event when startedAt is set", () => {
    const events = buildEventsFromRuns([makeRun({ startedAt: 2000 })]);
    const start = events.find((e) => e.type === "start");
    expect(start).toBeDefined();
    expect(start!.at).toBe(2000);
  });

  it("does not emit start event when startedAt is missing", () => {
    const events = buildEventsFromRuns([makeRun()]);
    expect(events.find((e) => e.type === "start")).toBeUndefined();
  });

  it("emits an end event for successful runs", () => {
    const events = buildEventsFromRuns([makeRun({ endedAt: 3000, status: "ok" })]);
    const end = events.find((e) => e.type === "end");
    expect(end).toBeDefined();
    expect(end!.text).toBe("completed");
  });

  it("emits an error event for failed runs", () => {
    const events = buildEventsFromRuns([makeRun({ endedAt: 3000, status: "error" })]);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.text).toBe("ended with error");
  });

  it("emits a cleanup event when cleanupCompletedAt is set", () => {
    const events = buildEventsFromRuns([makeRun({ cleanupCompletedAt: 4000 })]);
    const cleanup = events.find((e) => e.type === "cleanup");
    expect(cleanup).toBeDefined();
    expect(cleanup!.at).toBe(4000);
  });

  it("sorts events by timestamp descending (newest first)", () => {
    const events = buildEventsFromRuns([
      makeRun({ createdAt: 1000, startedAt: 2000, endedAt: 3000 }),
    ]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].at).toBeGreaterThanOrEqual(events[i].at);
    }
  });

  it("handles empty run list", () => {
    expect(buildEventsFromRuns([])).toEqual([]);
  });

  it("limits events to MAX_EVENTS (220)", () => {
    const manyRuns: OfficeRun[] = Array.from({ length: 300 }, (_, i) =>
      makeRun({
        runId: `run-${i}`,
        createdAt: i * 100,
        startedAt: i * 100 + 10,
        endedAt: i * 100 + 20,
        cleanupCompletedAt: i * 100 + 30,
      }),
    );
    const events = buildEventsFromRuns(manyRuns);
    expect(events.length).toBeLessThanOrEqual(220);
  });
});
