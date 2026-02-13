import "./App.css";
import { EventRail } from "./components/EventRail";
import { OfficeStage } from "./components/OfficeStage";
import { useOfficeStream } from "./hooks/useOfficeStream";

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
        <OfficeStage snapshot={snapshot} />
        <EventRail events={snapshot.events} />
      </section>

      {diagnostics.length > 0 ? (
        <section className="diagnostic-strip" role="status" aria-live="polite">
          <strong>Data Warnings ({snapshot.diagnostics.length})</strong>
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}:${diagnostic.source}:${index}`}>
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
