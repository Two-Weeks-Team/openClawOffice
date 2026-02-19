import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { AlertCenterPanel } from "./components/AlertCenterPanel";
import { CommandPalette, type CommandPaletteEntry } from "./components/CommandPalette";
import { EntityDetailPanel } from "./components/EntityDetailPanel";
import { EventRail } from "./components/EventRail";
import { GlobalStatusBar } from "./components/GlobalStatusBar";
import { OfficeStage } from "./components/OfficeStage";
import { SummaryExporter } from "./components/SummaryExporter";
import { ThroughputDashboard } from "./components/ThroughputDashboard";
import { useFocusTrap } from "./hooks/useFocusTrap";
import { useOfficeStream } from "./hooks/useOfficeStream";
import {
  DEFAULT_ALERT_RULE_PREFERENCES,
  evaluateAlertSignals,
  isAlertRuleSuppressed,
  normalizeAlertRulePreferences,
  type AlertRuleId,
  type AlertRulePreferences,
  type AlertSignal,
} from "./lib/alerts";
import {
  applyBatchAction,
  loadBatchActionState,
  persistBatchActionState,
  type BatchActionKind,
  type BatchActionState,
} from "./lib/entity-batch-actions";
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
  indexRunKnowledgeByRunId,
  loadRunKnowledgeEntries,
  persistRunKnowledgeEntries,
  removeRunKnowledgeEntry,
  upsertRunKnowledgeEntry,
  type RunKnowledgeEntry,
} from "./lib/run-notes-store";
import {
  DEFAULT_WORKSPACE_LAYOUT_STATE,
  loadWorkspaceLayoutSnapshot,
  loadWorkspaceLayoutState,
  persistWorkspaceLayoutSnapshot,
  persistWorkspaceLayoutState,
  setWorkspacePanelPlacement,
  workspaceDockedPanels,
  type WorkspaceLayoutPreset,
  type WorkspaceLayoutState,
  type WorkspacePanelId,
  type WorkspacePanelPlacement,
} from "./lib/workspace-layout";
import {
  buildTimelineIndex,
  filterTimelineEvents,
  nextPlaybackEventId,
  parseEventIdDeepLink,
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

type WorkspaceTabId = "status" | "operations" | "timeline" | "analysis" | "alerts";

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

type WorkspaceTabSpec = {
  id: WorkspaceTabId;
  label: string;
  description: string;
};

type CommandEntry = CommandSpec & {
  effectiveShortcut: string;
  shortcutLabel: string;
};

const SHORTCUT_OVERRIDES_KEY = "openclawoffice.shortcut-overrides.v1";
const RECENT_COMMANDS_KEY = "openclawoffice.recent-commands.v1";
const ALERT_RULE_PREFERENCES_KEY = "openclawoffice.alert-rule-preferences.v1";
const MAX_RECENT_COMMANDS = 8;

const DEFAULT_OPS_FILTERS: OpsFilters = {
  query: "",
  status: "all",
  roomId: "all",
  placementMode: "auto",
  recentMinutes: "all",
  focusMode: false,
};

const WORKSPACE_TABS: WorkspaceTabSpec[] = [
  {
    id: "status",
    label: "Status",
    description: "Live status and stage view",
  },
  {
    id: "operations",
    label: "Operations",
    description: "Search, filters, and batch actions",
  },
  {
    id: "timeline",
    label: "Timeline",
    description: "Replay and event navigation",
  },
  {
    id: "analysis",
    label: "Analysis",
    description: "Throughput, detail, and export tools",
  },
  {
    id: "alerts",
    label: "Alerts",
    description: "Signal list and rule controls",
  },
];

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

const WORKSPACE_PANEL_PLACEMENT_CLASS: Record<WorkspacePanelPlacement, string> = {
  docked: "is-docked",
  detached: "is-detached",
  hidden: "is-hidden",
};

const WORKSPACE_PANEL_LABELS: Record<WorkspacePanelId, string> = {
  timeline: "Timeline",
  detail: "Detail Panel",
};

function workspacePanelPlacementClass(
  layout: WorkspaceLayoutState,
  panel: WorkspacePanelId,
): string {
  return WORKSPACE_PANEL_PLACEMENT_CLASS[layout[panel]];
}

function workspaceTabForCommand(command: CommandEntry): WorkspaceTabId | null {
  if (command.id.startsWith("entity.jump:")) {
    return "analysis";
  }
  if (command.id === "run.jump") {
    return "timeline";
  }
  if (command.section === "Timeline" && !command.id.includes(".copy.")) {
    return "timeline";
  }
  if (command.section === "Filters" && command.id !== "filters.focus.toggle") {
    return "operations";
  }
  if (command.id === "selection.filtered") {
    return "operations";
  }
  return null;
}

function App() {
  const { snapshot, connected, liveSource, error, recoveryMessage } = useOfficeStream();
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(() => {
    const eventId = parseEventIdDeepLink(window.location.search);
    return eventId.length > 0 ? eventId : null;
  });
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
  const [isAlertCenterOpen, setIsAlertCenterOpen] = useState(false);
  const [rebindingCommandId, setRebindingCommandId] = useState<string | null>(null);
  const [shortcutOverrides, setShortcutOverrides] = useState<Record<string, string>>(loadShortcutOverrides);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>(loadRecentCommands);
  const [alertRulePreferences, setAlertRulePreferences] = useState<AlertRulePreferences>(
    loadAlertRulePreferences,
  );
  const [batchActionState, setBatchActionState] = useState<BatchActionState>(loadBatchActionState);
  const [runKnowledgeEntries, setRunKnowledgeEntries] = useState<RunKnowledgeEntry[]>(
    loadRunKnowledgeEntries,
  );
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayoutState>(
    loadWorkspaceLayoutState,
  );
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTabId>("status");
  const [isOperationsAdvancedOpen, setIsOperationsAdvancedOpen] = useState(false);
  const [isLayoutAdvancedOpen, setIsLayoutAdvancedOpen] = useState(false);
  const hasBatchStateHydratedRef = useRef(false);
  const hasRunKnowledgeHydratedRef = useRef(false);
  const hasWorkspaceLayoutHydratedRef = useRef(false);
  const workspaceTabButtonRefs = useRef<Record<WorkspaceTabId, HTMLButtonElement | null>>({
    status: null,
    operations: null,
    timeline: null,
    analysis: null,
    alerts: null,
  });
  const shortcutPlatform = useMemo(() => detectShortcutPlatform(), []);
  const alertCenterTrapRef = useFocusTrap<HTMLDivElement>(isAlertCenterOpen);
  const shortcutHelpTrapRef = useFocusTrap<HTMLDivElement>(isShortcutHelpOpen);

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
  const runKnowledgeByRunId = useMemo(
    () => indexRunKnowledgeByRunId(runKnowledgeEntries),
    [runKnowledgeEntries],
  );
  const dockedWorkspacePanels = useMemo(
    () => workspaceDockedPanels(workspaceLayout),
    [workspaceLayout],
  );
  const workspaceGridStyle = useMemo(
    () =>
      workspaceLayout.preset === "three-pane"
        ? {
            gridTemplateColumns: [
              "minmax(0, 1fr)",
              ...(workspaceLayout.timeline === "docked" ? ["360px"] : []),
              ...(workspaceLayout.detail === "docked" ? ["360px"] : []),
            ].join(" "),
            gridTemplateRows: "minmax(0, 1fr)",
          }
        : {
            gridTemplateColumns:
              dockedWorkspacePanels.length > 0 ? "minmax(0, 1fr) 360px" : "minmax(0, 1fr)",
            gridTemplateRows:
              dockedWorkspacePanels.length > 1
                ? "minmax(0, 1fr) minmax(0, 1fr)"
                : "minmax(0, 1fr)",
          },
    [dockedWorkspacePanels.length, workspaceLayout.detail, workspaceLayout.preset, workspaceLayout.timeline],
  );
  const activeEvent = useMemo(
    () => snapshot?.events.find((event) => event.id === activeEventId) ?? null,
    [activeEventId, snapshot],
  );
  const selectedEntityId =
    selectedEntityIds.length > 0 ? selectedEntityIds[selectedEntityIds.length - 1] : null;
  const effectiveSelectedEntityId = useMemo(() => {
    if (!snapshot || !activeEvent) {
      return selectedEntityId;
    }
    const replayEntityId = `subagent:${activeEvent.runId}`;
    return snapshot.entities.some((entity) => entity.id === replayEntityId)
      ? replayEntityId
      : selectedEntityId;
  }, [activeEvent, selectedEntityId, snapshot]);
  const selectedEntityIdsForStage = useMemo(() => {
    const ordered = [...new Set(selectedEntityIds)];
    if (effectiveSelectedEntityId && !ordered.includes(effectiveSelectedEntityId)) {
      ordered.push(effectiveSelectedEntityId);
    }
    return ordered;
  }, [effectiveSelectedEntityId, selectedEntityIds]);
  const pinnedEntityIdSet = useMemo(
    () => new Set(batchActionState.pinnedEntityIds),
    [batchActionState.pinnedEntityIds],
  );
  const watchedEntityIdSet = useMemo(
    () => new Set(batchActionState.watchedEntityIds),
    [batchActionState.watchedEntityIds],
  );
  const mutedEntityIdSet = useMemo(
    () => new Set(batchActionState.mutedEntityIds),
    [batchActionState.mutedEntityIds],
  );
  const selectedEntity = useMemo(
    () => snapshot?.entities.find((entity) => entity.id === effectiveSelectedEntityId) ?? null,
    [effectiveSelectedEntityId, snapshot],
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

  const alertSignals = useMemo<AlertSignal[]>(
    () => (snapshot ? evaluateAlertSignals(snapshot, snapshot.generatedAt) : []),
    [snapshot],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const runId = timelineFilters.runId.trim();
    if (runId) {
      url.searchParams.set("runId", runId);
    } else {
      url.searchParams.delete("runId");
    }
    const eventId = activeEventId?.trim();
    if (eventId) {
      url.searchParams.set("eventId", eventId);
    } else {
      url.searchParams.delete("eventId");
    }
    if (runId || eventId) {
      url.searchParams.set("replay", "1");
    } else {
      url.searchParams.delete("replay");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeEventId, timelineFilters.runId]);

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

  useEffect(() => {
    if (!hasBatchStateHydratedRef.current) {
      hasBatchStateHydratedRef.current = true;
      return;
    }
    persistBatchActionState(batchActionState);
  }, [batchActionState]);

  useEffect(() => {
    if (!hasRunKnowledgeHydratedRef.current) {
      hasRunKnowledgeHydratedRef.current = true;
      return;
    }
    persistRunKnowledgeEntries(runKnowledgeEntries);
  }, [runKnowledgeEntries]);

  useEffect(() => {
    if (!hasWorkspaceLayoutHydratedRef.current) {
      hasWorkspaceLayoutHydratedRef.current = true;
      return;
    }
    persistWorkspaceLayoutState(workspaceLayout);
  }, [workspaceLayout]);

  const applyEntityBatchAction = useCallback(
    (action: BatchActionKind) => {
      if (selectedEntityIds.length === 0) {
        showToast("error", "Select entities first before applying batch actions.");
        return;
      }
      setBatchActionState((prev) => applyBatchAction(prev, selectedEntityIds, action));
      const selectedCount = selectedEntityIds.length;
      const actionLabel: Record<BatchActionKind, string> = {
        pin: "Pinned",
        unpin: "Unpinned",
        watch: "Watching",
        unwatch: "Stopped watching",
        mute: "Muted",
        unmute: "Unmuted",
        clear: "Cleared flags for",
      };
      showToast("success", `${actionLabel[action]} ${selectedCount} selected target(s).`);
    },
    [selectedEntityIds, showToast],
  );

  const upsertRunKnowledge = useCallback((input: {
    runId: string;
    note: string;
    tags: string[];
  }) => {
    setRunKnowledgeEntries((prev) =>
      upsertRunKnowledgeEntry(prev, {
        runId: input.runId,
        note: input.note,
        tags: input.tags,
        updatedAt: Date.now(),
      }),
    );
  }, []);

  const removeRunKnowledge = useCallback((runId: string) => {
    setRunKnowledgeEntries((prev) => removeRunKnowledgeEntry(prev, runId));
  }, []);

  const setWorkspacePreset = useCallback((preset: WorkspaceLayoutPreset) => {
    setWorkspaceLayout((prev) => ({
      ...prev,
      preset,
    }));
  }, []);

  const toggleWorkspacePanelPinned = useCallback((panel: WorkspacePanelId) => {
    setWorkspaceLayout((prev) => {
      const nextPlacement = prev[panel] === "hidden" ? "docked" : "hidden";
      return setWorkspacePanelPlacement(prev, panel, nextPlacement);
    });
  }, []);

  const toggleWorkspacePanelDetached = useCallback((panel: WorkspacePanelId) => {
    setWorkspaceLayout((prev) => {
      const current = prev[panel];
      if (current === "hidden") {
        return prev;
      }
      const nextPlacement = current === "detached" ? "docked" : "detached";
      return setWorkspacePanelPlacement(prev, panel, nextPlacement);
    });
  }, []);

  const saveWorkspaceLayout = useCallback(() => {
    persistWorkspaceLayoutSnapshot(workspaceLayout);
    showToast("success", "Workspace layout snapshot saved.");
  }, [showToast, workspaceLayout]);

  const restoreWorkspaceLayout = useCallback(() => {
    const saved = loadWorkspaceLayoutSnapshot();
    if (!saved) {
      showToast("error", "No saved workspace layout snapshot.");
      return;
    }
    setWorkspaceLayout(saved);
    showToast("info", "Workspace layout restored.");
  }, [showToast]);

  const resetWorkspaceLayout = useCallback(() => {
    setWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT_STATE);
    showToast("info", "Workspace layout reset to default.");
  }, [showToast]);

  const handleSelectEntity = useCallback((entityId: string, mode: "single" | "toggle" = "single") => {
    if (mode === "toggle") {
      setSelectedEntityIds((prev) => {
        if (prev.includes(entityId)) {
          return prev.filter((id) => id !== entityId);
        }
        return [...prev, entityId];
      });
      return;
    }
    setSelectedEntityIds((prev) => (prev.length === 1 && prev[0] === entityId ? [] : [entityId]));
    setActiveWorkspaceTab("analysis");
  }, []);

  const clearSelectedEntities = useCallback(() => {
    setSelectedEntityIds([]);
  }, []);
  const selectFilteredEntities = useCallback(() => {
    if (filteredEntityIds.length === 0) {
      showToast("error", "No filtered entities available for selection.");
      return;
    }
    setSelectedEntityIds(filteredEntityIds);
    showToast("info", `Selected ${filteredEntityIds.length} filtered target(s).`);
  }, [filteredEntityIds, showToast]);
  const selectedCount = selectedEntityIds.length;
  const allSelectedPinned =
    selectedCount > 0 && selectedEntityIds.every((entityId) => pinnedEntityIdSet.has(entityId));
  const allSelectedWatched =
    selectedCount > 0 && selectedEntityIds.every((entityId) => watchedEntityIdSet.has(entityId));
  const allSelectedMuted =
    selectedCount > 0 && selectedEntityIds.every((entityId) => mutedEntityIdSet.has(entityId));

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

  const onCopyReplayLink = useCallback(async () => {
    const runId =
      timelineFilters.runId.trim() ||
      activeEvent?.runId ||
      selectedRun?.runId ||
      selectedEntity?.runId;
    if (!runId) {
      showToast("error", "No runId available for replay link.");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("runId", runId);
    if (activeEventId) {
      url.searchParams.set("eventId", activeEventId);
    } else {
      url.searchParams.delete("eventId");
    }
    url.searchParams.set("replay", "1");
    await copyText(url.toString(), "Copied replay link.");
  }, [
    activeEvent?.runId,
    activeEventId,
    copyText,
    selectedEntity?.runId,
    selectedRun?.runId,
    showToast,
    timelineFilters.runId,
  ]);

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

  const toggleAlertCenter = useCallback(() => {
    setRebindingCommandId(null);
    setIsCommandPaletteOpen(false);
    setIsShortcutHelpOpen(false);
    setIsAlertCenterOpen((prev) => !prev);
  }, []);

  const closeAlertCenter = useCallback(() => {
    setIsAlertCenterOpen(false);
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setRebindingCommandId(null);
    setIsAlertCenterOpen(false);
    setIsShortcutHelpOpen(false);
    setIsCommandPaletteOpen((prev) => !prev);
  }, []);

  const openShortcutHelp = useCallback(() => {
    setRebindingCommandId(null);
    setIsAlertCenterOpen(false);
    setIsCommandPaletteOpen(false);
    setIsShortcutHelpOpen(true);
  }, []);

  const closeShortcutHelp = useCallback(() => {
    setRebindingCommandId(null);
    setIsShortcutHelpOpen(false);
  }, []);

  const toggleAlertRuleMute = useCallback((ruleId: AlertRuleId) => {
    setAlertRulePreferences((prev) => ({
      ...prev,
      [ruleId]: {
        ...prev[ruleId],
        muted: !prev[ruleId].muted,
      },
    }));
  }, []);

  const snoozeAlertRule = useCallback((ruleId: AlertRuleId, durationMs: number) => {
    const baseTime = Math.max(snapshot?.generatedAt ?? 0, Date.now());
    setAlertRulePreferences((prev) => ({
      ...prev,
      [ruleId]: {
        ...prev[ruleId],
        muted: false,
        snoozeUntil: baseTime + durationMs,
      },
    }));
  }, [snapshot?.generatedAt]);

  const clearAlertRuleSuppression = useCallback((ruleId: AlertRuleId) => {
    setAlertRulePreferences((prev) => ({
      ...prev,
      [ruleId]: {
        muted: false,
        snoozeUntil: 0,
      },
    }));
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
          setSelectedEntityIds([entity.id]);
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
        id: "alerts.center.toggle",
        label: "Toggle Alert Center",
        description: "Open or close alert center and rule controls.",
        section: "Global",
        defaultShortcut: "mod+shift+a",
        allowInInput: true,
        allowWhenOverlayOpen: true,
        keywords: ["alerts", "center", "rules", "mute", "snooze"],
        run: toggleAlertCenter,
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
        id: "selection.clear",
        label: "Clear Selected Entities",
        description: "Clear current multi-selection list used for batch actions.",
        section: "Entities",
        defaultShortcut: "alt+shift+e",
        keywords: ["selection", "clear", "entities"],
        disabled: selectedCount === 0,
        run: clearSelectedEntities,
      },
      {
        id: "selection.filtered",
        label: "Select Filtered Entities",
        description: "Select all entities currently matched by Ops filters.",
        section: "Entities",
        defaultShortcut: "alt+shift+f",
        keywords: ["selection", "filtered", "entities"],
        disabled: filteredEntityIds.length === 0,
        run: selectFilteredEntities,
      },
      {
        id: "batch.pin",
        label: allSelectedPinned ? "Unpin Selected" : "Pin Selected",
        description: "Apply pin/unpin to selected entities in one action.",
        section: "Entities",
        keywords: ["pin", "batch", "entities", "selection"],
        disabled: selectedCount === 0,
        run: () => {
          applyEntityBatchAction(allSelectedPinned ? "unpin" : "pin");
        },
      },
      {
        id: "batch.watch",
        label: allSelectedWatched ? "Unwatch Selected" : "Watch Selected",
        description: "Apply watch/unwatch to selected entities in one action.",
        section: "Entities",
        keywords: ["watch", "batch", "entities", "selection"],
        disabled: selectedCount === 0,
        run: () => {
          applyEntityBatchAction(allSelectedWatched ? "unwatch" : "watch");
        },
      },
      {
        id: "batch.mute",
        label: allSelectedMuted ? "Unmute Selected" : "Mute Selected",
        description: "Apply mute/unmute to selected entities in one action.",
        section: "Entities",
        keywords: ["mute", "batch", "entities", "selection"],
        disabled: selectedCount === 0,
        run: () => {
          applyEntityBatchAction(allSelectedMuted ? "unmute" : "mute");
        },
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
        id: "timeline.copy.replayLink",
        label: "Copy Replay Link",
        description: "Copy a local replay deep-link with runId and active event.",
        section: "Timeline",
        defaultShortcut: "alt+shift+l",
        keywords: ["timeline", "replay", "link", "copy"],
        run: () => {
          void onCopyReplayLink();
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
      allSelectedMuted,
      allSelectedPinned,
      allSelectedWatched,
      applyEntityBatchAction,
      clearOpsFilters,
      clearSelectedEntities,
      clearTimelineFilters,
      filteredEntityIds.length,
      moveTimelineEvent,
      onCopyLogGuide,
      onCopyReplayLink,
      onCopyRunId,
      onCopySessionKey,
      onJumpToRun,
      openShortcutHelp,
      selectFilteredEntities,
      toggleAlertCenter,
      toggleCommandPalette,
      toggleFocusMode,
      togglePlacementMode,
      selectedCount,
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

      const linkedTab = workspaceTabForCommand(command);
      if (linkedTab) {
        setActiveWorkspaceTab(linkedTab);
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
      const isOverlayOpen = isCommandPaletteOpen || isShortcutHelpOpen || isAlertCenterOpen;

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
    isAlertCenterOpen,
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

  useEffect(() => {
    if (!isAlertCenterOpen) {
      return undefined;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeAlertCenter();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeAlertCenter, isAlertCenterOpen]);

  const mutedTargetSets = useMemo(() => {
    const mutedRunIds = new Set<string>();
    const mutedAgentIds = new Set<string>();
    if (!snapshot) {
      return { mutedRunIds, mutedAgentIds };
    }
    for (const entity of snapshot.entities) {
      if (!mutedEntityIdSet.has(entity.id)) {
        continue;
      }
      if (entity.kind === "agent") {
        mutedAgentIds.add(entity.agentId);
      }
      if (entity.kind === "subagent" && entity.runId) {
        mutedRunIds.add(entity.runId);
      }
    }
    return { mutedRunIds, mutedAgentIds };
  }, [mutedEntityIdSet, snapshot]);

  const visibleAlertSignals = useMemo(() => {
    if (!snapshot) {
      return [] as AlertSignal[];
    }
    return alertSignals.filter((signal) => {
      if (isAlertRuleSuppressed(alertRulePreferences, signal.ruleId, snapshot.generatedAt)) {
        return false;
      }
      if (signal.runIds.length === 0 && signal.agentIds.length === 0) {
        return true;
      }

      const hasVisibleRun = signal.runIds.some((runId) => {
        if (mutedTargetSets.mutedRunIds.has(runId)) {
          return false;
        }
        const run = runById.get(runId);
        if (!run) {
          return true;
        }
        return !mutedTargetSets.mutedAgentIds.has(run.childAgentId);
      });
      const hasVisibleAgent = signal.agentIds.some(
        (agentId) => !mutedTargetSets.mutedAgentIds.has(agentId),
      );
      return hasVisibleRun || hasVisibleAgent;
    });
  }, [
    alertRulePreferences,
    alertSignals,
    mutedTargetSets,
    runById,
    snapshot,
  ]);

  if (!snapshot) {
    return (
      <main className="app-shell">
        <div className="loading-view">
          <h1>openClawOffice</h1>
          <p>Loading office state stream...</p>
          {error ? <p className="error-text">{error}</p> : null}
          {recoveryMessage ? <p className="recovery-text">{recoveryMessage}</p> : null}
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
  const hasActiveAlerts = visibleAlertSignals.length > 0;
  const alertToastSignals = visibleAlertSignals.slice(0, 2);

  const paletteShortcutLabel = formatShortcut("mod+k", shortcutPlatform);
  const helpShortcutLabel = formatShortcut("shift+/", shortcutPlatform);
  const alertCenterShortcutLabel = formatShortcut("mod+shift+a", shortcutPlatform);
  const focusModeShortcutLabel = formatShortcut("mod+f", shortcutPlatform);
  const workspacePresetClass =
    workspaceLayout.preset === "three-pane" ? "workspace-preset-three" : "workspace-preset-two";
  const workspaceDockedClass =
    dockedWorkspacePanels.length === 0
      ? "has-no-docked"
      : dockedWorkspacePanels.length === 1
        ? "has-single-docked"
        : "has-double-docked";

  return (
    <main className="app-shell">
      <GlobalStatusBar
        connected={connected}
        liveSource={liveSource}
        agents={agents.length}
        subagents={subagents.length}
        running={running}
        errors={failed}
        events={snapshot.events.length}
        alertCount={visibleAlertSignals.length}
        updatedAt={snapshot.generatedAt}
        stateDir={snapshot.source.stateDir}
        onOpenAlerts={toggleAlertCenter}
      />

      {recoveryMessage ? (
        <section className="recovery-banner" role="status" aria-live="polite">
          <strong>Recovery Mode</strong>
          <p>{recoveryMessage}</p>
        </section>
      ) : null}

      <section className="workspace-tabs" aria-label="Workspace views">
        {/* Keep tab panel state mounted; switch visibility with `hidden` to preserve workflow context. */}
        <header className="workspace-tabs-header">
          <div className="workspace-tablist" role="tablist" aria-label="Workspace purpose tabs">
            {WORKSPACE_TABS.map((tab, index) => {
              const isActive = activeWorkspaceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    workspaceTabButtonRefs.current[tab.id] = node;
                  }}
                  id={`workspace-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`workspace-tabpanel-${tab.id}`}
                  title={tab.description}
                  tabIndex={isActive ? 0 : -1}
                  className={`workspace-tab-button${isActive ? " is-active" : ""}`}
                  onClick={() => {
                    setActiveWorkspaceTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    let nextIndex = index;
                    if (event.key === "ArrowRight") {
                      nextIndex = (index + 1) % WORKSPACE_TABS.length;
                    } else if (event.key === "ArrowLeft") {
                      nextIndex = (index - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
                    } else if (event.key === "Home") {
                      nextIndex = 0;
                    } else if (event.key === "End") {
                      nextIndex = WORKSPACE_TABS.length - 1;
                    } else {
                      return;
                    }
                    event.preventDefault();
                    const nextTab = WORKSPACE_TABS[nextIndex];
                    setActiveWorkspaceTab(nextTab.id);
                    workspaceTabButtonRefs.current[nextTab.id]?.focus();
                  }}
                >
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="workspace-quick-actions" aria-label="Quick actions">
            <button type="button" onClick={toggleCommandPalette}>
              Command Palette ({paletteShortcutLabel})
            </button>
            <button type="button" onClick={onJumpToRun}>
              Jump to run
            </button>
            <button type="button" onClick={() => void onCopyRunId()}>
              Copy runId
            </button>
            <button
              type="button"
              className={hasActiveAlerts ? "ops-alert-button has-alerts" : "ops-alert-button"}
              onClick={() => {
                setActiveWorkspaceTab("alerts");
              }}
            >
              Alerts [{visibleAlertSignals.length}]
            </button>
          </div>
        </header>

        <section
          id="workspace-tabpanel-status"
          role="tabpanel"
          aria-labelledby="workspace-tab-status"
          className="workspace-tabpanel"
          hidden={activeWorkspaceTab !== "status"}
        >
          <section className="unified-header" aria-label="Status overview">
            <div className="unified-header-title">
              <h1>openClawOffice</h1>
              <span className="unified-header-subtitle">Mission Control</span>
            </div>
            <div className="unified-header-kpis">
              <div className="unified-kpi">
                <span>Running</span>
                <strong>{running}</strong>
              </div>
              <div className="unified-kpi">
                <span>Errors</span>
                <strong className={failed > 0 ? "has-errors" : ""}>{failed}</strong>
              </div>
              <div className="unified-kpi">
                <span>Alerts</span>
                <strong className={visibleAlertSignals.length > 0 ? "has-alerts" : ""}>{visibleAlertSignals.length}</strong>
              </div>
              <div className="unified-kpi">
                <span>Selection</span>
                <strong>{selectedCount}/{(matchCount ?? filteredEntityIds.length).toString()}</strong>
              </div>
            </div>
          </section>
        </section>

        <section
          id="workspace-tabpanel-operations"
          role="tabpanel"
          aria-labelledby="workspace-tab-operations"
          className="workspace-tabpanel"
          hidden={activeWorkspaceTab !== "operations"}
        >
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

            <label className="ops-focus-toggle" title={`Shortcut: ${focusModeShortcutLabel}`}>
              <input
                type="checkbox"
                checked={opsFilters.focusMode}
                onChange={(event) => {
                  setOpsFilters((prev) => ({ ...prev, focusMode: event.target.checked }));
                }}
              />
              Focus mode ({focusModeShortcutLabel})
            </label>

            <div className="ops-actions">
              <div className="ops-actions-primary">
                <button type="button" onClick={openShortcutHelp}>
                  Shortcut Help ({helpShortcutLabel})
                </button>
                <button
                  type="button"
                  className={hasActiveAlerts ? "ops-alert-button has-alerts" : "ops-alert-button"}
                  onClick={toggleAlertCenter}
                >
                  Alert Center ({alertCenterShortcutLabel}) [{visibleAlertSignals.length}]
                </button>
                <button type="button" disabled={filteredEntityIds.length === 0} onClick={selectFilteredEntities}>
                  Select filtered
                </button>
                <button
                  type="button"
                  className={isOperationsAdvancedOpen ? "is-active" : ""}
                  aria-expanded={isOperationsAdvancedOpen}
                  aria-controls="ops-advanced-actions"
                  onClick={() => {
                    setIsOperationsAdvancedOpen((prev) => !prev);
                  }}
                >
                  {isOperationsAdvancedOpen ? "Hide advanced actions" : "Show advanced actions"}
                </button>
              </div>
              <div id="ops-advanced-actions" className="ops-actions-advanced" hidden={!isOperationsAdvancedOpen}>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => {
                    applyEntityBatchAction(allSelectedPinned ? "unpin" : "pin");
                  }}
                >
                  {allSelectedPinned ? "Unpin selected" : "Pin selected"}
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => {
                    applyEntityBatchAction(allSelectedWatched ? "unwatch" : "watch");
                  }}
                >
                  {allSelectedWatched ? "Unwatch selected" : "Watch selected"}
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => {
                    applyEntityBatchAction(allSelectedMuted ? "unmute" : "mute");
                  }}
                >
                  {allSelectedMuted ? "Unmute selected" : "Mute selected"}
                </button>
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => {
                    applyEntityBatchAction("clear");
                  }}
                >
                  Clear selected flags
                </button>
                <button type="button" disabled={selectedCount === 0} onClick={clearSelectedEntities}>
                  Clear selection
                </button>
                <button type="button" onClick={() => void onCopyReplayLink()}>
                  Copy replay link
                </button>
                <button type="button" onClick={() => void onCopySessionKey()}>
                  Copy sessionKey
                </button>
                <button type="button" onClick={() => void onCopyLogGuide()}>
                  Log path guide
                </button>
                <span className="ops-batch-summary">
                  selected {selectedCount} (ctrl/cmd+click) | pin {batchActionState.pinnedEntityIds.length} | watch{" "}
                  {batchActionState.watchedEntityIds.length} | mute {batchActionState.mutedEntityIds.length}
                </span>
              </div>
              <span className="ops-match-count">
                match {(matchCount ?? filteredEntityIds.length).toString()}/{snapshot.entities.length}
              </span>
            </div>
          </section>

          <section className="workspace-layout-advanced">
            <button
              type="button"
              className={`workspace-layout-toolbar-toggle ${isLayoutAdvancedOpen ? "is-active" : ""}`}
              aria-expanded={isLayoutAdvancedOpen}
              aria-controls="workspace-layout-toolbar"
              onClick={() => {
                setIsLayoutAdvancedOpen((prev) => !prev);
              }}
            >
              {isLayoutAdvancedOpen ? "Hide layout controls" : "Show layout controls"}
            </button>
            <section
              id="workspace-layout-toolbar"
              className="workspace-layout-toolbar"
              hidden={!isLayoutAdvancedOpen}
            >
              <div className="workspace-layout-presets">
                <strong>Split View</strong>
                <button
                  type="button"
                  className={workspaceLayout.preset === "two-pane" ? "is-active" : ""}
                  onClick={() => {
                    setWorkspacePreset("two-pane");
                  }}
                >
                  2-pane
                </button>
                <button
                  type="button"
                  className={workspaceLayout.preset === "three-pane" ? "is-active" : ""}
                  onClick={() => {
                    setWorkspacePreset("three-pane");
                  }}
                >
                  3-pane
                </button>
              </div>
              <div className="workspace-layout-panels">
                {(["timeline", "detail"] as WorkspacePanelId[]).map((panelId) => {
                  const placement = workspaceLayout[panelId];
                  const label = WORKSPACE_PANEL_LABELS[panelId];
                  return (
                    <div key={panelId} className="workspace-layout-panel-control">
                      <span>{label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          toggleWorkspacePanelPinned(panelId);
                        }}
                      >
                        {placement === "hidden" ? "Pin" : "Unpin"}
                      </button>
                      <button
                        type="button"
                        disabled={placement === "hidden"}
                        onClick={() => {
                          toggleWorkspacePanelDetached(panelId);
                        }}
                      >
                        {placement === "detached" ? "Attach" : "Detach"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="workspace-layout-actions">
                <button type="button" onClick={saveWorkspaceLayout}>
                  Save layout
                </button>
                <button type="button" onClick={restoreWorkspaceLayout}>
                  Restore layout
                </button>
                <button type="button" onClick={resetWorkspaceLayout}>
                  Reset layout
                </button>
              </div>
            </section>
          </section>
        </section>

        <section
          id="workspace-tabpanel-timeline"
          role="tabpanel"
          aria-labelledby="workspace-tab-timeline"
          className="workspace-tabpanel"
          hidden={activeWorkspaceTab !== "timeline"}
        >
          <p className="workspace-tab-note">Timeline panel is always visible on the right. Use the collapsible sections for playback and filtering.</p>
        </section>

        <section
          id="workspace-tabpanel-analysis"
          role="tabpanel"
          aria-labelledby="workspace-tab-analysis"
          className="workspace-tabpanel"
          hidden={activeWorkspaceTab !== "analysis"}
        >
          <ThroughputDashboard snapshot={snapshot} />
          <SummaryExporter
            snapshot={snapshot}
            defaultAgentId={selectedEntity?.agentId ?? activeEvent?.agentId ?? null}
            defaultRunId={
              selectedRun?.runId ?? selectedEntity?.runId ?? activeEvent?.runId ?? null
            }
            runKnowledgeEntries={runKnowledgeEntries}
            onNotify={showToast}
          />
        </section>

        <section
          id="workspace-tabpanel-alerts"
          role="tabpanel"
          aria-labelledby="workspace-tab-alerts"
          className="workspace-tabpanel"
          hidden={activeWorkspaceTab !== "alerts"}
        >
          <section className="alert-center alerts-tab-surface" aria-label="Alert Center panel">
            <header className="alert-center-header">
              <div>
                <h2>Alert Center</h2>
                <p>Event-driven local alerts with duplicate suppression and rule-level mute/snooze.</p>
              </div>
              <button type="button" onClick={toggleAlertCenter}>
                Open modal
              </button>
            </header>
            <AlertCenterPanel
              alertSignals={alertSignals}
              preferences={alertRulePreferences}
              now={snapshot.generatedAt}
              onToggleRuleMute={toggleAlertRuleMute}
              onSnoozeRule={snoozeAlertRule}
              onClearRuleSuppression={clearAlertRuleSuppression}
            />
          </section>
        </section>
      </section>

      <section
        className={`workspace ${workspacePresetClass} ${workspaceDockedClass} ${
          activeWorkspaceTab === "alerts" ? "is-hidden-by-tab" : ""
        }`}
        style={workspaceGridStyle}
        hidden={activeWorkspaceTab === "alerts"}
      >
        <div className="workspace-stage-pane">
          <OfficeStage
            snapshot={snapshot}
            selectedEntityId={effectiveSelectedEntityId}
            selectedEntityIds={selectedEntityIdsForStage}
            pinnedEntityIds={batchActionState.pinnedEntityIds}
            watchedEntityIds={batchActionState.watchedEntityIds}
            highlightRunId={highlightRunId}
            highlightAgentId={highlightAgentId}
            alertSignals={visibleAlertSignals}
            filterEntityIds={filteredEntityIds}
            hasEntityFilter={hasEntityFilter}
            roomFilterId={opsFilters.roomId}
            focusMode={opsFilters.focusMode}
            placementMode={opsFilters.placementMode}
            onRoomOptionsChange={setRoomOptions}
            onRoomAssignmentsChange={handleRoomAssignmentsChange}
            onFilterMatchCountChange={setMatchCount}
            onSelectEntity={handleSelectEntity}
          />
        </div>
        <section
          className={`workspace-panel timeline ${workspacePanelPlacementClass(
            workspaceLayout,
            "timeline",
          )}`}
          hidden={workspaceLayout.timeline === "hidden"}
        >
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
        </section>
        <section
          className={`workspace-panel detail ${workspacePanelPlacementClass(
            workspaceLayout,
            "detail",
          )} ${activeWorkspaceTab === "analysis" ? "" : "is-hidden-by-tab"}`}
          hidden={activeWorkspaceTab !== "analysis"}
        >
          <EntityDetailPanel
            snapshot={snapshot}
            selectedEntityId={effectiveSelectedEntityId}
            runKnowledgeByRunId={runKnowledgeByRunId}
            onUpsertRunKnowledge={upsertRunKnowledge}
            onRemoveRunKnowledge={removeRunKnowledge}
            onJumpToRun={(runId) => {
              if (!runId.trim()) {
                return;
              }
              jumpToRunId(runId, "panel");
            }}
            onClose={() => {
              clearSelectedEntities();
            }}
          />
        </section>
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
        <span>
          timeline {activeTimelineIndex >= 0 ? activeTimelineIndex + 1 : 0}/
          {timelinePlaybackEvents.length}
        </span>
        <span>
          selected {selectedCount} | match {(matchCount ?? filteredEntityIds.length).toString()}
        </span>
      </footer>

      {isAlertCenterOpen ? (
        <div
          ref={alertCenterTrapRef}
          className="alert-center-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeAlertCenter();
            }
          }}
        >
          <section className="alert-center" role="dialog" aria-modal="true" aria-label="Alert Center">
            <header className="alert-center-header">
              <div>
                <h2>Alert Center</h2>
                <p>
                  Event-driven local alerts with duplicate suppression and rule-level mute/snooze.
                </p>
              </div>
              <button type="button" onClick={closeAlertCenter}>
                Close
              </button>
            </header>
            <AlertCenterPanel
              alertSignals={alertSignals}
              preferences={alertRulePreferences}
              now={snapshot.generatedAt}
              onToggleRuleMute={toggleAlertRuleMute}
              onSnoozeRule={snoozeAlertRule}
              onClearRuleSuppression={clearAlertRuleSuppression}
            />
          </section>
        </div>
      ) : null}

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
          ref={shortcutHelpTrapRef}
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

      {alertToastSignals.length > 0 ? (
        <div className="alert-toast-stack" role="status" aria-live="polite">
          {alertToastSignals.map((signal) => (
            <article key={signal.dedupeKey} className={`alert-toast ${signal.severity}`}>
              <strong>{signal.title}</strong>
              <p>{signal.message}</p>
            </article>
          ))}
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
