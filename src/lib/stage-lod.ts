import type { BubbleLaneCard, BubbleLaneLayout } from "./bubble-lanes";
import type { OfficeRunStatus } from "../types/office";

export type StageLodLevel = "distant" | "mid" | "detail";

export function resolveStageLodLevel(zoom: number): StageLodLevel {
  if (zoom <= 0.92) {
    return "distant";
  }
  if (zoom <= 1.38) {
    return "mid";
  }
  return "detail";
}

export function shouldRenderRunLinkForLod(input: {
  lodLevel: StageLodLevel;
  hasHighlight: boolean;
  runStatus: OfficeRunStatus;
  runAgeMs: number;
  runRecentWindowMs: number;
}): boolean {
  if (input.lodLevel === "detail") {
    return true;
  }
  if (input.lodLevel === "distant") {
    return input.hasHighlight;
  }
  if (input.runStatus === "ok" && !input.hasHighlight && input.runAgeMs > input.runRecentWindowMs) {
    return false;
  }
  return true;
}

export function projectBubbleLaneLayoutForLod(
  layout: Pick<BubbleLaneLayout, "lanes" | "cards">,
  lodLevel: StageLodLevel,
): {
  lanes: BubbleLaneLayout["lanes"];
  cards: BubbleLaneCard[];
} {
  if (lodLevel === "distant") {
    return {
      lanes: [],
      cards: [],
    };
  }
  if (lodLevel === "mid") {
    const cards = layout.cards.filter((card) => card.isSummary || card.isPinned);
    const laneIdSet = new Set(cards.map((card) => card.laneId));
    return {
      lanes: layout.lanes.filter((lane) => laneIdSet.has(lane.id)),
      cards,
    };
  }
  return {
    lanes: layout.lanes,
    cards: layout.cards,
  };
}
