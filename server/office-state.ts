import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseSessionsStore,
  parseSubagentStore,
  type SessionSummary,
} from "./runtime-parser";
import type {
  OfficeEntity,
  OfficeEntityStatus,
  OfficeEvent,
  OfficeRun,
  OfficeSnapshot,
  SnapshotDiagnostic,
} from "./office-types";

const MAX_EVENTS = 220;
const LIVE_IDLE_WINDOW_MS = 8 * 60_000;
const LIVE_ACTIVE_WINDOW_MS = 2 * 60_000;

type AgentSnapshot = {
  agentId: string;
  sessions: number;
  lastUpdatedAt?: number;
  model?: string;
  bubble?: string;
};

type AgentLoadResult = {
  agentMap: Map<string, AgentSnapshot>;
  diagnostics: SnapshotDiagnostic[];
};

type RunLoadResult = {
  runs: OfficeRun[];
  diagnostics: SnapshotDiagnostic[];
};

function resolveStateDir() {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  return fromEnv || path.join(os.homedir(), ".openclaw");
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function shortText(value: string | undefined, max = 120): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}...`;
}

async function readJsonFile(pathname: string): Promise<{ value: unknown; diagnostics: SnapshotDiagnostic[] }> {
  try {
    const raw = await fs.readFile(pathname, "utf-8");
    try {
      return {
        value: JSON.parse(raw) as unknown,
        diagnostics: [],
      };
    } catch (err) {
      return {
        value: undefined,
        diagnostics: [
          {
            level: "warning",
            code: "JSON_PARSE_FAILED",
            source: pathname,
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { value: undefined, diagnostics: [] };
    }
    return {
      value: undefined,
      diagnostics: [
        {
          level: "warning",
          code: "JSON_READ_FAILED",
          source: pathname,
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

function extractLineText(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const row = parsed as Record<string, unknown>;

  const direct = normalizeText(row.text) ?? normalizeText(row.message);
  if (direct) {
    return direct;
  }

  const content = row.content;
  if (typeof content === "string") {
    return normalizeText(content);
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const typed = block as Record<string, unknown>;
      const blockText = normalizeText(typed.text) ?? normalizeText(typed.content);
      if (blockText) {
        return blockText;
      }
    }
  }

  const delta = row.delta;
  if (typeof delta === "string") {
    return normalizeText(delta);
  }

  return undefined;
}

async function readLatestBubble(agentDir: string): Promise<string | undefined> {
  const sessionsDir = path.join(agentDir, "sessions");
  let files: Dirent[] = [];
  try {
    files = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const jsonlNames = files.filter((file) => file.isFile() && file.name.endsWith(".jsonl"));
  if (jsonlNames.length === 0) {
    return undefined;
  }

  const withStat = await Promise.all(
    jsonlNames.map(async (file) => {
      const full = path.join(sessionsDir, file.name);
      try {
        const stat = await fs.stat(full);
        return { full, mtimeMs: stat.mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );

  const latest = withStat
    .filter((entry): entry is { full: string; mtimeMs: number } => Boolean(entry))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  if (!latest) {
    return undefined;
  }

  let raw = "";
  try {
    raw = await fs.readFile(latest.full, "utf-8");
  } catch {
    return undefined;
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      const text = extractLineText(parsed);
      if (text) {
        return shortText(text, 110);
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function latestSessionMetadata(sessions: SessionSummary[]): { lastUpdatedAt?: number; model?: string } {
  let model: string | undefined;
  let lastUpdatedAt: number | undefined;

  for (const entry of sessions) {
    if (entry.updatedAt !== undefined && (lastUpdatedAt === undefined || entry.updatedAt > lastUpdatedAt)) {
      lastUpdatedAt = entry.updatedAt;
      model = entry.model;
    }
  }

  return { lastUpdatedAt, model };
}

async function loadAgentSnapshots(stateDir: string): Promise<AgentLoadResult> {
  const out = new Map<string, AgentSnapshot>();
  const diagnostics: SnapshotDiagnostic[] = [];
  const agentsDir = path.join(stateDir, "agents");

  let folders: Dirent[] = [];
  try {
    folders = await fs.readdir(agentsDir, { withFileTypes: true });
  } catch {
    return { agentMap: out, diagnostics };
  }

  for (const folder of folders) {
    if (!folder.isDirectory()) {
      continue;
    }
    const agentId = folder.name.trim();
    if (!agentId) {
      continue;
    }

    const agentDir = path.join(agentsDir, agentId);
    const sessionsPath = path.join(agentDir, "sessions", "sessions.json");
    const sessionsFile = await readJsonFile(sessionsPath);
    diagnostics.push(...sessionsFile.diagnostics);

    const parsed = parseSessionsStore(sessionsFile.value, sessionsPath);
    diagnostics.push(...parsed.diagnostics);

    const sessions = parsed.value.length;
    const { lastUpdatedAt, model } = latestSessionMetadata(parsed.value);
    const bubble = await readLatestBubble(agentDir);

    out.set(agentId, { agentId, sessions, lastUpdatedAt, model, bubble });
  }

  return { agentMap: out, diagnostics };
}

async function loadSubagentRuns(stateDir: string): Promise<RunLoadResult> {
  const runsPath = path.join(stateDir, "subagents", "runs.json");
  const runsFile = await readJsonFile(runsPath);
  const parsed = parseSubagentStore(runsFile.value, runsPath);

  return {
    runs: parsed.value,
    diagnostics: [...runsFile.diagnostics, ...parsed.diagnostics],
  };
}

function buildEventsFromRuns(runs: OfficeRun[]): OfficeEvent[] {
  const events: OfficeEvent[] = [];

  for (const run of runs) {
    events.push({
      id: `${run.runId}:spawn:${run.createdAt}`,
      type: "spawn",
      runId: run.runId,
      at: run.createdAt,
      agentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      text: shortText(run.task, 96) ?? "spawn",
    });

    if (run.startedAt) {
      events.push({
        id: `${run.runId}:start:${run.startedAt}`,
        type: "start",
        runId: run.runId,
        at: run.startedAt,
        agentId: run.childAgentId,
        parentAgentId: run.parentAgentId,
        text: run.label ? `started ${run.label}` : "started",
      });
    }

    if (run.endedAt) {
      const doneType = run.status === "error" ? "error" : "end";
      events.push({
        id: `${run.runId}:${doneType}:${run.endedAt}`,
        type: doneType,
        runId: run.runId,
        at: run.endedAt,
        agentId: run.childAgentId,
        parentAgentId: run.parentAgentId,
        text: run.status === "error" ? "ended with error" : "completed",
      });
    }

    if (run.cleanupCompletedAt) {
      events.push({
        id: `${run.runId}:cleanup:${run.cleanupCompletedAt}`,
        type: "cleanup",
        runId: run.runId,
        at: run.cleanupCompletedAt,
        agentId: run.childAgentId,
        parentAgentId: run.parentAgentId,
        text: "cleanup completed",
      });
    }
  }

  return events.sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
}

function resolveAgentStatus(params: {
  lastUpdatedAt?: number;
  activeSubagents: number;
  hasRecentError: boolean;
}): OfficeEntityStatus {
  if (params.hasRecentError) {
    return "error";
  }
  if (params.activeSubagents > 0) {
    return "active";
  }
  if (!params.lastUpdatedAt) {
    return "offline";
  }
  const ageMs = Date.now() - params.lastUpdatedAt;
  if (ageMs <= LIVE_ACTIVE_WINDOW_MS) {
    return "active";
  }
  if (ageMs <= LIVE_IDLE_WINDOW_MS) {
    return "idle";
  }
  return "offline";
}

function createDemoSnapshot(stateDir: string, diagnostics: SnapshotDiagnostic[] = []): OfficeSnapshot {
  const now = Date.now();
  const demoRuns: OfficeRun[] = [
    {
      runId: "run-demo-1",
      childSessionKey: "agent:main:subagent:demo-a",
      requesterSessionKey: "agent:main:main",
      childAgentId: "main",
      parentAgentId: "main",
      status: "active",
      task: "Review open PRs and summarize merge risks.",
      label: "review-pr",
      cleanup: "keep",
      createdAt: now - 70_000,
      startedAt: now - 68_000,
    },
    {
      runId: "run-demo-2",
      childSessionKey: "agent:research:subagent:demo-b",
      requesterSessionKey: "agent:main:main",
      childAgentId: "research",
      parentAgentId: "main",
      status: "ok",
      task: "Collect Kenney office props and map them to room zones.",
      label: "asset-map",
      cleanup: "keep",
      createdAt: now - 6 * 60_000,
      startedAt: now - 5 * 60_000,
      endedAt: now - 4 * 60_000,
      cleanupCompletedAt: now - 3 * 60_000,
    },
    {
      runId: "run-demo-3",
      childSessionKey: "agent:ops:subagent:demo-c",
      requesterSessionKey: "agent:main:main",
      childAgentId: "ops",
      parentAgentId: "main",
      status: "error",
      task: "Probe gateway status and collect failing session IDs.",
      label: "gateway-probe",
      cleanup: "keep",
      createdAt: now - 12 * 60_000,
      startedAt: now - 11 * 60_000,
      endedAt: now - 10 * 60_000,
    },
  ];

  const entities: OfficeEntity[] = [
    {
      id: "agent:main",
      kind: "agent",
      label: "main",
      agentId: "main",
      status: "active",
      sessions: 8,
      activeSubagents: 1,
      lastUpdatedAt: now - 40_000,
      model: "openai/gpt-5",
      bubble: "OpenClawOffice layout render is running.",
    },
    {
      id: "agent:research",
      kind: "agent",
      label: "research",
      agentId: "research",
      status: "idle",
      sessions: 4,
      activeSubagents: 0,
      lastUpdatedAt: now - 6 * 60_000,
      model: "anthropic/claude-sonnet",
      bubble: "Kenney tilemap candidates were ranked.",
    },
    {
      id: "agent:ops",
      kind: "agent",
      label: "ops",
      agentId: "ops",
      status: "error",
      sessions: 6,
      activeSubagents: 0,
      lastUpdatedAt: now - 9 * 60_000,
      model: "openai/gpt-4.1",
      bubble: "Gateway probe hit a timeout on status scan.",
    },
    ...demoRuns.map((run) => ({
      id: `subagent:${run.runId}`,
      kind: "subagent" as const,
      label: run.label ?? run.runId.slice(0, 8),
      agentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      runId: run.runId,
      status: run.status,
      sessions: 1,
      activeSubagents: 0,
      lastUpdatedAt: run.endedAt ?? run.startedAt ?? run.createdAt,
      bubble: shortText(run.task, 95),
      task: run.task,
    })),
  ];

  return {
    generatedAt: now,
    source: {
      stateDir,
      live: false,
    },
    diagnostics,
    entities,
    runs: demoRuns,
    events: buildEventsFromRuns(demoRuns),
  };
}

export async function buildOfficeSnapshot(): Promise<OfficeSnapshot> {
  const stateDir = resolveStateDir();
  const [agentResult, runResult] = await Promise.all([
    loadAgentSnapshots(stateDir),
    loadSubagentRuns(stateDir),
  ]);

  const agentMap = agentResult.agentMap;
  const runs = runResult.runs;
  const diagnostics = [...agentResult.diagnostics, ...runResult.diagnostics];

  if (agentMap.size === 0 && runs.length === 0) {
    return createDemoSnapshot(stateDir, diagnostics);
  }

  const activeByAgent = new Map<string, number>();
  const hasErrorByAgent = new Map<string, boolean>();
  for (const run of runs) {
    if (run.status === "active") {
      activeByAgent.set(run.parentAgentId, (activeByAgent.get(run.parentAgentId) ?? 0) + 1);
    }
    if (run.status === "error") {
      hasErrorByAgent.set(run.parentAgentId, true);
    }
    if (!agentMap.has(run.childAgentId)) {
      agentMap.set(run.childAgentId, {
        agentId: run.childAgentId,
        sessions: 0,
      });
    }
    if (!agentMap.has(run.parentAgentId)) {
      agentMap.set(run.parentAgentId, {
        agentId: run.parentAgentId,
        sessions: 0,
      });
    }
  }

  const entities: OfficeEntity[] = [];
  for (const agent of agentMap.values()) {
    const activeSubagents = activeByAgent.get(agent.agentId) ?? 0;
    entities.push({
      id: `agent:${agent.agentId}`,
      kind: "agent",
      label: agent.agentId,
      agentId: agent.agentId,
      status: resolveAgentStatus({
        lastUpdatedAt: agent.lastUpdatedAt,
        activeSubagents,
        hasRecentError: hasErrorByAgent.get(agent.agentId) ?? false,
      }),
      sessions: agent.sessions,
      activeSubagents,
      lastUpdatedAt: agent.lastUpdatedAt,
      model: agent.model,
      bubble: agent.bubble,
    });
  }

  for (const run of runs) {
    entities.push({
      id: `subagent:${run.runId}`,
      kind: "subagent",
      label: run.label || run.runId.slice(0, 8),
      agentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      runId: run.runId,
      status: run.status,
      sessions: 1,
      activeSubagents: 0,
      lastUpdatedAt: run.endedAt ?? run.startedAt ?? run.createdAt,
      bubble: shortText(run.task, 95),
      task: run.task,
    });
  }

  entities.sort((a, b) => {
    if (a.kind === b.kind) {
      return a.label.localeCompare(b.label);
    }
    return a.kind === "agent" ? -1 : 1;
  });

  return {
    generatedAt: Date.now(),
    source: {
      stateDir,
      live: true,
    },
    diagnostics,
    entities,
    runs,
    events: buildEventsFromRuns(runs),
  };
}
