/**
 * Common formatting utilities shared across components.
 * Centralizes display formatting for numbers, durations, percentages, and timestamps.
 */

/** Formats a ratio (0–1) as a percentage string, e.g. 0.75 → "75%". Returns "-" for null. */
export function formatPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
}

/** Formats a duration in milliseconds to a human-readable string. Returns "-" for null. */
export function formatDuration(value: number | null): string {
  if (value === null) {
    return "-";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${(value / 60_000).toFixed(1)}m`;
}

/** Formats a ratio change with a leading sign, e.g. 0.05 → "+5%". Returns "-" for null. */
export function formatSignedPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }
  const rounded = Math.round(value * 100);
  if (rounded === 0) {
    return "0%";
  }
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

/** Formats a signed duration change in milliseconds, e.g. -500 → "-500ms". Returns "-" for null. */
export function formatSignedDuration(value: number | null): string {
  if (value === null) {
    return "-";
  }
  const abs = Math.abs(value);
  if (abs < 1000) {
    const rounded = Math.round(value);
    if (rounded === 0) {
      return "0ms";
    }
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded}ms`;
  }
  if (abs < 60_000) {
    const seconds = Number((value / 1000).toFixed(1));
    if (seconds === 0) {
      return "0.0s";
    }
    const sign = seconds > 0 ? "+" : "";
    return `${sign}${seconds.toFixed(1)}s`;
  }
  const minutes = Number((value / 60_000).toFixed(1));
  if (minutes === 0) {
    return "0.0m";
  }
  const sign = minutes > 0 ? "+" : "";
  return `${sign}${minutes.toFixed(1)}m`;
}

/** Formats a signed number to 2 decimal places with leading sign, e.g. 1.5 → "+1.50". Returns "-" for null. */
export function formatSignedNumber(value: number | null): string {
  if (value === null) {
    return "-";
  }
  const rounded = Number(value.toFixed(2));
  if (rounded === 0) {
    return "0.00";
  }
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(2)}`;
}

/** Formats a number to 2 decimal places, e.g. 1.5 → "1.50". Returns "-" for null. */
export function formatNumber(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return value.toFixed(2);
}

/**
 * Formats a timestamp as relative time from now, e.g. "3s ago", "5m ago", "2h ago".
 * Unifies EventRail's `relativeTime` and EntityDetailPanel's `formatRelative`.
 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const ms = Math.max(0, now - timestamp);
  if (ms < 60_000) {
    return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ago`;
  }
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

/**
 * Formats a Unix timestamp (ms) as a locale date/time string.
 * Returns "-" for null or undefined.
 */
export function formatDatetime(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "-";
  }
  return new Date(value).toLocaleString();
}

/**
 * Formats a latency value in milliseconds.
 * Returns "X ms" for sub-second values or "X.XX s" for longer durations.
 * Returns "-" for null.
 */
export function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) {
    return "-";
  }
  if (latencyMs < 1000) {
    return `${latencyMs} ms`;
  }
  return `${(latencyMs / 1000).toFixed(2)} s`;
}
