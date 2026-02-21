import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseSessionsStore,
  parseSubagentStore,
  type SessionSummary,
} from "./runtime-parser";
import { buildRunGraph } from "../src/lib/run-graph";
import { buildTranscriptBubble, buildTranscriptMeta } from "./transcript-tailer";
import { logStructuredEvent } from "./api-observability";
import type {
  OfficeEntity,
  OfficeEntityStatus,
  OfficeEvent,
  OfficeRun,
  OfficeSnapshot,
  SnapshotDiagnostic,
} from "./office-types";
import { fetchWorldPositions, isWorldIntegrationEnabled } from "./world-client";

const MAX_EVENTS = 220;
const LIVE_IDLE_WINDOW_MS = 8 * 60_000;
const LIVE_ACTIVE_WINDOW_MS = 2 * 60_000;
const DEFAULT_RUN_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_COMPLETED_RUNS = 200;

function resolveRunTtlMs(): number {
  const raw = process.env.OPENCLAW_RUN_TTL_MS?.trim();
  if (!raw) return DEFAULT_RUN_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RUN_TTL_MS;
  return parsed;
}

function resolveMaxCompletedRuns(): number {
  const raw = process.env.OPENCLAW_MAX_COMPLETED_RUNS?.trim();
  if (!raw) return DEFAULT_MAX_COMPLETED_RUNS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return DEFAULT_MAX_COMPLETED_RUNS;
  return parsed;
}

