export const RUN_COMPARISON_STORAGE_KEY = "openclawoffice.run-comparisons.v1";
const MAX_SAVED_COMPARISONS = 20;

export type SavedRunComparison = {
  id: string;
  entityId: string;
  baselineRunId: string;
  candidateRunId: string;
  createdAt: number;
};

function normalizeSavedRunComparison(candidate: unknown): SavedRunComparison | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.entityId !== "string" ||
    typeof record.baselineRunId !== "string" ||
    typeof record.candidateRunId !== "string" ||
    typeof record.createdAt !== "number"
  ) {
    return null;
  }
  if (!record.id || !record.entityId || !record.baselineRunId || !record.candidateRunId) {
    return null;
  }
  return {
    id: record.id,
    entityId: record.entityId,
    baselineRunId: record.baselineRunId,
    candidateRunId: record.candidateRunId,
    createdAt: record.createdAt,
  };
}

export function parseSavedRunComparisons(raw: string | null): SavedRunComparison[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeSavedRunComparison(item))
      .filter((item): item is SavedRunComparison => item !== null)
      .sort((left, right) => right.createdAt - left.createdAt);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[run-comparison-store] parse error:", error);
    }
    return [];
  }
}

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadSavedRunComparisons(): SavedRunComparison[] {
  if (!hasBrowserStorage()) {
    return [];
  }
  try {
    return parseSavedRunComparisons(window.localStorage.getItem(RUN_COMPARISON_STORAGE_KEY));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[run-comparison-store] load error:", error);
    }
    return [];
  }
}

export function persistSavedRunComparisons(saved: SavedRunComparison[]) {
  if (!hasBrowserStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(RUN_COMPARISON_STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[run-comparison-store] persist error:", error);
    }
  }
}

export function upsertSavedRunComparison(
  existing: SavedRunComparison[],
  candidate: SavedRunComparison,
): SavedRunComparison[] {
  const withoutDuplicate = existing.filter(
    (item) =>
      !(
        item.entityId === candidate.entityId &&
        item.baselineRunId === candidate.baselineRunId &&
        item.candidateRunId === candidate.candidateRunId
      ),
  );
  return [candidate, ...withoutDuplicate]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_SAVED_COMPARISONS);
}

export function removeSavedRunComparison(
  existing: SavedRunComparison[],
  id: string,
): SavedRunComparison[] {
  return existing.filter((item) => item.id !== id);
}
