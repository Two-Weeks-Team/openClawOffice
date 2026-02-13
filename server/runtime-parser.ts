import type { OfficeRun, OfficeRunStatus, SnapshotDiagnostic } from "./office-types";

export type SessionSummary = {
  sessionKey: string;
  updatedAt?: number;
  model?: string;
};

export type ParseResult<T> = {
  value: T;
  diagnostics: SnapshotDiagnostic[];
};

type PersistedSubagentRun = {
  runId?: unknown;
  childSessionKey?: unknown;
  requesterSessionKey?: unknown;
  requesterSession?: unknown;
  parentSessionKey?: unknown;
  task?: unknown;
  label?: unknown;
  cleanup?: unknown;
  createdAt?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  cleanupCompletedAt?: unknown;
  status?: unknown;
  outcome?: {
    status?: unknown;
    error?: unknown;
  };
};

const AGENT_KEY_PATTERN = /^agent:([^:]+):/i;
const DEFAULT_TASK_TEXT = "(no task text)";

function makeDiagnostic(params: { code: string; source: string; message: string }): SnapshotDiagnostic {
  return {
    level: "warning",
    code: params.code,
    source: params.source,
    message: params.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

export function parseAgentIdFromSessionKey(key: string | undefined): string | undefined {
  if (!key) {
    return undefined;
  }
  const match = key.match(AGENT_KEY_PATTERN);
  return match?.[1]?.trim() || undefined;
}

export function parseSessionsStore(raw: unknown, source: string): ParseResult<SessionSummary[]> {
  const diagnostics: SnapshotDiagnostic[] = [];
  if (raw === undefined) {
    return { value: [], diagnostics };
  }

  if (!isRecord(raw)) {
    diagnostics.push(
      makeDiagnostic({
        code: "SESSION_STORE_INVALID_SHAPE",
        source,
        message: "sessions.json must be an object map keyed by session key.",
      }),
    );
    return { value: [], diagnostics };
  }

  const sessions: SessionSummary[] = [];
  for (const [sessionKey, rawEntry] of Object.entries(raw)) {
    if (!isRecord(rawEntry)) {
      diagnostics.push(
        makeDiagnostic({
          code: "SESSION_ENTRY_INVALID",
          source,
          message: `Ignored invalid session entry at key "${sessionKey}".`,
        }),
      );
      continue;
    }

    const updatedAt = normalizeNumber(rawEntry.updatedAt);
    const model = normalizeText(rawEntry.modelOverride) ?? normalizeText(rawEntry.model);

    sessions.push({
      sessionKey,
      updatedAt,
      model,
    });
  }

  return { value: sessions, diagnostics };
}

function normalizeRunStatus(run: PersistedSubagentRun): OfficeRunStatus {
  const outcomeStatus = normalizeText(run.outcome?.status) ?? normalizeText(run.status);
  if (outcomeStatus === "error") {
    return "error";
  }

  if (normalizeNumber(run.endedAt) !== undefined) {
    return "ok";
  }

  return "active";
}

function normalizeRunRecords(
  raw: unknown,
  source: string,
  diagnostics: SnapshotDiagnostic[],
): Array<{ mapKey: string; run: PersistedSubagentRun }> {
  if (Array.isArray(raw)) {
    return raw
      .map((item, index) => {
        if (!isRecord(item)) {
          diagnostics.push(
            makeDiagnostic({
              code: "RUN_ENTRY_INVALID",
              source,
              message: `Ignored invalid run entry at index ${index}.`,
            }),
          );
          return undefined;
        }
        return { mapKey: `idx:${index}`, run: item as PersistedSubagentRun };
      })
      .filter((entry): entry is { mapKey: string; run: PersistedSubagentRun } => Boolean(entry));
  }

  if (isRecord(raw)) {
    return Object.entries(raw)
      .map(([mapKey, item]) => {
        if (!isRecord(item)) {
          diagnostics.push(
            makeDiagnostic({
              code: "RUN_ENTRY_INVALID",
              source,
              message: `Ignored invalid run entry at key "${mapKey}".`,
            }),
          );
          return undefined;
        }
        return { mapKey, run: item as PersistedSubagentRun };
      })
      .filter((entry): entry is { mapKey: string; run: PersistedSubagentRun } => Boolean(entry));
  }

  diagnostics.push(
    makeDiagnostic({
      code: "RUN_STORE_INVALID_SHAPE",
      source,
      message: "runs.json must contain a map or array in \"runs\".",
    }),
  );

  return [];
}

export function parseSubagentStore(raw: unknown, source: string): ParseResult<OfficeRun[]> {
  const diagnostics: SnapshotDiagnostic[] = [];
  if (raw === undefined) {
    return { value: [], diagnostics };
  }

  if (!isRecord(raw)) {
    diagnostics.push(
      makeDiagnostic({
        code: "RUN_STORE_INVALID_ROOT",
        source,
        message: "runs.json must be a JSON object.",
      }),
    );
    return { value: [], diagnostics };
  }

  const version = normalizeText(raw.version) ?? normalizeNumber(raw.version)?.toString();
  if (version && version !== "1" && version !== "2") {
    diagnostics.push(
      makeDiagnostic({
        code: "RUN_STORE_UNSUPPORTED_VERSION",
        source,
        message: `Unsupported runs.json version "${version}", using compatibility parser.`,
      }),
    );
  }

  const runRecords = normalizeRunRecords(raw.runs, source, diagnostics);
  const runs: OfficeRun[] = [];

  for (const { mapKey, run } of runRecords) {
    const runId = normalizeText(run.runId) ?? mapKey;
    const childSessionKey = normalizeText(run.childSessionKey);
    const requesterSessionKey =
      normalizeText(run.requesterSessionKey) ??
      normalizeText(run.requesterSession) ??
      normalizeText(run.parentSessionKey);

    if (!runId || !childSessionKey || !requesterSessionKey) {
      diagnostics.push(
        makeDiagnostic({
          code: "RUN_ENTRY_MISSING_REQUIRED_FIELD",
          source,
          message: `Skipped run "${runId || mapKey}" due to missing session keys.`,
        }),
      );
      continue;
    }

    const childAgentId = parseAgentIdFromSessionKey(childSessionKey);
    const parentAgentId = parseAgentIdFromSessionKey(requesterSessionKey);

    if (!childAgentId || !parentAgentId) {
      diagnostics.push(
        makeDiagnostic({
          code: "SESSION_KEY_PARSE_FAILED",
          source,
          message: `Skipped run "${runId}" because session key parsing failed.`,
        }),
      );
      continue;
    }

    runs.push({
      runId,
      childSessionKey,
      requesterSessionKey,
      childAgentId,
      parentAgentId,
      status: normalizeRunStatus(run),
      task: normalizeText(run.task) ?? DEFAULT_TASK_TEXT,
      label: normalizeText(run.label),
      cleanup: normalizeText(run.cleanup) === "delete" ? "delete" : "keep",
      createdAt: normalizeNumber(run.createdAt) ?? Date.now(),
      startedAt: normalizeNumber(run.startedAt),
      endedAt: normalizeNumber(run.endedAt),
      cleanupCompletedAt: normalizeNumber(run.cleanupCompletedAt),
    });
  }

  runs.sort((a, b) => b.createdAt - a.createdAt);
  return { value: runs, diagnostics };
}
