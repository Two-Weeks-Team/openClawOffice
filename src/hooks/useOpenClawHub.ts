/**
 * Polling hook for the OpenClaw Hub API.
 * Fetches `/api/office/openclaw-hub` every 30 s and exposes snapshot/loading/error state.
 * Requests are aborted on unmount or rapid re-fetch to prevent stale updates.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenClawHubSnapshot } from "../../server/openclaw-hub-types";

const POLL_INTERVAL_MS = 30_000;

type UseOpenClawHubResult = {
  snapshot: OpenClawHubSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

function isOpenClawHubSnapshot(value: unknown): value is OpenClawHubSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.generatedAt === "number" && typeof obj.projectDir === "string";
}

export function useOpenClawHub(): UseOpenClawHubResult {
  const [snapshot, setSnapshot] = useState<OpenClawHubSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchHub = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      const response = await fetch("/api/office/openclaw-hub", {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Hub fetch failed (${response.status})`);
      }
      const parsed: unknown = await response.json();
      if (!isOpenClawHubSnapshot(parsed)) {
        throw new Error("Invalid hub snapshot format");
      }
      setSnapshot(parsed);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHub();
    timerRef.current = window.setInterval(() => {
      void fetchHub();
    }, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      abortRef.current?.abort();
    };
  }, [fetchHub]);

  const refresh = useCallback(() => {
    void fetchHub();
  }, [fetchHub]);

  return { snapshot, loading, error, refresh };
}
