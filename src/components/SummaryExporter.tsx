import { useMemo, useState } from "react";
import {
  buildSummaryFilename,
  buildSummaryReport,
  downloadTextArtifact,
  renderSummaryMarkdown,
  serializeSummaryReportJson,
  type SummaryTemplate,
  type SummaryWindow,
} from "../lib/summary-exporter";
import type { OfficeSnapshot } from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
  defaultAgentId?: string | null;
  defaultRunId?: string | null;
  onNotify?: (kind: "success" | "error" | "info", message: string) => void;
};

const TEMPLATE_OPTIONS: Array<{ value: SummaryTemplate; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "incident", label: "Incident" },
];

const WINDOW_OPTIONS: Array<{ value: SummaryWindow; label: string }> = [
  { value: "5m", label: "5m" },
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "all", label: "All" },
];

function parseScreenshotPaths(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function SummaryExporter({
  snapshot,
  defaultAgentId = null,
  defaultRunId = null,
  onNotify,
}: Props) {
  const [template, setTemplate] = useState<SummaryTemplate>("daily");
  const [windowScope, setWindowScope] = useState<SummaryWindow>("1h");
  const [agentId, setAgentId] = useState(defaultAgentId ?? "");
  const [runId, setRunId] = useState(defaultRunId ?? "");
  const [screenshotsInput, setScreenshotsInput] = useState("");

  const runOptions = useMemo(
    () => [...snapshot.runs].map((run) => run.runId).sort((left, right) => left.localeCompare(right)),
    [snapshot.runs],
  );

  const agentOptions = useMemo(
    () =>
      [...new Set(snapshot.entities.filter((entity) => entity.kind === "agent").map((entity) => entity.agentId))]
        .sort((left, right) => left.localeCompare(right)),
    [snapshot.entities],
  );

  const emitNotify = (kind: "success" | "error" | "info", message: string) => {
    onNotify?.(kind, message);
  };

  const exportReport = (format: "md" | "json" | "both") => {
    try {
      const report = buildSummaryReport(snapshot, template, {
        window: windowScope,
        agentId,
        runId,
        screenshotPaths: parseScreenshotPaths(screenshotsInput),
      });

      if (format === "md" || format === "both") {
        const markdown = renderSummaryMarkdown(report);
        downloadTextArtifact(
          buildSummaryFilename(report, "md"),
          markdown,
          "text/markdown;charset=utf-8",
        );
      }
      if (format === "json" || format === "both") {
        const json = serializeSummaryReportJson(report);
        downloadTextArtifact(
          buildSummaryFilename(report, "json"),
          json,
          "application/json;charset=utf-8",
        );
      }

      emitNotify("success", `Exported ${template} summary (${format.toUpperCase()}).`);
    } catch (errorValue) {
      console.error("Summary export failed", errorValue);
      emitNotify("error", "Failed to export summary report.");
    }
  };

  return (
    <section className="summary-exporter" aria-label="Summary exporter">
      <label className="summary-exporter-field">
        Template
        <select
          value={template}
          onChange={(event) => {
            setTemplate(event.target.value as SummaryTemplate);
          }}
        >
          {TEMPLATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="summary-exporter-field">
        Window
        <select
          value={windowScope}
          onChange={(event) => {
            setWindowScope(event.target.value as SummaryWindow);
          }}
        >
          {WINDOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="summary-exporter-field">
        Agent
        <input
          type="text"
          list="summary-export-agent-options"
          placeholder="all agents"
          value={agentId}
          onChange={(event) => {
            setAgentId(event.target.value);
          }}
        />
        <datalist id="summary-export-agent-options">
          {agentOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>

      <label className="summary-exporter-field">
        Run
        <input
          type="text"
          list="summary-export-run-options"
          placeholder="all runs"
          value={runId}
          onChange={(event) => {
            setRunId(event.target.value);
          }}
        />
        <datalist id="summary-export-run-options">
          {runOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>

      <label className="summary-exporter-field summary-exporter-shots">
        Screenshot Paths (comma)
        <input
          type="text"
          placeholder="./shots/latest.png, ./shots/failure.png"
          value={screenshotsInput}
          onChange={(event) => {
            setScreenshotsInput(event.target.value);
          }}
        />
      </label>

      <div className="summary-exporter-actions">
        <button
          type="button"
          onClick={() => {
            exportReport("md");
          }}
        >
          Export MD
        </button>
        <button
          type="button"
          onClick={() => {
            exportReport("json");
          }}
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => {
            exportReport("both");
          }}
        >
          Export Both
        </button>
      </div>
    </section>
  );
}
