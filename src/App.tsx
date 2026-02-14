import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { CommandPalette, type CommandPaletteEntry } from "./components/CommandPalette";
import { EntityDetailPanel } from "./components/EntityDetailPanel";
import { EventRail } from "./components/EventRail";
import { OfficeStage } from "./components/OfficeStage";
import { useOfficeStream } from "./hooks/useOfficeStream";
import {
  formatShortcut,
  isEditableEventTarget,
  keyboardEventToShortcut,
  normalizeShortcut,
  pushRecentCommand,
  resolveShortcutForPlatform,
  type ShortcutPlatform,
} from "./lib/command-palette";
import { buildEntitySearchIndex, searchEntityIds } from "./lib/entity-search";
import type { PlacementMode } from "./lib/layout";
import {
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
  parseRunIdDeepLink,
  type TimelineFilters,
} from "./lib/timeline";

type EntityStatusFilter = "all" | "active" | "idle" | "error" | "ok" | "offline";
type RecentWindowFilter = "all" | 5 | 15 | 30 | 60;
type OpsFilters = {
  query: string;
  status: EntityStatusFilter;
  roomId: string;
  placementMode: PlacementMode;
  recentMinutes: RecentWindowFilter;
  focusMode: boolean;
};

type ToastState = {
  kind: "success" | "error" | "info";
  message: string;
} | null;

type CommandSpec = {
  id: string;
  label: string;
  description: string;
  section: "Global" | "Filters" | "Timeline" | "Run Tools" | "Entities";
  keywords?: string[];
  defaultShortcut?: string;
  allowInInput?: boolean;
  allowWhenOverlayOpen?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
};

type CommandEntry = CommandSpec & {
  effectiveShortcut: string;
  shortcutLabel: string;
};

const SHORTCUT_OVERRIDES_KEY = "openclawoffice.shortcut-overrides.v1";
const RECENT_COMMANDS_KEY = "openclawoffice.recent-commands.v1";
const MAX_RECENT_COMMANDS = 8;

const DEFAULT_OPS_FILTERS: OpsFilters = {
  query: "",
  status: "all",
  roomId: "all",
  placementMode: "auto",
  recentMinutes: "all",
  focusMode: false,
};

