import type { OfficeEvent, OfficeRun, OfficeSnapshot } from "../types/office";
import { formatDatetime, formatDuration, formatPercent } from "./format";
import { indexRunKnowledgeByRunId, type RunKnowledgeEntry } from "./run-notes-store";

export type SummaryTemplate = "daily" | "incident";
export type SummaryWindow = "5m" | "1h" | "24h" | "all";

export type SummaryExportFilters = {
  window: SummaryWindow;
  agentId?: string;
  runId?: string;
  screenshotPaths?: string[];
  runKnowledgeEntries?: RunKnowledgeEntry[];
};

export type SummaryKpis = {
  startedRuns: number;
  completedRuns: number;
  failedRuns: number;
  completionRate: number | null;
  avgDurationMs: number | null;
  errorRatio: number | null;
  activeConcurrency: number;
  eventCount: number;
};

export type SummaryTopAgent = {
  agentId: string;
  startedRuns: number;
  completedRuns: number;
  failedRuns: number;
  activeRuns: number;
  avgDurationMs: number | null;
};

export type SummaryFailedRun = {
  runId: string;
  childAgentId: string;
  parentAgentId: string;
  task: string;
  durationMs: number | null;
  endedAt: number | null;
};

export type SummaryEventRecord = {
  id: string;
  type: OfficeEvent["type"];
  runId: string;
  agentId: string;
  at: number;
  text: string;
};

export type SummaryRunKnowledgeRecord = {
  runId: string;
  note: string;
  tags: string[];
  updatedAt: number;
};

export type SummaryReport = {
  schemaVersion: "1.0";
  template: SummaryTemplate;
  generatedAt: number;
  generatedAtIso: string;
  filters: {
    window: SummaryWindow;
    fromAt: number | null;
    toAt: number;
    agentId: string | null;
    runId: string | null;
    screenshotPaths: string[];
  };
  kpis: SummaryKpis;
  highlights: string[];
  topAgents: SummaryTopAgent[];
  failedRuns: SummaryFailedRun[];
  recentEvents: SummaryEventRecord[];
  runKnowledge: SummaryRunKnowledgeRecord[];
  screenshots: string[];
};

const WINDOW_MS: Record<Exclude<SummaryWindow, "all">, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

