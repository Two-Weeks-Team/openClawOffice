import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_LAYOUT_STATE,
  normalizeWorkspaceLayout,
  parseWorkspaceLayout,
  setWorkspacePanelPlacement,
  workspaceDockedPanels,
} from "./workspace-layout";

describe("workspace layout", () => {
  it("falls back to defaults for invalid payloads", () => {
    expect(normalizeWorkspaceLayout(null)).toEqual(DEFAULT_WORKSPACE_LAYOUT_STATE);
    expect(normalizeWorkspaceLayout({ foo: "bar" })).toEqual(DEFAULT_WORKSPACE_LAYOUT_STATE);
    expect(parseWorkspaceLayout("{not-json")).toEqual(DEFAULT_WORKSPACE_LAYOUT_STATE);
  });

  it("normalizes valid preset and panel placements", () => {
    const normalized = normalizeWorkspaceLayout({
      preset: "three-pane",
      timeline: "detached",
      detail: "hidden",
    });
    expect(normalized).toEqual({
      preset: "three-pane",
      timeline: "detached",
      detail: "hidden",
    });
  });

  it("updates panel placement immutably", () => {
    const next = setWorkspacePanelPlacement(
      DEFAULT_WORKSPACE_LAYOUT_STATE,
      "timeline",
      "detached",
    );
    expect(next.timeline).toBe("detached");
    expect(next.detail).toBe("docked");
    expect(DEFAULT_WORKSPACE_LAYOUT_STATE.timeline).toBe("docked");
  });

  it("returns docked panels in timeline/detail order", () => {
    expect(
      workspaceDockedPanels({
        preset: "three-pane",
        timeline: "hidden",
        detail: "docked",
      }),
    ).toEqual(["detail"]);

    expect(
      workspaceDockedPanels({
        preset: "two-pane",
        timeline: "docked",
        detail: "docked",
      }),
    ).toEqual(["timeline", "detail"]);
  });
});
