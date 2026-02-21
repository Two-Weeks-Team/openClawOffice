import { useMemo } from "react";
import { formatNumber } from "../lib/format";
import { buildTokenMetrics } from "../lib/token-dashboard";
import type { OfficeSnapshot } from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return formatNumber(n);
}

function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function TokenBar({
  inputTokens,
  outputTokens,
  maxTokens,
}: {
  inputTokens: number;
  outputTokens: number;
  maxTokens: number;
}) {
  const inputPct = maxTokens > 0 ? (inputTokens / maxTokens) * 100 : 0;
  const outputPct = maxTokens > 0 ? (outputTokens / maxTokens) * 100 : 0;
  return (
    <div className="token-bar" aria-hidden="true">
      <div className="token-bar-input" style={{ width: `${inputPct}%` }} />
      <div className="token-bar-output" style={{ width: `${outputPct}%` }} />
    </div>
  );
}

export function TokenDashboard({ snapshot }: Props) {
  const metrics = useMemo(() => buildTokenMetrics(snapshot), [snapshot]);

  if (!metrics.hasData) {
    return (
      <section className="token-dashboard" aria-label="Token usage dashboard">
        <p className="token-dashboard-empty">
          No token usage data available. Token data appears when agents report usage.
        </p>
      </section>
    );
  }

  const maxAgentTokens = metrics.agentMetrics.reduce(
    (max, m) => Math.max(max, m.totalTokens),
    0,
  );

  return (
    <section className="token-dashboard" aria-label="Token usage dashboard">
      <div className="token-dashboard-summary">
        <div className="token-summary-card">
          <span className="token-summary-label">Total Tokens</span>
          <span className="token-summary-value">{formatTokens(metrics.totalTokens)}</span>
          <span className="token-summary-sub">
            {formatTokens(metrics.totalInputTokens)} in / {formatTokens(metrics.totalOutputTokens)} out
          </span>
        </div>
        <div className="token-summary-card">
          <span className="token-summary-label">Est. Cost</span>
          <span className="token-summary-value">{formatCost(metrics.totalEstimatedCostUsd)}</span>
          <span className="token-summary-sub">Sonnet default pricing</span>
        </div>
        <div className="token-summary-card">
          <span className="token-summary-label">Agents</span>
          <span className="token-summary-value">{metrics.agentMetrics.length}</span>
          <span className="token-summary-sub">with token data</span>
        </div>
      </div>

      <div className="token-agent-list">
        <div className="token-agent-list-header">
          <span>Agent</span>
          <span>Input</span>
          <span>Output</span>
          <span>Total</span>
          <span>Est. Cost</span>
          <span>/ Session</span>
        </div>
        {metrics.agentMetrics.map((m) => (
          <div key={m.agentId} className="token-agent-row">
            <span className="token-agent-name" title={m.agentId}>{m.label}</span>
            <span className="token-agent-value">{formatTokens(m.inputTokens)}</span>
            <span className="token-agent-value">{formatTokens(m.outputTokens)}</span>
            <span className="token-agent-value token-agent-total">{formatTokens(m.totalTokens)}</span>
            <span className="token-agent-value">{formatCost(m.estimatedCostUsd)}</span>
            <span className="token-agent-value token-agent-per-session">
              {m.sessions > 0 ? formatTokens(m.tokensPerSession) : "—"}
            </span>
            <TokenBar
              inputTokens={m.inputTokens}
              outputTokens={m.outputTokens}
              maxTokens={maxAgentTokens}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