function round(value: number, digits = 2): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function normalizeFilterValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeScreenshotPaths(paths: string[] | undefined): string[] {
  if (!paths) {
    return [];
  }
  const unique = new Set<string>();
  for (const path of paths) {
    const normalized = path.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

function normalizeRunKnowledgeEntries(
  entries: RunKnowledgeEntry[] | undefined,
): Map<string, SummaryRunKnowledgeRecord> {
  if (!entries || entries.length === 0) {
    return new Map();
  }
  const indexed = indexRunKnowledgeByRunId(entries);
  const byRunId = new Map<string, SummaryRunKnowledgeRecord>();
  for (const entry of indexed.values()) {
    const runId = entry.runId.trim();
    if (!runId) {
      continue;
    }
    const note = entry.note.trim();
    const tags = [...new Set(entry.tags.map((tag) => tag.trim()).filter((tag) => Boolean(tag)))];
    if (!note && tags.length === 0) {
      continue;
    }
    const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
    if (updatedAt <= 0) {
      continue;
    }
    const normalized: SummaryRunKnowledgeRecord = {
      runId,
      note,
      tags,
      updatedAt,
    };
    byRunId.set(runId, normalized);
  }
  return byRunId;
}

function runStartedAt(run: OfficeRun): number {
  return run.startedAt ?? run.createdAt;
}

function runCompletedAt(run: OfficeRun): number | null {
  if (run.status === "active") {
    return null;
  }
  return run.endedAt ?? run.cleanupCompletedAt ?? null;
}

function runDurationMs(run: OfficeRun): number | null {
  const startedAt = runStartedAt(run);
  const completedAt = runCompletedAt(run);
  if (completedAt === null) {
    return null;
  }
  return Math.max(0, completedAt - startedAt);
}

function resolveBounds(snapshot: OfficeSnapshot, window: SummaryWindow): {
  fromAt: number | null;
  toAt: number;
} {
  const toAt = snapshot.generatedAt;
  if (window === "all") {
    return {
      fromAt: null,
      toAt,
    };
  }
  return {
    fromAt: toAt - WINDOW_MS[window],
    toAt,
  };
}

function matchesTime(at: number, bounds: { fromAt: number | null; toAt: number }): boolean {
  if (at > bounds.toAt) {
    return false;
  }
  if (bounds.fromAt === null) {
    return true;
  }
  return at >= bounds.fromAt;
}

function filterRuns(
  snapshot: OfficeSnapshot,
  bounds: { fromAt: number | null; toAt: number },
  agentId: string | null,
  runId: string | null,
): OfficeRun[] {
  return snapshot.runs.filter((run) => {
    if (!matchesTime(runStartedAt(run), bounds)) {
      return false;
    }
    if (runId && run.runId !== runId) {
      return false;
    }
    if (agentId && run.childAgentId !== agentId && run.parentAgentId !== agentId) {
      return false;
    }
    return true;
  });
}

function filterEvents(
  snapshot: OfficeSnapshot,
  bounds: { fromAt: number | null; toAt: number },
  agentId: string | null,
  runId: string | null,
): OfficeEvent[] {
  return snapshot.events.filter((event) => {
    if (!matchesTime(event.at, bounds)) {
      return false;
    }
    if (runId && event.runId !== runId) {
      return false;
    }
    if (agentId && event.agentId !== agentId && event.parentAgentId !== agentId) {
      return false;
    }
    return true;
  });
}

function peakConcurrency(
  runs: OfficeRun[],
  bounds: { fromAt: number | null; toAt: number },
): number {
  if (runs.length === 0) {
    return 0;
  }
  const fromAt = bounds.fromAt ?? Number.NEGATIVE_INFINITY;
  const toAt = bounds.toAt;
  const deltas = new Map<number, number>();

  for (const run of runs) {
    const startAt = runStartedAt(run);
    const endAt = runCompletedAt(run) ?? toAt;
    if (endAt < fromAt || startAt > toAt) {
      continue;
    }
    const visibleStart = Math.max(startAt, fromAt);
    const visibleEnd = Math.min(endAt, toAt);

    deltas.set(visibleStart, (deltas.get(visibleStart) ?? 0) + 1);
    deltas.set(visibleEnd + 1, (deltas.get(visibleEnd + 1) ?? 0) - 1);
  }

  let current = 0;
  let peak = 0;
  const sorted = [...deltas.entries()].sort((left, right) => left[0] - right[0]);
  for (const [, delta] of sorted) {
    current += delta;
    if (current > peak) {
      peak = current;
    }
  }
  return peak;
}

function buildHighlights(kpis: SummaryKpis, failedRuns: SummaryFailedRun[]): string[] {
  const highlights: string[] = [];

  if (kpis.startedRuns === 0) {
    highlights.push("No runs matched the selected filter scope.");
    return highlights;
  }

  if (kpis.completionRate !== null && kpis.completionRate < 0.75) {
    highlights.push(`Completion rate dropped to ${Math.round(kpis.completionRate * 100)}%.`);
  }
  if (kpis.errorRatio !== null && kpis.errorRatio >= 0.25) {
    highlights.push(`Error ratio is elevated at ${Math.round(kpis.errorRatio * 100)}%.`);
  }
  if (kpis.avgDurationMs !== null && kpis.avgDurationMs >= 180_000) {
    highlights.push(`Average run duration reached ${(kpis.avgDurationMs / 1000).toFixed(1)}s.`);
  }
  if (kpis.activeConcurrency >= 10) {
    highlights.push(`High concurrency observed (peak ${kpis.activeConcurrency}).`);
  }
  if (failedRuns.length > 0) {
    highlights.push(`${failedRuns.length} failed runs captured in this report.`);
  }
  if (highlights.length === 0) {
    highlights.push("System stayed within normal range for the selected period.");
  }
  return highlights;
}


export function buildSummaryReport(
  snapshot: OfficeSnapshot,
  template: SummaryTemplate,
  filters: SummaryExportFilters,
): SummaryReport {
  const bounds = resolveBounds(snapshot, filters.window);
  const normalizedAgentId = normalizeFilterValue(filters.agentId);
  const normalizedRunId = normalizeFilterValue(filters.runId);
  const screenshots = normalizeScreenshotPaths(filters.screenshotPaths);
  const runKnowledgeByRunId = normalizeRunKnowledgeEntries(filters.runKnowledgeEntries);

  const runs = filterRuns(snapshot, bounds, normalizedAgentId, normalizedRunId);
  const events = filterEvents(snapshot, bounds, normalizedAgentId, normalizedRunId).sort(
    (left, right) => right.at - left.at,
  );

  const completedRuns = runs.filter((run) => runCompletedAt(run) !== null);
  const failedRuns = completedRuns
    .filter((run) => run.status === "error")
    .map((run) => ({
      runId: run.runId,
      childAgentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      task: run.task,
      durationMs: runDurationMs(run),
      endedAt: runCompletedAt(run),
    }))
    .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0));

  const completedDurations = completedRuns
    .map((run) => runDurationMs(run))
    .filter((value): value is number => typeof value === "number");

  const kpis: SummaryKpis = {
    startedRuns: runs.length,
    completedRuns: completedRuns.length,
    failedRuns: failedRuns.length,
    completionRate: ratio(completedRuns.length, runs.length),
    avgDurationMs:
      completedDurations.length === 0
        ? null
        : round(
            completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length,
            0,
          ),
    errorRatio: ratio(failedRuns.length, completedRuns.length),
    activeConcurrency: peakConcurrency(runs, bounds),
    eventCount: events.length,
  };

  const topAgents = [...runs
    .reduce((map, run) => {
      const bucket = map.get(run.childAgentId) ?? {
        agentId: run.childAgentId,
        startedRuns: 0,
        completedRuns: 0,
        failedRuns: 0,
        activeRuns: 0,
        durations: [] as number[],
      };
      bucket.startedRuns += 1;
      if (run.status === "active") {
        bucket.activeRuns += 1;
      }
      const duration = runDurationMs(run);
      if (duration !== null) {
        bucket.completedRuns += 1;
        bucket.durations.push(duration);
      }
      if (run.status === "error") {
        bucket.failedRuns += 1;
      }
      map.set(run.childAgentId, bucket);
      return map;
    }, new Map<string, {
      agentId: string;
      startedRuns: number;
      completedRuns: number;
      failedRuns: number;
      activeRuns: number;
      durations: number[];
    }>())
    .values()]
    .map((entry) => ({
      agentId: entry.agentId,
      startedRuns: entry.startedRuns,
      completedRuns: entry.completedRuns,
      failedRuns: entry.failedRuns,
      activeRuns: entry.activeRuns,
      avgDurationMs:
        entry.durations.length === 0
          ? null
          : round(entry.durations.reduce((sum, value) => sum + value, 0) / entry.durations.length, 0),
    }))
    .sort((left, right) => {
      if (left.startedRuns !== right.startedRuns) {
        return right.startedRuns - left.startedRuns;
      }
      if (left.failedRuns !== right.failedRuns) {
        return right.failedRuns - left.failedRuns;
      }
      return left.agentId.localeCompare(right.agentId);
    })
    .slice(0, 6);

  const recentEvents: SummaryEventRecord[] = events.slice(0, 14).map((event) => ({
    id: event.id,
    type: event.type,
    runId: event.runId,
    agentId: event.agentId,
    at: event.at,
    text: event.text,
  }));
  const runKnowledge = runs
    .map((run) => runKnowledgeByRunId.get(run.runId))
    .filter((entry): entry is SummaryRunKnowledgeRecord => Boolean(entry))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 20);

  return {
    schemaVersion: "1.0",
    template,
    generatedAt: snapshot.generatedAt,
    generatedAtIso: new Date(snapshot.generatedAt).toISOString(),
    filters: {
      window: filters.window,
      fromAt: bounds.fromAt,
      toAt: bounds.toAt,
      agentId: normalizedAgentId,
      runId: normalizedRunId,
      screenshotPaths: screenshots,
    },
    kpis,
    highlights: buildHighlights(kpis, failedRuns),
    topAgents,
    failedRuns: failedRuns.slice(0, 12),
    recentEvents,
    runKnowledge,
    screenshots,
  };
}

