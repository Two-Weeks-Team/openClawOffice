export const LOCAL50_SCENARIO = {
  agents: 50,
  runs: 500,
  events: 5_000,
} as const;

// UX-oriented targets used as operating budgets for local 50-agent mode.
export const LOCAL50_UX_BUDGET = {
  minFps: 30,
  ttiMs: 2_200,
  updateLatencyMs: 160,
} as const;

export const LOCAL50_PIPELINE_BUDGET = {
  parseRunsP95Ms: 45,
  parseSessionsP95Ms: 18,
  layoutP95Ms: 55,
  timelineIndexP95Ms: 60,
  entitySearchP95Ms: 12,
  streamMergeBatchP95Ms: 70,
} as const;
