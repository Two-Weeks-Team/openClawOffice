import type { OfficeSnapshot } from "../types/office";

/** Cost per million tokens (USD) for known model families. */
const MODEL_PRICE_TABLE: Array<{
  pattern: RegExp;
  inputPerMTok: number;
  outputPerMTok: number;
}> = [
  { pattern: /opus/i, inputPerMTok: 15, outputPerMTok: 75 },
  { pattern: /sonnet/i, inputPerMTok: 3, outputPerMTok: 15 },
  { pattern: /haiku/i, inputPerMTok: 0.8, outputPerMTok: 4 },
];

/** Default pricing when model is unknown (Sonnet-level). */
const DEFAULT_PRICE = { inputPerMTok: 3, outputPerMTok: 15 };

export type TokenModelPrice = {
  inputPerMTok: number;
  outputPerMTok: number;
};

export function resolveModelPrice(model?: string): TokenModelPrice {
  if (!model) return DEFAULT_PRICE;
  for (const entry of MODEL_PRICE_TABLE) {
    if (entry.pattern.test(model)) {
      return { inputPerMTok: entry.inputPerMTok, outputPerMTok: entry.outputPerMTok };
    }
  }
  return DEFAULT_PRICE;
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  price: TokenModelPrice = DEFAULT_PRICE,
): number {
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}

export type AgentTokenMetrics = {
  agentId: string;
  label: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  tokensPerSession: number;
};

export type TokenDashboardMetrics = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  agentMetrics: AgentTokenMetrics[];
  hasData: boolean;
};

export function buildTokenMetrics(snapshot: OfficeSnapshot): TokenDashboardMetrics {
  // Aggregate token usage per top-level agent (agent entity + its subagents)
  const agentInputTokens = new Map<string, number>();
  const agentOutputTokens = new Map<string, number>();
  const agentLabels = new Map<string, string>();
  const agentSessions = new Map<string, number>();
  const agentModels = new Map<string, string | undefined>();

  for (const entity of snapshot.entities) {
    const agentId = entity.kind === "subagent" ? entity.parentAgentId : entity.agentId;
    const usage = entity.tokenUsage;
    if (!agentId) continue;

    if (entity.kind === "agent") {
      agentLabels.set(agentId, entity.label);
      agentSessions.set(agentId, entity.sessions);
      agentModels.set(agentId, entity.model);
    }

    if (usage) {
      agentInputTokens.set(agentId, (agentInputTokens.get(agentId) ?? 0) + usage.inputTokens);
      agentOutputTokens.set(agentId, (agentOutputTokens.get(agentId) ?? 0) + usage.outputTokens);
    }
  }

  // Collect only agents that appear in entity list (to get label/sessions)
  const agentIds = [...agentLabels.keys()];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCostUsd = 0;

  const agentMetrics: AgentTokenMetrics[] = agentIds
    .map((agentId) => {
      const inputTokens = agentInputTokens.get(agentId) ?? 0;
      const outputTokens = agentOutputTokens.get(agentId) ?? 0;
      const totalTokens = inputTokens + outputTokens;
      const sessions = agentSessions.get(agentId) ?? 0;
      const estimatedCostUsd = estimateCost(inputTokens, outputTokens, resolveModelPrice(agentModels.get(agentId)));
      const tokensPerSession = sessions > 0 ? Math.round(totalTokens / sessions) : 0;

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalEstimatedCostUsd += estimatedCostUsd;

      return {
        agentId,
        label: agentLabels.get(agentId) ?? agentId,
        sessions,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd,
        tokensPerSession,
      };
    })
    .filter((m) => m.inputTokens > 0 || m.outputTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const totalTokens = totalInputTokens + totalOutputTokens;

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalEstimatedCostUsd,
    agentMetrics,
    hasData: totalTokens > 0,
  };
}
