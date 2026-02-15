import type { OfficeEntity, OfficeRun } from "../types/office";

export type StagePlacement = {
  entity: OfficeEntity;
  roomId: string;
  x: number;
  y: number;
  overflowed: boolean;
};

export type StagePriorityBand = "critical" | "high" | "normal";

type StageAlertSeverity = "critical" | "warning" | null;

export type StageEntityPriority = {
  score: number;
  band: StagePriorityBand;
  alertSeverity: StageAlertSeverity;
  isSecondary: boolean;
};

export type EvaluateStageEntityPriorityInput = {
  entity: OfficeEntity;
  isSelected: boolean;
  isPinned: boolean;
  isWatched: boolean;
  hasCriticalAlertTargets: boolean;
  criticalAlertRunIdSet: Set<string>;
  criticalAlertAgentIdSet: Set<string>;
  warningAlertRunIdSet: Set<string>;
  warningAlertAgentIdSet: Set<string>;
};

export type StageEntityRenderModel = {
  id: string;
  kind: OfficeEntity["kind"];
  label: string;
  statusLabel: string;
  className: string;
  style: {
    left: number;
    top: number;
    zIndex: number;
  };
  isSelected: boolean;
  priorityBand: StagePriorityBand;
  priorityScore: number;
};

export type BuildStageEntityRenderModelsInput = {
  placements: StagePlacement[];
  generatedAt: number;
  runById: Map<string, OfficeRun>;
  selectedEntityIdSet: Set<string>;
  pinnedEntityIdSet: Set<string>;
  watchedEntityIdSet: Set<string>;
  filteredEntityIdSet: Set<string>;
  hasEntityFilter: boolean;
  normalizedRoomFilterId: string | null;
  hasOpsFilter: boolean;
  focusMode: boolean;
  normalizedHighlightRunId: string | null;
  normalizedHighlightAgentId: string | null;
  highlightedRun?: OfficeRun;
  hasTimelineHighlight: boolean;
  hasCriticalAlertTargets: boolean;
  criticalAlertRunIdSet: Set<string>;
  criticalAlertAgentIdSet: Set<string>;
  warningAlertRunIdSet: Set<string>;
  warningAlertAgentIdSet: Set<string>;
  entityZOffset: number;
  spawnPulseWindowMs: number;
  startOrbitWindowMs: number;
  endSettleWindowMs: number;
  cleanupFadeWindowMs: number;
  errorShakeWindowMs: number;
};

const STATUS_PRIORITY_WEIGHT: Record<OfficeEntity["status"], number> = {
  active: 130,
  idle: 36,
  offline: 14,
  ok: 65,
  error: 260,
};

function statusClass(entity: OfficeEntity): string {
  if (entity.status === "active") {
    return "is-active";
  }
  if (entity.status === "idle") {
    return "is-idle";
  }
  if (entity.status === "error") {
    return "is-error";
  }
  if (entity.status === "ok") {
    return "is-ok";
  }
  return "is-offline";
}

function getAge(now: number, timestamp: number | undefined, fallback = Number.POSITIVE_INFINITY): number {
  if (typeof timestamp !== "number") {
    return fallback;
  }
  return Math.max(0, now - timestamp);
}

function isLinkedToTimelineHighlight(params: {
  entity: OfficeEntity;
  normalizedHighlightRunId: string | null;
  normalizedHighlightAgentId: string | null;
  highlightedRun?: OfficeRun;
}): boolean {
  const { entity, highlightedRun, normalizedHighlightAgentId, normalizedHighlightRunId } = params;

  let runHighlightMatch = false;
  if (normalizedHighlightRunId) {
    if (entity.kind === "subagent") {
      runHighlightMatch = entity.runId === normalizedHighlightRunId;
    } else if (highlightedRun) {
      runHighlightMatch =
        highlightedRun.parentAgentId === entity.agentId ||
        highlightedRun.childAgentId === entity.agentId;
    }
  }

  let agentHighlightMatch = false;
  if (normalizedHighlightAgentId) {
    agentHighlightMatch =
      entity.agentId === normalizedHighlightAgentId ||
      entity.parentAgentId === normalizedHighlightAgentId;
  }

  return runHighlightMatch || agentHighlightMatch;
}

