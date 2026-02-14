import type { OfficeRun, OfficeSnapshot } from "../types/office";

export type ThroughputWindow = "5m" | "1h" | "24h";

export type ThroughputWindowMetrics = {
  window: ThroughputWindow;
  startedRuns: number;
  completedRuns: number;
  completionRate: number | null;
  avgDurationMs: number | null;
  activeConcurrency: number;
  errorRatio: number | null;
  queueBacklog: number;
  queuePressureIndex: number | null;
  eventsInWindow: number;
  eventsPerMinute: number | null;
};

export type ThroughputSeriesBucket = {
  index: number;
  startAt: number;
  endAt: number;
  label: string;
  startedRuns: number;
  completedRuns: number;
  errorRuns: number;
  maxConcurrency: number;
};

export type ThroughputAgentMetrics = {
  agentId: string;
  startedRuns: number;
  completedRuns: number;
  activeRuns: number;
  completionRate: number | null;
  avgDurationMs: number | null;
  errorRatio: number | null;
  eventCount: number;
  latestRunAt: number;
};

export type ThroughputOutlier = {
  id: string;
  severity: "high" | "medium";
  title: string;
  detail: string;
  agentId?: string;
  runId?: string;
};

export type ThroughputHotspot = {
  agentId: string;
  startedRuns: number;
  completedRuns: number;
  activeRuns: number;
  queueBacklog: number;
  queuePressure: number;
  queuePressureIndex: number | null;
  latencyP90Ms: number | null;
  errorRatio: number | null;
  bottleneckScore: number;
  reasonHints: string[];
};

export type ThroughputWindowComparison = {
  window: ThroughputWindow;
  current: ThroughputWindowMetrics;
  previous: ThroughputWindowMetrics;
  completionRateDelta: number | null;
  avgDurationDeltaMs: number | null;
  errorRatioDelta: number | null;
  queuePressureDelta: number | null;
};

export const THROUGHPUT_WINDOWS: ThroughputWindow[] = ["5m", "1h", "24h"];

const WINDOW_MS: Record<ThroughputWindow, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

type RunStats = {
  run: OfficeRun;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  endForConcurrency: number;
};

type WindowBounds = {
  startAt: number;
  endAt: number;
};

type DashboardSelectionOptions = {
  now?: number;
  agentId?: string;
};

type ThroughputSeriesOptions = DashboardSelectionOptions & {
  bucketCount?: number;
};

function round(value: number, digits = 2): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function resolveBounds(window: ThroughputWindow, now: number): WindowBounds {
  return {
    startAt: now - WINDOW_MS[window],
    endAt: now,
  };
}

function resolvePreviousBounds(window: ThroughputWindow, now: number): WindowBounds {
  const current = resolveBounds(window, now);
  const span = current.endAt - current.startAt;
  return {
    startAt: current.startAt - span,
    endAt: current.startAt - 1,
  };
}

function startedAtOf(run: OfficeRun): number {
  return run.startedAt ?? run.createdAt;
}

function completedAtOf(run: OfficeRun): number | null {
  if (run.status === "active") {
    return null;
  }
  const completedAt = run.endedAt ?? run.cleanupCompletedAt;
  if (typeof completedAt !== "number") {
    return null;
  }
  return completedAt;
}

function endForConcurrencyOf(run: OfficeRun, now: number): number {
  if (run.status === "active") {
    return now;
  }
  return run.endedAt ?? run.cleanupCompletedAt ?? now;
}

function durationOf(startedAt: number, completedAt: number | null): number | null {
  if (completedAt === null) {
    return null;
  }
  if (completedAt < startedAt) {
    return null;
  }
  return completedAt - startedAt;
}

function runToStats(run: OfficeRun, now: number): RunStats {
  const startedAt = startedAtOf(run);
  const completedAt = completedAtOf(run);
  return {
    run,
    startedAt,
    completedAt,
    durationMs: durationOf(startedAt, completedAt),
    endForConcurrency: endForConcurrencyOf(run, now),
  };
}

function withinRange(value: number, bounds: WindowBounds): boolean {
  return value >= bounds.startAt && value <= bounds.endAt;
}

function intersectsRange(startAt: number, endAt: number, bounds: WindowBounds): boolean {
  return endAt >= bounds.startAt && startAt <= bounds.endAt;
}

