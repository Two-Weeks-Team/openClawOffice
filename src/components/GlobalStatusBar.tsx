type Props = {
  connected: boolean;
  liveSource: boolean;
  agents: number;
  subagents: number;
  running: number;
  errors: number;
  events: number;
  alertCount: number;
  updatedAt: number;
  stateDir: string;
  onOpenAlerts?: () => void;
};

const MAX_STATE_DIR_LENGTH = 34;
const STATE_DIR_EDGE_LENGTH = 14;

function shortStateDir(stateDir: string): string {
  const normalized = stateDir.trim();
  if (normalized.length <= MAX_STATE_DIR_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, STATE_DIR_EDGE_LENGTH)}...${normalized.slice(-STATE_DIR_EDGE_LENGTH)}`;
}

export function GlobalStatusBar({
  connected,
  liveSource,
  agents,
  subagents,
  running,
  errors,
  events,
  alertCount,
  updatedAt,
  stateDir,
  onOpenAlerts,
}: Props) {
  const metrics = [
    { label: "Agents", value: agents },
    { label: "Subagents", value: subagents },
    { label: "Running", value: running },
    { label: "Errors", value: errors },
    { label: "Events", value: events },
  ];

  return (
    <section className="global-status-bar" role="region" aria-label="Global status bar">
      <div className="global-status-head">
        <div className="global-status-channel">
          <span
            className={`global-status-chip ${connected ? "online" : "offline"}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {connected ? "Live Stream" : "Polling"}
          </span>
          <span className={`global-status-chip ${liveSource ? "online" : "demo"}`}>
            {liveSource ? "Live Runtime" : "Demo Snapshot"}
          </span>
        </div>
        <div className="global-status-meta">
          <span>Updated {new Date(updatedAt).toLocaleTimeString()}</span>
          <span title={stateDir}>State {shortStateDir(stateDir)}</span>
        </div>
      </div>

      <div className="global-status-metrics">
        {metrics.map((metric) => (
          <span key={metric.label} className="global-status-metric">
            {metric.label} <strong>{metric.value}</strong>
          </span>
        ))}
        <button
          type="button"
          className={`global-status-alert-button ${alertCount > 0 ? "has-alerts" : ""}`}
          onClick={onOpenAlerts}
          disabled={!onOpenAlerts}
        >
          Alerts <strong>{alertCount}</strong>
        </button>
      </div>
    </section>
  );
}
