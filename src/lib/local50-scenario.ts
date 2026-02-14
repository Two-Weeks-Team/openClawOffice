import type { OfficeEntityStatus, OfficeEvent, OfficeRun, OfficeSnapshot } from "../types/office";
import { buildRunGraph } from "./run-graph";
import { CAPACITY_BASELINE_PROFILES, type CapacityProfileId } from "./perf-budgets";

export type SyntheticSessionStore = Record<
  string,
  {
    updatedAt: number;
    model: string;
  }
>;

export type SyntheticRunStore = {
  version: "2";
  runs: Record<
    string,
    {
      runId: string;
      childSessionKey: string;
      requesterSessionKey: string;
      task: string;
      label: string;
      cleanup: "delete" | "keep";
      createdAt: number;
      startedAt?: number;
      endedAt?: number;
      cleanupCompletedAt?: number;
      status: "active" | "ok" | "error";
      outcome?: { status: "ok" | "error" };
    }
  >;
};

export type Local50Scenario = {
  snapshot: OfficeSnapshot;
  sessionStores: Array<{ agentId: string; source: string; raw: SyntheticSessionStore }>;
  runStore: { source: string; raw: SyntheticRunStore };
};

export type SyntheticPatternOptions = {
  errorRate?: number;
  activeRate?: number;
  runSpacingMs?: number;
  eventIntervalMs?: number;
  eventBurstEvery?: number;
  eventBurstSize?: number;
};

type ScenarioOptions = {
  profile?: CapacityProfileId;
  agents?: number;
  runs?: number;
  events?: number;
  seed?: number;
  seedTime?: number;
  pattern?: SyntheticPatternOptions;
};

export const SYNTHETIC_SCENARIO_PRESETS = {
  local10: { ...CAPACITY_BASELINE_PROFILES.local10.scenario },
  local25: { ...CAPACITY_BASELINE_PROFILES.local25.scenario },
  local50: { ...CAPACITY_BASELINE_PROFILES.local50.scenario },
} as const;

type RequiredPatternOptions = Required<SyntheticPatternOptions>;

const DEFAULT_PATTERN: RequiredPatternOptions = {
  errorRate: 1 / 11,
  activeRate: 1 / 3,
  runSpacingMs: 9_000,
  eventIntervalMs: 700,
  eventBurstEvery: 18,
  eventBurstSize: 5,
};

const DEFAULT_SEED = 938_412;

function agentName(index: number): string {
  return `agent-${String(index + 1).padStart(2, "0")}`;
}

function normalizePatternOptions(pattern: SyntheticPatternOptions | undefined): RequiredPatternOptions {
  const raw = pattern ?? {};
  return {
    errorRate: Math.min(1, Math.max(0, raw.errorRate ?? DEFAULT_PATTERN.errorRate)),
    activeRate: Math.min(1, Math.max(0, raw.activeRate ?? DEFAULT_PATTERN.activeRate)),
    runSpacingMs: Math.max(1, Math.floor(raw.runSpacingMs ?? DEFAULT_PATTERN.runSpacingMs)),
    eventIntervalMs: Math.max(1, Math.floor(raw.eventIntervalMs ?? DEFAULT_PATTERN.eventIntervalMs)),
    eventBurstEvery: Math.max(0, Math.floor(raw.eventBurstEvery ?? DEFAULT_PATTERN.eventBurstEvery)),
    eventBurstSize: Math.max(1, Math.floor(raw.eventBurstSize ?? DEFAULT_PATTERN.eventBurstSize)),
  };
}

function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pickRunStatus(rng: () => number, pattern: RequiredPatternOptions): "active" | "ok" | "error" {
  const errorRate = pattern.errorRate;
  const activeRate = Math.min(1 - errorRate, pattern.activeRate);
  const roll = rng();
  if (roll < errorRate) {
    return "error";
  }
  if (roll < errorRate + activeRate) {
    return "active";
  }
  return "ok";
}

function buildRuns(
  agentIds: string[],
  runCount: number,
  seedTime: number,
  rng: () => number,
  pattern: RequiredPatternOptions,
): OfficeRun[] {
  const runs: OfficeRun[] = [];
  for (let index = 0; index < runCount; index += 1) {
    const parentAgentId = agentIds[Math.floor(rng() * agentIds.length)] ?? "agent-01";
    const childAgentId = agentIds[Math.floor(rng() * agentIds.length)] ?? parentAgentId;
    const createdAt = seedTime - index * pattern.runSpacingMs;
    const startedAt = createdAt + 900;
    const status = pickRunStatus(rng, pattern);
    const endedAt = status === "active" ? undefined : createdAt + 5_400;
    const cleanupCompletedAt =
      status === "active" || index % 2 === 1 ? undefined : (endedAt ?? createdAt) + 1_600;

    runs.push({
      runId: `run-${String(index + 1).padStart(4, "0")}`,
      childSessionKey: `agent:${childAgentId}:session:${String((index % 4) + 1)}`,
      requesterSessionKey: `agent:${parentAgentId}:session:${String((index % 3) + 1)}`,
      childAgentId,
      parentAgentId,
      status,
      task: `Synthetic task ${index + 1}: triage and reconcile agent outputs.`,
      label: `job-${String(index + 1).padStart(4, "0")}`,
      cleanup: index % 4 === 0 ? "delete" : "keep",
      createdAt,
      startedAt,
      endedAt,
      cleanupCompletedAt,
    });
  }
  return runs;
}

