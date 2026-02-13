import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { EntityDetailPanel } from "./components/EntityDetailPanel";
import { EventRail } from "./components/EventRail";
import { OfficeStage } from "./components/OfficeStage";
import { useOfficeStream } from "./hooks/useOfficeStream";
import { buildEntitySearchIndex, searchEntityIds } from "./lib/entity-search";
import { parseRunIdDeepLink, type TimelineFilters } from "./lib/timeline";

type EntityStatusFilter = "all" | "active" | "idle" | "error" | "ok" | "offline";
type RecentWindowFilter = "all" | 5 | 15 | 30 | 60;
type OpsFilters = {
  query: string;
  status: EntityStatusFilter;
  roomId: string;
  recentMinutes: RecentWindowFilter;
  focusMode: boolean;
};

type ToastState = {
  kind: "success" | "error" | "info";
  message: string;
} | null;

function quoteShellToken(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function StatCard(props: { label: string; value: number | string; accent?: string }) {
  return (
    <article className="stat-card" style={props.accent ? { borderColor: props.accent } : undefined}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function App() {
  const { snapshot, connected, liveSource, error } = useOfficeStream();
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [roomOptions, setRoomOptions] = useState<string[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [timelineFilters, setTimelineFilters] = useState<TimelineFilters>(() => ({
    runId: parseRunIdDeepLink(window.location.search),
    agentId: "",
    status: "all",
  }));
  const [opsFilters, setOpsFilters] = useState<OpsFilters>({
    query: "",
    status: "all",
    roomId: "all",
    recentMinutes: "all",
    focusMode: false,
  });
  const searchIndex = useMemo(
    () => (snapshot ? buildEntitySearchIndex(snapshot) : new Map<string, string>()),
    [snapshot],
  );
  const filteredEntityIds = useMemo(() => {
    if (!snapshot) {
      return [] as string[];
    }

    const matchedBySearch = searchEntityIds(searchIndex, opsFilters.query);
    const recentWindowMs =
      opsFilters.recentMinutes === "all" ? null : opsFilters.recentMinutes * 60_000;

    return snapshot.entities
      .filter((entity) => {
        if (!matchedBySearch.has(entity.id)) {
          return false;
        }
        if (opsFilters.status !== "all" && entity.status !== opsFilters.status) {
          return false;
        }
        if (recentWindowMs !== null) {
          if (typeof entity.lastUpdatedAt !== "number") {
            return false;
          }
          if (snapshot.generatedAt - entity.lastUpdatedAt > recentWindowMs) {
            return false;
          }
        }
        return true;
      })
      .map((entity) => entity.id);
  }, [
    opsFilters.query,
    opsFilters.recentMinutes,
    opsFilters.status,
    searchIndex,
    snapshot,
  ]);
  const runById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof snapshot>["runs"][number]>();
    if (!snapshot) {
      return map;
    }
    for (const run of snapshot.runs) {
      map.set(run.runId, run);
    }
    return map;
  }, [snapshot]);
  const activeEvent = useMemo(
    () => snapshot?.events.find((event) => event.id === activeEventId) ?? null,
    [activeEventId, snapshot],
  );
  const selectedEntity = useMemo(
    () => snapshot?.entities.find((entity) => entity.id === selectedEntityId) ?? null,
    [selectedEntityId, snapshot],
  );
  const selectedRun = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    if (selectedEntity?.runId) {
      return runById.get(selectedEntity.runId) ?? null;
    }
    if (activeEvent?.runId) {
      return runById.get(activeEvent.runId) ?? null;
    }
    return null;
  }, [activeEvent, runById, selectedEntity, snapshot]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const runId = timelineFilters.runId.trim();
    if (runId) {
      url.searchParams.set("runId", runId);
    } else {
      url.searchParams.delete("runId");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [timelineFilters.runId]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 1800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  if (!snapshot) {
    return (
      <main className="app-shell">
        <div className="loading-view">
          <h1>openClawOffice</h1>
          <p>Loading office state stream...</p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </main>
    );
  }

  const agents = snapshot.entities.filter((entity) => entity.kind === "agent");
  const subagents = snapshot.entities.filter((entity) => entity.kind === "subagent");
  const running = subagents.filter((entity) => entity.status === "active").length;
  const failed = subagents.filter((entity) => entity.status === "error").length;
  const diagnostics = snapshot.diagnostics.slice(0, 2);
  const highlightRunId = activeEvent?.runId ?? (timelineFilters.runId.trim() || null);
  const highlightAgentId = activeEvent?.agentId ?? (timelineFilters.agentId.trim() || null);
  const hasEntityFilter =
    opsFilters.query.trim().length > 0 ||
    opsFilters.status !== "all" ||
    opsFilters.roomId !== "all" ||
    opsFilters.recentMinutes !== "all";

  const showToast = (kind: NonNullable<ToastState>["kind"], message: string) => {
    setToast({ kind, message });
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("success", successMessage);
    } catch (errorValue) {
      console.warn("Clipboard copy failed", errorValue);
      showToast("error", "Copy failed. Please check clipboard permission.");
    }
  };

  const onCopyRunId = async () => {
    const runId = selectedRun?.runId ?? selectedEntity?.runId ?? activeEvent?.runId;
    if (!runId) {
      showToast("error", "No runId available. Select an entity or timeline event first.");
      return;
    }
    await copyText(runId, `Copied runId: ${runId}`);
  };

  const onCopySessionKey = async () => {
    const sessionKey = selectedRun?.childSessionKey ?? selectedRun?.requesterSessionKey;
    if (!sessionKey) {
      showToast("error", "No session key available for the current context.");
      return;
    }
    await copyText(sessionKey, "Copied session key.");
  };

  const onCopyLogGuide = async () => {
    let agentId: string | null = null;
    if (selectedEntity?.kind === "agent") {
      agentId = selectedEntity.agentId;
    } else if (selectedRun) {
      agentId = selectedRun.childAgentId;
    } else if (activeEvent) {
      agentId = activeEvent.agentId;
    }

    if (!agentId) {
      showToast("error", "No log path context. Select an entity or timeline event first.");
      return;
    }
    const selectedLogPath = `${snapshot.source.stateDir}/agents/${agentId}/sessions`;
    const guide = `cd -- ${quoteShellToken(selectedLogPath)}\nls -lt -- *.jsonl`;
    await copyText(guide, "Copied log path guide.");
  };

  const onJumpToRun = () => {
    const runId = selectedRun?.runId ?? selectedEntity?.runId ?? activeEvent?.runId;
    if (!runId) {
      showToast("error", "No runId available for jump.");
      return;
    }
    setTimelineFilters((prev) => ({ ...prev, runId, status: "all" }));
    setActiveEventId(null);
    showToast("info", `Timeline jumped to runId filter: ${runId}`);
  };

  return (
    <main className="app-shell">
      <section className="hero-bar">
        <div>
          <h1>openClawOffice</h1>
          <p>Zone-based visual HQ for OpenClaw agents and subagents.</p>
        </div>

        <div className="status-pill-row">
          <span className={`status-pill ${connected ? "online" : "offline"}`}>
            {connected ? "Live Stream" : "Polling"}
          </span>
          <span className={`status-pill ${liveSource ? "online" : "demo"}`}>
            {liveSource ? "Live Runtime" : "Demo Snapshot"}
          </span>
        </div>
      </section>

      <section className="stats-bar">
        <StatCard label="Agents" value={agents.length} accent="#81f0ff" />
        <StatCard label="Subagents" value={subagents.length} accent="#8cffc0" />
        <StatCard label="Running" value={running} accent="#ffd081" />
        <StatCard label="Errors" value={failed} accent="#ff8686" />
        <StatCard label="Events" value={snapshot.events.length} accent="#96b4ff" />
      </section>

      <section className="ops-toolbar">
        <label className="ops-field ops-search">
          Search
          <input
            type="text"
            placeholder="agentId / runId / task"
            value={opsFilters.query}
            onChange={(event) => {
              setOpsFilters((prev) => ({ ...prev, query: event.target.value }));
            }}
          />
        </label>

        <label className="ops-field">
          Status
          <select
            value={opsFilters.status}
            onChange={(event) => {
              setOpsFilters((prev) => ({
                ...prev,
                status: event.target.value as EntityStatusFilter,
              }));
            }}
          >
            <option value="all">ALL</option>
            <option value="active">ACTIVE</option>
            <option value="idle">IDLE</option>
            <option value="error">ERROR</option>
            <option value="ok">OK</option>
            <option value="offline">OFFLINE</option>
          </select>
        </label>

        <label className="ops-field">
          Room
          <select
            value={opsFilters.roomId}
            onChange={(event) => {
              setOpsFilters((prev) => ({ ...prev, roomId: event.target.value }));
            }}
          >
            <option value="all">ALL</option>
            {roomOptions.map((roomId) => (
              <option key={roomId} value={roomId}>
                {roomId}
              </option>
            ))}
          </select>
        </label>

        <label className="ops-field">
          Recent
          <select
            value={opsFilters.recentMinutes}
            onChange={(event) => {
              const nextValue = event.target.value;
              setOpsFilters((prev) => ({
                ...prev,
                recentMinutes:
                  nextValue === "all" ? "all" : (Number(nextValue) as RecentWindowFilter),
              }));
            }}
          >
            <option value="all">ALL</option>
            <option value={5}>5m</option>
            <option value={15}>15m</option>
            <option value={30}>30m</option>
            <option value={60}>60m</option>
          </select>
        </label>

        <label className="ops-focus-toggle">
          <input
            type="checkbox"
            checked={opsFilters.focusMode}
            onChange={(event) => {
              setOpsFilters((prev) => ({ ...prev, focusMode: event.target.checked }));
            }}
          />
          Focus mode
        </label>

        <div className="ops-actions">
          <button type="button" onClick={() => void onCopyRunId()}>
            Copy runId
          </button>
          <button type="button" onClick={() => void onCopySessionKey()}>
            Copy sessionKey
          </button>
          <button type="button" onClick={() => void onCopyLogGuide()}>
            Log path guide
          </button>
          <button type="button" onClick={onJumpToRun}>
            Jump to run
          </button>
          <span className="ops-match-count">
            match {(matchCount ?? filteredEntityIds.length).toString()}/{snapshot.entities.length}
          </span>
        </div>
      </section>

      <section className="workspace">
        <OfficeStage
          snapshot={snapshot}
          selectedEntityId={selectedEntityId}
          highlightRunId={highlightRunId}
          highlightAgentId={highlightAgentId}
          filterEntityIds={filteredEntityIds}
          hasEntityFilter={hasEntityFilter}
          roomFilterId={opsFilters.roomId}
          focusMode={opsFilters.focusMode}
          onRoomOptionsChange={setRoomOptions}
          onFilterMatchCountChange={setMatchCount}
          onSelectEntity={(entityId) => {
            setSelectedEntityId((prev) => (prev === entityId ? null : entityId));
          }}
        />
        <div className="workspace-side">
          <EventRail
            events={snapshot.events}
            runGraph={snapshot.runGraph}
            now={snapshot.generatedAt}
            filters={timelineFilters}
            onFiltersChange={setTimelineFilters}
            activeEventId={activeEventId}
            onActiveEventIdChange={setActiveEventId}
          />
          <EntityDetailPanel
            snapshot={snapshot}
            selectedEntityId={selectedEntityId}
            onClose={() => {
              setSelectedEntityId(null);
            }}
          />
        </div>
      </section>

      {diagnostics.length > 0 ? (
        <section className="diagnostic-strip" role="status" aria-live="polite">
          <strong>Data Warnings ({snapshot.diagnostics.length})</strong>
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}:${diagnostic.source}:${index}`}
                title={diagnostic.message}
              >
                [{diagnostic.code}] {diagnostic.source}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="footer-bar">
        <span>State Dir: {snapshot.source.stateDir}</span>
        <span>Updated: {new Date(snapshot.generatedAt).toLocaleTimeString()}</span>
      </footer>

      {toast ? (
        <div className={`ops-toast ${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}

export default App;
