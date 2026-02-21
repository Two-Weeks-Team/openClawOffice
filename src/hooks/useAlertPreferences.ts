import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ALERT_RULE_PREFERENCES,
  normalizeAlertRulePreferences,
  type AlertRuleId,
  type AlertRulePreferences,
} from "../lib/alerts";

const ALERT_RULE_PREFERENCES_KEY = "openclawoffice.alert-rule-preferences.v1";

function loadAlertRulePreferences(): AlertRulePreferences {
  try {
    const raw = window.localStorage.getItem(ALERT_RULE_PREFERENCES_KEY);
    if (!raw) {
      return DEFAULT_ALERT_RULE_PREFERENCES;
    }
    const parsed: unknown = JSON.parse(raw);
    return normalizeAlertRulePreferences(parsed);
  } catch {
    return DEFAULT_ALERT_RULE_PREFERENCES;
  }
}

export function useAlertPreferences(snapshotGeneratedAt: number | undefined) {
  const [alertRulePreferences, setAlertRulePreferences] = useState<AlertRulePreferences>(
    loadAlertRulePreferences,
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ALERT_RULE_PREFERENCES_KEY,
        JSON.stringify(alertRulePreferences),
      );
    } catch {
      // Ignore localStorage persistence errors in restricted browser modes.
    }
  }, [alertRulePreferences]);

  const toggleAlertRuleMute = useCallback((ruleId: AlertRuleId) => {
    setAlertRulePreferences((prev) => ({
      ...prev,
      [ruleId]: {
        ...prev[ruleId],
        muted: !prev[ruleId].muted,
      },
    }));
  }, []);

  const snoozeAlertRule = useCallback(
    (ruleId: AlertRuleId, durationMs: number) => {
      const baseTime = Math.max(snapshotGeneratedAt ?? 0, Date.now());
      setAlertRulePreferences((prev) => ({
        ...prev,
        [ruleId]: {
          ...prev[ruleId],
          muted: false,
          snoozeUntil: baseTime + durationMs,
        },
      }));
    },
    [snapshotGeneratedAt],
  );

  const clearAlertRuleSuppression = useCallback((ruleId: AlertRuleId) => {
    setAlertRulePreferences((prev) => ({
      ...prev,
      [ruleId]: {
        muted: false,
        snoozeUntil: 0,
      },
    }));
  }, []);

  return {
    alertRulePreferences,
    toggleAlertRuleMute,
    snoozeAlertRule,
    clearAlertRuleSuppression,
  };
}
