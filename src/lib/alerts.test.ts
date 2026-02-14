import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALERT_RULE_PREFERENCES,
  evaluateAlertSignals,
  isAlertRuleSuppressed,
  normalizeAlertRulePreferences,
} from "./alerts";
import type { OfficeEvent, OfficeRun, OfficeSnapshot } from "../types/office";

function createSnapshot({
  generatedAt = 1_000_000,
  runs = [],
  events = [],
}: {
  generatedAt?: number;
  runs?: OfficeRun[];
  events?: OfficeEvent[];
}): OfficeSnapshot {
  return {
    generatedAt,
    source: {
      stateDir: "/tmp/openclaw",
      live: true,
    },
    diagnostics: [],
    entities: [],
    runs,
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

describe("evaluateAlertSignals", () => {
  it("detects consecutive error events", () => {
    const now = 2_000_000;
    const snapshot = createSnapshot({
      generatedAt: now,
      events: [
        {
          id: "evt-4",
          type: "error",
          runId: "run-4",
          at: now - 1000,
          agentId: "sub-4",
          parentAgentId: "agent-a",
          text: "error 4",
        },
        {
          id: "evt-3",
          type: "error",
          runId: "run-3",
          at: now - 1500,
          agentId: "sub-3",
          parentAgentId: "agent-a",
          text: "error 3",
        },
        {
          id: "evt-2",
          type: "error",
          runId: "run-2",
          at: now - 2000,
          agentId: "sub-2",
          parentAgentId: "agent-a",
          text: "error 2",
        },
        {
          id: "evt-1",
          type: "start",
          runId: "run-1",
          at: now - 3000,
          agentId: "sub-1",
          parentAgentId: "agent-a",
          text: "start",
        },
      ],
    });

    const ruleIds = evaluateAlertSignals(snapshot).map((signal) => signal.ruleId);
    expect(ruleIds).toContain("consecutive-errors");
  });

  it("detects long active runs", () => {
    const now = 3_000_000;
    const snapshot = createSnapshot({
      generatedAt: now,
      runs: [
        {
          runId: "run-long",
          childSessionKey: "child",
          requesterSessionKey: "req",
          childAgentId: "sub-1",
          parentAgentId: "agent-a",
          status: "active",
          task: "long run",
          cleanup: "keep",
          createdAt: now - 11 * 60_000,
          startedAt: now - 10 * 60_000,
        },
      ],
    });

    const ruleIds = evaluateAlertSignals(snapshot).map((signal) => signal.ruleId);
    expect(ruleIds).toContain("long-active");
  });

  it("detects pending cleanup runs", () => {
    const now = 4_000_000;
    const snapshot = createSnapshot({
      generatedAt: now,
      runs: [
        {
          runId: "run-cleanup",
          childSessionKey: "child",
          requesterSessionKey: "req",
          childAgentId: "sub-2",
          parentAgentId: "agent-b",
          status: "ok",
          task: "cleanup run",
          cleanup: "delete",
          createdAt: now - 10 * 60_000,
          endedAt: now - 5 * 60_000,
        },
      ],
    });

    const ruleIds = evaluateAlertSignals(snapshot).map((signal) => signal.ruleId);
    expect(ruleIds).toContain("cleanup-pending");
  });

  it("detects event stall when active runs have no recent events", () => {
    const now = 5_000_000;
    const snapshot = createSnapshot({
      generatedAt: now,
      runs: [
        {
          runId: "run-active",
          childSessionKey: "child",
          requesterSessionKey: "req",
          childAgentId: "sub-3",
          parentAgentId: "agent-c",
          status: "active",
          task: "active run",
          cleanup: "keep",
          createdAt: now - 8 * 60_000,
          startedAt: now - 7 * 60_000,
        },
      ],
      events: [
        {
          id: "evt-old",
          type: "start",
          runId: "run-active",
          at: now - 5 * 60_000,
          agentId: "sub-3",
          parentAgentId: "agent-c",
          text: "start",
        },
      ],
    });

    const ruleIds = evaluateAlertSignals(snapshot).map((signal) => signal.ruleId);
    expect(ruleIds).toContain("event-stall");
  });
});

describe("alert rule preferences", () => {
  it("normalizes invalid inputs and applies valid values", () => {
    const parsed = normalizeAlertRulePreferences({
      "long-active": {
        muted: true,
        snoozeUntil: 1234,
      },
      "event-stall": {
        muted: "no",
        snoozeUntil: "soon",
      },
    });

    expect(parsed["long-active"]).toEqual({ muted: true, snoozeUntil: 1234 });
    expect(parsed["event-stall"]).toEqual({ muted: false, snoozeUntil: 0 });
    expect(parsed["consecutive-errors"]).toEqual(DEFAULT_ALERT_RULE_PREFERENCES["consecutive-errors"]);
  });

  it("checks suppression by mute and snooze", () => {
    const now = 10_000;
    const preferences = normalizeAlertRulePreferences({
      "consecutive-errors": { muted: true, snoozeUntil: 0 },
      "cleanup-pending": { muted: false, snoozeUntil: now + 5_000 },
    });

    expect(isAlertRuleSuppressed(preferences, "consecutive-errors", now)).toBe(true);
    expect(isAlertRuleSuppressed(preferences, "cleanup-pending", now)).toBe(true);
    expect(isAlertRuleSuppressed(preferences, "event-stall", now)).toBe(false);
  });
});