function buildEvents(
  runs: OfficeRun[],
  eventCount: number,
  seedTime: number,
  rng: () => number,
  pattern: RequiredPatternOptions,
): OfficeEvent[] {
  const events: OfficeEvent[] = [];
  const eventTypes: OfficeEvent["type"][] = ["spawn", "start", "end", "error", "cleanup"];
  for (let index = 0; index < eventCount; index += 1) {
    const run = runs[index % runs.length];
    if (!run) {
      continue;
    }
    const type = eventTypes[index % eventTypes.length] ?? "spawn";
    const inBurst =
      pattern.eventBurstEvery > 0 && index % pattern.eventBurstEvery < pattern.eventBurstSize;
    const burstStep = inBurst ? Math.max(1, Math.floor(pattern.eventIntervalMs * 0.35)) : pattern.eventIntervalMs;
    const jitter = Math.floor(rng() * Math.max(1, Math.floor(pattern.eventIntervalMs * 0.2)));
    const at = seedTime - index * burstStep - jitter;
    events.push({
      id: `evt-${String(index + 1).padStart(5, "0")}`,
      type,
      runId: run.runId,
      at,
      agentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      text: `${type} ${run.runId}`,
    });
  }
  events.sort((left, right) => {
    if (left.at !== right.at) {
      return right.at - left.at;
    }
    return left.id.localeCompare(right.id);
  });
  return events;
}

function buildSessionStores(agentIds: string[], seedTime: number) {
  return agentIds.map((agentId, index) => {
    const raw: SyntheticSessionStore = {};
    for (let session = 1; session <= 8; session += 1) {
      raw[`agent:${agentId}:session:${session}`] = {
        updatedAt: seedTime - (index * 8 + session) * 1_100,
        model: session % 2 === 0 ? "openai/gpt-5" : "anthropic/claude-sonnet",
      };
    }
    return {
      agentId,
      source: `/synthetic/agents/${agentId}/sessions.json`,
      raw,
    };
  });
}

export function createLocal50Scenario(options: ScenarioOptions = {}): Local50Scenario {
  const profileId = options.profile ?? "local50";
  const preset = SYNTHETIC_SCENARIO_PRESETS[profileId];
  const agentCount = options.agents ?? preset.agents;
  const runCount = options.runs ?? preset.runs;
  const eventCount = options.events ?? preset.events;
  const seed = Math.floor(options.seed ?? DEFAULT_SEED);
  const seedTime = options.seedTime ?? 1_765_280_000_000;
  const pattern = normalizePatternOptions(options.pattern);
  const rng = createSeededRandom(seed);
  const agentIds = Array.from({ length: agentCount }, (_, index) => agentName(index));
  const runs = buildRuns(agentIds, runCount, seedTime, rng, pattern);
  const events = buildEvents(runs, eventCount, seedTime, rng, pattern);
  const activeCounts = new Map<string, number>();
  const hasError = new Map<string, boolean>();
  for (const run of runs) {
    if (run.status === "active") {
      activeCounts.set(run.parentAgentId, (activeCounts.get(run.parentAgentId) ?? 0) + 1);
    }
    if (run.status === "error") {
      hasError.set(run.parentAgentId, true);
    }
  }

  const entities = [
    ...agentIds.map((agentId, index) => {
      const activeSubagents = activeCounts.get(agentId) ?? 0;
      const status: OfficeEntityStatus = hasError.get(agentId)
        ? "error"
        : activeSubagents > 0
          ? "active"
          : index % 5 === 0
            ? "idle"
            : "ok";
      return {
        id: `agent:${agentId}`,
        kind: "agent" as const,
        label: agentId,
        agentId,
        status,
        sessions: 8,
        activeSubagents,
        lastUpdatedAt: seedTime - index * 1_500,
        model: index % 2 === 0 ? "openai/gpt-5" : "anthropic/claude-sonnet",
        bubble: `Synthetic status report for ${agentId}`,
      };
    }),
    ...runs.map((run) => ({
      id: `subagent:${run.runId}`,
      kind: "subagent" as const,
      label: run.label ?? run.runId,
      agentId: run.childAgentId,
      parentAgentId: run.parentAgentId,
      runId: run.runId,
      status: run.status,
      sessions: 1,
      activeSubagents: 0,
      lastUpdatedAt: run.cleanupCompletedAt ?? run.endedAt ?? run.startedAt ?? run.createdAt,
      task: run.task,
      bubble: run.task,
    })),
  ];

  const runStore: SyntheticRunStore = {
    version: "2",
    runs: Object.fromEntries(
      runs.map((run) => [
        run.runId,
        {
          runId: run.runId,
          childSessionKey: run.childSessionKey,
          requesterSessionKey: run.requesterSessionKey,
          task: run.task,
          label: run.label ?? run.runId,
          cleanup: run.cleanup,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          cleanupCompletedAt: run.cleanupCompletedAt,
          status: run.status,
          outcome:
            run.status === "active"
              ? undefined
              : run.status === "error"
                ? { status: "error" }
                : { status: "ok" },
        },
      ]),
    ),
  };

  return {
    snapshot: {
      generatedAt: seedTime,
      source: {
        stateDir: "/synthetic/openclaw",
        live: true,
      },
      diagnostics: [],
      entities,
      runs,
      runGraph: buildRunGraph(runs),
      events,
    },
    sessionStores: buildSessionStores(agentIds, seedTime),
    runStore: {
      source: "/synthetic/subagents/runs.json",
      raw: runStore,
    },
  };
}