function toTimeLabel(at: number, window: ThroughputWindow): string {
  const date = new Date(at);
  if (window === "5m") {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function percentile(values: number[], ratioValue: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const clamped = Math.min(1, Math.max(0, ratioValue));
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((sorted.length - 1) * clamped);
  return sorted[index] ?? sorted[sorted.length - 1] ?? null;
}

function peakConcurrency(runs: RunStats[], bounds: WindowBounds): number {
  if (runs.length === 0) {
    return 0;
  }

  const deltas = new Map<number, number>();
  for (const run of runs) {
    if (!intersectsRange(run.startedAt, run.endForConcurrency, bounds)) {
      continue;
    }
    const visibleStart = Math.max(run.startedAt, bounds.startAt);
    const visibleEnd = Math.min(run.endForConcurrency, bounds.endAt);
    if (visibleEnd < visibleStart) {
      continue;
    }

    deltas.set(visibleStart, (deltas.get(visibleStart) ?? 0) + 1);
    const releasePoint = visibleEnd + 1;
    deltas.set(releasePoint, (deltas.get(releasePoint) ?? 0) - 1);
  }

  let current = 0;
  let peak = 0;
  const points = [...deltas.entries()].sort((left, right) => left[0] - right[0]);
  for (const [, delta] of points) {
    current += delta;
    if (current > peak) {
      peak = current;
    }
  }
  return peak;
}

function selectRunStats(snapshot: OfficeSnapshot, options: DashboardSelectionOptions): RunStats[] {
  const now = options.now ?? snapshot.generatedAt;
  const agentId = options.agentId?.trim() || null;
  return snapshot.runs
    .filter((run) => (agentId ? run.childAgentId === agentId : true))
    .map((run) => runToStats(run, now));
}

function eventsInWindow(snapshot: OfficeSnapshot, bounds: WindowBounds, agentId?: string): number {
  const filterAgentId = agentId?.trim() || null;
  let total = 0;
  for (const event of snapshot.events) {
    if (!withinRange(event.at, bounds)) {
      continue;
    }
    if (filterAgentId && event.agentId !== filterAgentId && event.parentAgentId !== filterAgentId) {
      continue;
    }
    total += 1;
  }
  return total;
}

function buildWindowMetricsForBounds(
  snapshot: OfficeSnapshot,
  runStats: RunStats[],
  window: ThroughputWindow,
  bounds: WindowBounds,
  agentId?: string,
): ThroughputWindowMetrics {
  const startedInWindow = runStats.filter((item) => withinRange(item.startedAt, bounds));
  const completedInWindow = startedInWindow.filter((item) => item.completedAt !== null);
  const completedDurations = completedInWindow
    .map((item) => item.durationMs)
    .filter((value): value is number => typeof value === "number");
  const errorRuns = completedInWindow.filter((item) => item.run.status === "error").length;
  const activeConcurrency = peakConcurrency(runStats, bounds);
  const queueBacklog = Math.max(0, startedInWindow.length - completedInWindow.length);

  const eventCount = eventsInWindow(snapshot, bounds, agentId);
  const eventRate = ratio(eventCount, WINDOW_MS[window] / 60_000);
  const queuePressureIndex = ratio(
    activeConcurrency + queueBacklog,
    Math.max(1, startedInWindow.length),
  );

  return {
    window,
    startedRuns: startedInWindow.length,
    completedRuns: completedInWindow.length,
    completionRate: ratio(completedInWindow.length, startedInWindow.length),
    avgDurationMs:
      completedDurations.length === 0
        ? null
        : round(
            completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length,
            0,
          ),
    activeConcurrency,
    errorRatio: ratio(errorRuns, completedInWindow.length),
    queueBacklog,
    queuePressureIndex: queuePressureIndex === null ? null : round(queuePressureIndex),
    eventsInWindow: eventCount,
    eventsPerMinute: eventRate === null ? null : round(eventRate),
  };
}

export function buildThroughputWindowMetrics(
  snapshot: OfficeSnapshot,
  options: DashboardSelectionOptions = {},
): Record<ThroughputWindow, ThroughputWindowMetrics> {
  const now = options.now ?? snapshot.generatedAt;
  const runStats = selectRunStats(snapshot, options);

  return Object.fromEntries(
    THROUGHPUT_WINDOWS.map((window) => {
      const bounds = resolveBounds(window, now);
      const metrics = buildWindowMetricsForBounds(
        snapshot,
        runStats,
        window,
        bounds,
        options.agentId,
      );
      return [window, metrics] as const;
    }),
  ) as Record<ThroughputWindow, ThroughputWindowMetrics>;
}

export function buildThroughputWindowComparison(
  snapshot: OfficeSnapshot,
  window: ThroughputWindow,
  options: DashboardSelectionOptions = {},
): ThroughputWindowComparison {
  const now = options.now ?? snapshot.generatedAt;
  const runStats = selectRunStats(snapshot, options);
  const current = buildWindowMetricsForBounds(
    snapshot,
    runStats,
    window,
    resolveBounds(window, now),
    options.agentId,
  );
  const previous = buildWindowMetricsForBounds(
    snapshot,
    runStats,
    window,
    resolvePreviousBounds(window, now),
    options.agentId,
  );

  const completionRateDelta =
    current.completionRate === null || previous.completionRate === null
      ? null
      : round(current.completionRate - previous.completionRate, 3);
  const avgDurationDeltaMs =
    current.avgDurationMs === null || previous.avgDurationMs === null
      ? null
      : round(current.avgDurationMs - previous.avgDurationMs, 0);
  const errorRatioDelta =
    current.errorRatio === null || previous.errorRatio === null
      ? null
      : round(current.errorRatio - previous.errorRatio, 3);
  const queuePressureDelta =
    current.queuePressureIndex === null || previous.queuePressureIndex === null
      ? null
      : round(current.queuePressureIndex - previous.queuePressureIndex, 2);

  return {
    window,
    current,
    previous,
    completionRateDelta,
    avgDurationDeltaMs,
    errorRatioDelta,
    queuePressureDelta,
  };
}

export function buildThroughputSeries(
  snapshot: OfficeSnapshot,
  window: ThroughputWindow,
  options: ThroughputSeriesOptions = {},
): ThroughputSeriesBucket[] {
  const now = options.now ?? snapshot.generatedAt;
  const bucketCount = Math.max(4, Math.min(30, options.bucketCount ?? 12));
  const runStats = selectRunStats(snapshot, options);
  const bounds = resolveBounds(window, now);
  const span = Math.max(1, bounds.endAt - bounds.startAt);
  const step = Math.max(1, Math.floor(span / bucketCount));

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = bounds.startAt + index * step;
    const bucketEnd = index === bucketCount - 1 ? bounds.endAt : Math.min(bounds.endAt, bucketStart + step - 1);
    const bucketBounds: WindowBounds = { startAt: bucketStart, endAt: bucketEnd };

    const startedRuns = runStats.filter((item) => withinRange(item.startedAt, bucketBounds)).length;
    const completedRuns = runStats.filter(
      (item) => item.completedAt !== null && withinRange(item.completedAt, bucketBounds),
    );

    return {
      index,
      startAt: bucketStart,
      endAt: bucketEnd,
      label: toTimeLabel(bucketEnd, window),
      startedRuns,
      completedRuns: completedRuns.length,
      errorRuns: completedRuns.filter((item) => item.run.status === "error").length,
      maxConcurrency: peakConcurrency(runStats, bucketBounds),
    };
  });
}

