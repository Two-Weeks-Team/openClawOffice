import { describe, expect, it } from "vitest";
import { createLocal50Scenario } from "./local50-scenario";
import {
  buildSummaryFilename,
  buildSummaryReport,
  renderSummaryMarkdown,
  serializeSummaryReportJson,
} from "./summary-exporter";

describe("summary exporter", () => {
  it("builds filtered summary report schema for downstream automation", () => {
    const { snapshot } = createLocal50Scenario({
      profile: "local10",
      seed: 14,
      seedTime: 1_700_000_000_000,
    });
    const targetRun = snapshot.runs[1] ?? snapshot.runs[0];

    const report = buildSummaryReport(snapshot, "daily", {
      window: "all",
      runId: targetRun?.runId,
      screenshotPaths: [" ./shots/latest.png ", "./shots/latest.png", "./shots/error.png"],
      runKnowledgeEntries: [
        {
          runId: targetRun?.runId ?? "run-fallback",
          note: "Investigated retry storm on child agent.",
          tags: ["incident", "retry"],
          updatedAt: snapshot.generatedAt - 60_000,
        },
      ],
    });

    expect(report.schemaVersion).toBe("1.0");
    expect(report.filters.window).toBe("all");
    expect(report.filters.runId).toBe(targetRun?.runId ?? null);
    expect(report.filters.screenshotPaths).toEqual([
      "./shots/latest.png",
      "./shots/error.png",
    ]);
    expect(report.runKnowledge[0]).toMatchObject({
      runId: targetRun?.runId,
      tags: ["incident", "retry"],
    });
    expect(report.kpis.startedRuns).toBeGreaterThanOrEqual(0);
    expect(report.recentEvents.every((event) => event.runId === (targetRun?.runId ?? event.runId))).toBe(true);
  });

  it("renders daily and incident markdown templates with required sections", () => {
    const { snapshot } = createLocal50Scenario({
      profile: "local10",
      seed: 22,
      seedTime: 1_700_000_050_000,
    });

    const daily = buildSummaryReport(snapshot, "daily", {
      window: "24h",
      screenshotPaths: ["./shots/daily.png"],
    });
    const incident = buildSummaryReport(snapshot, "incident", {
      window: "24h",
      screenshotPaths: ["./shots/incident.png"],
    });

    const dailyMd = renderSummaryMarkdown(daily);
    const incidentMd = renderSummaryMarkdown(incident);

    expect(dailyMd).toContain("# Daily Operations Summary");
    expect(dailyMd).toContain("## KPI Snapshot");
    expect(dailyMd).toContain("## Failed Runs");
    expect(dailyMd).toContain("## Run Notes");
    expect(dailyMd).toContain("./shots/daily.png");

    expect(incidentMd).toContain("# Incident Summary");
    expect(incidentMd).toContain("## Incident Context");
    expect(incidentMd).toContain("## Failure Timeline");
    expect(incidentMd).toContain("## Run Notes");
    expect(incidentMd).toContain("./shots/incident.png");
  });

  it("serializes json payload and deterministic filenames", () => {
    const { snapshot } = createLocal50Scenario({
      profile: "local10",
      seed: 37,
      seedTime: 1_700_000_100_000,
    });

    const report = buildSummaryReport(snapshot, "daily", {
      window: "5m",
    });

    const json = serializeSummaryReportJson(report);
    const filename = buildSummaryFilename(report, "json");

    expect(() => JSON.parse(json)).not.toThrow();
    expect(filename).toMatch(/^openclaw-daily-summary-[0-9-]+\.json$/);
  });

  it("escapes markdown-sensitive run notes and preserves multiline indentation", () => {
    const { snapshot } = createLocal50Scenario({
      profile: "local10",
      seed: 41,
      seedTime: 1_700_000_110_000,
    });
    const targetRun = snapshot.runs[1] ?? snapshot.runs[0];

    const report = buildSummaryReport(snapshot, "incident", {
      window: "all",
      runId: targetRun?.runId,
      runKnowledgeEntries: [
        {
          runId: targetRun?.runId ?? "run-fallback",
          note: "line one\nline two [link](javascript:alert(1))",
          tags: ["ops*tag"],
          updatedAt: snapshot.generatedAt - 30_000,
        },
      ],
    });

    const markdown = renderSummaryMarkdown(report);
    expect(markdown).toContain("\\[link\\]\\(javascript:alert\\(1\\)\\)");
    expect(markdown).toContain("#ops\\*tag");
    expect(markdown).toContain("line one\n    line two");
  });
});