function quoteShellToken(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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

function StatCard(props: { label: string; value: number | string; accent?: string }) {
  return (
    <article className="stat-card" style={props.accent ? { borderColor: props.accent } : undefined}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </article>
  );
}

function App() {
  const { snapshot, connected, liveSource, error } = useOfficeStream();
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [timelineRoomByAgentId, setTimelineRoomByAgentId] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [timelineLaneHighlightAgentId, setTimelineLaneHighlightAgentId] = useState<string | null>(
    null,
  );
  const [roomOptions, setRoomOptions] = useState<string[]>([]);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [timelineFilters, setTimelineFilters] = useState<TimelineFilters>(() => ({
    runId: parseRunIdDeepLink(window.location.search),
    agentId: "",
    status: "all",
  }));
  const [opsFilters, setOpsFilters] = useState<OpsFilters>(DEFAULT_OPS_FILTERS);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const [rebindingCommandId, setRebindingCommandId] = useState<string | null>(null);
  const [shortcutOverrides, setShortcutOverrides] = useState<Record<string, string>>(loadShortcutOverrides);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>(loadRecentCommands);
  const shortcutPlatform = useMemo(() => detectShortcutPlatform(), []);

  const showToast = useCallback((kind: NonNullable<ToastState>["kind"], message: string) => {
    setToast({ kind, message });
  }, []);

  const searchIndex = useMemo(
    () => (snapshot ? buildEntitySearchIndex(snapshot) : new Map<string, string>()),
    [snapshot],
  );
  const filteredEntityIds = useMemo(() => {
    if (!snapshot) {
      return [] as string[];
    }

    const matchedBySearch = searchEntityIds(searchIndex, opsFilters.query);
    const recentWindowMs =
      opsFilters.recentMinutes === "all" ? null : opsFilters.recentMinutes * 60_000;

    return snapshot.entities
      .filter((entity) => {
        if (!matchedBySearch.has(entity.id)) {
          return false;
        }
        if (opsFilters.status !== "all" && entity.status !== opsFilters.status) {
          return false;
        }
        if (recentWindowMs !== null) {
          if (typeof entity.lastUpdatedAt !== "number") {
            return false;
          }
          if (snapshot.generatedAt - entity.lastUpdatedAt > recentWindowMs) {
            return false;
          }
        }
        return true;
      })
      .map((entity) => entity.id);
  }, [
    opsFilters.query,
    opsFilters.recentMinutes,
    opsFilters.status,
    searchIndex,
    snapshot,
  ]);
  const runById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof snapshot>["runs"][number]>();
    if (!snapshot) {
      return map;
    }
    for (const run of snapshot.runs) {
      map.set(run.runId, run);
    }
    return map;
  }, [snapshot]);
  const activeEvent = useMemo(
    () => snapshot?.events.find((event) => event.id === activeEventId) ?? null,
    [activeEventId, snapshot],
  );
  const selectedEntity = useMemo(
    () => snapshot?.entities.find((entity) => entity.id === selectedEntityId) ?? null,
    [selectedEntityId, snapshot],
  );
  const selectedRun = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    if (selectedEntity?.runId) {
      return runById.get(selectedEntity.runId) ?? null;
    }
    if (activeEvent?.runId) {
      return runById.get(activeEvent.runId) ?? null;
    }
    return null;
  }, [activeEvent, runById, selectedEntity, snapshot]);

  const timelinePlaybackEvents = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const index = buildTimelineIndex(snapshot.events, snapshot.runGraph);
    return [...filterTimelineEvents(index, timelineFilters)].sort((left, right) => left.at - right.at);
  }, [snapshot, timelineFilters]);

  const activeTimelineIndex = useMemo(
    () => timelinePlaybackEvents.findIndex((event) => event.id === activeEventId),
    [activeEventId, timelinePlaybackEvents],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const runId = timelineFilters.runId.trim();
    if (runId) {
      url.searchParams.set("runId", runId);
    } else {
      url.searchParams.delete("runId");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [timelineFilters.runId]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 1800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

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

  const handleLaneContextChange = useCallback((next: { highlightAgentId: string | null }) => {
    setTimelineLaneHighlightAgentId(next.highlightAgentId);
  }, []);

  const handleRoomAssignmentsChange = useCallback((next: Map<string, string>) => {
    setTimelineRoomByAgentId(next);
  }, []);

  const copyText = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast("success", successMessage);
      } catch (errorValue) {
        console.warn("Clipboard copy failed", errorValue);
        showToast("error", "Copy failed. Please check clipboard permission.");
      }
    },
    [showToast],
  );

  const onCopyRunId = useCallback(async () => {
    const runId = selectedRun?.runId ?? selectedEntity?.runId ?? activeEvent?.runId;
    if (!runId) {
      showToast("error", "No runId available. Select an entity or timeline event first.");
      return;
    }
    await copyText(runId, `Copied runId: ${runId}`);
  }, [activeEvent?.runId, copyText, selectedEntity?.runId, selectedRun?.runId, showToast]);

  const onCopySessionKey = useCallback(async () => {
    const sessionKey = selectedRun?.childSessionKey ?? selectedRun?.requesterSessionKey;
    if (!sessionKey) {
      showToast("error", "No session key available for the current context.");
      return;
    }
    await copyText(sessionKey, "Copied session key.");
  }, [copyText, selectedRun?.childSessionKey, selectedRun?.requesterSessionKey, showToast]);

  const onCopyLogGuide = useCallback(async () => {
    let agentId: string | null = null;
    if (selectedEntity?.kind === "agent") {
      agentId = selectedEntity.agentId;
    } else if (selectedRun) {
      agentId = selectedRun.childAgentId;
    } else if (activeEvent) {
      agentId = activeEvent.agentId;
    }

    if (!agentId || !snapshot) {
      showToast("error", "No log path context. Select an entity or timeline event first.");
      return;
    }
    const selectedLogPath = `${snapshot.source.stateDir}/agents/${agentId}/sessions`;
    const guide = `cd -- ${quoteShellToken(selectedLogPath)}\nls -lt -- *.jsonl`;
    await copyText(guide, "Copied log path guide.");
  }, [activeEvent, copyText, selectedEntity, selectedRun, showToast, snapshot]);

  const jumpToRunId = useCallback(
    (runId: string, source: "toolbar" | "panel" = "toolbar") => {
      setTimelineFilters((prev) => ({ ...prev, runId, status: "all" }));
      setActiveEventId(null);
      showToast(
        "info",
        source === "toolbar"
          ? `Timeline jumped to runId filter: ${runId}`
          : `Detail panel jumped to runId filter: ${runId}`,
      );
    },
    [showToast],
  );

  const onJumpToRun = useCallback(() => {
    const runId = selectedRun?.runId ?? selectedEntity?.runId ?? activeEvent?.runId;
    if (!runId) {
      showToast("error", "No runId available for jump.");
      return;
    }
    jumpToRunId(runId, "toolbar");
  }, [activeEvent?.runId, jumpToRunId, selectedEntity?.runId, selectedRun?.runId, showToast]);

  const clearOpsFilters = useCallback(() => {
    setOpsFilters(DEFAULT_OPS_FILTERS);
    showToast("info", "Ops filters reset.");
  }, [showToast]);

  const clearTimelineFilters = useCallback(() => {
    setTimelineFilters({ runId: "", agentId: "", status: "all" });
    setActiveEventId(null);
    showToast("info", "Timeline filters reset.");
  }, [showToast]);

  const moveTimelineEvent = useCallback(
    (direction: 1 | -1) => {
      const nextId = nextPlaybackEventId(timelinePlaybackEvents, activeEventId, direction);
      if (!nextId) {
        showToast(
          "info",
          direction === 1 ? "Already at the latest timeline event." : "Already at the earliest timeline event.",
        );
        return;
      }
      setActiveEventId(nextId);
    },
    [activeEventId, showToast, timelinePlaybackEvents],
  );

  const togglePlacementMode = useCallback(() => {
    setOpsFilters((prev) => ({
      ...prev,
      placementMode: prev.placementMode === "auto" ? "manual" : "auto",
    }));
  }, []);

  const toggleFocusMode = useCallback(() => {
    setOpsFilters((prev) => ({ ...prev, focusMode: !prev.focusMode }));
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setRebindingCommandId(null);
    setIsShortcutHelpOpen(false);
    setIsCommandPaletteOpen((prev) => !prev);
  }, []);

  const openShortcutHelp = useCallback(() => {
    setRebindingCommandId(null);
    setIsCommandPaletteOpen(false);
    setIsShortcutHelpOpen(true);
  }, []);

  const closeShortcutHelp = useCallback(() => {
    setRebindingCommandId(null);
    setIsShortcutHelpOpen(false);
  }, []);

  const entityCommandSpecs = useMemo<CommandSpec[]>(() => {
    if (!snapshot) {
      return [];
    }
    return [...snapshot.entities]
      .sort((left, right) => left.agentId.localeCompare(right.agentId))
      .map((entity) => ({
        id: `entity.jump:${entity.id}`,
        label: `Jump to ${entity.kind} ${entity.agentId}`,
        description: `Select ${entity.id} and open detail context in the panel.`,
        section: "Entities",
        keywords: [entity.id, entity.agentId, entity.runId ?? "", entity.status, entity.kind],
        run: () => {
          setSelectedEntityId(entity.id);
          showToast("info", `Selected ${entity.kind} ${entity.agentId}`);
        },
      }));
  }, [showToast, snapshot]);

  const baseCommandSpecs = useMemo<CommandSpec[]>(
    () => [
      {
        id: "palette.toggle",
        label: "Toggle Command Palette",
        description: "Open or close the command palette.",
        section: "Global",
        defaultShortcut: "mod+k",
        allowInInput: true,
        allowWhenOverlayOpen: true,
        keywords: ["command", "palette", "search"],
        run: toggleCommandPalette,
      },
      {
        id: "help.shortcuts",
        label: "Open Shortcut Help",
        description: "Open cheat sheet and edit keymap overrides.",
        section: "Global",
        defaultShortcut: "shift+/",
        allowInInput: true,
        allowWhenOverlayOpen: true,
        keywords: ["cheat", "keymap", "shortcut", "help"],
        run: openShortcutHelp,
      },
      {
        id: "filters.clear",
        label: "Clear Ops Filters",
        description: "Reset search, status, room, recent, focus, and placement filters.",
        section: "Filters",
        defaultShortcut: "mod+shift+x",
        keywords: ["clear", "reset", "ops"],
        run: clearOpsFilters,
      },
      {
        id: "filters.focus.toggle",
        label: "Toggle Focus Mode",
        description: "Toggle stage focus lighting for selected context.",
        section: "Filters",
        defaultShortcut: "mod+f",
        keywords: ["focus", "lighting", "fog"],
        run: toggleFocusMode,
      },
      {
        id: "filters.status.all",
        label: "Set Status Filter: ALL",
        description: "Show every entity status in the stage.",
        section: "Filters",
        defaultShortcut: "mod+0",
        keywords: ["status", "all"],
        run: () => {
          setOpsFilters((prev) => ({ ...prev, status: "all" }));
        },
      },
      {
        id: "filters.status.active",
        label: "Set Status Filter: ACTIVE",
        description: "Show active entities only.",
        section: "Filters",
        defaultShortcut: "mod+1",
        keywords: ["status", "active"],
        run: () => {
          setOpsFilters((prev) => ({ ...prev, status: "active" }));
        },
      },
      {
        id: "filters.status.error",
        label: "Set Status Filter: ERROR",
        description: "Show error entities only.",
        section: "Filters",
        defaultShortcut: "mod+2",
        keywords: ["status", "error"],
        run: () => {
          setOpsFilters((prev) => ({ ...prev, status: "error" }));
        },
      },
      {
        id: "layout.placement.toggle",
        label: "Toggle Placement Mode",
        description: "Switch between AUTO and MANUAL overflow routing.",
        section: "Filters",
        defaultShortcut: "mod+m",
        keywords: ["placement", "auto", "manual", "overflow"],
        run: togglePlacementMode,
      },
      {
        id: "timeline.clear",
        label: "Clear Timeline Filters",
        description: "Reset run/agent/status timeline filters and playback cursor.",
        section: "Timeline",
        defaultShortcut: "alt+shift+c",
        keywords: ["timeline", "clear", "reset"],
        run: clearTimelineFilters,
      },
      {
        id: "timeline.prev",
        label: "Timeline Previous Event",
        description: "Move playback cursor to previous timeline event.",
        section: "Timeline",
        defaultShortcut: "alt+arrowleft",
        keywords: ["timeline", "previous", "playback"],
        run: () => {
          moveTimelineEvent(-1);
        },
      },
      {
        id: "timeline.next",
        label: "Timeline Next Event",
        description: "Move playback cursor to next timeline event.",
        section: "Timeline",
        defaultShortcut: "alt+arrowright",
        keywords: ["timeline", "next", "playback"],
        run: () => {
          moveTimelineEvent(1);
        },
      },
      {
        id: "run.jump",
        label: "Jump to Selected Run",
        description: "Apply selected runId to timeline filter.",
        section: "Run Tools",
        defaultShortcut: "mod+j",
        keywords: ["run", "jump", "timeline"],
        run: onJumpToRun,
      },
      {
        id: "run.copy.runId",
        label: "Copy runId",
        description: "Copy runId from selected entity/timeline context.",
        section: "Run Tools",
        defaultShortcut: "mod+shift+r",
        keywords: ["copy", "run", "id"],
        run: () => {
          void onCopyRunId();
        },
      },
      {
        id: "run.copy.sessionKey",
        label: "Copy sessionKey",
        description: "Copy requester/child session key from current run.",
        section: "Run Tools",
        defaultShortcut: "mod+shift+s",
        keywords: ["copy", "session", "key"],
        run: () => {
          void onCopySessionKey();
        },
      },
      {
        id: "run.copy.logGuide",
        label: "Copy Log Path Guide",
        description: "Copy shell snippet for selected agent session log directory.",
        section: "Run Tools",
        defaultShortcut: "mod+shift+g",
        keywords: ["copy", "log", "path", "guide"],
        run: () => {
          void onCopyLogGuide();
        },
      },
    ],
    [
      clearOpsFilters,
      clearTimelineFilters,
      moveTimelineEvent,
      onCopyLogGuide,
      onCopyRunId,
      onCopySessionKey,
      onJumpToRun,
      openShortcutHelp,
      toggleCommandPalette,
      toggleFocusMode,
      togglePlacementMode,
    ],
  );

  const commandSpecs = useMemo(() => [...baseCommandSpecs, ...entityCommandSpecs], [
    baseCommandSpecs,
    entityCommandSpecs,
  ]);

  const defaultShortcutByCommandId = useMemo(() => {
    const map = new Map<string, string>();
    for (const command of commandSpecs) {
      if (!command.defaultShortcut) {
        continue;
      }
      const normalized = normalizeShortcut(command.defaultShortcut);
      if (normalized) {
        map.set(command.id, normalized);
      }
    }
    return map;
  }, [commandSpecs]);

  const commandEntries = useMemo<CommandEntry[]>(() => {
    return commandSpecs.map((command) => {
      const overrideShortcut = shortcutOverrides[command.id];
      const baseShortcut = overrideShortcut ?? command.defaultShortcut;
      const normalizedShortcut = baseShortcut ? normalizeShortcut(baseShortcut) : null;
      const effectiveShortcut = normalizedShortcut
        ? (resolveShortcutForPlatform(normalizedShortcut, shortcutPlatform) ?? "")
        : "";
      const shortcutLabel = normalizedShortcut ? formatShortcut(normalizedShortcut, shortcutPlatform) : "";
      return {
        ...command,
        effectiveShortcut,
        shortcutLabel,
      };
    });
  }, [commandSpecs, shortcutOverrides, shortcutPlatform]);

  const commandEntryById = useMemo(
    () => new Map(commandEntries.map((entry) => [entry.id, entry])),
    [commandEntries],
  );

  const shortcutCommands = useMemo(
    () => commandEntries.filter((command) => Boolean(command.defaultShortcut)),
    [commandEntries],
  );

  const paletteCommands = useMemo<CommandPaletteEntry[]>(
    () =>
      commandEntries.map((command) => ({
        id: command.id,
        label: command.label,
        description: command.description,
        section: command.section,
        keywords: command.keywords,
        shortcutLabel: command.shortcutLabel,
        disabled: command.disabled,
      })),
    [commandEntries],
  );

  const executeCommandById = useCallback(
    (commandId: string, source: "palette" | "shortcut") => {
      const command = commandEntryById.get(commandId);
      if (!command || command.disabled) {
        return;
      }
      const result = command.run();
      if (result instanceof Promise) {
        void result;
      }

      if (!command.id.startsWith("palette.") && !command.id.startsWith("help.")) {
        setRecentCommandIds((prev) => pushRecentCommand(prev, command.id, MAX_RECENT_COMMANDS));
      }

      if (source === "palette") {
        setIsCommandPaletteOpen(false);
      }
    },
    [commandEntryById],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (rebindingCommandId) {
        return;
      }
      const chord = keyboardEventToShortcut(event);
      if (!chord) {
        return;
      }

      const isInputTarget = isEditableEventTarget(event.target);
      const isOverlayOpen = isCommandPaletteOpen || isShortcutHelpOpen;

      const matchedCommand = commandEntries.find((command) => {
        if (!command.effectiveShortcut || command.disabled) {
          return false;
        }
        if (command.effectiveShortcut !== chord) {
          return false;
        }
        if (isInputTarget && !command.allowInInput) {
          return false;
        }
        if (isOverlayOpen && !command.allowWhenOverlayOpen) {
          return false;
        }
        return true;
      });

      if (!matchedCommand) {
        return;
      }

      event.preventDefault();
      executeCommandById(matchedCommand.id, "shortcut");
    };

    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [
    commandEntries,
    executeCommandById,
    isCommandPaletteOpen,
    isShortcutHelpOpen,
    rebindingCommandId,
  ]);

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
    [setShortcutOverrides],
  );

  useEffect(() => {
    if (!isShortcutHelpOpen || !rebindingCommandId) {
      return undefined;
    }

    const handleRebind = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRebindingCommandId(null);
        return;
      }

      const chord = keyboardEventToShortcut(event);
      if (!chord) {
        return;
      }

      event.preventDefault();

      const conflict = shortcutCommands.find(
        (command) => command.id !== rebindingCommandId && command.effectiveShortcut === chord,
      );
      if (conflict) {
        showToast("error", `Shortcut conflict: ${conflict.label}`);
        return;
      }

      const normalizedChord = normalizeShortcut(chord);
      if (!normalizedChord) {
        return;
      }

      setShortcutOverrides((prev) => {
        const next = { ...prev };
        const defaultShortcut = defaultShortcutByCommandId.get(rebindingCommandId);
        if (defaultShortcut === normalizedChord) {
          delete next[rebindingCommandId];
        } else {
          next[rebindingCommandId] = normalizedChord;
        }
        return next;
      });

      setRebindingCommandId(null);
      showToast("success", "Shortcut updated.");
    };

    window.addEventListener("keydown", handleRebind);
    return () => {
      window.removeEventListener("keydown", handleRebind);
    };
  }, [
    defaultShortcutByCommandId,
    isShortcutHelpOpen,
    rebindingCommandId,
    shortcutCommands,
    showToast,
  ]);

  if (!snapshot) {
    return (
      <main className="app-shell">
        <div className="loading-view">
          <h1>openClawOffice</h1>
          <p>Loading office state stream...</p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </main>
    );
  }

  const agents = snapshot.entities.filter((entity) => entity.kind === "agent");
  const subagents = snapshot.entities.filter((entity) => entity.kind === "subagent");
  const running = subagents.filter((entity) => entity.status === "active").length;
  const failed = subagents.filter((entity) => entity.status === "error").length;
  const diagnostics = snapshot.diagnostics.slice(0, 2);
  const highlightRunId = activeEvent?.runId ?? (timelineFilters.runId.trim() || null);
  const timelineFilterAgentId = timelineFilters.agentId.trim();
  const highlightAgentId =
    activeEvent?.agentId ?? (timelineFilterAgentId || timelineLaneHighlightAgentId || null);
  const hasEntityFilter =
    opsFilters.query.trim().length > 0 ||
    opsFilters.status !== "all" ||
    opsFilters.roomId !== "all" ||
    opsFilters.recentMinutes !== "all";

  const paletteShortcutLabel = formatShortcut("mod+k", shortcutPlatform);
  const helpShortcutLabel = formatShortcut("shift+/", shortcutPlatform);

  return (
    <main className="app-shell">
      <section className="hero-bar">
        <div>
          <h1>openClawOffice</h1>
          <p>Zone-based visual HQ for OpenClaw agents and subagents.</p>
        </div>

        <div className="status-pill-row">
          <span className={`status-pill ${connected ? "online" : "offline"}`}>
            {connected ? "Live Stream" : "Polling"}
          </span>
          <span className={`status-pill ${liveSource ? "online" : "demo"}`}>
            {liveSource ? "Live Runtime" : "Demo Snapshot"}
          </span>
        </div>
      </section>

      <section className="stats-bar">
        <StatCard label="Agents" value={agents.length} accent="#81f0ff" />
        <StatCard label="Subagents" value={subagents.length} accent="#8cffc0" />
        <StatCard label="Running" value={running} accent="#ffd081" />
        <StatCard label="Errors" value={failed} accent="#ff8686" />
        <StatCard label="Events" value={snapshot.events.length} accent="#96b4ff" />
      </section>

      <section className="ops-toolbar">
        <label className="ops-field ops-search">
          Search
          <input
            type="text"
            placeholder="agentId / runId / task"
            value={opsFilters.query}
            onChange={(event) => {
              setOpsFilters((prev) => ({ ...prev, query: event.target.value }));
            }}
          />
        </label>

        <label className="ops-field">
          Status
          <select
            value={opsFilters.status}
            onChange={(event) => {
              setOpsFilters((prev) => ({
                ...prev,
                status: event.target.value as EntityStatusFilter,
              }));
            }}
          >
            <option value="all">ALL</option>
            <option value="active">ACTIVE</option>
            <option value="idle">IDLE</option>
            <option value="error">ERROR</option>
            <option value="ok">OK</option>
            <option value="offline">OFFLINE</option>
          </select>
        </label>

        <label className="ops-field">
          Room
          <select
            value={opsFilters.roomId}
            onChange={(event) => {
              setOpsFilters((prev) => ({ ...prev, roomId: event.target.value }));
            }}
          >
            <option value="all">ALL</option>
            {roomOptions.map((roomId) => (
              <option key={roomId} value={roomId}>
                {roomId}
              </option>
            ))}
          </select>
        </label>

        <label className="ops-field">
          Placement
          <select
            value={opsFilters.placementMode}
            onChange={(event) => {
              setOpsFilters((prev) => ({
                ...prev,
                placementMode: event.target.value as PlacementMode,
              }));
            }}
          >
            <option value="auto">AUTO</option>
            <option value="manual">MANUAL</option>
          </select>
        </label>

        <label className="ops-field">
          Recent
          <select
            value={opsFilters.recentMinutes}
            onChange={(event) => {
              const nextValue = event.target.value;
              setOpsFilters((prev) => ({
                ...prev,
                recentMinutes:
                  nextValue === "all" ? "all" : (Number(nextValue) as RecentWindowFilter),
              }));
            }}
          >
            <option value="all">ALL</option>
            <option value={5}>5m</option>
            <option value={15}>15m</option>
            <option value={30}>30m</option>
            <option value={60}>60m</option>
          </select>
        </label>

        <label className="ops-focus-toggle">
          <input
            type="checkbox"
            checked={opsFilters.focusMode}
            onChange={(event) => {
              setOpsFilters((prev) => ({ ...prev, focusMode: event.target.checked }));
            }}
          />
          Focus mode
        </label>

        <div className="ops-actions">
          <button type="button" onClick={toggleCommandPalette}>
            Command Palette ({paletteShortcutLabel})
          </button>
          <button type="button" onClick={openShortcutHelp}>
            Shortcut Help ({helpShortcutLabel})
          </button>
          <button type="button" onClick={() => void onCopyRunId()}>
            Copy runId
          </button>
          <button type="button" onClick={() => void onCopySessionKey()}>
            Copy sessionKey
          </button>
          <button type="button" onClick={() => void onCopyLogGuide()}>
            Log path guide
          </button>
          <button type="button" onClick={onJumpToRun}>
            Jump to run
          </button>
          <span className="ops-match-count">
            match {(matchCount ?? filteredEntityIds.length).toString()}/{snapshot.entities.length}
          </span>
        </div>
      </section>

      <section className="workspace">
        <OfficeStage
          snapshot={snapshot}
          selectedEntityId={selectedEntityId}
          highlightRunId={highlightRunId}
          highlightAgentId={highlightAgentId}
          filterEntityIds={filteredEntityIds}
          hasEntityFilter={hasEntityFilter}
          roomFilterId={opsFilters.roomId}
          focusMode={opsFilters.focusMode}
          placementMode={opsFilters.placementMode}
          onRoomOptionsChange={setRoomOptions}
          onRoomAssignmentsChange={handleRoomAssignmentsChange}
          onFilterMatchCountChange={setMatchCount}
          onSelectEntity={(entityId) => {
            setSelectedEntityId((prev) => (prev === entityId ? null : entityId));
          }}
        />
        <div className="workspace-side">
          <EventRail
            roomByAgentId={timelineRoomByAgentId}
            events={snapshot.events}
            runGraph={snapshot.runGraph}
            now={snapshot.generatedAt}
            filters={timelineFilters}
            onFiltersChange={setTimelineFilters}
            activeEventId={activeEventId}
            onActiveEventIdChange={setActiveEventId}
            onLaneContextChange={handleLaneContextChange}
          />
          <EntityDetailPanel
            key={selectedEntityId ?? "detail-empty"}
            snapshot={snapshot}
            selectedEntityId={selectedEntityId}
            onJumpToRun={(runId) => {
              if (!runId.trim()) {
                return;
              }
              jumpToRunId(runId, "panel");
            }}
            onClose={() => {
              setSelectedEntityId(null);
            }}
          />
        </div>
      </section>

      {diagnostics.length > 0 ? (
        <section className="diagnostic-strip" role="status" aria-live="polite">
          <strong>Data Warnings ({snapshot.diagnostics.length})</strong>
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}:${diagnostic.source}:${index}`} title={diagnostic.message}>
                [{diagnostic.code}] {diagnostic.source}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="footer-bar">
        <span>State Dir: {snapshot.source.stateDir}</span>
        <span>
          Updated: {new Date(snapshot.generatedAt).toLocaleTimeString()} | timeline
          {" "}
          {activeTimelineIndex >= 0 ? activeTimelineIndex + 1 : 0}/{timelinePlaybackEvents.length}
        </span>
      </footer>

      {isCommandPaletteOpen ? (
        <CommandPalette
          commands={paletteCommands}
          recentCommandIds={recentCommandIds}
          onClose={() => {
            setIsCommandPaletteOpen(false);
          }}
          onExecute={(commandId) => {
            executeCommandById(commandId, "palette");
          }}
          onOpenHelp={openShortcutHelp}
        />
      ) : null}

      {isShortcutHelpOpen ? (
        <div
          className="shortcut-help-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeShortcutHelp();
            }
          }}
        >
          <section className="shortcut-help" role="dialog" aria-modal="true" aria-label="Shortcut Help">
            <header className="shortcut-help-header">
              <div>
                <h2>Shortcut Help</h2>
                <p>
                  Rebind keys for command actions. Press a key combination after clicking Rebind.
                </p>
              </div>
              <div className="shortcut-help-header-actions">
                <button
                  type="button"
                  onClick={() => {
                    setShortcutOverrides({});
                    setRebindingCommandId(null);
                    showToast("info", "All shortcut overrides reset.");
                  }}
                  disabled={Object.keys(shortcutOverrides).length === 0}
                >
                  Reset all
                </button>
                <button type="button" onClick={closeShortcutHelp}>
                  Close
                </button>
              </div>
            </header>

            <p className="shortcut-help-capture" aria-live="polite">
              {rebindingCommandId
                ? `Listening for new shortcut: ${commandEntryById.get(rebindingCommandId)?.label ?? rebindingCommandId}`
                : "Select Rebind on a command to capture a new shortcut. Press Esc to cancel capture."}
            </p>

            <ol className="shortcut-help-list">
              {shortcutCommands.map((command) => {
                const hasOverride = Boolean(shortcutOverrides[command.id]);
                return (
                  <li key={command.id} className="shortcut-help-item">
                    <div className="shortcut-help-main">
                      <strong>{command.label}</strong>
                      <p>{command.description}</p>
                    </div>
                    <div className="shortcut-help-actions">
                      <kbd>{command.shortcutLabel}</kbd>
                      <button
                        type="button"
                        onClick={() => {
                          setRebindingCommandId(command.id);
                        }}
                        className={rebindingCommandId === command.id ? "is-armed" : ""}
                      >
                        {rebindingCommandId === command.id ? "Press keys..." : "Rebind"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          resetShortcutOverride(command.id);
                        }}
                        disabled={!hasOverride}
                      >
                        Reset
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      ) : null}

      {toast ? (
        <div className={`ops-toast ${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}

export default App;
