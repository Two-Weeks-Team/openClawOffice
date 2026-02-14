import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { OfficeEvent, OfficeSnapshot } from "../types/office";
import { mergeLifecycleEvent } from "../lib/lifecycle-merge";
import {
  hasCorruptedSnapshotInput,
  resolveSnapshotRecovery,
  SNAPSHOT_RECOVERY_MESSAGES,
} from "../lib/snapshot-recovery";

type OfficeStreamState = {
  snapshot: OfficeSnapshot | null;
  connected: boolean;
  liveSource: boolean;
  error?: string;
  recoveryMessage?: string;
};

type LifecyclePayload = {
  seq: number;
  event: OfficeEvent;
};

type BackfillGapPayload = {
  requestedCursor: number;
  oldestAvailableSeq: number;
  latestAvailableSeq: number;
  droppedCount: number;
};

const POLL_INTERVAL_MS = 4_000;
const RECONNECT_DELAY_MS = 1_200;
const MAX_SEEN_LIFECYCLE_IDS = 4_000;

async function fetchSnapshot(signal: AbortSignal): Promise<OfficeSnapshot> {
  const response = await fetch("/api/office/snapshot", {
    method: "GET",
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed (${response.status})`);
  }
  return (await response.json()) as OfficeSnapshot;
}

function parseSseErrorMessage(event: Event): string | undefined {
  if (!("data" in event) || typeof (event as MessageEvent<string>).data !== "string") {
    return undefined;
  }

  const rawData = (event as MessageEvent<string>).data;
  try {
    const payload = JSON.parse(rawData) as unknown;
    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string" &&
      payload.error.trim().length > 0
    ) {
      return payload.error;
    }
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      console.warn("Malformed SSE error payload", rawData, err);
    } else {
      console.error("Unexpected SSE error payload parse failure", err);
    }
    return undefined;
  }

  return undefined;
}

export function useOfficeStream() {
  const [state, setState] = useState<OfficeStreamState>({
    snapshot: null,
    connected: false,
    liveSource: false,
  });

  const pollTimer = useRef<number | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const lastLifecycleSeq = useRef(0);
  const seenLifecycleEventIds = useRef(new Set<string>());
  const seenLifecycleEventOrder = useRef<string[]>([]);
  const lastHealthySnapshot = useRef<OfficeSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | null = null;
    let stopped = false;

    const clearTimer = (timerRef: RefObject<number | null>) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const stopPolling = () => {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const rememberLifecycleEventId = (eventId: string) => {
      if (seenLifecycleEventIds.current.has(eventId)) {
        return;
      }
      seenLifecycleEventIds.current.add(eventId);
      seenLifecycleEventOrder.current.push(eventId);
      if (seenLifecycleEventOrder.current.length > MAX_SEEN_LIFECYCLE_IDS) {
        const removeCount = seenLifecycleEventOrder.current.length - MAX_SEEN_LIFECYCLE_IDS;
        const removed = seenLifecycleEventOrder.current.splice(0, removeCount);
        for (const removedEventId of removed) {
          seenLifecycleEventIds.current.delete(removedEventId);
        }
      }
    };

    const seedSeenLifecycleEvents = (events: OfficeEvent[]) => {
      for (const event of events) {
        rememberLifecycleEventId(event.id);
      }
    };

    const applySnapshot = (snapshot: OfficeSnapshot, connected: boolean) => {
      if (stopped) {
        return;
      }
      const recovered = resolveSnapshotRecovery({
        incoming: snapshot,
        lastHealthy: lastHealthySnapshot.current,
      });
      if (!recovered.recoveryMessage) {
        lastHealthySnapshot.current = recovered.snapshot;
      }
      seedSeenLifecycleEvents(recovered.snapshot.events);
      setState({
        snapshot: recovered.snapshot,
        connected,
        liveSource: recovered.snapshot.source.live,
        error: undefined,
        recoveryMessage: recovered.recoveryMessage,
      });
    };

    const loadSnapshot = async (connected: boolean) => {
      try {
        const snapshot = await fetchSnapshot(controller.signal);
        applySnapshot(snapshot, connected);
      } catch (err) {
        if (!stopped) {
          const message = err instanceof Error ? err.message : String(err);
          setState((prev) => ({
            ...prev,
            connected: false,
            error: prev.snapshot ? undefined : message,
            recoveryMessage: prev.snapshot ? SNAPSHOT_RECOVERY_MESSAGES.fetchFallback : undefined,
          }));
        }
      }
    };

    const startPolling = () => {
      if (stopped || pollTimer.current !== null) {
        return;
      }
      void loadSnapshot(false);
      pollTimer.current = window.setInterval(() => {
        void loadSnapshot(false);
      }, POLL_INTERVAL_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer.current !== null) {
        return;
      }
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        connectSse();
      }, RECONNECT_DELAY_MS);
    };

    const connectSse = () => {
      if (stopped) {
        return;
      }

      const cursorQuery =
        lastLifecycleSeq.current > 0 ? `?lastEventId=${encodeURIComponent(String(lastLifecycleSeq.current))}` : "";
      source = new EventSource(`/api/office/stream${cursorQuery}`);

      source.addEventListener("open", () => {
        if (stopped) {
          return;
        }
        stopPolling();
        setState((prev) => ({ ...prev, connected: true, error: undefined }));
      });

      source.addEventListener("snapshot", (event) => {
        try {
          const snapshot = JSON.parse((event as MessageEvent<string>).data) as OfficeSnapshot;
          applySnapshot(snapshot, true);
        } catch (err: unknown) {
          const rawData = (event as MessageEvent<string>).data;
          if (err instanceof Error) {
            console.warn("Malformed SSE snapshot frame", rawData, err);
          } else {
            console.warn("Malformed SSE snapshot frame", rawData);
          }
          setState((prev) => ({
            ...prev,
            error: prev.snapshot ? undefined : SNAPSHOT_RECOVERY_MESSAGES.malformedSnapshotFrame,
            recoveryMessage: prev.snapshot ? SNAPSHOT_RECOVERY_MESSAGES.malformedSnapshotFrame : undefined,
          }));
        }
      });

      source.addEventListener("lifecycle", (event) => {
        let payload: LifecyclePayload | undefined;
        try {
          payload = JSON.parse((event as MessageEvent<string>).data) as LifecyclePayload;
        } catch (err: unknown) {
          payload = undefined;
          const rawData = (event as MessageEvent<string>).data;
          if (err instanceof Error) {
            console.warn("Malformed SSE lifecycle frame", rawData, err);
          } else {
            console.warn("Malformed SSE lifecycle frame", rawData);
          }
        }

        if (!payload || !payload.event || typeof payload.seq !== "number") {
          return;
        }

        if (payload.seq > lastLifecycleSeq.current) {
          lastLifecycleSeq.current = payload.seq;
        }

        if (seenLifecycleEventIds.current.has(payload.event.id)) {
          return;
        }

        rememberLifecycleEventId(payload.event.id);

        setState((prev) => {
          if (!prev.snapshot) {
            return prev;
          }

          const merged = mergeLifecycleEvent(prev.snapshot, payload.event);
          if (!hasCorruptedSnapshotInput(merged)) {
            lastHealthySnapshot.current = merged;
          }
          return {
            ...prev,
            snapshot: merged,
            connected: true,
            liveSource: merged.source.live,
            error: undefined,
            recoveryMessage: undefined,
          };
        });
      });

      source.addEventListener("backfill-gap", (event) => {
        let payload: BackfillGapPayload | undefined;
        try {
          payload = JSON.parse((event as MessageEvent<string>).data) as BackfillGapPayload;
        } catch (err: unknown) {
          const rawData = (event as MessageEvent<string>).data;
          if (err instanceof Error) {
            console.warn("Malformed SSE backfill-gap frame", rawData, err);
          } else {
            console.warn("Malformed SSE backfill-gap frame", rawData);
          }
          payload = undefined;
        }

        if (payload?.latestAvailableSeq && payload.latestAvailableSeq > lastLifecycleSeq.current) {
          lastLifecycleSeq.current = payload.latestAvailableSeq;
        }
        void loadSnapshot(true);
      });

      source.onerror = (event) => {
        if (stopped) {
          return;
        }

        const message = parseSseErrorMessage(event);
        if (message) {
          setState((prev) => ({
            ...prev,
            connected: false,
            error: prev.snapshot ? undefined : message,
            recoveryMessage: prev.snapshot ? SNAPSHOT_RECOVERY_MESSAGES.streamFallback : undefined,
          }));
          return;
        }

        source?.close();
        source = null;

        setState((prev) => ({
          ...prev,
          connected: false,
          error: prev.snapshot ? undefined : prev.error,
          recoveryMessage: prev.snapshot ? SNAPSHOT_RECOVERY_MESSAGES.streamFallback : prev.recoveryMessage,
        }));
        startPolling();
        scheduleReconnect();
      };
    };

    startPolling();
    connectSse();

    return () => {
      stopped = true;
      controller.abort();
      stopPolling();
      clearTimer(reconnectTimer);
      source?.close();
    };
  }, []);

  return useMemo(
    () => ({
      snapshot: state.snapshot,
      connected: state.connected,
      liveSource: state.liveSource,
      error: state.error,
      recoveryMessage: state.recoveryMessage,
    }),
    [state.snapshot, state.connected, state.liveSource, state.error, state.recoveryMessage],
  );
}
