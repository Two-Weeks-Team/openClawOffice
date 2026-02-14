import {
  ALERT_RULE_LABELS,
  RULE_IDS,
  isAlertRuleSuppressed,
  type AlertRuleId,
  type AlertRulePreferences,
  type AlertSignal,
} from "../lib/alerts";

type AlertCenterPanelProps = {
  alertSignals: AlertSignal[];
  preferences: AlertRulePreferences;
  now: number;
  onToggleRuleMute: (ruleId: AlertRuleId) => void;
  onSnoozeRule: (ruleId: AlertRuleId, durationMs: number) => void;
  onClearRuleSuppression: (ruleId: AlertRuleId) => void;
};

export function AlertCenterPanel({
  alertSignals,
  preferences,
  now,
  onToggleRuleMute,
  onSnoozeRule,
  onClearRuleSuppression,
}: AlertCenterPanelProps) {
  return (
    <>
      <section className="alert-center-section">
        <h3>Active Alerts ({alertSignals.length})</h3>
        {alertSignals.length === 0 ? (
          <p className="alert-center-empty">No active alerts from current rule evaluation.</p>
        ) : (
          <ol className="alert-center-list">
            {alertSignals.map((signal) => {
              const suppressed = isAlertRuleSuppressed(preferences, signal.ruleId, now);
              return (
                <li
                  key={signal.dedupeKey}
                  className={`alert-center-item ${signal.severity} ${suppressed ? "is-suppressed" : ""}`}
                >
                  <div className="alert-center-item-main">
                    <strong>{signal.title}</strong>
                    <p>{signal.message}</p>
                    <p className="alert-center-meta">
                      Rule {ALERT_RULE_LABELS[signal.ruleId]} | runs {signal.runIds.length} | agents{" "}
                      {signal.agentIds.length}
                    </p>
                  </div>
                  <div className="alert-center-item-tags">
                    <span className="alert-severity-tag">{signal.severity.toUpperCase()}</span>
                    {suppressed ? <span className="alert-suppressed-tag">Suppressed</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="alert-center-section">
        <h3>Rule Controls</h3>
        <ol className="alert-rule-list">
          {RULE_IDS.map((ruleId) => {
            const preference = preferences[ruleId];
            const isSnoozed = preference.snoozeUntil > now;
            return (
              <li key={ruleId} className="alert-rule-item">
                <div className="alert-rule-main">
                  <strong>{ALERT_RULE_LABELS[ruleId]}</strong>
                  <p>
                    {preference.muted
                      ? "Muted"
                      : isSnoozed
                        ? `Snoozed until ${new Date(preference.snoozeUntil).toLocaleTimeString()}`
                        : "Active"}
                  </p>
                </div>
                <div className="alert-rule-actions">
                  <button
                    type="button"
                    onClick={() => {
                      onToggleRuleMute(ruleId);
                    }}
                  >
                    {preference.muted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSnoozeRule(ruleId, 15 * 60_000);
                    }}
                  >
                    Snooze 15m
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSnoozeRule(ruleId, 60 * 60_000);
                    }}
                  >
                    Snooze 1h
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClearRuleSuppression(ruleId);
                    }}
                    disabled={!preference.muted && !isSnoozed}
                  >
                    Clear
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