function renderKpiTable(kpis: SummaryKpis): string {
  return [
    "| KPI | Value |",
    "| --- | --- |",
    `| Started runs | ${kpis.startedRuns} |`,
    `| Completed runs | ${kpis.completedRuns} |`,
    `| Failed runs | ${kpis.failedRuns} |`,
    `| Completion rate | ${formatPercent(kpis.completionRate)} |`,
    `| Error ratio | ${formatPercent(kpis.errorRatio)} |`,
    `| Avg duration | ${formatDuration(kpis.avgDurationMs)} |`,
    `| Peak concurrency | ${kpis.activeConcurrency} |`,
    `| Event count | ${kpis.eventCount} |`,
  ].join("\n");
}

function renderTopAgents(topAgents: SummaryTopAgent[]): string {
  if (topAgents.length === 0) {
    return "No agent-level activity in this scope.";
  }
  const lines = [
    "| Agent | Started | Completed | Failed | Active | Avg Duration |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const agent of topAgents) {
    lines.push(
      `| ${agent.agentId} | ${agent.startedRuns} | ${agent.completedRuns} | ${agent.failedRuns} | ${agent.activeRuns} | ${formatDuration(agent.avgDurationMs)} |`,
    );
  }
  return lines.join("\n");
}

function renderFailedRuns(failedRuns: SummaryFailedRun[]): string {
  if (failedRuns.length === 0) {
    return "No failed runs in this scope.";
  }
  return failedRuns
    .map(
      (run) =>
        `- \`${run.runId}\` (${run.childAgentId}) at ${formatDatetime(run.endedAt)} | duration ${formatDuration(run.durationMs)} | ${run.task}`,
    )
    .join("\n");
}

