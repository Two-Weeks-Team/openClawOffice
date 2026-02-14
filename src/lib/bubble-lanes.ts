export type BubbleLaneCandidate = {
  id: string;
  entityId: string;
  laneId: string;
  laneLabel: string;
  anchorX: number;
  text: string;
  ageMs: number;
  priority: number;
  isPinned: boolean;
  isExpanded: boolean;
};

export type BubbleLaneLayoutOptions = {
  stageWidth: number;
  topPadding?: number;
  sidePadding?: number;
  laneGap?: number;
  laneHeaderHeight?: number;
  laneRowHeight?: number;
  cardGap?: number;
  maxRowsPerLane?: number;
  maxVisiblePerLane?: number;
  maxLanes?: number;
  collapseAfterMs?: number;
  collapseChars?: number;
};

export type BubbleLane = {
  id: string;
  label: string;
  y: number;
  height: number;
  hiddenCount: number;
  totalCount: number;
};

export type BubbleLaneCard = {
  id: string;
  entityId: string;
  laneId: string;
  laneLabel: string;
  x: number;
  y: number;
  width: number;
  text: string;
  fullText: string;
  ageMs: number;
  isPinned: boolean;
  isExpanded: boolean;
  isSummary: boolean;
  hiddenCount: number;
};

export type BubbleLaneLayout = {
  lanes: BubbleLane[];
  cards: BubbleLaneCard[];
  contentHeight: number;
};

type ResolvedCard = BubbleLaneCandidate & {
  isSummary: boolean;
  hiddenCount: number;
};

type LaneBucket = {
  id: string;
  label: string;
  priority: number;
  latestAgeMs: number;
  entries: BubbleLaneCandidate[];
};

