import type { OfficeRun, OfficeSnapshot } from "../types/office";

export type EntitySearchIndex = Map<string, string>;

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function pushToken(parts: string[], value: string | undefined) {
  if (!value) {
    return;
  }
  const normalized = normalizeText(value);
  if (normalized.length > 0) {
    parts.push(normalized);
  }
}

function addRun(map: Map<string, OfficeRun[]>, agentId: string, run: OfficeRun) {
  const runs = map.get(agentId);
  if (runs) {
    runs.push(run);
    return;
  }
  map.set(agentId, [run]);
}

function buildRunsByAgent(runs: OfficeRun[]) {
  const map = new Map<string, OfficeRun[]>();
  for (const run of runs) {
    addRun(map, run.parentAgentId, run);
    if (run.childAgentId !== run.parentAgentId) {
      addRun(map, run.childAgentId, run);
    }
  }
  return map;
}

export function buildEntitySearchIndex(snapshot: OfficeSnapshot): EntitySearchIndex {
  const index = new Map<string, string>();
  const runById = new Map(snapshot.runs.map((run) => [run.runId, run]));
  const runsByAgent = buildRunsByAgent(snapshot.runs);

  for (const entity of snapshot.entities) {
    const parts: string[] = [];
    pushToken(parts, entity.id);
    pushToken(parts, entity.label);
    pushToken(parts, entity.agentId);
    pushToken(parts, entity.parentAgentId);
    pushToken(parts, entity.runId);
    pushToken(parts, entity.task);
    pushToken(parts, entity.bubble);
    pushToken(parts, entity.model);
    pushToken(parts, entity.status);

    if (entity.kind === "subagent" && entity.runId) {
      const run = runById.get(entity.runId);
      if (run) {
        pushToken(parts, run.runId);
        pushToken(parts, run.task);
        pushToken(parts, run.parentAgentId);
        pushToken(parts, run.childAgentId);
      }
    }

    if (entity.kind === "agent") {
      const relatedRuns = runsByAgent.get(entity.agentId) ?? [];
      for (const run of relatedRuns) {
        pushToken(parts, run.runId);
        pushToken(parts, run.task);
      }
    }

    index.set(entity.id, parts.join(" "));
  }

  return index;
}

export function searchEntityIds(index: EntitySearchIndex, rawQuery: string): Set<string> {
  const query = normalizeText(rawQuery);
  if (!query) {
    return new Set(index.keys());
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  const matched = new Set<string>();
  for (const [entityId, haystack] of index.entries()) {
    if (tokens.every((token) => haystack.includes(token))) {
      matched.add(entityId);
    }
  }
  return matched;
}
