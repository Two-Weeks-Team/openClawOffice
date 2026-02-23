import { describe, expect, it } from "vitest";
import {
  buildBubbleLaneLayout,
  hasNonStaleActiveEntity,
  isStaleActive,
  BUBBLE_ACTIVE_STALE_TIMEOUT_MS,
  type BubbleLaneCandidate,
} from "./bubble-lanes";

function baseCandidate(partial: Partial<BubbleLaneCandidate> & {
  id: string;
  entityId: string;
  anchorX: number;
}): BubbleLaneCandidate {
  return {
    id: partial.id,
    entityId: partial.entityId,
    laneId: partial.laneId ?? "lane:alpha",
    laneLabel: partial.laneLabel ?? "alpha",
    anchorX: partial.anchorX,
    text: partial.text ?? "Synthetic bubble payload",
    ageMs: partial.ageMs ?? 1_000,
    priority: partial.priority ?? 1,
    isPinned: partial.isPinned ?? false,
    isExpanded: partial.isExpanded ?? false,
  };
}

const NOW = 1_700_000_000_000;

describe("isStaleActive", () => {
  it("returns false for non-active statuses regardless of age", () => {
    expect(isStaleActive("idle", NOW - 200_000, NOW)).toBe(false);
    expect(isStaleActive("error", NOW - 200_000, NOW)).toBe(false);
    expect(isStaleActive("offline", NOW - 200_000, NOW)).toBe(false);
    expect(isStaleActive("ok", NOW - 200_000, NOW)).toBe(false);
  });

  it("returns false for active entity with fresh heartbeat (<= 120 s)", () => {
    expect(isStaleActive("active", NOW - 60_000, NOW)).toBe(false);
    expect(isStaleActive("active", NOW - BUBBLE_ACTIVE_STALE_TIMEOUT_MS, NOW)).toBe(false);
  });

  it("returns true for active entity with stale heartbeat (> 120 s)", () => {
    expect(isStaleActive("active", NOW - (BUBBLE_ACTIVE_STALE_TIMEOUT_MS + 1), NOW)).toBe(true);
    expect(isStaleActive("active", NOW - 200_000, NOW)).toBe(true);
  });

  it("returns true for active entity with unknown lastUpdatedAt", () => {
    expect(isStaleActive("active", undefined, NOW)).toBe(true);
  });
});

describe("hasNonStaleActiveEntity — overlay visibility regression tests", () => {
  it("active + fresh update (<= 120 s) → true (overlay visible)", () => {
    expect(
      hasNonStaleActiveEntity([{ status: "active", lastUpdatedAt: NOW - 60_000 }], NOW),
    ).toBe(true);
  });

  it("active + stale (> 120 s) → false (overlay hidden)", () => {
    expect(
      hasNonStaleActiveEntity([{ status: "active", lastUpdatedAt: NOW - 200_000 }], NOW),
    ).toBe(false);
  });

  it("2 active (1 stale + 1 fresh) → true (overlay visible)", () => {
    expect(
      hasNonStaleActiveEntity(
        [
          { status: "active", lastUpdatedAt: NOW - 200_000 }, // stale
          { status: "active", lastUpdatedAt: NOW - 60_000 }, // fresh
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it("no active entities → false (overlay hidden)", () => {
    expect(
      hasNonStaleActiveEntity(
        [
          { status: "idle", lastUpdatedAt: NOW - 10_000 },
          { status: "error", lastUpdatedAt: NOW - 5_000 },
        ],
        NOW,
      ),
    ).toBe(false);
  });
});

describe("buildBubbleLaneLayout", () => {
  it("avoids overlap by spreading cards across rows", () => {
    const candidates: BubbleLaneCandidate[] = [
      baseCandidate({ id: "b1", entityId: "e1", anchorX: 120, text: "A".repeat(80) }),
      baseCandidate({ id: "b2", entityId: "e2", anchorX: 160, text: "B".repeat(80) }),
      baseCandidate({ id: "b3", entityId: "e3", anchorX: 200, text: "C".repeat(80) }),
    ];

    const layout = buildBubbleLaneLayout(candidates, {
      stageWidth: 360,
      maxRowsPerLane: 3,
      maxVisiblePerLane: 6,
    });

    const cards = layout.cards.filter((card) => !card.isSummary);
    expect(cards).toHaveLength(3);

    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        const left = cards[i];
        const right = cards[j];
        if (left.y !== right.y) {
          continue;
        }
        expect(left.x + left.width).toBeLessThanOrEqual(right.x);
      }
    }
  });

  it("creates lane summary card when old bubbles exceed visible limit", () => {
    const candidates: BubbleLaneCandidate[] = [
      baseCandidate({ id: "n1", entityId: "n1", anchorX: 110, ageMs: 1_000 }),
      baseCandidate({ id: "n2", entityId: "n2", anchorX: 130, ageMs: 2_000 }),
      baseCandidate({ id: "n3", entityId: "n3", anchorX: 150, ageMs: 3_000 }),
      baseCandidate({ id: "n4", entityId: "n4", anchorX: 170, ageMs: 4_000 }),
      baseCandidate({ id: "n5", entityId: "n5", anchorX: 190, ageMs: 5_000 }),
    ];

    const layout = buildBubbleLaneLayout(candidates, {
      stageWidth: 500,
      maxVisiblePerLane: 2,
    });

    const summary = layout.cards.find((card) => card.isSummary);
    expect(summary).toBeDefined();
    expect(summary?.hiddenCount).toBe(3);
    expect(summary?.text).toContain("older updates");
  });

  it("keeps pinned and expanded cards uncollapsed", () => {
    const candidates: BubbleLaneCandidate[] = [
      baseCandidate({
        id: "pinned",
        entityId: "pinned",
        anchorX: 120,
        text: "Pinned card should keep full text without collapse".repeat(2),
        ageMs: 80_000,
        isPinned: true,
      }),
      baseCandidate({
        id: "expanded",
        entityId: "expanded",
        anchorX: 250,
        text: "Expanded card should also keep the full message body".repeat(2),
        ageMs: 90_000,
        isExpanded: true,
      }),
      baseCandidate({
        id: "collapsed",
        entityId: "collapsed",
        anchorX: 380,
        text: "This card is old and should be collapsed to preserve readability".repeat(2),
        ageMs: 90_000,
      }),
    ];

    const layout = buildBubbleLaneLayout(candidates, {
      stageWidth: 680,
      collapseAfterMs: 20_000,
      collapseChars: 40,
      maxVisiblePerLane: 6,
    });

    const pinned = layout.cards.find((card) => card.id === "pinned");
    const expanded = layout.cards.find((card) => card.id === "expanded");
    const collapsed = layout.cards.find((card) => card.id === "collapsed");

    expect(pinned?.text).toBe(pinned?.fullText);
    expect(expanded?.text).toBe(expanded?.fullText);
    expect(collapsed?.text).not.toBe(collapsed?.fullText);
    expect(collapsed?.text.endsWith("…")).toBe(true);
  });
});
