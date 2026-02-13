export type OfficeEntityStatus = "active" | "idle" | "offline" | "ok" | "error";

export type OfficeEntity = {
  id: string;
  kind: "agent" | "subagent";
  label: string;
  agentId: string;
  parentAgentId?: string;
  runId?: string;
  status: OfficeEntityStatus;
  sessions: number;
  activeSubagents: number;
  lastUpdatedAt?: number;
  model?: string;
  bubble?: string;
  task?: string;
};

export type OfficeRunStatus = "active" | "ok" | "error";

export type OfficeRun = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  childAgentId: string;
  parentAgentId: string;
  status: OfficeRunStatus;
  task: string;
  label?: string;
  cleanup: "delete" | "keep";
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  cleanupCompletedAt?: number;
};

export type OfficeRunGraphNodeKind = "agent" | "subagent";

export type OfficeRunGraphNode = {
  id: string;
  kind: OfficeRunGraphNodeKind;
  runId?: string;
  agentId: string;
  parentAgentId?: string;
  childSessionKey?: string;
  requesterSessionKey?: string;
  status?: OfficeRunStatus;
  label?: string;
  task?: string;
  cleanup?: "delete" | "keep";
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  cleanupCompletedAt?: number;
};

export type OfficeRunGraphEdgeKind = "runId" | "spawnedBy";

export type OfficeRunGraphEdge = {
  id: string;
  kind: OfficeRunGraphEdgeKind;
  from: string;
  to: string;
  runId: string;
};

export type OfficeRunGraphTimeRange = {
  startAt: number;
  endAt: number;
};

export type OfficeRunGraphIndex = {
  runNodeIdByRunId: Record<string, string>;
  runIdsByAgentId: Record<string, string[]>;
  agentIdsByRunId: Record<string, string[]>;
  timeRangeByRunId: Record<string, OfficeRunGraphTimeRange>;
  spawnedByRunId: Record<string, string>;
  spawnedChildrenByRunId: Record<string, string[]>;
};

export type OfficeRunGraphDiagnosticCode = "missing_parent" | "orphan_run" | "cycle_detected";

export type OfficeRunGraphDiagnostic = {
  code: OfficeRunGraphDiagnosticCode;
  runId?: string;
  nodeId?: string;
  message: string;
};

export type OfficeRunGraph = {
  nodes: OfficeRunGraphNode[];
  edges: OfficeRunGraphEdge[];
  index: OfficeRunGraphIndex;
  diagnostics: OfficeRunGraphDiagnostic[];
};

export type OfficeEventType = "spawn" | "start" | "end" | "error" | "cleanup";

export type OfficeEvent = {
  id: string;
  type: OfficeEventType;
  runId: string;
  at: number;
  agentId: string;
  parentAgentId: string;
  text: string;
};

export type SnapshotDiagnosticLevel = "warning";

export type SnapshotDiagnostic = {
  level: SnapshotDiagnosticLevel;
  code: string;
  source: string;
  message: string;
};

export type OfficeSnapshot = {
  generatedAt: number;
  source: {
    stateDir: string;
    live: boolean;
  };
  diagnostics: SnapshotDiagnostic[];
  entities: OfficeEntity[];
  runs: OfficeRun[];
  runGraph: OfficeRunGraph;
  events: OfficeEvent[];
};
