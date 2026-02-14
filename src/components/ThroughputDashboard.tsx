import { useMemo, useState } from "react";
import {
  THROUGHPUT_WINDOWS,
  buildAgentThroughputBreakdown,
  buildThroughputOutliers,
  buildThroughputSeries,
  buildThroughputWindowMetrics,
  type ThroughputWindow,
} from "../lib/throughput-dashboard";
import type { OfficeSnapshot } from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
};

const WINDOW_LABELS: Record<ThroughputWindow, string> = {
  "5m": "5m",
  "1h": "1h",
  "24h": "24h",
};

function formatPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "-";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${(value / 60_000).toFixed(1)}m`;
}

function ratioToPercentHeight(value: number, max: number): string {
  if (value <= 0) {
    return "0%";
  }
  if (max <= 0) {
    return "0%";
  }
  return `${Math.max(6, Math.round((value / max) * 100))}%`;
}

export function ThroughputDashboard({ snapshot }: Props) {
  const [selectedWindow, setSelectedWindow] = useState<ThroughputWindow>("1h");
  const [drillAgentId, setDrillAgentId] = useState<string | null>(null);

  const agentBreakdown = useMemo(
    () => buildAgentThroughputBreakdown(snapshot, selectedWindow),
    [selectedWindow, snapshot],
  );

  const effectiveDrillAgentId =
    drillAgentId && agentBreakdown.some((agent) => agent.agentId === drillAgentId)
      ? drillAgentId
      : null;

  const windowMetrics = useMemo(
    () =>
      buildThroughputWindowMetrics(snapshot, {
        now: snapshot.generatedAt,
        agentId: effectiveDrillAgentId ?? undefined,
      }),
    [effectiveDrillAgentId, snapshot],
  );

  const selectedMetrics = windowMetrics[selectedWindow];

  const series = useMemo(
    () =>
      buildThroughputSeries(snapshot, selectedWindow, {
        now: snapshot.generatedAt,
        agentId: effectiveDrillAgentId ?? undefined,
      }),
    [effectiveDrillAgentId, selectedWindow, snapshot],
  );

  const outliers = useMemo(
    () =>
      buildThroughputOutliers(snapshot, selectedWindow, {
        now: snapshot.generatedAt,
        agentId: effectiveDrillAgentId ?? undefined,
      }),
    [effectiveDrillAgentId, selectedWindow, snapshot],
  );

  const maxRunCount = Math.max(
    1,
    ...series.map((bucket) => Math.max(bucket.startedRuns, bucket.completedRuns, bucket.errorRuns)),
  );
  const maxConcurrency = Math.max(1, ...series.map((bucket) => bucket.maxConcurrency));

  return (
    <section className="throughput-dashboard" aria-label="Throughput dashboard">
      <header className="throughput-header">
        <div>
          <h2>Throughput Dashboard</h2>
          <p>
            Compare 5m/1h/24h KPIs, drill into agent metrics, and surface latency/error hotspots.
          </p>
        </div>

        <div className="throughput-controls" role="tablist" aria-label="Throughput windows">
          {THROUGHPUT_WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              role="tab"
              aria-selected={window === selectedWindow}
              className={`throughput-window-toggle${window === selectedWindow ? " is-active" : ""}`}
              onClick={() => {
                setSelectedWindow(window);
              }}
            >
              {WINDOW_LABELS[window]}
            </button>
          ))}
        </div>
      </header>

      <div className="throughput-window-grid">
        {THROUGHPUT_WINDOWS.map((window) => {
          const metrics = windowMetrics[window];
          return (
            <article
              key={window}
              className={`throughput-window-card${window === selectedWindow ? " is-selected" : ""}`}
            >
              <strong>{WINDOW_LABELS[window]}</strong>
              <span>completion {formatPercent(metrics.completionRate)}</span>
              <span>avg {formatDuration(metrics.avgDurationMs)}</span>
              <span>concurrency {metrics.activeConcurrency}</span>
              <span>error {formatPercent(metrics.errorRatio)}</span>
            </article>
          );
        })}
      </div>

      <div className="throughput-kpi-grid">
        <article className="throughput-kpi-card">
          <span>Run Completion Rate</span>
          <strong>{formatPercent(selectedMetrics.completionRate)}</strong>
          <small>
            {selectedMetrics.completedRuns}/{selectedMetrics.startedRuns} runs completed
          </small>
        </article>
        <article className="throughput-kpi-card">
          <span>Avg Duration</span>
          <strong>{formatDuration(selectedMetrics.avgDurationMs)}</strong>
          <small>{selectedWindow} window average</small>
        </article>
        <article className="throughput-kpi-card">
          <span>Active Concurrency</span>
          <strong>{selectedMetrics.activeConcurrency}</strong>
          <small>peak concurrent runs in window</small>
        </article>
        <article className="throughput-kpi-card">
          <span>Error Ratio</span>
          <strong>{formatPercent(selectedMetrics.errorRatio)}</strong>
          <small>{selectedMetrics.eventsInWindow} events observed</small>
        </article>
      </div>

      <div className="throughput-main-grid">
        <section className="throughput-chart-panel">
          <header>
            <h3>
              Window Trend {effectiveDrillAgentId ? `(agent: ${effectiveDrillAgentId})` : "(all agents)"}
            </h3>
            <p>Started/completed/error buckets with concurrency heat.</p>
          </header>

          <div className="throughput-chart-legend">
            <span className="started">Started</span>
            <span className="completed">Completed</span>
            <span className="error">Error</span>
            <span className="concurrency">Concurrency</span>
          </div>

          <div className="throughput-chart-grid" role="img" aria-label="Throughput bucket chart">
            {series.map((bucket) => {
              const startedHeight = ratioToPercentHeight(bucket.startedRuns, maxRunCount);
              const completedHeight = ratioToPercentHeight(bucket.completedRuns, maxRunCount);
              const errorHeight = ratioToPercentHeight(bucket.errorRuns, maxRunCount);
              const concurrencyOpacity = 0.16 + (bucket.maxConcurrency / maxConcurrency) * 0.72;
              return (
                <article key={bucket.index} className="throughput-chart-bucket">
                  <span className="throughput-concurrency-strip" style={{ opacity: concurrencyOpacity }} />
                  <div className="throughput-chart-bars">
                    <span
                      className="throughput-chart-bar started"
                      style={{ height: startedHeight }}
                      title={`Started ${bucket.startedRuns}`}
                    />
                    <span
                      className="throughput-chart-bar completed"
                      style={{ height: completedHeight }}
                      title={`Completed ${bucket.completedRuns}`}
                    />
                    <span
                      className="throughput-chart-bar error"
                      style={{ height: errorHeight }}
                      title={`Error ${bucket.errorRuns}`}
                    />
                  </div>
                  <small>{bucket.label}</small>
                </article>
              );
            })}
          </div>
        </section>

        <section className="throughput-agent-panel">
          <header>
            <h3>Agent Drill-down</h3>
            <p>Ranked by started runs in {selectedWindow}.</p>
          </header>

          <div className="throughput-agent-actions">
            <button
              type="button"
              onClick={() => {
                setDrillAgentId(null);
              }}
              className={effectiveDrillAgentId === null ? "is-active" : ""}
            >
              Show all
            </button>
          </div>

          <div className="throughput-agent-table-wrap">
            <table className="throughput-agent-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Runs</th>
                  <th>Completion</th>
                  <th>Avg</th>
                  <th>Error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {agentBreakdown.slice(0, 10).map((agent) => (
                  <tr
                    key={agent.agentId}
                    className={effectiveDrillAgentId === agent.agentId ? "is-selected" : ""}
                  >
                    <td>{agent.agentId}</td>
                    <td>
                      {agent.completedRuns}/{agent.startedRuns}
                    </td>
                    <td>{formatPercent(agent.completionRate)}</td>
                    <td>{formatDuration(agent.avgDurationMs)}</td>
                    <td>{formatPercent(agent.errorRatio)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setDrillAgentId((prev) =>
                            prev === agent.agentId ? null : agent.agentId,
                          );
                        }}
                      >
                        {effectiveDrillAgentId === agent.agentId ? "Clear" : "Focus"}
                      </button>
                    </td>
                  </tr>
                ))}
                {agentBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="throughput-agent-empty">
                      No agent runs in this window.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="throughput-outlier-panel">
        <header>
          <h3>Anomaly Highlights</h3>
          <p>Outlier candidates based on latency, error ratio, and completion drop.</p>
        </header>

        {outliers.length === 0 ? (
          <p className="throughput-outlier-empty">No notable outliers for the current scope.</p>
        ) : (
          <ul className="throughput-outlier-list">
            {outliers.map((outlier) => (
              <li
                key={outlier.id}
                className={`throughput-outlier-item ${outlier.severity}`}
              >
                <strong>{outlier.title}</strong>
                <span>{outlier.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
