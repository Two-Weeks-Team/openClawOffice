import { useState } from "react";

const DEFAULT_OVERSCAN = 3;

export type VirtualListResult = {
  /** Index of the first item to render. */
  startIndex: number;
  /** Index after the last item to render. */
  endIndex: number;
  /** Total scroll height of the list in pixels. */
  totalHeight: number;
  /** Top offset in pixels for positioning the rendered slice. */
  offsetY: number;
  /** Call with the scroll container's scrollTop value on each scroll event. */
  onScroll: (scrollTop: number) => void;
};

/**
 * Fixed-height virtual list hook.
 *
 * Computes which slice of a fixed-height list is visible given the current
 * scroll position, allowing the caller to render only those items.
 *
 * Usage:
 *   <div style={{ height: containerHeight, overflowY: "auto" }}
 *        onScroll={(e) => onScroll(e.currentTarget.scrollTop)}>
 *     <div style={{ height: totalHeight, position: "relative" }}>
 *       <div style={{ position: "absolute", top: offsetY, width: "100%" }}>
 *         {items.slice(startIndex, endIndex).map(...)}
 *       </div>
 *     </div>
 *   </div>
 */
export function useVirtualList({
  itemCount,
  itemHeight,
  containerHeight,
  overscan = DEFAULT_OVERSCAN,
}: {
  itemCount: number;
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}): VirtualListResult {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = itemCount * itemHeight;
  const firstVisible = Math.floor(scrollTop / itemHeight);
  const startIndex = Math.max(0, firstVisible - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const endIndex = Math.min(itemCount, firstVisible + visibleCount + overscan);
  const offsetY = startIndex * itemHeight;

  return {
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
    onScroll: setScrollTop,
  };
}
