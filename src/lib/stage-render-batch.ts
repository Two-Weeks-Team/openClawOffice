import type { OfficeEntity, OfficeRun } from "../types/office";

export type StagePlacement = {
  entity: OfficeEntity;
  roomId: string;
  x: number;
  y: number;
  overflowed: boolean;
};

export type StageOcclusion = {
  left: number;
  right: number;
  top: number;
  bottom: number;
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
  spriteStyle: {
    backgroundImage: string;
    backgroundPosition: string;
  };
  isSelected: boolean;
};

export type BuildStageEntityRenderModelsInput = {
  placements: StagePlacement[];
  occlusionByRoom: Map<string, StageOcclusion>;
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
  entityZOffset: number;
  spawnPulseWindowMs: number;
  startOrbitWindowMs: number;
  endSettleWindowMs: number;
  cleanupFadeWindowMs: number;
  errorShakeWindowMs: number;
};

const MAX_SPRITE_STYLE_CACHE_SIZE = 1_024;
const SPRITE_STYLE_CACHE = new Map<string, { backgroundImage: string; backgroundPosition: string }>();

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function spriteStyleForEntity(entityId: string): {
  backgroundImage: string;
  backgroundPosition: string;
} {
  const cached = SPRITE_STYLE_CACHE.get(entityId);
  if (cached) {
    return cached;
  }

  const framesPerRow = 54;
  const frameSize = 16;
  const spacing = 1;
  const maxRows = 12;
  const totalFrames = framesPerRow * maxRows;
  const frame = hashString(entityId) % totalFrames;
  const col = frame % framesPerRow;
  const row = Math.floor(frame / framesPerRow);
  const stride = frameSize + spacing;

  const spriteStyle = {
    backgroundImage: 'url("/assets/kenney/characters/characters_spritesheet.png")',
    backgroundPosition: `-${col * stride}px -${row * stride}px`,
  };

  if (SPRITE_STYLE_CACHE.size >= MAX_SPRITE_STYLE_CACHE_SIZE) {
    const oldestKey = SPRITE_STYLE_CACHE.keys().next().value;
    if (typeof oldestKey === "string") {
      SPRITE_STYLE_CACHE.delete(oldestKey);
    }
  }

  SPRITE_STYLE_CACHE.set(entityId, spriteStyle);
  return spriteStyle;
}

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

    const occlusion = input.occlusionByRoom.get(placement.roomId);
    const isOccluded = occlusion
      ? placement.x >= occlusion.left &&
        placement.x <= occlusion.right &&
        placement.y >= occlusion.top &&
        placement.y <= occlusion.bottom
      : false;

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
    const renderPriorityBoost = isWatched ? 220 : isPinned ? 140 : 0;

    const className = [
      "entity-token",
      statusClass(entity),
      entity.kind,
      isOccluded ? "is-occluded" : "",
      motionClasses,
      isSelected ? "is-selected" : "",
      isPinned ? "is-pinned" : "",
      isWatched ? "is-watched" : "",
      isLinked ? "is-linked" : "",
      input.hasOpsFilter && matchesOpsFilter ? "is-filter-hit" : "",
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
      spriteStyle: spriteStyleForEntity(entity.id),
      isSelected,
    });
  }

  return models;
}
