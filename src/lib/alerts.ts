import type { OfficeEvent, OfficeRun, OfficeSnapshot } from "../types/office";

export type AlertRuleId =
  | "consecutive-errors"
  | "long-active"
  | "cleanup-pending"
  | "event-stall";

export type AlertSeverity = "warning" | "critical";

export type AlertSignal = {
  ruleId: AlertRuleId;
  severity: AlertSeverity;
  dedupeKey: string;
  title: string;
  message: string;
  runIds: string[];
  agentIds: string[];
};

export type AlertRulePreference = {
  muted: boolean;
  snoozeUntil: number;
};

export type AlertRulePreferences = Record<AlertRuleId, AlertRulePreference>;

const CONSECUTIVE_ERROR_COUNT = 3;
const LONG_ACTIVE_MS = 8 * 60_000;
const CLEANUP_PENDING_MS = 3 * 60_000;
const EVENT_STALL_MS = 90_000;

const RULE_IDS: AlertRuleId[] = [
  "consecutive-errors",
  "long-active",
  "cleanup-pending",
  "event-stall",
];

export const DEFAULT_ALERT_RULE_PREFERENCES: AlertRulePreferences = {
  "consecutive-errors": { muted: false, snoozeUntil: 0 },
  "long-active": { muted: false, snoozeUntil: 0 },
  "cleanup-pending": { muted: false, snoozeUntil: 0 },
  "event-stall": { muted: false, snoozeUntil: 0 },
};

export const ALERT_RULE_LABELS: Record<AlertRuleId, string> = {
  "consecutive-errors": "Consecutive Errors",
  "long-active": "Long-running Active",
  "cleanup-pending": "Cleanup Pending",
  "event-stall": "Event Stall",
};

function dedupeList(values: string[]): string[] {
  return [...new Set(values)];
}

function takeConsecutiveErrorEvents(events: OfficeEvent[]): OfficeEvent[] {
  const ordered = [...events].sort((left, right) => right.at - left.at);
  const consecutive: OfficeEvent[] = [];
  for (const event of ordered) {
    if (event.type !== "error") {
      break;
    }
    consecutive.push(event);
  }
  return consecutive;
}

function evaluateConsecutiveErrors(snapshot: OfficeSnapshot): AlertSignal | null {
  const consecutiveErrors = takeConsecutiveErrorEvents(snapshot.events);
  if (consecutiveErrors.length < CONSECUTIVE_ERROR_COUNT) {
    return null;
  }
  const recent = consecutiveErrors.slice(0, CONSECUTIVE_ERROR_COUNT);
  const runIds = dedupeList(recent.map((event) => event.runId));
  const agentIds = dedupeList(recent.map((event) => event.agentId));
  return {
    ruleId: "consecutive-errors",
    severity: "critical",
    dedupeKey: `consecutive-errors:${recent.map((event) => event.id).join(",")}`,
    title: "Consecutive Error Events",
    message: `${consecutiveErrors.length} consecutive error events detected from latest stream frames.`,
    runIds,
    agentIds,
  };
}

function evaluateLongActiveRuns(snapshot: OfficeSnapshot, now: number): AlertSignal | null {
  const staleActiveRuns = snapshot.runs.filter((run) => {
    if (run.status !== "active") {
      return false;
    }
    const startedAt = run.startedAt ?? run.createdAt;
    return now - startedAt >= LONG_ACTIVE_MS;
  });

  if (staleActiveRuns.length === 0) {
    return null;
  }

  const sorted = [...staleActiveRuns].sort((left, right) => left.createdAt - right.createdAt);
  const longestAgeMs = now - (sorted[0]?.startedAt ?? sorted[0]?.createdAt ?? now);
  const longestAgeMin = Math.floor(longestAgeMs / 60_000);

  return {
    ruleId: "long-active",
    severity: "warning",
    dedupeKey: `long-active:${sorted.map((run) => run.runId).sort().join(",")}`,
    title: "Long-running Active Runs",
    message: `${sorted.length} active runs exceeded ${Math.floor(
      LONG_ACTIVE_MS / 60_000,
    )}m (oldest ${longestAgeMin}m).`,
    runIds: sorted.map((run) => run.runId),
    agentIds: dedupeList(sorted.map((run) => run.childAgentId)),
  };
}

