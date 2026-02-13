import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { OfficeEvent, OfficeSnapshot } from "../types/office";

type OfficeStreamState = {
  snapshot: OfficeSnapshot | null;
  connected: boolean;
  liveSource: boolean;
  error?: string;
};

type LifecyclePayload = {
  seq: number;
  event: OfficeEvent;
};

const POLL_INTERVAL_MS = 4_000;
const RECONNECT_DELAY_MS = 1_200;
const RESYNC_DELAY_MS = 140;
const MAX_EVENTS = 220;

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

function mergeLifecycleEvent(snapshot: OfficeSnapshot, event: OfficeEvent): OfficeSnapshot {
  const events = [event, ...snapshot.events.filter((item) => item.id !== event.id)]
    .sort((a, b) => {
      if (a.at !== b.at) {
        return b.at - a.at;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, MAX_EVENTS);

  return {
    ...snapshot,
    generatedAt: Math.max(snapshot.generatedAt, event.at),
    events,
  };
}

export function useOfficeStream() {
  const [state, setState] = useState<OfficeStreamState>({
    snapshot: null,
    connected: false,
    liveSource: false,
  });

  const pollTimer = useRef<number | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const resyncTimer = useRef<number | null>(null);
  const lastLifecycleSeq = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | null = null;
    let stopped = false;

    const clearTimer = (timerRef: MutableRefObject<number | null>) => {
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

    const applySnapshot = (snapshot: OfficeSnapshot, connected: boolean) => {
      if (stopped) {
        return;
      }
      setState({
        snapshot,
        connected,
        liveSource: snapshot.source.live,
        error: undefined,
      });
    };

    const loadSnapshot = async (connected: boolean) => {
      try {
        const snapshot = await fetchSnapshot(controller.signal);
        applySnapshot(snapshot, connected);
      } catch (err) {
        if (!stopped) {
          setState((prev) => ({
            ...prev,
            connected: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      }
    };

    const scheduleResync = () => {
      if (stopped || resyncTimer.current !== null) {
        return;
      }

      resyncTimer.current = window.setTimeout(() => {
        resyncTimer.current = null;
        void loadSnapshot(true);
      }, RESYNC_DELAY_MS);
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
        } catch {
          // ignore malformed snapshot frame
        }
      });

      source.addEventListener("lifecycle", (event) => {
        let payload: LifecyclePayload | undefined;
        try {
          payload = JSON.parse((event as MessageEvent<string>).data) as LifecyclePayload;
        } catch {
          payload = undefined;
        }

        if (!payload || !payload.event || typeof payload.seq !== "number") {
          return;
        }

        if (payload.seq > lastLifecycleSeq.current) {
          lastLifecycleSeq.current = payload.seq;
        }

        setState((prev) => {
          if (!prev.snapshot) {
            return prev;
          }

          const merged = mergeLifecycleEvent(prev.snapshot, payload.event);
          return {
            ...prev,
            snapshot: merged,
            connected: true,
            liveSource: merged.source.live,
            error: undefined,
          };
        });

        scheduleResync();
      });

      source.onerror = () => {
        if (stopped) {
          return;
        }

        source?.close();
        source = null;

        setState((prev) => ({ ...prev, connected: false }));
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
      clearTimer(resyncTimer);
      source?.close();
    };
  }, []);

  return useMemo(
    () => ({
      snapshot: state.snapshot,
      connected: state.connected,
      liveSource: state.liveSource,
      error: state.error,
    }),
    [state],
  );
}
