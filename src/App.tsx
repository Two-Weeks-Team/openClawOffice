import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { EntityDetailPanel } from "./components/EntityDetailPanel";
import { EventRail } from "./components/EventRail";
import { OfficeStage } from "./components/OfficeStage";
import { useOfficeStream } from "./hooks/useOfficeStream";
import { parseRunIdDeepLink, type TimelineFilters } from "./lib/timeline";

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
  const [timelineFilters, setTimelineFilters] = useState<TimelineFilters>(() => ({
    runId: parseRunIdDeepLink(window.location.search),
    agentId: "",
    status: "all",
  }));
  const activeEvent = useMemo(
    () => snapshot?.events.find((event) => event.id === activeEventId) ?? null,
    [activeEventId, snapshot],
  );

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

      <section className="workspace">
        <OfficeStage
          snapshot={snapshot}
          selectedEntityId={selectedEntityId}
          highlightRunId={highlightRunId}
          highlightAgentId={highlightAgentId}
          onSelectEntity={(entityId) => {
            setSelectedEntityId((prev) => (prev === entityId ? null : entityId));
          }}
        />
        <div className="workspace-side">
          <EventRail
            events={snapshot.events}
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
    </main>
  );
}

export default App;
