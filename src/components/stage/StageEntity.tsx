import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type StageLodLevel,
} from "../../lib/stage-lod";
import { type StageEntityRenderModel } from "../../lib/stage-render-batch";
import type { OfficeEntity, OfficeRun } from "../../types/office";

export function statusFocusAccent(status: OfficeEntity["status"]): string {
  if (status === "error") {
    return "255, 150, 150";
  }
  if (status === "active") {
    return "255, 217, 136";
  }
  if (status === "ok") {
    return "130, 255, 190";
  }
  if (status === "idle") {
    return "139, 226, 255";
  }
  return "173, 231, 250";
}

function formatTimeRemaining(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

type EntityDatapadProps = {
  entity: OfficeEntity;
  run?: OfficeRun;
  generatedAt: number;
};

export const EntityDatapad = memo(function EntityDatapad({
  entity,
  run,
  generatedAt,
}: EntityDatapadProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [bubbleOverflows, setBubbleOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (el) {
      setBubbleOverflows(el.scrollHeight > el.clientHeight);
    } else {
      setBubbleOverflows(false);
    }
  }, [entity.bubble, entity.task]);

  const durationText = useMemo(() => {
    if (entity.kind === "subagent" && run) {
      const startTime = run.startedAt ?? run.createdAt;
      const endTime = run.endedAt ?? generatedAt;
      const durationMs = endTime - startTime;
      if (durationMs < 1000) return "<1s";
      if (durationMs < 60_000) return `${Math.floor(durationMs / 1000)}s`;
      if (durationMs < 3_600_000) return `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`;
      return `${Math.floor(durationMs / 3_600_000)}h ${Math.floor((durationMs % 3_600_000) / 60_000)}m`;
    }
    if (entity.lastUpdatedAt) {
      const age = generatedAt - entity.lastUpdatedAt;
      if (age < 60_000) return `${Math.max(1, Math.floor(age / 1000))}s ago`;
      if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
      return `${Math.floor(age / 3_600_000)}h ago`;
    }
    return "—";
  }, [entity, run, generatedAt]);

  const statusLabel = entity.kind === "agent"
    ? `${entity.sessions} session${entity.sessions === 1 ? "" : "s"}`
    : entity.status;

  return (
    <div className="entity-datapad">
      <div className="datapad-header">{entity.label}</div>
      <div className="datapad-row">
        <span className="datapad-label">Status</span>
        <span className={`datapad-value datapad-status-${entity.status}`}>
          <span className="datapad-status-dot" />
          {statusLabel}
        </span>
      </div>
      <div className="datapad-row">
        <span className="datapad-label">{entity.kind === "subagent" ? "Duration" : "Last active"}</span>
        <span className="datapad-value">{durationText}</span>
      </div>
      {entity.kind === "subagent" && entity.parentAgentId ? (
        <div className="datapad-row">
          <span className="datapad-label">Parent</span>
          <span className="datapad-value datapad-parent">{entity.parentAgentId}</span>
        </div>
      ) : null}
      {entity.bubble ? (
        <div className="datapad-bubble-section">
          <div className="datapad-bubble-label">Latest message</div>
          <div ref={bubbleRef} className={`datapad-bubble${bubbleOverflows ? " has-overflow" : ""}`}>{entity.bubble}</div>
        </div>
      ) : entity.task ? (
        <div className="datapad-bubble-section">
          <div className="datapad-bubble-label">Task</div>
          <div ref={bubbleRef} className={`datapad-bubble${bubbleOverflows ? " has-overflow" : ""}`}>{entity.task}</div>
        </div>
      ) : null}
    </div>
  );
});

type EntityTokenViewProps = {
  model: StageEntityRenderModel;
  lodLevel: StageLodLevel;
  densityMode: "standard" | "compact" | "dense";
  onSelectEntity?: (entityId: string, mode?: "single" | "toggle") => void;
  onHoverEntity?: (entityId: string | null, rect: DOMRect | null) => void;
};

export const EntityTokenView = memo(function EntityTokenView({
  model,
  lodLevel,
  densityMode,
  onSelectEntity,
  onHoverEntity,
}: EntityTokenViewProps) {
  const showLabel = lodLevel !== "distant" && densityMode !== "dense";
  const showStatus = lodLevel === "detail" && densityMode === "standard";
  return (
    <article
      className={`${model.className} lod-${lodLevel} density-${densityMode}`}
      style={model.style}
      role="button"
      tabIndex={0}
      title={model.fullLabel}
      aria-label={`Open detail panel for ${model.label}`}
      aria-pressed={model.isSelected}
      onClick={(event) => {
        const multiToggle = event.metaKey || event.ctrlKey;
        onSelectEntity?.(model.id, multiToggle ? "toggle" : "single");
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectEntity?.(model.id, "single");
        }
      }}
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onHoverEntity?.(model.id, rect);
      }}
      onMouseLeave={() => onHoverEntity?.(null, null)}
    >
      <div className="chip-status-bar" />
      {model.avatarStyle ? <div className="chip-avatar" style={model.avatarStyle} /> : null}
      {showLabel ? (
        <div className="chip-content">
          <span className="chip-label">
            {model.label}
            {model.secondaryLabel ? <span className="chip-secondary">{model.secondaryLabel}</span> : null}
          </span>
          {showStatus ? <span className="chip-status">{model.statusLabel}</span> : null}
          {model.expiresAt ? (
            <span className="chip-expires" title="Time until removal">
              {formatTimeRemaining(model.expiresAt)}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});
