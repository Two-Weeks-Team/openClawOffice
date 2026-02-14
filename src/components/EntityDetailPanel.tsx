import { Suspense, lazy, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  buildDetailPanelModelCached,
  buildRunDiffForSelection,
  prefetchDetailPanelModels,
  selectDefaultRunComparison,
  type DetailPanelRunComparisonSelection,
} from "../lib/detail-panel";
import {
  loadSavedRunComparisons,
  persistSavedRunComparisons,
  removeSavedRunComparison,
  upsertSavedRunComparison,
  type SavedRunComparison,
} from "../lib/run-comparison-store";
import type { RunKnowledgeEntry } from "../lib/run-notes-store";
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
  runKnowledgeByRunId: Map<string, RunKnowledgeEntry>;
  onUpsertRunKnowledge?: (input: { runId: string; note: string; tags: string[] }) => void;
  onRemoveRunKnowledge?: (runId: string) => void;
  onJumpToRun?: (runId: string) => void;
  onClose: () => void;
};

type DetailPanelTab = "overview" | "sessions" | "runs" | "diff";
type RunKnowledgeDraft = {
  note: string;
  tagsInput: string;
};

const RUN_KNOWLEDGE_DRAFT_STORAGE_KEY = "openclawoffice.run-knowledge-drafts.v1";

const DETAIL_PANEL_TABS: Array<{ id: DetailPanelTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "sessions", label: "Sessions" },
  { id: "runs", label: "Runs" },
  { id: "diff", label: "Diff" },
];

const LazyRunDiffView = lazy(async () => {
  const module = await import("./RunDiffView");
  return { default: module.RunDiffView };
});

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

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) {
    return "-";
  }
  if (latencyMs < 1000) {
    return `${latencyMs} ms`;
  }
  return `${(latencyMs / 1000).toFixed(2)} s`;
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

function parseRunTagsInput(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const chunk of value.split(",")) {
    const normalized = chunk.trim().replace(/^#+/, "").toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags;
}

function runKnowledgeDraftFromEntry(entry: RunKnowledgeEntry | undefined): RunKnowledgeDraft {
  return {
    note: entry?.note ?? "",
    tagsInput: entry?.tags.join(", ") ?? "",
  };
}

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeDraft(value: unknown): RunKnowledgeDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.note !== "string" || typeof record.tagsInput !== "string") {
    return null;
  }
  return {
    note: record.note,
    tagsInput: record.tagsInput,
  };
}

function loadRunKnowledgeDrafts(): Record<string, RunKnowledgeDraft> {
  if (!hasBrowserStorage()) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(RUN_KNOWLEDGE_DRAFT_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const normalized: Record<string, RunKnowledgeDraft> = {};
    for (const [runId, draft] of Object.entries(parsed)) {
      if (!runId.trim()) {
        continue;
      }
      const hydrated = normalizeDraft(draft);
      if (!hydrated) {
        continue;
      }
      normalized[runId] = hydrated;
    }
    return normalized;
  } catch {
    return {};
  }
}

