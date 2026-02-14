export const ENTITY_BATCH_ACTIONS_STORAGE_KEY = "openclawoffice.entity-batch-actions.v1";

type BatchActionStateShape = {
  pinnedEntityIds: string[];
  watchedEntityIds: string[];
  mutedEntityIds: string[];
};

export type BatchActionState = BatchActionStateShape;

export type BatchActionKind =
  | "pin"
  | "unpin"
  | "watch"
  | "unwatch"
  | "mute"
  | "unmute"
  | "clear";

function createEmptyBatchActionState(): BatchActionState {
  return {
    pinnedEntityIds: [],
    watchedEntityIds: [],
    mutedEntityIds: [],
  };
}

function normalizeEntityIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      continue;
    }
    normalized.push(candidate.trim());
  }
  return [...new Set(normalized)];
}

export function normalizeBatchActionState(input: unknown): BatchActionState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return createEmptyBatchActionState();
  }
  const candidate = input as Record<string, unknown>;
  return {
    pinnedEntityIds: normalizeEntityIdList(candidate.pinnedEntityIds),
    watchedEntityIds: normalizeEntityIdList(candidate.watchedEntityIds),
    mutedEntityIds: normalizeEntityIdList(candidate.mutedEntityIds),
  };
}

export function loadBatchActionState(): BatchActionState {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return createEmptyBatchActionState();
  }
  try {
    const raw = window.localStorage.getItem(ENTITY_BATCH_ACTIONS_STORAGE_KEY);
    if (!raw) {
      return createEmptyBatchActionState();
    }
    return normalizeBatchActionState(JSON.parse(raw));
  } catch {
    return createEmptyBatchActionState();
  }
}

export function persistBatchActionState(state: BatchActionState) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ENTITY_BATCH_ACTIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage persistence errors in restricted browser modes.
  }
}

function applySetOperation(
  current: string[],
  entityIds: string[],
  mode: "add" | "remove",
): string[] {
  const set = new Set(current);
  for (const entityId of entityIds) {
    if (mode === "add") {
      set.add(entityId);
    } else {
      set.delete(entityId);
    }
  }
  return [...set];
}

export function applyBatchAction(
  state: BatchActionState,
  entityIds: string[],
  action: BatchActionKind,
): BatchActionState {
  const normalizedEntityIds = [
    ...new Set(
      entityIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ];
  if (normalizedEntityIds.length === 0) {
    return state;
  }
  if (action === "clear") {
    return {
      pinnedEntityIds: applySetOperation(state.pinnedEntityIds, normalizedEntityIds, "remove"),
      watchedEntityIds: applySetOperation(state.watchedEntityIds, normalizedEntityIds, "remove"),
      mutedEntityIds: applySetOperation(state.mutedEntityIds, normalizedEntityIds, "remove"),
    };
  }
  if (action === "pin" || action === "unpin") {
    return {
      ...state,
      pinnedEntityIds: applySetOperation(
        state.pinnedEntityIds,
        normalizedEntityIds,
        action === "pin" ? "add" : "remove",
      ),
    };
  }
  if (action === "watch" || action === "unwatch") {
    return {
      ...state,
      watchedEntityIds: applySetOperation(
        state.watchedEntityIds,
        normalizedEntityIds,
        action === "watch" ? "add" : "remove",
      ),
    };
  }
  return {
    ...state,
    mutedEntityIds: applySetOperation(
      state.mutedEntityIds,
      normalizedEntityIds,
      action === "mute" ? "add" : "remove",
    ),
  };
}
