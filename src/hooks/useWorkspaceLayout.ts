import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "../lib/workspace-layout";
import type { ShowToast } from "./useToast";

export function useWorkspaceLayout(showToast: ShowToast) {
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayoutState>(
    loadWorkspaceLayoutState,
  );
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    persistWorkspaceLayoutState(workspaceLayout);
  }, [workspaceLayout]);

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

  const setWorkspacePreset = useCallback((preset: WorkspaceLayoutPreset) => {
    setWorkspaceLayout((prev) => ({ ...prev, preset }));
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

  return {
    workspaceLayout,
    setWorkspaceLayout,
    dockedWorkspacePanels,
    workspaceGridStyle,
    setWorkspacePreset,
    toggleWorkspacePanelPinned,
    toggleWorkspacePanelDetached,
    saveWorkspaceLayout,
    restoreWorkspaceLayout,
    resetWorkspaceLayout,
  };
}
