import type {
  OfficeRun,
  OfficeRunGraph,
  OfficeRunGraphDiagnostic,
  OfficeRunGraphEdge,
  OfficeRunGraphNode,
  OfficeRunGraphTimeRange,
} from "../types/office";

const SUBAGENT_SESSION_MARKER = ":subagent:";

function toAgentNodeId(agentId: string): string {
  return `agent:${agentId}`;
}

function toRunNodeId(runId: string): string {
  return `subagent:${runId}`;
}

function pushUnique(record: Record<string, string[]>, key: string, value: string) {
  const existing = record[key];
  if (existing) {
    if (!existing.includes(value)) {
      existing.push(value);
    }
    return;
  }
  record[key] = [value];
}

function runTimeRange(run: OfficeRun): OfficeRunGraphTimeRange {
  const startAt = run.startedAt ?? run.createdAt;
  const endAt = run.cleanupCompletedAt ?? run.endedAt ?? run.startedAt ?? run.createdAt;
  return { startAt, endAt };
}

function normalizeCyclePath(path: string[]): string {
  const ring = path.slice(0, -1);
  if (ring.length === 0) {
    return "";
  }

  let best = ring;
  let bestKey = ring.join(">");
  for (let index = 1; index < ring.length; index += 1) {
    const rotated = [...ring.slice(index), ...ring.slice(0, index)];
    const rotatedKey = rotated.join(">");
    if (rotatedKey < bestKey) {
      best = rotated;
      bestKey = rotatedKey;
    }
  }

  return [...best, best[0]!].join(">");
}

