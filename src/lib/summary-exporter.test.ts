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
    const targetRun = snapshot.runs[0];

    const report = buildSummaryReport(snapshot, "daily", {
      window: "1h",
      runId: targetRun?.runId,
      screenshotPaths: [" ./shots/latest.png ", "./shots/latest.png", "./shots/error.png"],
    });

    expect(report.schemaVersion).toBe("1.0");
    expect(report.filters.window).toBe("1h");
    expect(report.filters.runId).toBe(targetRun?.runId ?? null);
    expect(report.filters.screenshotPaths).toEqual([
      "./shots/latest.png",
      "./shots/error.png",
    ]);
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
    expect(dailyMd).toContain("./shots/daily.png");

    expect(incidentMd).toContain("# Incident Summary");
    expect(incidentMd).toContain("## Incident Context");
    expect(incidentMd).toContain("## Failure Timeline");
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
});