export function buildAgentThroughputBreakdown(
  snapshot: OfficeSnapshot,
  window: ThroughputWindow,
  options: DashboardSelectionOptions = {},
): ThroughputAgentMetrics[] {
  const now = options.now ?? snapshot.generatedAt;
  const bounds = resolveBounds(window, now);
  const runStats = selectRunStats(snapshot, options);

  const statsByAgent = new Map<string, RunStats[]>();
  for (const item of runStats) {
    if (!withinRange(item.startedAt, bounds)) {
      continue;
    }
    const bucket = statsByAgent.get(item.run.childAgentId);
    if (bucket) {
      bucket.push(item);
    } else {
      statsByAgent.set(item.run.childAgentId, [item]);
    }
  }

  const eventsByAgent = new Map<string, number>();
  for (const event of snapshot.events) {
    if (!withinRange(event.at, bounds)) {
      continue;
    }
    eventsByAgent.set(event.agentId, (eventsByAgent.get(event.agentId) ?? 0) + 1);
  }

  return [...statsByAgent.entries()]
    .map(([agentId, items]) => {
      const completed = items.filter((item) => item.completedAt !== null);
      const durations = completed
        .map((item) => item.durationMs)
        .filter((value): value is number => typeof value === "number");
      const activeRuns = items.filter((item) => item.run.status === "active").length;
      const latestRunAt = items.reduce(
        (latest, item) => Math.max(latest, item.completedAt ?? item.startedAt),
        0,
      );

      return {
        agentId,
        startedRuns: items.length,
        completedRuns: completed.length,
        activeRuns,
        completionRate: ratio(completed.length, items.length),
        avgDurationMs:
          durations.length === 0
            ? null
            : round(durations.reduce((sum, value) => sum + value, 0) / durations.length, 0),
        errorRatio: ratio(
          completed.filter((item) => item.run.status === "error").length,
          completed.length,
        ),
        eventCount: eventsByAgent.get(agentId) ?? 0,
        latestRunAt,
      } satisfies ThroughputAgentMetrics;
    })
    .sort((left, right) => {
      if (left.startedRuns !== right.startedRuns) {
        return right.startedRuns - left.startedRuns;
      }
      if (left.activeRuns !== right.activeRuns) {
        return right.activeRuns - left.activeRuns;
      }
      const leftErrorRatio = left.errorRatio ?? -1;
      const rightErrorRatio = right.errorRatio ?? -1;
      if (leftErrorRatio !== rightErrorRatio) {
        return rightErrorRatio - leftErrorRatio;
      }
      if (left.latestRunAt !== right.latestRunAt) {
        return right.latestRunAt - left.latestRunAt;
      }
      return left.agentId.localeCompare(right.agentId);
    });
}

