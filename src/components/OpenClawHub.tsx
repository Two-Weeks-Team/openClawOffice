import { useCallback, useMemo, useState } from "react";
import type { OpenClawHubSnapshot } from "../../server/openclaw-hub-types";
import { useOpenClawHub } from "../hooks/useOpenClawHub";
import {
  formatCommitsBehind,
  formatLatencyMs,
  resolveCardSeverity,
  type HubCardId,
  type HubCardSeverity,
} from "../lib/openclaw-hub";
import { HubDetailPanel, type DetailTarget } from "./HubDetailPanel";
import { HubTooltip } from "./HubTooltip";

type ExpandedCards = Record<string, boolean>;

const SEVERITY_LABEL: Record<HubCardSeverity, string> = {
  good: "OK",
  warn: "Warning",
  bad: "Error",
  neutral: "Info",
};

function SeverityDot({ severity }: { severity: HubCardSeverity }) {
  return (
    <span
      className={`hub-severity-dot severity-${severity}`}
      title={SEVERITY_LABEL[severity]}
      aria-label={SEVERITY_LABEL[severity]}
    />
  );
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function OpenClawHub() {
  const { snapshot, loading, error, refresh } = useOpenClawHub();
  const [expandedCards, setExpandedCards] = useState<ExpandedCards>({});
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const toggleCard = useCallback((cardId: string) => {
    setExpandedCards((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  }, []);

  const openDetail = useCallback((target: DetailTarget) => {
    setDetailTarget(target);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailTarget(null);
  }, []);

  const severities = useMemo<Record<HubCardId, HubCardSeverity>>(() => {
    if (!snapshot) {
      return {
        project: "neutral",
        gateway: "neutral",
        channels: "neutral",
        skills: "neutral",
        memory: "neutral",
        cron: "neutral",
        docs: "neutral",
        changelog: "neutral",
      };
    }
    return {
      project: resolveCardSeverity(snapshot, "project"),
      gateway: resolveCardSeverity(snapshot, "gateway"),
      channels: resolveCardSeverity(snapshot, "channels"),
      skills: resolveCardSeverity(snapshot, "skills"),
      memory: resolveCardSeverity(snapshot, "memory"),
      cron: resolveCardSeverity(snapshot, "cron"),
      docs: resolveCardSeverity(snapshot, "docs"),
      changelog: resolveCardSeverity(snapshot, "changelog"),
    };
  }, [snapshot]);

  if (!snapshot && loading) {
    return (
      <div className="hub-container" role="status" aria-busy="true">
        <div className="hub-loading">Loading OpenClaw Hub...</div>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="hub-container">
        <div className="hub-error">
          <strong>Hub Error</strong>
          <p>{error}</p>
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="hub-container">
      <header className="hub-header">
        <div className="hub-header-title">
          <h2>OpenClaw Status Hub</h2>
          <span className="hub-header-meta">
            {snapshot.project?.version ? `v${snapshot.project.version}` : ""} · {snapshot.projectDir}
          </span>
        </div>
        <div className="hub-header-actions">
          <button type="button" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <span className="hub-header-updated">
            {new Date(snapshot.generatedAt).toLocaleTimeString()}
          </span>
        </div>
      </header>

      {snapshot.diagnostics.length > 0 && (
        <section className="hub-diagnostics" role="status">
          {snapshot.diagnostics.slice(0, 3).map((d, i) => (
            <span key={`${d.code}-${i}`} className={`hub-diag hub-diag-${d.level}`}>
              [{d.code}] {d.message}
            </span>
          ))}
        </section>
      )}

      <div className="hub-cards-grid">
        {/* Project Card */}
        <ProjectCard
          snapshot={snapshot}
          severity={severities.project}
          expanded={expandedCards.project}
          onToggle={() => toggleCard("project")}
        />

        {/* Gateway Card */}
        <GatewayCard
          snapshot={snapshot}
          severity={severities.gateway}
          expanded={expandedCards.gateway}
          onToggle={() => toggleCard("gateway")}
        />

        {/* Channels Card */}
        <ChannelsCard
          snapshot={snapshot}
          severity={severities.channels}
          expanded={expandedCards.channels}
          onToggle={() => toggleCard("channels")}
          onOpenDetail={openDetail}
        />

        {/* Skills Card */}
        <SkillsCard
          snapshot={snapshot}
          severity={severities.skills}
          expanded={expandedCards.skills}
          onToggle={() => toggleCard("skills")}
          onOpenDetail={openDetail}
        />

        {/* Memory Card */}
        <MemoryCard
          snapshot={snapshot}
          severity={severities.memory}
          expanded={expandedCards.memory}
          onToggle={() => toggleCard("memory")}
        />

        {/* Cron Card */}
        <CronCard
          snapshot={snapshot}
          severity={severities.cron}
          expanded={expandedCards.cron}
          onToggle={() => toggleCard("cron")}
        />

        {/* Docs Card */}
        <DocsCard
          snapshot={snapshot}
          severity={severities.docs}
          expanded={expandedCards.docs}
          onToggle={() => toggleCard("docs")}
          onOpenDetail={openDetail}
        />

        {/* Changelog Card */}
        <ChangelogCard
          snapshot={snapshot}
          severity={severities.changelog}
          expanded={expandedCards.changelog}
          onToggle={() => toggleCard("changelog")}
          onOpenDetail={openDetail}
        />
      </div>

      <HubDetailPanel target={detailTarget} onClose={closeDetail} />
    </div>
  );
}

/* ─── Individual Card Components ─── */

type CardShellProps = {
  cardId: string;
  title: string;
  severity: HubCardSeverity;
  glance: string;
  tooltipLines: string[];
  expanded: boolean | undefined;
  onToggle: () => void;
  children?: React.ReactNode;
};

function CardShell({
  cardId,
  title,
  severity,
  glance,
  tooltipLines,
  expanded,
  onToggle,
  children,
}: CardShellProps) {
  return (
    <article className={`hub-card severity-${severity} ${expanded ? "hub-card-expanded" : "hub-card-collapsed"}`}>
      <header className="hub-card-header" onClick={onToggle} role="button" tabIndex={0}
        aria-expanded={!!expanded}
        aria-controls={`hub-card-body-${cardId}`}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <div className="hub-card-header-left">
          <SeverityDot severity={severity} />
          <HubTooltip tip={tooltipLines.join("\n")}>
            <strong>{title}</strong>
          </HubTooltip>
        </div>
        <span className="hub-card-glance">{glance}</span>
      </header>
      <div
        id={`hub-card-body-${cardId}`}
        className="hub-card-body"
        hidden={!expanded}
      >
        {children}
      </div>
    </article>
  );
}

function ProjectCard({
  snapshot,
  severity,
  expanded,
  onToggle,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
}) {
  const git = snapshot.git;
  const project = snapshot.project;
  const glance = [
    project ? `v${project.version}` : "?",
    git ? git.branch : "",
    git ? formatCommitsBehind(git.commitsBehind) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const tooltipLines = git
    ? [
        `Commit: ${git.lastCommitHash} ${git.lastCommitMessage}`,
        `Date: ${git.lastCommitDate}`,
        git.isDirty ? `Dirty: ${git.dirtyFiles.length} files` : "Clean",
      ]
    : ["Git status unavailable"];

  return (
    <CardShell
      cardId="project"
      title="Project"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      <dl className="hub-card-kv">
        {project && (
          <>
            <div><dt>Name</dt><dd>{project.name}</dd></div>
            <div><dt>Version</dt><dd>{project.version}</dd></div>
            <div><dt>Description</dt><dd>{project.description}</dd></div>
            <div><dt>Dependencies</dt><dd>{project.depsCount} deps + {project.devDepsCount} devDeps</dd></div>
            <div><dt>Scripts</dt><dd>{project.scripts.length} ({project.scripts.slice(0, 8).join(", ")})</dd></div>
            {project.nodeEngine && <div><dt>Node Engine</dt><dd>{project.nodeEngine}</dd></div>}
          </>
        )}
        {git && (
          <>
            <div><dt>Branch</dt><dd>{git.branch}</dd></div>
            <div><dt>Behind origin/main</dt><dd>{formatCommitsBehind(git.commitsBehind)}</dd></div>
            <div><dt>Last Commit</dt><dd><code>{git.lastCommitHash}</code> {git.lastCommitMessage}</dd></div>
            <div><dt>Commit Date</dt><dd>{formatDate(git.lastCommitDate)}</dd></div>
            {git.isDirty && (
              <div><dt>Dirty Files</dt><dd>{git.dirtyFiles.join(", ")}</dd></div>
            )}
          </>
        )}
      </dl>
    </CardShell>
  );
}

function GatewayCard({
  snapshot,
  severity,
  expanded,
  onToggle,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
}) {
  const gw = snapshot.gateway;
  const glance = gw?.reachable
    ? `Online · ${formatLatencyMs(gw.latencyMs)}`
    : "Offline";

  const tooltipLines = gw
    ? [`URL: ${gw.url}`, `Port: ${gw.port}`, gw.reachable ? `Latency: ${formatLatencyMs(gw.latencyMs)}` : "Not reachable"]
    : ["Gateway status unavailable"];

  return (
    <CardShell
      cardId="gateway"
      title="Gateway"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      <dl className="hub-card-kv">
        {gw && (
          <>
            <div><dt>Status</dt><dd>{gw.reachable ? "Online" : "Offline"}</dd></div>
            <div><dt>URL</dt><dd><code>{gw.url}</code></dd></div>
            <div><dt>Port</dt><dd>{gw.port}</dd></div>
            {gw.latencyMs !== null && <div><dt>Latency</dt><dd>{gw.latencyMs}ms</dd></div>}
          </>
        )}
      </dl>
    </CardShell>
  );
}

function ChannelsCard({
  snapshot,
  severity,
  expanded,
  onToggle,
  onOpenDetail,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
  onOpenDetail: (target: DetailTarget) => void;
}) {
  const count = snapshot.channels.length;
  const glance = `${count} Channel${count !== 1 ? "s" : ""}`;
  const tooltipLines = snapshot.channels
    .slice(0, 5)
    .map((ch) => ch.name)
    .concat(count > 5 ? [`+${count - 5} more`] : []);

  return (
    <CardShell
      cardId="channels"
      title="Channels"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      <ul className="hub-item-list">
        {snapshot.channels.map((ch) => (
          <li key={ch.name}>
            <button
              type="button"
              className="hub-item-link"
              onClick={() => onOpenDetail({ kind: "channel", channel: ch })}
            >
              {ch.name}
            </button>
            <span className="hub-item-meta">{ch.sourceDir} · {ch.fileCount} files</span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function SkillsCard({
  snapshot,
  severity,
  expanded,
  onToggle,
  onOpenDetail,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
  onOpenDetail: (target: DetailTarget) => void;
}) {
  const count = snapshot.skills.length;
  const glance = `${count} Skill${count !== 1 ? "s" : ""}`;
  const tooltipLines = snapshot.skills
    .slice(0, 10)
    .map((s) => s.name)
    .concat(count > 10 ? [`+${count - 10} more`] : []);

  return (
    <CardShell
      cardId="skills"
      title="Skills"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      <ul className="hub-item-list hub-item-list-compact">
        {snapshot.skills.map((skill) => (
          <li key={skill.name}>
            <button
              type="button"
              className="hub-item-link"
              onClick={() => onOpenDetail({ kind: "skill", skill })}
            >
              {skill.name}
            </button>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function MemoryCard({
  snapshot,
  severity,
  expanded,
  onToggle,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
}) {
  const mem = snapshot.memory;
  const glance = mem ? `${mem.files.length} modules` : "Not found";
  const tooltipLines = mem ? mem.files.slice(0, 5) : ["Memory module not detected"];

  return (
    <CardShell
      cardId="memory"
      title="Memory"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      {mem && (
        <ul className="hub-item-list hub-item-list-compact">
          {mem.files.map((f) => (
            <li key={f}><code>{f}</code></li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function CronCard({
  snapshot,
  severity,
  expanded,
  onToggle,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
}) {
  const cron = snapshot.cron;
  const glance = cron ? `${cron.files.length} modules` : "Not found";
  const tooltipLines = cron ? cron.files.slice(0, 5) : ["Cron module not detected"];

  return (
    <CardShell
      cardId="cron"
      title="Cron"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      {cron && (
        <ul className="hub-item-list hub-item-list-compact">
          {cron.files.map((f) => (
            <li key={f}><code>{f}</code></li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function DocsCard({
  snapshot,
  severity,
  expanded,
  onToggle,
  onOpenDetail,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
  onOpenDetail: (target: DetailTarget) => void;
}) {
  const count = snapshot.docs.length;
  const glance = `${count} Page${count !== 1 ? "s" : ""}`;
  const tooltipLines = snapshot.docs
    .slice(0, 5)
    .map((d) => d.title);

  return (
    <CardShell
      cardId="docs"
      title="Docs"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      <ul className="hub-item-list">
        {snapshot.docs.map((doc) => (
          <li key={doc.path}>
            <button
              type="button"
              className="hub-item-link"
              onClick={() =>
                onOpenDetail({ kind: "doc", path: doc.path, title: doc.title })
              }
            >
              {doc.title}
            </button>
            <span className="hub-item-meta">
              {doc.path} · {(doc.sizeBytes / 1024).toFixed(1)}KB
            </span>
            {doc.firstParagraph && (
              <p className="hub-item-excerpt">{doc.firstParagraph}</p>
            )}
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function ChangelogCard({
  snapshot,
  severity,
  expanded,
  onToggle,
  onOpenDetail,
}: {
  snapshot: OpenClawHubSnapshot;
  severity: HubCardSeverity;
  expanded: boolean | undefined;
  onToggle: () => void;
  onOpenDetail: (target: DetailTarget) => void;
}) {
  const entries = snapshot.changelog;
  const latest = entries[0];
  const glance = latest ? `Latest: ${latest.version}` : "No changelog";
  const tooltipLines = entries.slice(0, 3).map(
    (e) => `${e.version}: ${e.changedCount} changes, ${e.fixedCount} fixes`,
  );

  return (
    <CardShell
      cardId="changelog"
      title="Changelog"
      severity={severity}
      glance={glance}
      tooltipLines={tooltipLines}
      expanded={expanded}
      onToggle={onToggle}
    >
      <ul className="hub-item-list">
        {entries.map((entry) => (
          <li key={entry.version}>
            <button
              type="button"
              className="hub-item-link"
              onClick={() => onOpenDetail({ kind: "changelog", entry })}
            >
              {entry.version}
            </button>
            <span className="hub-item-meta">
              +{entry.addedCount} added · {entry.fixedCount} fixed · {entry.changedCount} changed
            </span>
            {entry.highlights.length > 0 && (
              <p className="hub-item-excerpt">{entry.highlights[0]}</p>
            )}
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
