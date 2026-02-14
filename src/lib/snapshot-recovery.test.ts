import { describe, expect, it } from "vitest";
import { buildRunGraph } from "./run-graph";
import {
  hasCorruptedSnapshotInput,
  resolveSnapshotRecovery,
  SNAPSHOT_RECOVERY_MESSAGES,
} from "./snapshot-recovery";
import type { OfficeSnapshot } from "../types/office";

function makeSnapshot(params?: {
  generatedAt?: number;
  diagnostics?: string[];
}): OfficeSnapshot {
  const generatedAt = params?.generatedAt ?? 1000;
  const diagnostics = params?.diagnostics ?? [];
  return {
    generatedAt,
    source: {
      stateDir: "/tmp/openclawoffice",
      live: true,
    },
    diagnostics: diagnostics.map((code, index) => ({
      level: "warning",
      code,
      source: `state-${index}`,
      message: `${code} detected`,
    })),
    entities: [],
    runs: [],
    runGraph: buildRunGraph([]),
    events: [],
  };
}

describe("snapshot recovery", () => {
  it("detects corrupted snapshot diagnostics by known prefixes", () => {
    expect(hasCorruptedSnapshotInput(makeSnapshot({ diagnostics: ["JSON_PARSE_FAILED"] }))).toBe(true);
    expect(hasCorruptedSnapshotInput(makeSnapshot({ diagnostics: ["RUN_ENTRY_INVALID"] }))).toBe(true);
    expect(hasCorruptedSnapshotInput(makeSnapshot({ diagnostics: ["SESSION_KEY_PARSE_FAILED"] }))).toBe(true);
    expect(hasCorruptedSnapshotInput(makeSnapshot({ diagnostics: ["RUN_GRAPH_ORPHAN_RUN"] }))).toBe(false);
  });

  it("keeps incoming snapshot when corruption is not detected", () => {
    const incoming = makeSnapshot({ generatedAt: 2000, diagnostics: ["RUN_GRAPH_ORPHAN_RUN"] });
    const lastHealthy = makeSnapshot({ generatedAt: 1500 });

    const resolved = resolveSnapshotRecovery({
      incoming,
      lastHealthy,
    });

    expect(resolved.snapshot).toBe(incoming);
    expect(resolved.recoveredFromLastHealthy).toBe(false);
    expect(resolved.recoveryMessage).toBeUndefined();
  });

  it("restores the last healthy snapshot on corrupted input", () => {
    const lastHealthy = makeSnapshot({ generatedAt: 1500 });
    const incoming = makeSnapshot({ generatedAt: 2200, diagnostics: ["RUN_STORE_INVALID_SHAPE"] });

    const resolved = resolveSnapshotRecovery({
      incoming,
      lastHealthy,
    });

    expect(resolved.snapshot).toBe(lastHealthy);
    expect(resolved.recoveredFromLastHealthy).toBe(true);
    expect(resolved.recoveryMessage).toBe(SNAPSHOT_RECOVERY_MESSAGES.corruptedSnapshotRecovered);
  });

  it("keeps corrupted input when no healthy baseline exists", () => {
    const incoming = makeSnapshot({ generatedAt: 2200, diagnostics: ["JSON_READ_FAILED"] });

    const resolved = resolveSnapshotRecovery({
      incoming,
      lastHealthy: null,
    });

    expect(resolved.snapshot).toBe(incoming);
    expect(resolved.recoveredFromLastHealthy).toBe(false);
    expect(resolved.recoveryMessage).toBe(SNAPSHOT_RECOVERY_MESSAGES.corruptedSnapshotNoBaseline);
  });
});
