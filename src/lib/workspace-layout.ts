export type WorkspaceLayoutPreset = "two-pane" | "three-pane";
export type WorkspacePanelId = "timeline" | "detail";
export type WorkspacePanelPlacement = "docked" | "detached" | "hidden";

export type WorkspaceLayoutState = {
  preset: WorkspaceLayoutPreset;
  timeline: WorkspacePanelPlacement;
  detail: WorkspacePanelPlacement;
};

export const WORKSPACE_LAYOUT_STATE_KEY = "openclawoffice.workspace-layout.state.v1";
export const WORKSPACE_LAYOUT_SNAPSHOT_KEY = "openclawoffice.workspace-layout.saved.v1";

export const DEFAULT_WORKSPACE_LAYOUT_STATE: WorkspaceLayoutState = {
  preset: "two-pane",
  timeline: "docked",
  detail: "docked",
};

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isPreset(value: unknown): value is WorkspaceLayoutPreset {
  return value === "two-pane" || value === "three-pane";
}

function isPanelPlacement(value: unknown): value is WorkspacePanelPlacement {
  return value === "docked" || value === "detached" || value === "hidden";
}

export function normalizeWorkspaceLayout(candidate: unknown): WorkspaceLayoutState {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return DEFAULT_WORKSPACE_LAYOUT_STATE;
  }
  const record = candidate as Record<string, unknown>;
  return {
    preset: isPreset(record.preset) ? record.preset : DEFAULT_WORKSPACE_LAYOUT_STATE.preset,
    timeline: isPanelPlacement(record.timeline)
      ? record.timeline
      : DEFAULT_WORKSPACE_LAYOUT_STATE.timeline,
    detail: isPanelPlacement(record.detail)
      ? record.detail
      : DEFAULT_WORKSPACE_LAYOUT_STATE.detail,
  };
}

export function parseWorkspaceLayout(raw: string | null): WorkspaceLayoutState {
  if (!raw) {
    return DEFAULT_WORKSPACE_LAYOUT_STATE;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeWorkspaceLayout(parsed);
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT_STATE;
  }
}

export function loadWorkspaceLayoutState(): WorkspaceLayoutState {
  if (!hasBrowserStorage()) {
    return DEFAULT_WORKSPACE_LAYOUT_STATE;
  }
  try {
    return parseWorkspaceLayout(window.localStorage.getItem(WORKSPACE_LAYOUT_STATE_KEY));
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT_STATE;
  }
}

export function persistWorkspaceLayoutState(layout: WorkspaceLayoutState): void {
  if (!hasBrowserStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(WORKSPACE_LAYOUT_STATE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore localStorage persistence errors in restricted browser modes.
  }
}

export function loadWorkspaceLayoutSnapshot(): WorkspaceLayoutState | null {
  if (!hasBrowserStorage()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }
    return parseWorkspaceLayout(raw);
  } catch {
    return null;
  }
}

export function persistWorkspaceLayoutSnapshot(layout: WorkspaceLayoutState): void {
  if (!hasBrowserStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(WORKSPACE_LAYOUT_SNAPSHOT_KEY, JSON.stringify(layout));
  } catch {
    // Ignore localStorage persistence errors in restricted browser modes.
  }
}

export function setWorkspacePanelPlacement(
  layout: WorkspaceLayoutState,
  panel: WorkspacePanelId,
  placement: WorkspacePanelPlacement,
): WorkspaceLayoutState {
  return {
    ...layout,
    [panel]: placement,
  };
}

export function workspaceDockedPanels(layout: WorkspaceLayoutState): WorkspacePanelId[] {
  return (["timeline", "detail"] as const).filter((panel) => layout[panel] === "docked");
}