type AgentSnapshot = {
  agentId: string;
  sessions: number;
  lastUpdatedAt?: number;
  model?: string;
  bubble?: string;
  lastTool?: string;
  toolCount?: number;
  toolCategoryBreakdown?: import("./transcript-tailer").ToolCategoryBreakdown;
  inputTokens?: number;
  outputTokens?: number;
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
  const fallback = path.join(os.homedir(), ".openclaw");
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (!fromEnv || fromEnv.includes("\0")) {
    return fallback;
  }
  return path.resolve(fromEnv);
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

export function truncateMiddle(value: string, max = 16): string {
  if (value.length <= max) {
    return value;
  }
  const keep = Math.floor((max - 3) / 2);
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

export function extractMeaningfulLabel(name: string): string {
  const segments = name.split("-");
  const lastSegment = segments[segments.length - 1] || name;
  
  if (lastSegment.length >= 3 && lastSegment.length <= 12) {
    return lastSegment;
  }
  
  if (segments.length >= 2) {
    const lastTwoSegments = segments.slice(-2).join("-");
    if (lastTwoSegments.length <= 16) {
      return lastTwoSegments;
    }
  }
  
  return truncateMiddle(name, 16);
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

type TranscriptInfo = {
  bubble?: string;
  lastTool?: string;
  toolCount: number;
  toolCategoryBreakdown: import("./transcript-tailer").ToolCategoryBreakdown;
  inputTokens: number;
  outputTokens: number;
};

async function readLatestTranscriptInfo(agentDir: string): Promise<TranscriptInfo | undefined> {
  const sessionsDir = path.join(agentDir, "sessions");
  let files: Dirent[] = [];
  try {
    files = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    logStructuredEvent({ level: "info", event: "fs.readdir.skip", extra: { sessionsDir, error: String(error) } });
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
      } catch (error) {
        logStructuredEvent({ level: "info", event: "fs.stat.skip", extra: { path: full, error: String(error) } });
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
  } catch (error) {
    logStructuredEvent({ level: "info", event: "fs.readFile.skip", extra: { path: latest.full, error: String(error) } });
    return undefined;
  }

  const bubble = buildTranscriptBubble(raw, { maxChars: 110 });
  const meta = buildTranscriptMeta(raw);

  return {
    bubble,
    lastTool: meta.lastToolName,
    toolCount: meta.toolCount,
    toolCategoryBreakdown: meta.toolCategoryBreakdown,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
  };
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
  } catch (err) {
    const errorCode =
      err && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : undefined;
    if (errorCode !== "ENOENT") {
      diagnostics.push({
        level: "warning",
        code: "AGENT_DIR_READ_FAILED",
        source: agentsDir,
        message: err instanceof Error ? err.message : String(err),
      });
    }
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
    const transcriptInfo = await readLatestTranscriptInfo(agentDir);

    out.set(agentId, {
      agentId,
      sessions,
      lastUpdatedAt,
      model,
      bubble: transcriptInfo?.bubble,
      lastTool: transcriptInfo?.lastTool,
      toolCount: transcriptInfo?.toolCount,
      toolCategoryBreakdown: transcriptInfo?.toolCategoryBreakdown,
      inputTokens: transcriptInfo?.inputTokens,
      outputTokens: transcriptInfo?.outputTokens,
    });
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

export function buildEventsFromRuns(runs: OfficeRun[]): OfficeEvent[] {
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

export function resolveAgentStatus(params: {
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

function graphDiagnosticsToSnapshotDiagnostics(
  diagnostics: ReturnType<typeof buildRunGraph>["diagnostics"],
): SnapshotDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    level: "warning",
    code: `RUN_GRAPH_${diagnostic.code.toUpperCase()}`,
    source: diagnostic.nodeId ?? diagnostic.runId ?? "run-graph",
    message: diagnostic.message,
  }));
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
      lastTool: "Read",
      toolCount: 12,
      tokenUsage: { inputTokens: 45000, outputTokens: 12000 },
      worldPosition: { x: 1280, y: 720, zone: "plaza", facing: "down" },
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
      lastTool: "Bash",
      toolCount: 8,
      tokenUsage: { inputTokens: 32000, outputTokens: 9500 },
      worldPosition: { x: 640, y: 480, zone: "library", facing: "right" },
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
      lastTool: "Grep",
      toolCount: 5,
      tokenUsage: { inputTokens: 18000, outputTokens: 4200 },
    },
    ...demoRuns.map((run) => ({
      id: `subagent:${run.runId}`,
      kind: "subagent" as const,
      label: run.label ?? truncateMiddle(run.childAgentId),
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

  const runGraph = buildRunGraph(demoRuns);

  return {
    generatedAt: now,
    source: {
      stateDir,
      live: false,
    },
    diagnostics: [...diagnostics, ...graphDiagnosticsToSnapshotDiagnostics(runGraph.diagnostics)],
    entities,
    runs: demoRuns,
    runGraph,
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
  const baseDiagnostics = [
    ...agentResult.diagnostics,
    ...runResult.diagnostics,
  ];

  if (agentMap.size === 0 && runs.length === 0) {
    return createDemoSnapshot(stateDir, baseDiagnostics);
  }
  const runGraph = buildRunGraph(runs);
  const diagnostics = [
    ...baseDiagnostics,
    ...graphDiagnosticsToSnapshotDiagnostics(runGraph.diagnostics),
  ];

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
      lastTool: agent.lastTool,
      toolCount: agent.toolCount,
      toolCategoryBreakdown: agent.toolCategoryBreakdown,
      tokenUsage:
        agent.inputTokens || agent.outputTokens
          ? { inputTokens: agent.inputTokens ?? 0, outputTokens: agent.outputTokens ?? 0 }
          : undefined,
    });
  }

  const now = Date.now();
  const runTtlMs = resolveRunTtlMs();
  const maxCompletedRuns = resolveMaxCompletedRuns();
  const completedEntities: OfficeEntity[] = [];

  for (const run of runs) {
    const isCompleted = run.status === "ok" || run.status === "error";
    const expiresAt = runTtlMs > 0 && run.endedAt ? run.endedAt + runTtlMs : undefined;

    if (isCompleted && runTtlMs > 0 && expiresAt && expiresAt < now) {
      continue;
    }

    const entity: OfficeEntity = {
      id: `subagent:${run.runId}`,
      kind: "subagent",
      label: extractMeaningfulLabel(run.label || run.childAgentId),
      agentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      runId: run.runId,
      status: run.status,
      sessions: 1,
      activeSubagents: 0,
      lastUpdatedAt: run.endedAt ?? run.startedAt ?? run.createdAt,
      bubble: shortText(run.task, 95),
      task: run.task,
      expiresAt: isCompleted ? expiresAt : undefined,
    };

    if (isCompleted) {
      completedEntities.push(entity);
    } else {
      entities.push(entity);
    }
  }

  // Only cap completed runs when TTL is disabled (0) to prevent unbounded growth.
  // When TTL is active, all within-TTL runs are shown without cap.
  if (runTtlMs === 0 && completedEntities.length > maxCompletedRuns) {
    completedEntities.sort(
      (a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0),
    );
    entities.push(...completedEntities.slice(0, maxCompletedRuns));
  } else {
    entities.push(...completedEntities);
  }

  entities.sort((a, b) => {
    if (a.kind === b.kind) {
      return a.label.localeCompare(b.label);
    }
    return a.kind === "agent" ? -1 : 1;
  });

  // Optional: enrich entities with world position data.
  if (isWorldIntegrationEnabled()) {
    try {
      const worldData = await fetchWorldPositions();
      if (worldData) {
        for (const entity of entities) {
          const worldPos = worldData.positions.get(entity.agentId);
          if (worldPos) {
            entity.worldPosition = {
              x: worldPos.x,
              y: worldPos.y,
              zone: worldPos.zone,
              facing: worldPos.facing,
            };
          }
        }
      }
    } catch {
      // Non-blocking: world integration failure must not break the dashboard.
    }
  }

  return {
    generatedAt: Date.now(),
    source: {
      stateDir,
      live: true,
    },
    diagnostics,
    entities,
    runs,
    runGraph,
    events: buildEventsFromRuns(runs),
  };
}