const DEFAULT_OPTIONS: Required<Omit<BubbleLaneLayoutOptions, "stageWidth">> = {
  topPadding: 16,
  sidePadding: 14,
  laneGap: 10,
  laneHeaderHeight: 18,
  laneRowHeight: 50,
  cardGap: 8,
  maxRowsPerLane: 3,
  maxVisiblePerLane: 3,
  maxLanes: 8,
  collapseAfterMs: 20_000,
  collapseChars: 72,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeLabel(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "thread";
  }
  return compact;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function estimateCardWidth(text: string, isExpanded: boolean): number {
  const baseWidth = 120;
  const widthPerChar = isExpanded ? 4.2 : 3.2;
  const calculated = baseWidth + text.length * widthPerChar;
  const maxWidth = isExpanded ? 300 : 240;
  return clamp(Math.round(calculated), 128, maxWidth);
}

function mergeOptions(options: BubbleLaneLayoutOptions): Required<BubbleLaneLayoutOptions> {
  return {
    stageWidth: Math.max(320, Math.floor(options.stageWidth)),
    topPadding: options.topPadding ?? DEFAULT_OPTIONS.topPadding,
    sidePadding: options.sidePadding ?? DEFAULT_OPTIONS.sidePadding,
    laneGap: options.laneGap ?? DEFAULT_OPTIONS.laneGap,
    laneHeaderHeight: options.laneHeaderHeight ?? DEFAULT_OPTIONS.laneHeaderHeight,
    laneRowHeight: options.laneRowHeight ?? DEFAULT_OPTIONS.laneRowHeight,
    cardGap: options.cardGap ?? DEFAULT_OPTIONS.cardGap,
    maxRowsPerLane: options.maxRowsPerLane ?? DEFAULT_OPTIONS.maxRowsPerLane,
    maxVisiblePerLane: options.maxVisiblePerLane ?? DEFAULT_OPTIONS.maxVisiblePerLane,
    maxLanes: options.maxLanes ?? DEFAULT_OPTIONS.maxLanes,
    collapseAfterMs: options.collapseAfterMs ?? DEFAULT_OPTIONS.collapseAfterMs,
    collapseChars: options.collapseChars ?? DEFAULT_OPTIONS.collapseChars,
  };
}

function compactLaneEntries(entries: BubbleLaneCandidate[], maxVisiblePerLane: number): {
  cards: ResolvedCard[];
  hiddenCount: number;
} {
  const forced = entries
    .filter((entry) => entry.isPinned || entry.isExpanded)
    .sort((left, right) => {
      if (left.isPinned !== right.isPinned) {
        return left.isPinned ? -1 : 1;
      }
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      if (left.ageMs !== right.ageMs) {
        return left.ageMs - right.ageMs;
      }
      return left.id.localeCompare(right.id);
    });

  const normal = entries
    .filter((entry) => !entry.isPinned && !entry.isExpanded)
    .sort((left, right) => {
      if (left.ageMs !== right.ageMs) {
        return left.ageMs - right.ageMs;
      }
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      return left.id.localeCompare(right.id);
    });

  const visibleNormal = normal.slice(0, maxVisiblePerLane);
  const hidden = normal.slice(maxVisiblePerLane);
  const cards: ResolvedCard[] = [
    ...forced,
    ...visibleNormal,
  ].map((entry) => ({
    ...entry,
    isSummary: false,
    hiddenCount: 0,
  }));

  if (hidden.length > 0) {
    const averageAnchorX = Math.round(
      hidden.reduce((sum, entry) => sum + entry.anchorX, 0) / hidden.length,
    );
    cards.push({
      id: `${entries[0]?.laneId ?? "lane"}:summary`,
      entityId: "",
      laneId: entries[0]?.laneId ?? "lane",
      laneLabel: entries[0]?.laneLabel ?? "thread",
      anchorX: averageAnchorX,
      text: `+${hidden.length} older updates condensed`,
      ageMs: hidden[0]?.ageMs ?? 0,
      priority: -1,
      isPinned: false,
      isExpanded: false,
      isSummary: true,
      hiddenCount: hidden.length,
    });
  }

  return {
    cards,
    hiddenCount: hidden.length,
  };
}

export function buildBubbleLaneLayout(
  candidates: BubbleLaneCandidate[],
  options: BubbleLaneLayoutOptions,
): BubbleLaneLayout {
  const resolved = mergeOptions(options);
  const normalizedCandidates = candidates
    .map((candidate) => {
      const text = normalizeText(candidate.text);
      const laneId = candidate.laneId.trim();
      if (!laneId || !text) {
        return null;
      }
      return {
        ...candidate,
        laneId,
        laneLabel: normalizeLabel(candidate.laneLabel),
        text,
        anchorX: clamp(candidate.anchorX, resolved.sidePadding, resolved.stageWidth - resolved.sidePadding),
        ageMs: Math.max(0, candidate.ageMs),
      } satisfies BubbleLaneCandidate;
    })
    .filter((value): value is BubbleLaneCandidate => Boolean(value));

  if (normalizedCandidates.length === 0) {
    return {
      lanes: [],
      cards: [],
      contentHeight: resolved.topPadding,
    };
  }

  const laneMap = new Map<string, LaneBucket>();
  for (const candidate of normalizedCandidates) {
    const lane = laneMap.get(candidate.laneId);
    if (lane) {
      lane.entries.push(candidate);
      lane.priority = Math.max(lane.priority, candidate.priority + (candidate.isPinned ? 2 : 0));
      lane.latestAgeMs = Math.min(lane.latestAgeMs, candidate.ageMs);
      continue;
    }
    laneMap.set(candidate.laneId, {
      id: candidate.laneId,
      label: candidate.laneLabel,
      priority: candidate.priority + (candidate.isPinned ? 2 : 0),
      latestAgeMs: candidate.ageMs,
      entries: [candidate],
    });
  }

  const sortedLanes = [...laneMap.values()]
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      if (left.latestAgeMs !== right.latestAgeMs) {
        return left.latestAgeMs - right.latestAgeMs;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, resolved.maxLanes);

  const lanes: BubbleLane[] = [];
  const cards: BubbleLaneCard[] = [];
  let cursorY = resolved.topPadding;

  for (const lane of sortedLanes) {
    const compacted = compactLaneEntries(lane.entries, resolved.maxVisiblePerLane);
    const placedCards = compacted.cards.sort((left, right) => {
      if (left.anchorX !== right.anchorX) {
        return left.anchorX - right.anchorX;
      }
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      return left.id.localeCompare(right.id);
    });

    const rightMostByRow: number[] = [];
    let maxRowIndex = 0;

    for (const card of placedCards) {
      const shouldCollapseText =
        !card.isSummary &&
        !card.isPinned &&
        !card.isExpanded &&
        card.ageMs >= resolved.collapseAfterMs;
      const visibleText = shouldCollapseText
        ? truncateText(card.text, resolved.collapseChars)
        : card.text;
      const width = card.isSummary ? 182 : estimateCardWidth(visibleText, card.isExpanded);
      const leftLimit = resolved.sidePadding;
      const rightLimit = resolved.stageWidth - resolved.sidePadding - width;
      const desiredLeft = clamp(card.anchorX - width / 2, leftLimit, rightLimit);

      let selectedRow = 0;
      let selectedLeft = desiredLeft;
      for (let rowIndex = 0; rowIndex < resolved.maxRowsPerLane; rowIndex += 1) {
        const previousRight = rightMostByRow[rowIndex];
        const startLeft =
          typeof previousRight === "number"
            ? Math.max(desiredLeft, previousRight + resolved.cardGap)
            : desiredLeft;

        if (startLeft + width <= resolved.stageWidth - resolved.sidePadding) {
          selectedRow = rowIndex;
          selectedLeft = startLeft;
          break;
        }

        if (rowIndex === resolved.maxRowsPerLane - 1) {
          selectedRow = rowIndex;
          selectedLeft = clamp(startLeft, leftLimit, rightLimit);
        }
      }

      const previousRight = rightMostByRow[selectedRow];
      if (typeof previousRight === "number") {
        const minLeft = previousRight + resolved.cardGap;
        if (selectedLeft < minLeft) {
          selectedLeft = minLeft;
        }
        if (selectedLeft + width > resolved.stageWidth - resolved.sidePadding) {
          selectedLeft = Math.max(leftLimit, resolved.stageWidth - resolved.sidePadding - width);
        }
      }

      rightMostByRow[selectedRow] = selectedLeft + width;
      maxRowIndex = Math.max(maxRowIndex, selectedRow);

      cards.push({
        id: card.id,
        entityId: card.entityId,
        laneId: card.laneId,
        laneLabel: card.laneLabel,
        x: Math.round(selectedLeft),
        y: Math.round(cursorY + resolved.laneHeaderHeight + selectedRow * resolved.laneRowHeight),
        width,
        text: visibleText,
        fullText: card.text,
        ageMs: card.ageMs,
        isPinned: card.isPinned,
        isExpanded: card.isExpanded,
        isSummary: card.isSummary,
        hiddenCount: card.hiddenCount,
      });
    }

    const laneHeight = resolved.laneHeaderHeight + (maxRowIndex + 1) * resolved.laneRowHeight;
    lanes.push({
      id: lane.id,
      label: lane.label,
      y: Math.round(cursorY + Math.max(6, resolved.laneHeaderHeight * 0.6)),
      height: Math.round(laneHeight),
      hiddenCount: compacted.hiddenCount,
      totalCount: lane.entries.length,
    });

    cursorY += laneHeight + resolved.laneGap;
  }

  return {
    lanes,
    cards,
    contentHeight: Math.round(cursorY),
  };
}