function entityMatchesRunAlert(entity: OfficeEntity, runIdSet: Set<string>): boolean {
  return entity.kind === "subagent" && typeof entity.runId === "string" && runIdSet.has(entity.runId);
}

function entityMatchesAgentAlert(entity: OfficeEntity, agentIdSet: Set<string>): boolean {
  if (agentIdSet.has(entity.agentId)) {
    return true;
  }
  return entity.kind === "subagent" && typeof entity.parentAgentId === "string"
    ? agentIdSet.has(entity.parentAgentId)
    : false;
}

function resolveEntityAlertSeverity(
  input: Pick<
    EvaluateStageEntityPriorityInput,
    | "entity"
    | "criticalAlertRunIdSet"
    | "criticalAlertAgentIdSet"
    | "warningAlertRunIdSet"
    | "warningAlertAgentIdSet"
  >,
): StageAlertSeverity {
  const hasCriticalAlert =
    entityMatchesRunAlert(input.entity, input.criticalAlertRunIdSet) ||
    entityMatchesAgentAlert(input.entity, input.criticalAlertAgentIdSet);
  if (hasCriticalAlert) {
    return "critical";
  }

  const hasWarningAlert =
    entityMatchesRunAlert(input.entity, input.warningAlertRunIdSet) ||
    entityMatchesAgentAlert(input.entity, input.warningAlertAgentIdSet);
  return hasWarningAlert ? "warning" : null;
}

export function evaluateStageEntityPriority(
  input: EvaluateStageEntityPriorityInput,
): StageEntityPriority {
  const alertSeverity = resolveEntityAlertSeverity(input);
  let score = STATUS_PRIORITY_WEIGHT[input.entity.status];

  if (input.isSelected) {
    score += 320;
  }
  if (input.isWatched) {
    score += 270;
  }
  if (input.isPinned) {
    score += 170;
  }
  if (alertSeverity === "critical") {
    score += 340;
  } else if (alertSeverity === "warning") {
    score += 190;
  }

  let band: StagePriorityBand = "normal";
  if (alertSeverity === "critical" || input.entity.status === "error") {
    band = "critical";
  } else if (
    alertSeverity === "warning" ||
    input.entity.status === "active" ||
    input.isSelected ||
    input.isWatched ||
    input.isPinned ||
    score >= 190
  ) {
    band = "high";
  }

  const isSecondary =
    input.hasCriticalAlertTargets &&
    band === "normal" &&
    !input.isSelected &&
    !input.isWatched &&
    !input.isPinned;

  return {
    score,
    band,
    alertSeverity,
    isSecondary,
  };
}

