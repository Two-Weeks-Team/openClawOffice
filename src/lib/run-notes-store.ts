export const RUN_KNOWLEDGE_STORAGE_KEY = "openclawoffice.run-knowledge.v1";
const MAX_RUN_KNOWLEDGE_RECORDS = 400;

export type RunKnowledgeEntry = {
  runId: string;
  note: string;
  tags: string[];
  updatedAt: number;
};

export type UpsertRunKnowledgeInput = {
  runId: string;
  note?: string;
  tags?: string[];
  updatedAt?: number;
};

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeRunId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeNote(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const compact = item.trim().replace(/^#+/, "").toLowerCase();
    if (!compact || seen.has(compact)) {
      continue;
    }
    seen.add(compact);
    normalized.push(compact);
  }
  return normalized;
}

function normalizeEntry(candidate: unknown): RunKnowledgeEntry | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const runId = normalizeRunId(record.runId);
  const note = normalizeNote(record.note);
  const tags = normalizeTags(record.tags);
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : 0;
  if (!runId) {
    return null;
  }
  if (!note && tags.length === 0) {
    return null;
  }
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return null;
  }
  return {
    runId,
    note,
    tags,
    updatedAt,
  };
}

export function parseRunKnowledgeEntries(raw: string | null): RunKnowledgeEntry[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const dedupedByRun = new Map<string, RunKnowledgeEntry>();
    for (const item of parsed) {
      const normalized = normalizeEntry(item);
      if (!normalized) {
        continue;
      }
      const existing = dedupedByRun.get(normalized.runId);
      if (!existing || normalized.updatedAt > existing.updatedAt) {
        dedupedByRun.set(normalized.runId, normalized);
      }
    }
    return [...dedupedByRun.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[run-notes-store] parse error:", error);
    }
    return [];
  }
}

export function loadRunKnowledgeEntries(): RunKnowledgeEntry[] {
  if (!hasBrowserStorage()) {
    return [];
  }
  try {
    return parseRunKnowledgeEntries(window.localStorage.getItem(RUN_KNOWLEDGE_STORAGE_KEY));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[run-notes-store] load error:", error);
    }
    return [];
  }
}

export function persistRunKnowledgeEntries(entries: RunKnowledgeEntry[]): void {
  if (!hasBrowserStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(RUN_KNOWLEDGE_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[run-notes-store] persist error:", error);
    }
  }
}

export function indexRunKnowledgeByRunId(
  entries: RunKnowledgeEntry[],
): Map<string, RunKnowledgeEntry> {
  return new Map(entries.map((entry) => [entry.runId, entry] as const));
}

export function upsertRunKnowledgeEntry(
  existing: RunKnowledgeEntry[],
  input: UpsertRunKnowledgeInput,
): RunKnowledgeEntry[] {
  const runId = normalizeRunId(input.runId);
  if (!runId) {
    return existing;
  }
  const note = normalizeNote(input.note);
  const tags = normalizeTags(input.tags);
  const withoutCurrent = existing.filter((entry) => entry.runId !== runId);
  if (!note && tags.length === 0) {
    return withoutCurrent;
  }
  const updatedAt = typeof input.updatedAt === "number" && input.updatedAt > 0
    ? input.updatedAt
    : Date.now();
  const nextEntry: RunKnowledgeEntry = {
    runId,
    note,
    tags,
    updatedAt,
  };
  return [nextEntry, ...withoutCurrent]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RUN_KNOWLEDGE_RECORDS);
}

export function removeRunKnowledgeEntry(
  existing: RunKnowledgeEntry[],
  runId: string,
): RunKnowledgeEntry[] {
  const normalized = normalizeRunId(runId);
  if (!normalized) {
    return existing;
  }
  return existing.filter((entry) => entry.runId !== normalized);
}
