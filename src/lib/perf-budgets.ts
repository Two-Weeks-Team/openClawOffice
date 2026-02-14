export type CapacityProfileId = "local10" | "local25" | "local50";

export type CapacityScenario = {
  agents: number;
  runs: number;
  events: number;
};

export type CapacityUxBudget = {
  minFps: number;
  ttiMs: number;
  updateLatencyMs: number;
  memoryFootprintMb: number;
};

export type CapacityPipelineBudget = {
  parseRunsP95Ms: number;
  parseSessionsP95Ms: number;
  layoutP95Ms: number;
  timelineIndexP95Ms: number;
  entitySearchP95Ms: number;
  streamMergeBatchP95Ms: number;
};

export type CapacityProfile = {
  scenario: CapacityScenario;
  uxBudget: CapacityUxBudget;
  pipelineBudget: CapacityPipelineBudget;
};

const BASELINE_PIPELINE_BUDGET: CapacityPipelineBudget = {
  parseRunsP95Ms: 45,
  parseSessionsP95Ms: 18,
  layoutP95Ms: 55,
  timelineIndexP95Ms: 60,
  entitySearchP95Ms: 12,
  streamMergeBatchP95Ms: 70,
};

const BASELINE_UX_BUDGET: CapacityUxBudget = {
  minFps: 30,
  ttiMs: 2_200,
  updateLatencyMs: 160,
  memoryFootprintMb: 220,
};

export const CAPACITY_BASELINE_PROFILES: Record<CapacityProfileId, CapacityProfile> = {
  local10: {
    scenario: { agents: 10, runs: 100, events: 1_000 },
    uxBudget: BASELINE_UX_BUDGET,
    pipelineBudget: BASELINE_PIPELINE_BUDGET,
  },
  local25: {
    scenario: { agents: 25, runs: 250, events: 2_500 },
    uxBudget: BASELINE_UX_BUDGET,
    pipelineBudget: BASELINE_PIPELINE_BUDGET,
  },
  local50: {
    scenario: { agents: 50, runs: 500, events: 5_000 },
    uxBudget: BASELINE_UX_BUDGET,
    pipelineBudget: BASELINE_PIPELINE_BUDGET,
  },
};

export const LOCAL50_SCENARIO = {
  ...CAPACITY_BASELINE_PROFILES.local50.scenario,
} as const;

// UX-oriented targets used as operating budgets for local 50-agent mode.
export const LOCAL50_UX_BUDGET = {
  ...CAPACITY_BASELINE_PROFILES.local50.uxBudget,
} as const;

export const LOCAL50_PIPELINE_BUDGET = {
  ...CAPACITY_BASELINE_PROFILES.local50.pipelineBudget,
} as const;
