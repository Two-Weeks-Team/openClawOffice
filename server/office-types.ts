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
  events: OfficeEvent[];
};
