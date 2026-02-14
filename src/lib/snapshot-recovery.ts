import type { OfficeSnapshot } from "../types/office";

const CORRUPTION_DIAGNOSTIC_PREFIXES = ["JSON_", "RUN_", "SESSION_"] as const;

export const SNAPSHOT_RECOVERY_MESSAGES = {
  corruptedSnapshotRecovered:
    "Corrupted state input detected. Recovered to the last healthy snapshot.",
  corruptedSnapshotNoBaseline:
    "Corrupted state input detected. Waiting for a healthy snapshot baseline.",
  fetchFallback:
    "Snapshot refresh failed. Continuing with the last healthy snapshot while retrying.",
  streamFallback:
    "Live stream disconnected. Continuing with the last healthy snapshot while reconnecting.",
  malformedSnapshotFrame:
    "Malformed snapshot frame ignored. Continuing with the last healthy snapshot.",
} as const;

export function hasCorruptedSnapshotInput(snapshot: OfficeSnapshot): boolean {
  return snapshot.diagnostics.some((diagnostic) => {
    if (diagnostic.code.startsWith("RUN_GRAPH_")) {
      return false;
    }
    return CORRUPTION_DIAGNOSTIC_PREFIXES.some((prefix) => diagnostic.code.startsWith(prefix));
  });
}

export function resolveSnapshotRecovery(params: {
  incoming: OfficeSnapshot;
  lastHealthy: OfficeSnapshot | null;
}): {
  snapshot: OfficeSnapshot;
  recoveredFromLastHealthy: boolean;
  recoveryMessage?: string;
} {
  if (!hasCorruptedSnapshotInput(params.incoming)) {
    return {
      snapshot: params.incoming,
      recoveredFromLastHealthy: false,
    };
  }
  if (!params.lastHealthy) {
    return {
      snapshot: params.incoming,
      recoveredFromLastHealthy: false,
      recoveryMessage: SNAPSHOT_RECOVERY_MESSAGES.corruptedSnapshotNoBaseline,
    };
  }
  return {
    snapshot: params.lastHealthy,
    recoveredFromLastHealthy: true,
    recoveryMessage: SNAPSHOT_RECOVERY_MESSAGES.corruptedSnapshotRecovered,
  };
}