export function buildStageEntityRenderModels(
  input: BuildStageEntityRenderModelsInput,
): StageEntityRenderModel[] {
  const models: StageEntityRenderModel[] = [];

  for (const placement of input.placements) {
    const entity = placement.entity;
    const isSelected = input.selectedEntityIdSet.has(entity.id);
    const isPinned = input.pinnedEntityIdSet.has(entity.id);
    const isWatched = input.watchedEntityIdSet.has(entity.id);

    const matchesEntityFilter = !input.hasEntityFilter || input.filteredEntityIdSet.has(entity.id);
    const matchesRoomFilter =
      !input.normalizedRoomFilterId || placement.roomId === input.normalizedRoomFilterId;
    const matchesOpsFilter = matchesEntityFilter && matchesRoomFilter;

    if (input.hasOpsFilter && !input.focusMode && !matchesOpsFilter && !isSelected && !isWatched) {
      continue;
    }

    const linkedRun =
      entity.kind === "subagent" && entity.runId ? input.runById.get(entity.runId) : undefined;
    const entityAgeMs = getAge(input.generatedAt, entity.lastUpdatedAt);
    const spawnAgeMs = getAge(input.generatedAt, linkedRun?.createdAt, entityAgeMs);
    const runStartAt = linkedRun?.startedAt ?? linkedRun?.createdAt;
    const startAgeMs = getAge(input.generatedAt, runStartAt, entityAgeMs);
    const endAgeMs = getAge(input.generatedAt, linkedRun?.endedAt, entityAgeMs);
    const cleanupAgeMs = getAge(input.generatedAt, linkedRun?.cleanupCompletedAt);

    const showSpawnPulse =
      entity.kind === "subagent" && entity.status === "active" && spawnAgeMs <= input.spawnPulseWindowMs;
    const showStartOrbit =
      entity.status === "active" &&
      entity.kind === "subagent" &&
      startAgeMs <= input.startOrbitWindowMs;
    const showRunOrbit = entity.status === "active";
    const showErrorMotion = entity.status === "error" && entityAgeMs <= input.errorShakeWindowMs;
    const showEndSettle =
      entity.kind === "subagent" && entity.status === "ok" && endAgeMs <= input.endSettleWindowMs;
    const showCleanupFade =
      entity.kind === "subagent" &&
      entity.status === "ok" &&
      cleanupAgeMs <= input.cleanupFadeWindowMs;

    const motionClasses = [
      showSpawnPulse ? "motion-spawn" : "",
      showStartOrbit ? "motion-start" : "",
      showRunOrbit ? "motion-run" : "",
      showErrorMotion ? "motion-error" : "",
      showEndSettle ? "motion-end" : "",
      showCleanupFade ? "motion-cleanup" : "",
      placement.overflowed ? "is-overflowed" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const isLinked = isLinkedToTimelineHighlight({
      entity,
      highlightedRun: input.highlightedRun,
      normalizedHighlightAgentId: input.normalizedHighlightAgentId,
      normalizedHighlightRunId: input.normalizedHighlightRunId,
    });

    const isMutedByTimeline = input.hasTimelineHighlight && !isLinked;
    const isMutedByFocus = input.hasOpsFilter && input.focusMode && !matchesOpsFilter && !isWatched;
    const priority = evaluateStageEntityPriority({
      entity,
      isSelected,
      isPinned,
      isWatched,
      hasCriticalAlertTargets: input.hasCriticalAlertTargets,
      criticalAlertRunIdSet: input.criticalAlertRunIdSet,
      criticalAlertAgentIdSet: input.criticalAlertAgentIdSet,
      warningAlertRunIdSet: input.warningAlertRunIdSet,
      warningAlertAgentIdSet: input.warningAlertAgentIdSet,
    });
    const renderPriorityBoost = Math.min(460, Math.max(0, Math.round(priority.score)));

    const className = [
      "entity-token",
      statusClass(entity),
      entity.kind,
      `priority-${priority.band}`,
      priority.alertSeverity ? `alert-${priority.alertSeverity}` : "",
      motionClasses,
      isSelected ? "is-selected" : "",
      isPinned ? "is-pinned" : "",
      isWatched ? "is-watched" : "",
      isLinked ? "is-linked" : "",
      input.hasOpsFilter && matchesOpsFilter ? "is-filter-hit" : "",
      priority.isSecondary ? "is-secondary" : "",
      isMutedByFocus ? "is-filtered-out" : "",
      isMutedByTimeline || isMutedByFocus ? "is-muted" : "",
    ]
      .filter(Boolean)
      .join(" ");

    models.push({
      id: entity.id,
      kind: entity.kind,
      label: entity.label,
      statusLabel:
        entity.kind === "agent"
          ? `${entity.sessions} session${entity.sessions === 1 ? "" : "s"}`
          : entity.status,
      className,
      style: {
        left: placement.x,
        top: placement.y,
        zIndex: input.entityZOffset + Math.round(placement.y) + renderPriorityBoost,
      },
      isSelected,
      priorityBand: priority.band,
      priorityScore: priority.score,
    });
  }

  return models;
}