export function buildThroughputHotspots(
  snapshot: OfficeSnapshot,
  window: ThroughputWindow,
  options: DashboardSelectionOptions = {},
): ThroughputHotspot[] {
  const now = options.now ?? snapshot.generatedAt;
  const bounds = resolveBounds(window, now);
  const runStats = selectRunStats(snapshot, options).filter((item) =>
    withinRange(item.startedAt, bounds),
  );
  const statsByAgent = new Map<string, RunStats[]>();
  for (const item of runStats) {
    const bucket = statsByAgent.get(item.run.childAgentId);
    if (bucket) {
      bucket.push(item);
    } else {
      statsByAgent.set(item.run.childAgentId, [item]);
    }
  }

  if (statsByAgent.size === 0) {
    return [];
  }

  const candidateRows = [...statsByAgent.entries()].map(([agentId, items]) => {
    const completed = items.filter((item) => item.completedAt !== null);
    const durations = completed
      .map((item) => item.durationMs)
      .filter((value): value is number => typeof value === "number");
    const activeRuns = items.filter((item) => item.run.status === "active").length;
    const queueBacklog = Math.max(0, items.length - completed.length);
    const queuePressure = queueBacklog + activeRuns;
    const queuePressureIndex = ratio(queuePressure, Math.max(1, items.length));
    const completionRate = ratio(completed.length, items.length);
    const errorRatio = ratio(
      completed.filter((item) => item.run.status === "error").length,
      completed.length,
    );
    const latencyP90Ms = percentile(durations, 0.9);

    return {
      agentId,
      startedRuns: items.length,
      completedRuns: completed.length,
      activeRuns,
      queueBacklog,
      queuePressure,
      queuePressureIndex,
      completionRate,
      errorRatio,
      latencyP90Ms,
    };
  });

  const maxLatencyP90 = Math.max(
    1,
    ...candidateRows.map((row) => (row.latencyP90Ms === null ? 0 : row.latencyP90Ms)),
  );
  const maxQueuePressure = Math.max(1, ...candidateRows.map((row) => row.queuePressure));

  return candidateRows
    .map((row) => {
      const latencyScore =
        row.latencyP90Ms === null ? 0 : round(row.latencyP90Ms / maxLatencyP90, 3);
      const errorScore = row.errorRatio ?? 0;
      const queueScore = round(row.queuePressure / maxQueuePressure, 3);
      const bottleneckScore = round(
        latencyScore * 0.42 + errorScore * 0.34 + queueScore * 0.24,
        3,
      );

      const reasonHints: string[] = [];
      if (latencyScore >= 0.75 && (row.latencyP90Ms ?? 0) >= 30_000) {
        reasonHints.push("latency hotspot");
      }
      if (errorScore >= 0.35) {
        reasonHints.push("error-heavy");
      }
      if (row.queuePressure >= 2 || (row.queuePressureIndex ?? 0) >= 0.9) {
        reasonHints.push("queue pressure");
      }
      if ((row.completionRate ?? 1) < 0.5 && row.startedRuns >= 3) {
        reasonHints.push("completion drop");
      }
      if (reasonHints.length === 0) {
        reasonHints.push("observe trend");
      }

      return {
        agentId: row.agentId,
        startedRuns: row.startedRuns,
        completedRuns: row.completedRuns,
        activeRuns: row.activeRuns,
        queueBacklog: row.queueBacklog,
        queuePressure: row.queuePressure,
        queuePressureIndex:
          row.queuePressureIndex === null ? null : round(row.queuePressureIndex, 2),
        latencyP90Ms: row.latencyP90Ms === null ? null : round(row.latencyP90Ms, 0),
        errorRatio: row.errorRatio === null ? null : round(row.errorRatio, 2),
        bottleneckScore,
        reasonHints,
      } satisfies ThroughputHotspot;
    })
    .sort((left, right) => {
      if (left.bottleneckScore !== right.bottleneckScore) {
        return right.bottleneckScore - left.bottleneckScore;
      }
      if (left.queuePressure !== right.queuePressure) {
        return right.queuePressure - left.queuePressure;
      }
      if (left.startedRuns !== right.startedRuns) {
        return right.startedRuns - left.startedRuns;
      }
      return left.agentId.localeCompare(right.agentId);
    });
}

