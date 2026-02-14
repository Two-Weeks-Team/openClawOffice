import { describe, expect, it } from "vitest";
import type { BubbleLaneLayout } from "./bubble-lanes";
import {
  projectBubbleLaneLayoutForLod,
  resolveStageLodLevel,
  shouldRenderRunLinkForLod,
} from "./stage-lod";

describe("stage LOD helpers", () => {
  it("resolves zoom into distant/mid/detail levels", () => {
    expect(resolveStageLodLevel(0.8)).toBe("distant");
    expect(resolveStageLodLevel(0.92)).toBe("distant");
    expect(resolveStageLodLevel(1.05)).toBe("mid");
    expect(resolveStageLodLevel(1.38)).toBe("mid");
    expect(resolveStageLodLevel(1.6)).toBe("detail");
  });

  it("filters run link rendering by lod and highlight state", () => {
    expect(
      shouldRenderRunLinkForLod({
        lodLevel: "distant",
        hasHighlight: false,
        runStatus: "active",
        runAgeMs: 20_000,
        runRecentWindowMs: 10_000,
      }),
    ).toBe(false);

    expect(
      shouldRenderRunLinkForLod({
        lodLevel: "distant",
        hasHighlight: true,
        runStatus: "ok",
        runAgeMs: 20_000,
        runRecentWindowMs: 10_000,
      }),
    ).toBe(true);

    expect(
      shouldRenderRunLinkForLod({
        lodLevel: "mid",
        hasHighlight: false,
        runStatus: "ok",
        runAgeMs: 25_000,
        runRecentWindowMs: 10_000,
      }),
    ).toBe(false);
  });

  it("projects bubble lanes by lod", () => {
    const layout: BubbleLaneLayout = {
      lanes: [
        {
          id: "lane:a",
          label: "lane a",
          y: 30,
          height: 80,
          hiddenCount: 0,
          totalCount: 1,
        },
        {
          id: "lane:b",
          label: "lane b",
          y: 120,
          height: 80,
          hiddenCount: 2,
          totalCount: 3,
        },
      ],
      cards: [
        {
          id: "card:a",
          entityId: "entity:a",
          laneId: "lane:a",
          laneLabel: "lane a",
          x: 100,
          y: 40,
          width: 200,
          text: "message",
          fullText: "message",
          ageMs: 1_000,
          isPinned: false,
          isExpanded: false,
          isSummary: false,
          hiddenCount: 0,
        },
        {
          id: "card:b",
          entityId: "entity:b",
          laneId: "lane:b",
          laneLabel: "lane b",
          x: 120,
          y: 140,
          width: 220,
          text: "summary",
          fullText: "summary",
          ageMs: 4_000,
          isPinned: false,
          isExpanded: false,
          isSummary: true,
          hiddenCount: 2,
        },
      ],
      contentHeight: 220,
    };

    const distant = projectBubbleLaneLayoutForLod(layout, "distant");
    expect(distant.cards).toHaveLength(0);
    expect(distant.lanes).toHaveLength(0);

    const mid = projectBubbleLaneLayoutForLod(layout, "mid");
    expect(mid.cards).toHaveLength(1);
    expect(mid.cards[0]?.id).toBe("card:b");
    expect(mid.lanes).toHaveLength(1);
    expect(mid.lanes[0]?.id).toBe("lane:b");

    const detail = projectBubbleLaneLayoutForLod(layout, "detail");
    expect(detail.cards).toHaveLength(2);
    expect(detail.lanes).toHaveLength(2);
  });
});