function evaluateCleanupPending(snapshot: OfficeSnapshot, now: number): AlertSignal | null {
  const pendingCleanupRuns = snapshot.runs.filter((run) => {
    if (run.cleanup !== "delete") {
      return false;
    }
    if (run.cleanupCompletedAt) {
      return false;
    }
    if (!run.endedAt) {
      return false;
    }
    return now - run.endedAt >= CLEANUP_PENDING_MS;
  });

  if (pendingCleanupRuns.length === 0) {
    return null;
  }

  const sorted = [...pendingCleanupRuns].sort((left, right) => {
    const leftEndedAt = left.endedAt ?? left.createdAt;
    const rightEndedAt = right.endedAt ?? right.createdAt;
    return leftEndedAt - rightEndedAt;
  });

  return {
    ruleId: "cleanup-pending",
    severity: "warning",
    dedupeKey: `cleanup-pending:${sorted.map((run) => run.runId).sort().join(",")}`,
    title: "Cleanup Not Completed",
    message: `${sorted.length} ended runs are still waiting cleanup(delete) completion.`,
    runIds: sorted.map((run) => run.runId),
    agentIds: dedupeList(sorted.map((run) => run.childAgentId)),
  };
}

function latestEventTime(events: OfficeEvent[]): number | null {
  if (events.length === 0) {
    return null;
  }
  let latest = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    latest = Math.max(latest, event.at);
  }
  return Number.isFinite(latest) ? latest : null;
}

function latestActiveRunStart(activeRuns: OfficeRun[]): number | null {
  if (activeRuns.length === 0) {
    return null;
  }
  let latest = Number.NEGATIVE_INFINITY;
  for (const run of activeRuns) {
    latest = Math.max(latest, run.startedAt ?? run.createdAt);
  }
  return Number.isFinite(latest) ? latest : null;
}

function evaluateEventStall(snapshot: OfficeSnapshot, now: number): AlertSignal | null {
  const activeRuns = snapshot.runs.filter((run) => run.status === "active");
  if (activeRuns.length === 0) {
    return null;
  }

  const latestEventAt = latestEventTime(snapshot.events);
  const fallbackStartAt = latestActiveRunStart(activeRuns);
  const referenceAt = latestEventAt ?? fallbackStartAt;
  if (!referenceAt) {
    return null;
  }

  const idleMs = now - referenceAt;
  if (idleMs < EVENT_STALL_MS) {
    return null;
  }

  return {
    ruleId: "event-stall",
    severity: "critical",
    dedupeKey: `event-stall:${referenceAt}`,
    title: "Event Stream Stalled",
    message: `No new lifecycle event for ${Math.floor(idleMs / 1000)}s while active runs exist.`,
    runIds: activeRuns.map((run) => run.runId),
    agentIds: dedupeList(activeRuns.map((run) => run.childAgentId)),
  };
}

export function evaluateAlertSignals(snapshot: OfficeSnapshot, now = snapshot.generatedAt): AlertSignal[] {
  const results = [
    evaluateConsecutiveErrors(snapshot),
    evaluateLongActiveRuns(snapshot, now),
    evaluateCleanupPending(snapshot, now),
    evaluateEventStall(snapshot, now),
  ];
  return results.filter((value): value is AlertSignal => Boolean(value));
}

export function normalizeAlertRulePreferences(input: unknown): AlertRulePreferences {
  const next: AlertRulePreferences = {
    ...DEFAULT_ALERT_RULE_PREFERENCES,
  };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return next;
  }

  for (const ruleId of RULE_IDS) {
    const candidate = (input as Record<string, unknown>)[ruleId];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const muted = (candidate as Record<string, unknown>).muted;
    const snoozeUntil = (candidate as Record<string, unknown>).snoozeUntil;
    next[ruleId] = {
      muted: typeof muted === "boolean" ? muted : false,
      snoozeUntil: typeof snoozeUntil === "number" && Number.isFinite(snoozeUntil) ? snoozeUntil : 0,
    };
  }

  return next;
}

export function isAlertRuleSuppressed(
  preferences: AlertRulePreferences,
  ruleId: AlertRuleId,
  now: number,
): boolean {
  const preference = preferences[ruleId] ?? DEFAULT_ALERT_RULE_PREFERENCES[ruleId];
  return preference.muted || preference.snoozeUntil > now;
}
