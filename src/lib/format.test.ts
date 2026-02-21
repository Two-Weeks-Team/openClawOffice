import { describe, expect, it } from "vitest";
import {
  formatDatetime,
  formatDuration,
  formatLatency,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatSignedDuration,
  formatSignedNumber,
  formatSignedPercent,
} from "./format";

describe("formatPercent", () => {
  it("returns '-' for null", () => {
    expect(formatPercent(null)).toBe("-");
  });
  it("rounds to nearest integer percent", () => {
    expect(formatPercent(0.75)).toBe("75%");
    expect(formatPercent(0.005)).toBe("1%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatDuration", () => {
  it("returns '-' for null", () => {
    expect(formatDuration(null)).toBe("-");
  });
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
  });
  it("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(59_999)).toBe("60.0s");
  });
  it("formats minutes", () => {
    expect(formatDuration(60_000)).toBe("1.0m");
    expect(formatDuration(90_000)).toBe("1.5m");
  });
});

describe("formatSignedPercent", () => {
  it("returns '-' for null", () => {
    expect(formatSignedPercent(null)).toBe("-");
  });
  it("returns '0%' for zero", () => {
    expect(formatSignedPercent(0)).toBe("0%");
    expect(formatSignedPercent(0.004)).toBe("0%");
  });
  it("formats positive with '+'", () => {
    expect(formatSignedPercent(0.05)).toBe("+5%");
    expect(formatSignedPercent(1.0)).toBe("+100%");
  });
  it("formats negative without extra sign", () => {
    expect(formatSignedPercent(-0.05)).toBe("-5%");
  });
});

describe("formatSignedDuration", () => {
  it("returns '-' for null", () => {
    expect(formatSignedDuration(null)).toBe("-");
  });
  it("returns '0ms' for zero ms", () => {
    expect(formatSignedDuration(0)).toBe("0ms");
  });
  it("formats positive ms with '+'", () => {
    expect(formatSignedDuration(200)).toBe("+200ms");
  });
  it("formats negative ms", () => {
    expect(formatSignedDuration(-200)).toBe("-200ms");
  });
  it("formats seconds with sign", () => {
    expect(formatSignedDuration(2000)).toBe("+2.0s");
    expect(formatSignedDuration(-2000)).toBe("-2.0s");
  });
  it("formats minutes with sign", () => {
    expect(formatSignedDuration(120_000)).toBe("+2.0m");
    expect(formatSignedDuration(-120_000)).toBe("-2.0m");
  });
});

describe("formatSignedNumber", () => {
  it("returns '-' for null", () => {
    expect(formatSignedNumber(null)).toBe("-");
  });
  it("returns '0.00' for zero", () => {
    expect(formatSignedNumber(0)).toBe("0.00");
    expect(formatSignedNumber(0.001)).toBe("0.00");
  });
  it("formats positive with '+'", () => {
    expect(formatSignedNumber(1.5)).toBe("+1.50");
  });
  it("formats negative", () => {
    expect(formatSignedNumber(-1.5)).toBe("-1.50");
  });
});

describe("formatNumber", () => {
  it("returns '-' for null", () => {
    expect(formatNumber(null)).toBe("-");
  });
  it("formats to 2 decimal places", () => {
    expect(formatNumber(1.5)).toBe("1.50");
    expect(formatNumber(0)).toBe("0.00");
    expect(formatNumber(100)).toBe("100.00");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_700_000_000_000;

  it("formats seconds ago", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
    expect(formatRelativeTime(now - 500, now)).toBe("1s ago"); // min 1s
  });
  it("formats minutes ago", () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  });
  it("formats hours ago", () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
  it("clamps negative delta to 0", () => {
    expect(formatRelativeTime(now + 1000, now)).toBe("1s ago");
  });
});

describe("formatDatetime", () => {
  it("returns '-' for null", () => {
    expect(formatDatetime(null)).toBe("-");
  });
  it("returns '-' for undefined", () => {
    expect(formatDatetime(undefined)).toBe("-");
  });
  it("returns locale string for a timestamp", () => {
    const result = formatDatetime(0);
    // Just check it's a non-empty string; locale format varies
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("-");
  });
});

describe("formatLatency", () => {
  it("returns '-' for null", () => {
    expect(formatLatency(null)).toBe("-");
  });
  it("formats sub-second as '### ms'", () => {
    expect(formatLatency(500)).toBe("500 ms");
    expect(formatLatency(0)).toBe("0 ms");
  });
  it("formats >= 1s as 'X.XX s'", () => {
    expect(formatLatency(1000)).toBe("1.00 s");
    expect(formatLatency(2500)).toBe("2.50 s");
  });
});