export function buildThroughputOutliers(
  snapshot: OfficeSnapshot,
  window: ThroughputWindow,
  options: DashboardSelectionOptions = {},
): ThroughputOutlier[] {
  const now = options.now ?? snapshot.generatedAt;
  const bounds = resolveBounds(window, now);
  const runStats = selectRunStats(snapshot, options)
    .filter((item) => withinRange(item.startedAt, bounds))
    .filter((item) => item.completedAt !== null && item.durationMs !== null);

  const outliers: ThroughputOutlier[] = [];
  const durations = runStats
    .map((item) => item.durationMs)
    .filter((value): value is number => typeof value === "number");
  const slowThreshold = percentile(durations, 0.9);

  if (slowThreshold !== null && durations.length >= 3) {
    const slowRuns = runStats
      .filter((item) => (item.durationMs ?? 0) >= slowThreshold)
      .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
      .slice(0, 3);

    for (const item of slowRuns) {
      outliers.push({
        id: `slow:${item.run.runId}`,
        severity: "high",
        title: `Slow run ${item.run.runId}`,
        detail: `${item.run.childAgentId} took ${Math.round((item.durationMs ?? 0) / 1000)}s`,
        agentId: item.run.childAgentId,
        runId: item.run.runId,
      });
    }
  }

  const agentBreakdown = buildAgentThroughputBreakdown(snapshot, window, options);
  for (const agent of agentBreakdown) {
    const queueBacklog = Math.max(0, agent.startedRuns - agent.completedRuns);
    if (agent.completedRuns >= 2 && (agent.errorRatio ?? 0) >= 0.5) {
      outliers.push({
        id: `error:${agent.agentId}`,
        severity: "high",
        title: `Error hotspot ${agent.agentId}`,
        detail: `${Math.round((agent.errorRatio ?? 0) * 100)}% of completed runs failed`,
        agentId: agent.agentId,
      });
    }
    if ((queueBacklog >= 2 || agent.activeRuns >= 2) && (agent.completionRate ?? 1) < 0.8) {
      outliers.push({
        id: `queue:${agent.agentId}`,
        severity: queueBacklog >= 3 ? "high" : "medium",
        title: `Queue pressure ${agent.agentId}`,
        detail: `backlog ${queueBacklog}, active ${agent.activeRuns}, completion ${agent.completedRuns}/${agent.startedRuns}`,
        agentId: agent.agentId,
      });
    }
    if (agent.startedRuns >= 3 && (agent.completionRate ?? 1) < 0.5) {
      outliers.push({
        id: `completion:${agent.agentId}`,
        severity: "medium",
        title: `Low completion ${agent.agentId}`,
        detail: `${agent.completedRuns}/${agent.startedRuns} runs completed in this window`,
        agentId: agent.agentId,
      });
    }
  }

  return outliers
    .slice(0, 6)
    .sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity === "high" ? -1 : 1;
      }
      return left.title.localeCompare(right.title);
    });
}
