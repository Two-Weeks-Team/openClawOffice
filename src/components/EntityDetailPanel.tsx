import { useEffect, useMemo, useState } from "react";
import { buildDetailPanelModel } from "../lib/detail-panel";
import type {
  OfficeEvent,
  OfficeEventType,
  OfficeRun,
  OfficeRunStatus,
  OfficeSnapshot,
} from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
  selectedEntityId: string | null;
  onClose: () => void;
};

function formatRelative(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < 60_000) {
    return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ago`;
  }
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function formatAt(at?: number): string {
  if (typeof at !== "number") {
    return "-";
  }
  return new Date(at).toLocaleString();
}

const RUN_STATUS_LABELS: Record<OfficeRunStatus, string> = {
  error: "ERROR",
  ok: "DONE",
  active: "ACTIVE",
};

const EVENT_TYPE_LABELS: Record<OfficeEventType, string> = {
  cleanup: "CLEANUP",
  start: "START",
  spawn: "SPAWN",
  error: "ERROR",
  end: "END",
};

function runStatusLabel(run: OfficeRun): string {
  return RUN_STATUS_LABELS[run.status] ?? run.status.toUpperCase();
}

function eventTypeLabel(event: OfficeEvent): string {
  return EVENT_TYPE_LABELS[event.type] ?? event.type.toUpperCase();
}

export function EntityDetailPanel({ snapshot, selectedEntityId, onClose }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const model = useMemo(
    () => buildDetailPanelModel(snapshot, selectedEntityId),
    [snapshot, selectedEntityId],
  );

  useEffect(() => {
    if (!selectedEntityId) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedEntityId, onClose]);

  useEffect(() => {
    if (!copiedKey) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setCopiedKey(null);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copiedKey]);

  const copyText = async (key: string, value: string | undefined) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
    } catch (error) {
      console.warn("Clipboard copy failed", error);
    }
  };

  const readyModel = model.status === "ready" ? model : null;

  const renderCopyValue = (label: string, key: string, value: string | undefined) => (
    <div>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <span className="detail-inline-copy">
            <code>{value}</code>
            <button
              type="button"
              className="detail-copy-button"
              onClick={() => {
                void copyText(key, value);
              }}
            >
              {copiedKey === key ? "Copied" : "Copy"}
            </button>
          </span>
        ) : (
          "-"
        )}
      </dd>
    </div>
  );

  return (
    <aside className="detail-panel">
      <header className="detail-panel-header">
        <div>
          <h2>Entity Detail</h2>
          <p>Click an entity token to inspect sessions, runs, messages, and metrics.</p>
        </div>
        <button
          type="button"
          className="detail-close-button"
          onClick={onClose}
          disabled={model.status === "empty"}
        >
          Close
        </button>
      </header>

      {model.status === "empty" ? (
        <div className="detail-empty">
          <strong>No entity selected</strong>
          <p>
            Select an agent or subagent on the stage. Press <kbd>Esc</kbd> to close anytime.
          </p>
        </div>
      ) : null}

      {model.status === "missing" ? (
        <div className="detail-empty detail-empty-missing">
          <strong>Selected entity is no longer available</strong>
          <p>
            The stream updated and the previous selection disappeared. Close this panel and pick a
            current entity.
          </p>
        </div>
      ) : null}

      {readyModel ? (
        <div className="detail-body">
          <section className="detail-section">
            <h3>Overview</h3>
            <dl className="detail-kv">
              <div>
                <dt>Entity</dt>
                <dd>
                  {readyModel.entity.label} ({readyModel.entity.kind})
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{readyModel.entity.status}</dd>
              </div>
              <div>
                <dt>Agent ID</dt>
                <dd>{readyModel.entity.agentId}</dd>
              </div>
              <div>
                <dt>Parent Agent</dt>
                <dd>{readyModel.entity.parentAgentId ?? "-"}</dd>
              </div>
              {renderCopyValue("Run ID", "runId", readyModel.linkedRun?.runId ?? readyModel.entity.runId)}
              <div>
                <dt>Model</dt>
                <dd>{readyModel.models.join(", ") || "unknown"}</dd>
              </div>
              <div>
                <dt>Last Updated</dt>
                <dd>{formatAt(readyModel.entity.lastUpdatedAt)}</dd>
              </div>
              <div>
                <dt>Cleanup</dt>
                <dd>
                  {readyModel.linkedRun
                    ? `${readyModel.linkedRun.cleanup} / ${
                        readyModel.linkedRun.cleanupCompletedAt ? "completed" : "pending"
                      }`
                    : "-"}
                </dd>
              </div>
            </dl>
            {readyModel.entity.task || readyModel.linkedRun?.task ? (
              <p className="detail-task">{readyModel.entity.task ?? readyModel.linkedRun?.task}</p>
            ) : null}
          </section>

          <section className="detail-section">
            <h3>Sessions</h3>
            <dl className="detail-kv">
              <div>
                <dt>Session Count</dt>
                <dd>{readyModel.metrics.sessions}</dd>
              </div>
              {renderCopyValue("Child Session Key", "childSession", readyModel.linkedRun?.childSessionKey)}
              {renderCopyValue(
                "Requester Session Key",
                "requesterSession",
                readyModel.linkedRun?.requesterSessionKey,
              )}
              {renderCopyValue("Session Store", "sessionStore", readyModel.paths.sessionStorePath)}
              {renderCopyValue("Session Logs", "sessionLogs", readyModel.paths.sessionLogPath)}
              {renderCopyValue("Child Logs", "childLogs", readyModel.paths.childSessionLogPath)}
              {renderCopyValue("Parent Logs", "parentLogs", readyModel.paths.parentSessionLogPath)}
            </dl>
          </section>

          <section className="detail-section">
            <h3>Runs</h3>
            {readyModel.relatedRuns.length === 0 ? (
              <p className="detail-muted">No related runs were found.</p>
            ) : (
              <ol className="detail-run-list">
                {readyModel.relatedRuns.map((run) => (
                  <li key={run.runId} className="detail-run-item">
                    <div className="detail-run-top">
                      <strong>{run.runId}</strong>
                      <button
                        type="button"
                        className="detail-copy-button"
                        onClick={() => {
                          void copyText(`run:${run.runId}`, run.runId);
                        }}
                      >
                        {copiedKey === `run:${run.runId}` ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="detail-run-meta">
                      <span className={`detail-tag ${run.status}`}>{runStatusLabel(run)}</span>
                      <span>{run.parentAgentId} {"->"} {run.childAgentId}</span>
                      <span>cleanup: {run.cleanup}</span>
                    </div>
                    <p className="detail-run-task">{run.task}</p>
                    <p className="detail-run-time">
                      created {formatAt(run.createdAt)} | start {formatAt(run.startedAt)} | end{" "}
                      {formatAt(run.endedAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="detail-section">
            <h3>Messages</h3>
            {readyModel.relatedEvents.length === 0 ? (
              <p className="detail-muted">No related lifecycle events were found.</p>
            ) : (
              <ol className="detail-message-list">
                {readyModel.relatedEvents.map((event) => (
                  <li key={event.id} className="detail-message-item">
                    <div className="detail-message-top">
                      <span className={`detail-tag event-${event.type}`}>{eventTypeLabel(event)}</span>
                      <time title={new Date(event.at).toLocaleString()}>
                        {formatRelative(event.at, snapshot.generatedAt)}
                      </time>
                    </div>
                    <p>{event.text}</p>
                    <small>
                      run {event.runId} | {event.parentAgentId} {"->"} {event.agentId}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="detail-section">
            <h3>Metrics</h3>
            <div className="detail-metrics">
              <article>
                <span>Sessions</span>
                <strong>{readyModel.metrics.sessions}</strong>
              </article>
              <article>
                <span>Runs</span>
                <strong>{readyModel.metrics.runCount}</strong>
              </article>
              <article>
                <span>Run Errors</span>
                <strong>{readyModel.metrics.errorRuns}</strong>
              </article>
              <article>
                <span>Events</span>
                <strong>{readyModel.metrics.eventCount}</strong>
              </article>
              <article>
                <span>Active Subs</span>
                <strong>{readyModel.metrics.activeSubagents}</strong>
              </article>
              <article>
                <span>Token Est.</span>
                <strong>{readyModel.metrics.tokenEstimate}</strong>
              </article>
            </div>
            <dl className="detail-kv detail-kv-compact">
              {renderCopyValue("Run Store Path", "runStore", readyModel.paths.runStorePath)}
            </dl>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
