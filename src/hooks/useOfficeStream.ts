import { useEffect, useMemo, useRef, useState } from "react";
import type { OfficeSnapshot } from "../types/office";

type OfficeStreamState = {
  snapshot: OfficeSnapshot | null;
  connected: boolean;
  liveSource: boolean;
  error?: string;
};

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

export function useOfficeStream() {
  const [state, setState] = useState<OfficeStreamState>({
    snapshot: null,
    connected: false,
    liveSource: false,
  });

  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | null = null;
    let stopped = false;

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
      });
    };

    const startPolling = () => {
      if (pollTimer.current !== null || stopped) {
        return;
      }

      const load = async () => {
        try {
          const snapshot = await fetchSnapshot(controller.signal);
          applySnapshot(snapshot, false);
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

      void load();
      pollTimer.current = window.setInterval(() => {
        void load();
      }, 4_000);
    };

    const connectSse = () => {
      source = new EventSource("/api/office/stream");

      source.addEventListener("snapshot", (event) => {
        try {
          const snapshot = JSON.parse((event as MessageEvent<string>).data) as OfficeSnapshot;
          applySnapshot(snapshot, true);
        } catch {
          // noop
        }
      });

      source.onerror = () => {
        if (stopped) {
          return;
        }
        setState((prev) => ({ ...prev, connected: false }));
        source?.close();
        source = null;
        startPolling();
      };
    };

    connectSse();

    return () => {
      stopped = true;
      controller.abort();
      stopPolling();
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
