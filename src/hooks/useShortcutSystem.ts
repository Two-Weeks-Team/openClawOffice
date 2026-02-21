import { useCallback, useEffect, useMemo, useState } from "react";
import {
  normalizeShortcut,
  type ShortcutPlatform,
} from "../lib/command-palette";

const SHORTCUT_OVERRIDES_KEY = "openclawoffice.shortcut-overrides.v1";
const RECENT_COMMANDS_KEY = "openclawoffice.recent-commands.v1";
const MAX_RECENT_COMMANDS = 8;

function detectShortcutPlatform(): ShortcutPlatform {
  return /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform) ? "mac" : "other";
}

function loadShortcutOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SHORTCUT_OVERRIDES_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const normalizedOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        continue;
      }
      const normalized = normalizeShortcut(value);
      if (normalized) {
        normalizedOverrides[key] = normalized;
      }
    }
    return normalizedOverrides;
  } catch {
    return {};
  }
}

function loadRecentCommands(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_COMMANDS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string").slice(0, MAX_RECENT_COMMANDS);
  } catch {
    return [];
  }
}

export function useShortcutSystem() {
  const [shortcutOverrides, setShortcutOverrides] = useState<Record<string, string>>(loadShortcutOverrides);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>(loadRecentCommands);
  const [rebindingCommandId, setRebindingCommandId] = useState<string | null>(null);

  const shortcutPlatform = useMemo(() => detectShortcutPlatform(), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHORTCUT_OVERRIDES_KEY, JSON.stringify(shortcutOverrides));
    } catch {
      // Ignore localStorage persistence errors in restricted browser modes.
    }
  }, [shortcutOverrides]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(recentCommandIds));
    } catch {
      // Ignore localStorage persistence errors in restricted browser modes.
    }
  }, [recentCommandIds]);

  const resetShortcutOverride = useCallback(
    (commandId: string) => {
      setShortcutOverrides((prev) => {
        if (!(commandId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[commandId];
        return next;
      });
    },
    [],
  );

  return {
    shortcutOverrides,
    setShortcutOverrides,
    recentCommandIds,
    setRecentCommandIds,
    rebindingCommandId,
    setRebindingCommandId,
    shortcutPlatform,
    resetShortcutOverride,
  };
}