function renderRecentEvents(events: SummaryEventRecord[]): string {
  if (events.length === 0) {
    return "No events in this scope.";
  }
  return events
    .map(
      (event) =>
        `- ${new Date(event.at).toLocaleTimeString()} [${event.type}] \`${event.runId}\` ${event.agentId} - ${event.text}`,
    )
    .join("\n");
}

function renderScreenshotSection(screenshots: string[]): string {
  if (screenshots.length === 0) {
    return "- (none provided)";
  }
  return screenshots.map((path) => `- [${path}](${path})`).join("\n");
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_{}()[\]#+.!|>~-])/g, "\\$1");
}

function renderRunKnowledge(records: SummaryRunKnowledgeRecord[]): string {
  if (records.length === 0) {
    return "No saved run notes for this scope.";
  }
  return records
    .map((record) => {
      const tagText =
        record.tags.length > 0
          ? record.tags.map((tag) => `#${escapeMarkdownText(tag)}`).join(" ")
          : "(no tags)";
      const noteLines = escapeMarkdownText(record.note || "(no note)")
        .split(/\r?\n/)
        .map((line, index) => (index === 0 ? line : `    ${line}`))
        .join("\n");
      return `- ${escapeMarkdownText(record.runId)} | ${tagText} | updated ${escapeMarkdownText(formatDatetime(record.updatedAt))}\n  - ${noteLines}`;
    })
    .join("\n");
}

export function renderSummaryMarkdown(report: SummaryReport): string {
  const header =
    report.template === "incident" ? "Incident Summary" : "Daily Operations Summary";
  const scopeLines = [
    `- Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    `- Window: ${report.filters.window}`,
    `- Agent filter: ${report.filters.agentId ?? "all"}`,
    `- Run filter: ${report.filters.runId ?? "all"}`,
  ];

  const incidentIntro =
    report.template === "incident"
      ? [
          "## Incident Context",
          report.highlights.map((line) => `- ${line}`).join("\n"),
          "",
          "## Impact Metrics",
          renderKpiTable(report.kpis),
        ]
      : [
          "## KPI Snapshot",
          renderKpiTable(report.kpis),
          "",
          "## Highlights",
          report.highlights.map((line) => `- ${line}`).join("\n"),
        ];

  const sections = [
    `# ${header}`,
    "",
    "## Scope",
    scopeLines.join("\n"),
    "",
    ...incidentIntro,
    "",
    "## Top Agents",
    renderTopAgents(report.topAgents),
    "",
    report.template === "incident" ? "## Failure Timeline" : "## Failed Runs",
    renderFailedRuns(report.failedRuns),
    "",
    report.template === "incident" ? "## Timeline Evidence" : "## Recent Events",
    renderRecentEvents(report.recentEvents),
    "",
    "## Run Notes",
    renderRunKnowledge(report.runKnowledge),
    "",
    "## Screenshot Links",
    renderScreenshotSection(report.screenshots),
  ];

  return sections.join("\n").trimEnd();
}

export function serializeSummaryReportJson(report: SummaryReport): string {
  return JSON.stringify(report, null, 2);
}

export function buildSummaryFilename(
  report: SummaryReport,
  format: "md" | "json",
): string {
  const stamp = new Date(report.generatedAt)
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\..+$/, "")
    .replace("T", "-");
  return `openclaw-${report.template}-summary-${stamp}.${format}`;
}

export function downloadTextArtifact(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