function persistRunKnowledgeDrafts(drafts: Record<string, RunKnowledgeDraft>): void {
  if (!hasBrowserStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(RUN_KNOWLEDGE_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Ignore localStorage persistence errors in restricted browser modes.
  }
}

export function EntityDetailPanel({
  snapshot,
  selectedEntityId,
  runKnowledgeByRunId,
  onUpsertRunKnowledge,
  onRemoveRunKnowledge,
  onJumpToRun,
  onClose,
}: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailPanelTab>("overview");
  const [runTagFilter, setRunTagFilter] = useState("");
  const [runKnowledgeDraftByRunId, setRunKnowledgeDraftByRunId] = useState<
    Record<string, RunKnowledgeDraft>
  >(loadRunKnowledgeDrafts);
  const [savedComparisons, setSavedComparisons] = useState<SavedRunComparison[]>(
    loadSavedRunComparisons,
  );
  const [runComparisonSelection, setRunComparisonSelection] =
    useState<DetailPanelRunComparisonSelection | null>(null);
  const deferredActiveTab = useDeferredValue(activeTab);
  const isRunsTabReady = deferredActiveTab === "runs";
  const isDiffTabReady = deferredActiveTab === "diff";

  const model = useMemo(
    () => buildDetailPanelModelCached(snapshot, selectedEntityId),
    [snapshot, selectedEntityId],
  );
  const readyModel = model.status === "ready" ? model : null;
  const prefetchEntityIds = useMemo(() => {
    if (!selectedEntityId || !readyModel) {
      return [] as string[];
    }
    const ids = new Set<string>();
    const availableEntityIds = new Set(snapshot.entities.map((entity) => entity.id));

    if (readyModel.entity.parentAgentId) {
      ids.add(`agent:${readyModel.entity.parentAgentId}`);
    }
    for (const item of readyModel.recentRuns.slice(0, 4)) {
      ids.add(`agent:${item.run.parentAgentId}`);
      ids.add(`agent:${item.run.childAgentId}`);
      ids.add(`subagent:${item.run.runId}`);
    }

    return [...ids].filter((id) => availableEntityIds.has(id) && id !== selectedEntityId);
  }, [readyModel, selectedEntityId, snapshot.entities]);

  useEffect(() => {
    if (prefetchEntityIds.length === 0) {
      return;
    }
    prefetchDetailPanelModels(snapshot, prefetchEntityIds);
  }, [prefetchEntityIds, snapshot]);

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

  useEffect(() => {
    persistSavedRunComparisons(savedComparisons);
  }, [savedComparisons]);

  useEffect(() => {
    persistRunKnowledgeDrafts(runKnowledgeDraftByRunId);
  }, [runKnowledgeDraftByRunId]);

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

  const defaultRunComparisonSelection = useMemo(() => {
    if (!readyModel || !isDiffTabReady) {
      return null;
    }
    return selectDefaultRunComparison(readyModel.runInsights);
  }, [isDiffTabReady, readyModel]);
  const effectiveRunComparisonSelection = useMemo(() => {
    if (!readyModel || !isDiffTabReady) {
      return null;
    }
    const isCurrentSelectionValid =
      runComparisonSelection !== null &&
      runComparisonSelection.baselineRunId !== runComparisonSelection.candidateRunId &&
      readyModel.runInsights.some((item) => item.run.runId === runComparisonSelection.baselineRunId) &&
      readyModel.runInsights.some((item) => item.run.runId === runComparisonSelection.candidateRunId);
    if (isCurrentSelectionValid) {
      return runComparisonSelection;
    }
    return defaultRunComparisonSelection;
  }, [defaultRunComparisonSelection, isDiffTabReady, readyModel, runComparisonSelection]);
  const activeRunDiff = useMemo(() => {
    if (!readyModel || !effectiveRunComparisonSelection || !isDiffTabReady) {
      return null;
    }
    return buildRunDiffForSelection(readyModel.runInsights, effectiveRunComparisonSelection);
  }, [effectiveRunComparisonSelection, isDiffTabReady, readyModel]);
  const savedComparisonsForEntity = useMemo(() => {
    if (!readyModel || !isDiffTabReady) {
      return [];
    }
    return savedComparisons.filter((item) => item.entityId === readyModel.entity.id);
  }, [isDiffTabReady, readyModel, savedComparisons]);
  const normalizedRunTagFilter = useMemo(
    () => runTagFilter.trim().replace(/^#+/, "").toLowerCase(),
    [runTagFilter],
  );
  const filteredRecentRuns = useMemo(() => {
    if (!readyModel) {
      return [];
    }
    if (!normalizedRunTagFilter) {
      return readyModel.recentRuns;
    }
    return readyModel.recentRuns.filter((item) => {
      const entry = runKnowledgeByRunId.get(item.run.runId);
      const tagMatched = entry?.tags.some((tag) => tag.includes(normalizedRunTagFilter)) ?? false;
      const noteMatched =
        entry?.note.toLowerCase().includes(normalizedRunTagFilter) ?? false;
      return (
        tagMatched ||
        noteMatched ||
        item.run.runId.toLowerCase().includes(normalizedRunTagFilter)
      );
    });
  }, [normalizedRunTagFilter, readyModel, runKnowledgeByRunId]);

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

  const handleSaveComparison = () => {
    if (!readyModel || !activeRunDiff || !effectiveRunComparisonSelection) {
      return;
    }
    const savedRecord: SavedRunComparison = {
      id: `cmp:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      entityId: readyModel.entity.id,
      baselineRunId: effectiveRunComparisonSelection.baselineRunId,
      candidateRunId: effectiveRunComparisonSelection.candidateRunId,
      createdAt: Date.now(),
    };
    setSavedComparisons((prev) => upsertSavedRunComparison(prev, savedRecord));
  };

  const handleDeleteSavedComparison = (id: string) => {
    setSavedComparisons((prev) => removeSavedRunComparison(prev, id));
  };

  const updateRunKnowledgeDraft = (
    runId: string,
    patch: Partial<RunKnowledgeDraft>,
  ) => {
    setRunKnowledgeDraftByRunId((prev) => {
      const current = prev[runId] ?? runKnowledgeDraftFromEntry(runKnowledgeByRunId.get(runId));
      return {
        ...prev,
        [runId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const saveRunKnowledge = (runId: string) => {
    if (!onUpsertRunKnowledge) {
      return;
    }
    const draft =
      runKnowledgeDraftByRunId[runId] ?? runKnowledgeDraftFromEntry(runKnowledgeByRunId.get(runId));
    onUpsertRunKnowledge({
      runId,
      note: draft.note,
      tags: parseRunTagsInput(draft.tagsInput),
    });
  };

  const clearRunKnowledge = (runId: string) => {
    onRemoveRunKnowledge?.(runId);
    setRunKnowledgeDraftByRunId((prev) => ({
      ...prev,
      [runId]: {
        note: "",
        tagsInput: "",
      },
    }));
  };

  const isSavedComparisonActive = (saved: SavedRunComparison): boolean => {
    if (!effectiveRunComparisonSelection) {
      return false;
    }
    return (
      saved.baselineRunId === effectiveRunComparisonSelection.baselineRunId &&
      saved.candidateRunId === effectiveRunComparisonSelection.candidateRunId
    );
  };

  return (
    <aside className="detail-panel">
      <header className="detail-panel-header">
        <div>
          <h2>Entity Detail</h2>
          <p>Inspect sessions, recent runs, and run A/B comparisons from one panel.</p>
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

      {readyModel ? (
        <div className="detail-tabs" role="tablist" aria-label="Entity detail tabs">
          {DETAIL_PANEL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`detail-tab-${tab.id}`}
              aria-controls={`detail-tabpanel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              className={`detail-tab-button${activeTab === tab.id ? " is-active" : ""}`}
              onClick={() => {
                setActiveTab(tab.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

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
          {activeTab === "overview" ? (
            <div
              role="tabpanel"
              id="detail-tabpanel-overview"
              aria-labelledby="detail-tab-overview"
            >
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
                  {renderCopyValue(
                    "Run ID",
                    "runId",
                    readyModel.linkedRun?.runId ?? readyModel.entity.runId,
                  )}
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

          {activeTab === "sessions" ? (
            <div role="tabpanel" id="detail-tabpanel-sessions" aria-labelledby="detail-tab-sessions">
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
            </div>
          ) : null}

          {activeTab === "runs" && !isRunsTabReady ? (
            <div role="tabpanel" id="detail-tabpanel-runs" aria-labelledby="detail-tab-runs">
              <section className="detail-section detail-panel-lazy">
                <h3>Runs (Recent 6)</h3>
                <p className="detail-muted">Loading run insights...</p>
              </section>
            </div>
          ) : null}

          {activeTab === "runs" && isRunsTabReady ? (
            <div role="tabpanel" id="detail-tabpanel-runs" aria-labelledby="detail-tab-runs">
              <section className="detail-section">
                <h3>Runs (Recent 6)</h3>
                <label className="detail-run-filter">
                  <span>Tag Filter</span>
                  <input
                    type="text"
                    placeholder="incident, retry, runId"
                    value={runTagFilter}
                    onChange={(event) => {
                      setRunTagFilter(event.target.value);
                    }}
                  />
                </label>
                <p className="detail-muted detail-run-filter-note">
                  Tag filter searches within this entity&apos;s recent 6 runs.
                </p>
                {readyModel.recentRuns.length === 0 ? (
                  <p className="detail-muted">No related runs were found.</p>
                ) : filteredRecentRuns.length === 0 ? (
                  <p className="detail-muted">No runs match the current tag filter.</p>
                ) : (
                  <ol className="detail-run-list">
                    {filteredRecentRuns.map((item) => {
                      const runId = item.run.runId;
                      const entry = runKnowledgeByRunId.get(runId);
                      const draft =
                        runKnowledgeDraftByRunId[runId] ?? runKnowledgeDraftFromEntry(entry);
                      const draftTags = parseRunTagsInput(draft.tagsInput);
                      const savedTags = entry?.tags ?? [];
                      const savedNote = entry?.note ?? "";
                      const isKnowledgeDirty =
                        draft.note.trim() !== savedNote ||
                        draftTags.join(",") !== savedTags.join(",");
                      const hasSavedKnowledge = Boolean(savedNote || savedTags.length > 0);

                      return (
                        <li key={runId} className="detail-run-item">
                          <div className="detail-run-top">
                            <strong>{runId}</strong>
                            <div className="detail-run-actions">
                              <button
                                type="button"
                                className="detail-copy-button"
                                onClick={() => {
                                  void copyText(`run:${runId}`, runId);
                                }}
                              >
                                {copiedKey === `run:${runId}` ? "Copied" : "Copy"}
                              </button>
                              {onJumpToRun ? (
                                <button
                                  type="button"
                                  className="detail-copy-button"
                                  onClick={() => {
                                    onJumpToRun(runId);
                                  }}
                                >
                                  Jump
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="detail-run-meta">
                            <span className={`detail-tag ${item.run.status}`}>{runStatusLabel(item.run)}</span>
                            <span>
                              {item.run.parentAgentId} {"->"} {item.run.childAgentId}
                            </span>
                            <span>model: {item.model}</span>
                            <span>tokens: {item.tokenEstimate}</span>
                            <span>latency: {formatLatency(item.latencyMs)}</span>
                            <span>events: {item.eventCount}</span>
                            <span>cleanup: {item.run.cleanup}</span>
                          </div>
                          {entry?.tags.length ? (
                            <div className="detail-run-tags">
                              {entry.tags.map((tag) => (
                                <span key={`${runId}:${tag}`} className="detail-tag detail-tag-note">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <p className="detail-run-task">{item.run.task}</p>
                          <p className="detail-run-time">
                            created {formatAt(item.run.createdAt)} | start {formatAt(item.run.startedAt)} | end{" "}
                            {formatAt(item.run.endedAt)}
                          </p>
                          <div className="detail-run-knowledge">
                            <label>
                              Tags (comma)
                              <input
                                type="text"
                                placeholder="incident, retry"
                                value={draft.tagsInput}
                                onChange={(event) => {
                                  updateRunKnowledgeDraft(runId, {
                                    tagsInput: event.target.value,
                                  });
                                }}
                              />
                            </label>
                            <label>
                              Note
                              <textarea
                                rows={2}
                                placeholder="Run context, failure root cause, follow-up..."
                                aria-label={`Note for run ${runId}`}
                                value={draft.note}
                                onChange={(event) => {
                                  updateRunKnowledgeDraft(runId, {
                                    note: event.target.value,
                                  });
                                }}
                              />
                            </label>
                            <div className="detail-run-knowledge-actions">
                              <button
                                type="button"
                                className="detail-copy-button"
                                disabled={!isKnowledgeDirty}
                                onClick={() => {
                                  saveRunKnowledge(runId);
                                }}
                              >
                                Save Note
                              </button>
                              <button
                                type="button"
                                className="detail-copy-button"
                                disabled={!hasSavedKnowledge && draft.note.trim().length === 0 && draftTags.length === 0}
                                onClick={() => {
                                  clearRunKnowledge(runId);
                                }}
                              >
                                Clear Note
                              </button>
                              {entry ? (
                                <small>saved {formatAt(entry.updatedAt)}</small>
                              ) : (
                                <small>not saved</small>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </div>
          ) : null}

          {activeTab === "diff" && !isDiffTabReady ? (
            <div role="tabpanel" id="detail-tabpanel-diff" aria-labelledby="detail-tab-diff">
              <section className="detail-section detail-panel-lazy">
                <h3>Run Comparison (Run A vs Run B)</h3>
                <p className="detail-muted">Loading comparison tools...</p>
              </section>
            </div>
          ) : null}

          {activeTab === "diff" && isDiffTabReady ? (
            <div role="tabpanel" id="detail-tabpanel-diff" aria-labelledby="detail-tab-diff">
              <section className="detail-section">
                <h3>Run Comparison (Run A vs Run B)</h3>
                {readyModel.runInsights.length < 2 ? (
                  <p className="detail-muted">
                    At least two related runs are required to compare run patterns.
                  </p>
                ) : (
                  <div className="detail-diff-controls">
                    <label className="detail-diff-field">
                      <span>Baseline (Run A)</span>
                      <select
                        value={effectiveRunComparisonSelection?.baselineRunId ?? ""}
                        onChange={(event) => {
                          setRunComparisonSelection((prev) => ({
                            baselineRunId: event.target.value,
                            candidateRunId:
                              prev?.candidateRunId ??
                              defaultRunComparisonSelection?.candidateRunId ??
                              "",
                          }));
                        }}
                      >
                        <option value="">Select baseline run</option>
                        {readyModel.runInsights.map((item) => (
                          <option key={item.run.runId} value={item.run.runId}>
                            {item.run.runId} | {runStatusLabel(item.run)} | {item.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="detail-diff-field">
                      <span>Candidate (Run B)</span>
                      <select
                        value={effectiveRunComparisonSelection?.candidateRunId ?? ""}
                        onChange={(event) => {
                          setRunComparisonSelection((prev) => ({
                            baselineRunId:
                              prev?.baselineRunId ??
                              defaultRunComparisonSelection?.baselineRunId ??
                              "",
                            candidateRunId: event.target.value,
                          }));
                        }}
                      >
                        <option value="">Select candidate run</option>
                        {readyModel.runInsights.map((item) => (
                          <option key={item.run.runId} value={item.run.runId}>
                            {item.run.runId} | {runStatusLabel(item.run)} | {item.model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="detail-diff-actions">
                      <button
                        type="button"
                        className="detail-copy-button"
                        disabled={!effectiveRunComparisonSelection}
                        onClick={() => {
                          if (!effectiveRunComparisonSelection) {
                            return;
                          }
                          setRunComparisonSelection({
                            baselineRunId: effectiveRunComparisonSelection.candidateRunId,
                            candidateRunId: effectiveRunComparisonSelection.baselineRunId,
                          });
                        }}
                      >
                        Swap
                      </button>
                      <button
                        type="button"
                        className="detail-copy-button"
                        disabled={!activeRunDiff}
                        onClick={handleSaveComparison}
                      >
                        Save Comparison
                      </button>
                    </div>
                  </div>
                )}
                <div className="detail-diff-saved">
                  <h4>Saved Comparisons</h4>
                  {savedComparisonsForEntity.length === 0 ? (
                    <p className="detail-muted">
                      No saved comparison yet for this entity. Save your current run A/B pair.
                    </p>
                  ) : (
                    <ol>
                      {savedComparisonsForEntity.map((saved) => (
                        <li key={saved.id} className={isSavedComparisonActive(saved) ? "is-active" : ""}>
                          <span>
                            {saved.baselineRunId} {"->"} {saved.candidateRunId}
                          </span>
                          <small>{formatAt(saved.createdAt)}</small>
                          <div className="detail-run-actions">
                            <button
                              type="button"
                              className="detail-copy-button"
                              onClick={() => {
                                setRunComparisonSelection({
                                  baselineRunId: saved.baselineRunId,
                                  candidateRunId: saved.candidateRunId,
                                });
                              }}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="detail-copy-button"
                              onClick={() => {
                                handleDeleteSavedComparison(saved.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <Suspense fallback={<p className="detail-muted">Loading run diff view...</p>}>
                  <LazyRunDiffView
                    runDiff={activeRunDiff}
                    copiedKey={copiedKey}
                    onCopy={copyText}
                    onJumpToRun={onJumpToRun}
                  />
                </Suspense>
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