function detectCycleDiagnostics(
  runIds: string[],
  adjacency: Map<string, string[]>,
): OfficeRunGraphDiagnostic[] {
  const diagnostics: OfficeRunGraphDiagnostic[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycleSignatures = new Set<string>();

  const visit = (runId: string) => {
    state.set(runId, 1);
    stack.push(runId);

    for (const neighbor of adjacency.get(runId) ?? []) {
      const neighborState = state.get(neighbor) ?? 0;
      if (neighborState === 0) {
        visit(neighbor);
        continue;
      }
      if (neighborState !== 1) {
        continue;
      }

      const startIndex = stack.lastIndexOf(neighbor);
      if (startIndex < 0) {
        continue;
      }
      const cyclePath = [...stack.slice(startIndex), neighbor];
      const signature = normalizeCyclePath(cyclePath);
      if (!signature || cycleSignatures.has(signature)) {
        continue;
      }
      cycleSignatures.add(signature);

      diagnostics.push({
        code: "cycle_detected",
        runId: neighbor,
        nodeId: toRunNodeId(neighbor),
        message: `Spawn chain cycle detected: ${cyclePath.join(" -> ")}`,
      });
    }

    stack.pop();
    state.set(runId, 2);
  };

  for (const runId of runIds) {
    if ((state.get(runId) ?? 0) === 0) {
      visit(runId);
    }
  }

  return diagnostics;
}

function sortRunIds(runIds: string[], runById: Map<string, OfficeRun>): string[] {
  return [...runIds].sort((leftId, rightId) => {
    const left = runById.get(leftId);
    const right = runById.get(rightId);
    if (!left && !right) {
      return leftId.localeCompare(rightId);
    }
    if (!left) {
      return 1;
    }
    if (!right) {
      return -1;
    }
    if (left.createdAt !== right.createdAt) {
      return right.createdAt - left.createdAt;
    }
    return left.runId.localeCompare(right.runId);
  });
}

export function indexRunsById(runs: OfficeRun[]): Map<string, OfficeRun> {
  return new Map(runs.map((run) => [run.runId, run]));
}

export function runIdsForAgent(graph: OfficeRunGraph, agentId: string): string[] {
  return graph.index.runIdsByAgentId[agentId] ?? [];
}

export function agentIdsForRun(graph: OfficeRunGraph, runId: string): string[] {
  return graph.index.agentIdsByRunId[runId] ?? [];
}

export function looksLikeSubagentSessionKey(sessionKey: string): boolean {
  return sessionKey.includes(SUBAGENT_SESSION_MARKER);
}

export function buildRunGraph(runs: OfficeRun[]): OfficeRunGraph {
  const nodes: OfficeRunGraphNode[] = [];
  const edges: OfficeRunGraphEdge[] = [];
  const diagnostics: OfficeRunGraphDiagnostic[] = [];

  const agentNodeById = new Map<string, OfficeRunGraphNode>();
  const runById = indexRunsById(runs);
  const runByChildSessionKey = new Map<string, OfficeRun>();
  const runNodeIdByRunId: Record<string, string> = {};
  const runIdsByAgentId: Record<string, string[]> = {};
  const agentIdsByRunId: Record<string, string[]> = {};
  const timeRangeByRunId: Record<string, OfficeRunGraphTimeRange> = {};
  const spawnedByRunId: Record<string, string> = {};
  const spawnedChildrenByRunId: Record<string, string[]> = {};

  const spawnAdjacency = new Map<string, string[]>();
  const diagnosticKeys = new Set<string>();

  const pushDiagnostic = (entry: OfficeRunGraphDiagnostic) => {
    const key = `${entry.code}:${entry.runId ?? ""}:${entry.nodeId ?? ""}:${entry.message}`;
    if (diagnosticKeys.has(key)) {
      return;
    }
    diagnosticKeys.add(key);
    diagnostics.push(entry);
  };

  const ensureAgentNode = (agentId: string): OfficeRunGraphNode => {
    const nodeId = toAgentNodeId(agentId);
    const existing = agentNodeById.get(nodeId);
    if (existing) {
      return existing;
    }

    const next: OfficeRunGraphNode = {
      id: nodeId,
      kind: "agent",
      agentId,
    };
    agentNodeById.set(nodeId, next);
    nodes.push(next);
    return next;
  };

  for (const run of runs) {
    ensureAgentNode(run.parentAgentId);
    ensureAgentNode(run.childAgentId);

    const runNodeId = toRunNodeId(run.runId);
    const runNode: OfficeRunGraphNode = {
      id: runNodeId,
      kind: "subagent",
      runId: run.runId,
      agentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      childSessionKey: run.childSessionKey,
      requesterSessionKey: run.requesterSessionKey,
      status: run.status,
      label: run.label,
      task: run.task,
      cleanup: run.cleanup,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      cleanupCompletedAt: run.cleanupCompletedAt,
    };
    nodes.push(runNode);

    runNodeIdByRunId[run.runId] = runNodeId;
    pushUnique(runIdsByAgentId, run.parentAgentId, run.runId);
    pushUnique(runIdsByAgentId, run.childAgentId, run.runId);
    pushUnique(agentIdsByRunId, run.runId, run.parentAgentId);
    pushUnique(agentIdsByRunId, run.runId, run.childAgentId);
    timeRangeByRunId[run.runId] = runTimeRange(run);

    edges.push({
      id: `runId:${run.runId}`,
      kind: "runId",
      from: toAgentNodeId(run.parentAgentId),
      to: runNodeId,
      runId: run.runId,
    });

    if (runByChildSessionKey.has(run.childSessionKey)) {
      pushDiagnostic({
        code: "orphan_run",
        runId: run.runId,
        nodeId: runNodeId,
        message: `Duplicate childSessionKey "${run.childSessionKey}" detected for run "${run.runId}".`,
      });
    } else {
      runByChildSessionKey.set(run.childSessionKey, run);
    }
  }

  for (const run of runs) {
    const parentRun = runByChildSessionKey.get(run.requesterSessionKey);
    if (parentRun) {
      edges.push({
        id: `spawnedBy:${parentRun.runId}->${run.runId}`,
        kind: "spawnedBy",
        from: toRunNodeId(parentRun.runId),
        to: toRunNodeId(run.runId),
        runId: run.runId,
      });
      spawnedByRunId[run.runId] = parentRun.runId;
      pushUnique(spawnedChildrenByRunId, parentRun.runId, run.runId);

      const children = spawnAdjacency.get(parentRun.runId);
      if (children) {
        if (!children.includes(run.runId)) {
          children.push(run.runId);
        }
      } else {
        spawnAdjacency.set(parentRun.runId, [run.runId]);
      }
      continue;
    }

    if (looksLikeSubagentSessionKey(run.requesterSessionKey)) {
      pushDiagnostic({
        code: "missing_parent",
        runId: run.runId,
        nodeId: toRunNodeId(run.runId),
        message: `Run "${run.runId}" references requester session "${run.requesterSessionKey}" without a matching parent run.`,
      });
      pushDiagnostic({
        code: "orphan_run",
        runId: run.runId,
        nodeId: toRunNodeId(run.runId),
        message: `Run "${run.runId}" is orphaned because its parent run could not be resolved.`,
      });
    }
  }

  for (const [agentId, runIds] of Object.entries(runIdsByAgentId)) {
    runIdsByAgentId[agentId] = sortRunIds(runIds, runById);
  }
  for (const [runId, childIds] of Object.entries(spawnedChildrenByRunId)) {
    spawnedChildrenByRunId[runId] = sortRunIds(childIds, runById);
  }

  diagnostics.push(...detectCycleDiagnostics(runs.map((run) => run.runId), spawnAdjacency));

  return {
    nodes,
    edges,
    index: {
      runNodeIdByRunId,
      runIdsByAgentId,
      agentIdsByRunId,
      timeRangeByRunId,
      spawnedByRunId,
      spawnedChildrenByRunId,
    },
    diagnostics,
  };
}
