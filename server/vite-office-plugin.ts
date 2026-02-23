import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import {
  API_ERROR_CODES,
  classifyServerError,
  logStructuredEvent,
  resolveCorrelationId,
  toApiErrorBody,
  type ApiErrorCode,
} from "./api-observability";
import { buildOfficeSnapshot } from "./office-state";
import type { OfficeSnapshot } from "./office-types";
import { buildOpenClawHubSnapshot, loadFullDocument, resolveOpenClawProjectDir } from "./openclaw-status";
import { OfficeSnapshotStore } from "./snapshot-store";
import {
  OfficeStreamBridge,
  parseLifecycleCursor,
  type LifecycleEnvelope,
} from "./stream-bridge";

const STREAM_POLL_INTERVAL_MS = 400;
const STREAM_PING_INTERVAL_MS = 15_000;

type ApiRoute = "snapshot" | "stream" | "metrics" | "replayIndex" | "replaySnapshot" | "openclawHub" | "openclawHubDoc";

type ApiRequestContext = {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
};

type RouteMetric = {
  requests: number;
  success: number;
  failure: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

type StreamMetric = {
  activeConnections: number;
  totalConnections: number;
  lifecycleFramesSent: number;
  snapshotFramesSent: number;
  streamErrors: number;
  backpressureActivations: number;
  droppedUnseenEvents: number;
  evictedBackfillEvents: number;
};

type ReplayStoreMetric = {
  persistedSnapshots: number;
  skippedByInterval: number;
  evictedSnapshots: number;
  lastStoredAt: number;
  totalEntries: number;
  totalBytes: number;
};

type StreamSubscriber = {
  sendSnapshot: (snapshot: OfficeSnapshot) => void;
  sendLifecycle: (frame: LifecycleEnvelope) => void;
  sendBackfillGap: (payload: {
    requestedCursor: number;
    oldestAvailableSeq: number;
    latestAvailableSeq: number;
    droppedCount: number;
  }) => void;
  sendError: (code: ApiErrorCode, message: string) => void;
  close: () => void;
};

const streamBridge = new OfficeStreamBridge();
const streamSubscribers = new Set<StreamSubscriber>();
let streamPoller: NodeJS.Timeout | null = null;
let pollInFlight = false;
let initialSnapshotPromise: Promise<OfficeSnapshot> | null = null;
let snapshotStore: OfficeSnapshotStore | null = null;

const routeMetrics: Record<ApiRoute, RouteMetric> = {
  snapshot: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  stream: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  metrics: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  replayIndex: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  replaySnapshot: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  openclawHub: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  openclawHubDoc: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
};

const streamMetrics: StreamMetric = {
  activeConnections: 0,
  totalConnections: 0,
  lifecycleFramesSent: 0,
  snapshotFramesSent: 0,
  streamErrors: 0,
  backpressureActivations: 0,
  droppedUnseenEvents: 0,
  evictedBackfillEvents: 0,
};

const replayStoreMetrics: ReplayStoreMetric = {
  persistedSnapshots: 0,
  skippedByInterval: 0,
  evictedSnapshots: 0,
  lastStoredAt: 0,
  totalEntries: 0,
  totalBytes: 0,
};

/**
 * Backpressure warning throttle — warn at most once per this interval.
 * Repeated pressure events within the window are aggregated and emitted
 * as a single summary when the window expires.
 */
const BACKPRESSURE_WARN_INTERVAL_MS = 30_000;
let lastBackpressureWarnAt = 0;
let pendingBackpressure = { activations: 0, droppedUnseenEvents: 0, evictedBackfillEvents: 0 };

function resolveSnapshotStore(stateDir: string): OfficeSnapshotStore {
  if (!snapshotStore) {
    const replayDir = process.env.OPENCLAW_REPLAY_DIR?.trim();
    snapshotStore = replayDir
      ? OfficeSnapshotStore.forReplayDir(replayDir)
      : OfficeSnapshotStore.forStateDir(stateDir);
  }
  return snapshotStore;
}

function syncReplayStoreMetrics() {
  if (!snapshotStore) {
    return;
  }
  const metrics = snapshotStore.getMetrics();
  replayStoreMetrics.persistedSnapshots = metrics.persistedSnapshots;
  replayStoreMetrics.skippedByInterval = metrics.skippedByInterval;
  replayStoreMetrics.evictedSnapshots = metrics.evictedSnapshots;
  replayStoreMetrics.lastStoredAt = metrics.lastStoredAt;
  replayStoreMetrics.totalEntries = metrics.totalEntries;
  replayStoreMetrics.totalBytes = metrics.totalBytes;
}

async function persistSnapshotForReplay(snapshot: OfficeSnapshot) {
  const store = resolveSnapshotStore(snapshot.source.stateDir);
  try {
    await store.persistSnapshot(snapshot);
    syncReplayStoreMetrics();
  } catch (error) {
    logStructuredEvent({
      level: "warn",
      event: "replay.persist.error",
      details: asErrorDetails(error),
      extra: {
        generatedAt: snapshot.generatedAt,
      },
    });
  }
  return store;
}

function setJsonHeaders(res: ServerResponse, requestId?: string) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (requestId) {
    res.setHeader("X-Correlation-Id", requestId);
  }
}

function isClosed(req: IncomingMessage) {
  return req.destroyed;
}

function buildRequestContext(req: IncomingMessage, path: string): ApiRequestContext {
  return {
    requestId: resolveCorrelationId(req.headers),
    method: req.method?.toUpperCase() ?? "UNKNOWN",
    path,
    startedAt: Date.now(),
  };
}

export function asErrorDetails(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return undefined;
}

function durationFrom(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function recordRouteMetric(route: ApiRoute, success: boolean, durationMs: number) {
  const metric = routeMetrics[route];
  metric.requests += 1;
  metric.totalDurationMs += durationMs;
  metric.maxDurationMs = Math.max(metric.maxDurationMs, durationMs);
  if (success) {
    metric.success += 1;
  } else {
    metric.failure += 1;
  }
}

function logRouteResult(params: {
  context: ApiRequestContext;
  event: string;
  level: "info" | "warn" | "error";
  statusCode: number;
  durationMs: number;
  details?: string;
  extra?: Record<string, unknown>;
}) {
  logStructuredEvent({
    level: params.level,
    event: params.event,
    requestId: params.context.requestId,
    method: params.context.method,
    path: params.context.path,
    statusCode: params.statusCode,
    durationMs: params.durationMs,
    details: params.details,
    extra: params.extra,
  });
}

function collectCursor(req: IncomingMessage): number {
  const headerValue = req.headers["last-event-id"];
  const fromHeader = parseLifecycleCursor(
    Array.isArray(headerValue) ? headerValue[headerValue.length - 1] : headerValue,
  );

  const url = req.url ?? "";
  if (!url.includes("?")) {
    return fromHeader;
  }

  try {
    const parsed = new URL(url, "http://127.0.0.1");
    const fromQuery = parseLifecycleCursor(parsed.searchParams.get("lastEventId"));
    return Math.max(fromHeader, fromQuery);
  } catch {
    return fromHeader;
  }
}

export function parseQueryNumber(value: string | null): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.floor(parsed);
}

async function ensureReplayStore(): Promise<OfficeSnapshotStore> {
  const snapshot = await ensureInitialSnapshot();
  return resolveSnapshotStore(snapshot.source.stateDir);
}

async function handleSnapshot(res: ServerResponse, context: ApiRequestContext) {
  try {
    const snapshot = await buildOfficeSnapshot();
    await persistSnapshotForReplay(snapshot);
    setJsonHeaders(res, context.requestId);
    res.statusCode = 200;
    res.end(JSON.stringify(snapshot));
    const durationMs = durationFrom(context.startedAt);
    recordRouteMetric("snapshot", true, durationMs);
    logRouteResult({
      context,
      event: "snapshot.ok",
      level: "info",
      statusCode: 200,
      durationMs,
      extra: {
        entities: snapshot.entities.length,
        runs: snapshot.runs.length,
        diagnostics: snapshot.diagnostics.length,
      },
    });
  } catch (err) {
    const code = classifyServerError(err, API_ERROR_CODES.snapshotBuildFailed);
    const statusCode =
      code === API_ERROR_CODES.snapshotStateNotFound
        ? 404
        : code === API_ERROR_CODES.snapshotStateAccessDenied
          ? 403
          : 500;
    const details = asErrorDetails(err);
    const durationMs = durationFrom(context.startedAt);
    setJsonHeaders(res, context.requestId);
    res.statusCode = statusCode;
    res.end(
      JSON.stringify(
        toApiErrorBody({
          code,
          message: "Failed to build office snapshot",
          requestId: context.requestId,
          details,
        }),
      ),
    );
    recordRouteMetric("snapshot", false, durationMs);
    logRouteResult({
      context,
      event: "snapshot.error",
      level: "error",
      statusCode,
      durationMs,
      details,
      extra: { code },
    });
  }
}

async function handleReplayIndex(req: IncomingMessage, res: ServerResponse, context: ApiRequestContext) {
  try {
    const store = await ensureReplayStore();
    const parsedUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const queryResult = await store.queryIndex({
      runId: parsedUrl.searchParams.get("runId") ?? undefined,
      agentId: parsedUrl.searchParams.get("agentId") ?? undefined,
      from: parseQueryNumber(parsedUrl.searchParams.get("from")),
      to: parseQueryNumber(parsedUrl.searchParams.get("to")),
      limit: parseQueryNumber(parsedUrl.searchParams.get("limit")),
    });
    syncReplayStoreMetrics();

    setJsonHeaders(res, context.requestId);
    res.statusCode = 200;
    res.end(JSON.stringify(queryResult));
    const durationMs = durationFrom(context.startedAt);
    recordRouteMetric("replayIndex", true, durationMs);
    logRouteResult({
      context,
      event: "replay.index.ok",
      level: "info",
      statusCode: 200,
      durationMs,
      extra: {
        returnedEntries: queryResult.entries.length,
        totalEntries: queryResult.totalEntries,
      },
    });
  } catch (error) {
    const details = asErrorDetails(error);
    const durationMs = durationFrom(context.startedAt);
    setJsonHeaders(res, context.requestId);
    res.statusCode = 500;
    res.end(
      JSON.stringify(
        toApiErrorBody({
          code: API_ERROR_CODES.replayIndexReadFailed,
          message: "Failed to read replay snapshot index",
          requestId: context.requestId,
          details,
        }),
      ),
    );
    recordRouteMetric("replayIndex", false, durationMs);
    logRouteResult({
      context,
      event: "replay.index.error",
      level: "error",
      statusCode: 500,
      durationMs,
      details,
      extra: {
        code: API_ERROR_CODES.replayIndexReadFailed,
      },
    });
  }
}

async function handleReplaySnapshot(req: IncomingMessage, res: ServerResponse, context: ApiRequestContext) {
  try {
    const parsedUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const snapshotId = parsedUrl.searchParams.get("snapshotId")?.trim();
    const at = parseQueryNumber(parsedUrl.searchParams.get("at"));

    if (!snapshotId && at === undefined) {
      const durationMs = durationFrom(context.startedAt);
      setJsonHeaders(res, context.requestId);
      res.statusCode = 400;
      res.end(
        JSON.stringify(
          toApiErrorBody({
            code: API_ERROR_CODES.replaySnapshotBadRequest,
            message: "Provide either snapshotId or at query parameter.",
            requestId: context.requestId,
          }),
        ),
      );
      recordRouteMetric("replaySnapshot", false, durationMs);
      logRouteResult({
        context,
        event: "replay.snapshot.bad_request",
        level: "warn",
        statusCode: 400,
        durationMs,
        extra: {
          code: API_ERROR_CODES.replaySnapshotBadRequest,
        },
      });
      return;
    }

    const store = await ensureReplayStore();
    const resolved = snapshotId
      ? await store.readSnapshotById(snapshotId)
      : await store.readSnapshotAt(at ?? Date.now());
    syncReplayStoreMetrics();

    if (!resolved) {
      const durationMs = durationFrom(context.startedAt);
      setJsonHeaders(res, context.requestId);
      res.statusCode = 404;
      res.end(
        JSON.stringify(
          toApiErrorBody({
            code: API_ERROR_CODES.replaySnapshotNotFound,
            message: "Replay snapshot not found for requested selector.",
            requestId: context.requestId,
          }),
        ),
      );
      recordRouteMetric("replaySnapshot", false, durationMs);
      logRouteResult({
        context,
        event: "replay.snapshot.not_found",
        level: "warn",
        statusCode: 404,
        durationMs,
        extra: {
          code: API_ERROR_CODES.replaySnapshotNotFound,
          snapshotId: snapshotId ?? null,
          at: at ?? null,
        },
      });
      return;
    }

    const replaySnapshot: OfficeSnapshot = {
      ...resolved.snapshot,
      source: {
        ...resolved.snapshot.source,
        live: false,
      },
    };
    setJsonHeaders(res, context.requestId);
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        resolvedAt: resolved.resolvedAt,
        entry: resolved.entry,
        snapshot: replaySnapshot,
      }),
    );
    const durationMs = durationFrom(context.startedAt);
    recordRouteMetric("replaySnapshot", true, durationMs);
    logRouteResult({
      context,
      event: "replay.snapshot.ok",
      level: "info",
      statusCode: 200,
      durationMs,
      extra: {
        snapshotId: resolved.entry.snapshotId,
        resolvedAt: resolved.resolvedAt,
      },
    });
  } catch (error) {
    const details = asErrorDetails(error);
    const durationMs = durationFrom(context.startedAt);
    setJsonHeaders(res, context.requestId);
    res.statusCode = 500;
    res.end(
      JSON.stringify(
        toApiErrorBody({
          code: API_ERROR_CODES.replaySnapshotReadFailed,
          message: "Failed to read replay snapshot payload",
          requestId: context.requestId,
          details,
        }),
      ),
    );
    recordRouteMetric("replaySnapshot", false, durationMs);
    logRouteResult({
      context,
      event: "replay.snapshot.error",
      level: "error",
      statusCode: 500,
      durationMs,
      details,
      extra: {
        code: API_ERROR_CODES.replaySnapshotReadFailed,
      },
    });
  }
}

function handleMetrics(res: ServerResponse, context: ApiRequestContext) {
  try {
    syncReplayStoreMetrics();
    const payload = {
      generatedAt: Date.now(),
      requestId: context.requestId,
      routes: Object.fromEntries(
        (Object.entries(routeMetrics) as Array<[ApiRoute, RouteMetric]>).map(([route, metric]) => [
          route,
          {
            requests: metric.requests,
            success: metric.success,
            failure: metric.failure,
            averageDurationMs:
              metric.requests === 0
                ? 0
                : Math.round((metric.totalDurationMs / metric.requests) * 1000) / 1000,
            maxDurationMs: metric.maxDurationMs,
          },
        ]),
      ),
      stream: streamMetrics,
      replayStore: replayStoreMetrics,
    };
    setJsonHeaders(res, context.requestId);
    res.statusCode = 200;
    res.end(JSON.stringify(payload));
    const durationMs = durationFrom(context.startedAt);
    recordRouteMetric("metrics", true, durationMs);
    logRouteResult({
      context,
      event: "metrics.ok",
      level: "info",
      statusCode: 200,
      durationMs,
    });
  } catch (error) {
    const details = asErrorDetails(error);
    const code = API_ERROR_CODES.metricsReadFailed;
    setJsonHeaders(res, context.requestId);
    res.statusCode = 500;
    res.end(
      JSON.stringify(
        toApiErrorBody({
          code,
          message: "Failed to read office metrics",
          requestId: context.requestId,
          details,
        }),
      ),
    );
    const durationMs = durationFrom(context.startedAt);
    recordRouteMetric("metrics", false, durationMs);
    logRouteResult({
      context,
      event: "metrics.error",
      level: "error",
      statusCode: 500,
      durationMs,
      details,
      extra: { code },
    });
  }
}

async function ensureInitialSnapshot(): Promise<OfficeSnapshot> {
  const existing = streamBridge.getLatestSnapshot();
  if (existing) {
    return existing;
  }

  if (!initialSnapshotPromise) {
    initialSnapshotPromise = buildOfficeSnapshot().finally(() => {
      initialSnapshotPromise = null;
    });
  }

  const snapshot = await initialSnapshotPromise;
  await persistSnapshotForReplay(snapshot);
  if (!streamBridge.getLatestSnapshot()) {
    streamBridge.ingestSnapshot(snapshot);
  }
  return streamBridge.getLatestSnapshot() ?? snapshot;
}

async function pollStreamSnapshot() {
  if (pollInFlight) {
    return;
  }

  pollInFlight = true;
  try {
    const hasSnapshot = Boolean(streamBridge.getLatestSnapshot());
    if (!hasSnapshot) {
      await ensureInitialSnapshot();
      return;
    }

    const snapshot = await buildOfficeSnapshot();
    await persistSnapshotForReplay(snapshot);
    const frames = streamBridge.ingestSnapshot(snapshot);
    const pressure = streamBridge.consumePressureStats();
    streamMetrics.backpressureActivations += pressure.backpressureActivations;
    streamMetrics.droppedUnseenEvents += pressure.droppedUnseenEvents;
    streamMetrics.evictedBackfillEvents += pressure.evictedBackfillEvents;

    if (pressure.backpressureActivations > 0) {
      pendingBackpressure.activations += pressure.backpressureActivations;
      pendingBackpressure.droppedUnseenEvents += pressure.droppedUnseenEvents;
      pendingBackpressure.evictedBackfillEvents += pressure.evictedBackfillEvents;

      const nowMs = Date.now();
      const hasDrop = pendingBackpressure.droppedUnseenEvents > 0;
      const windowExpired = nowMs - lastBackpressureWarnAt >= BACKPRESSURE_WARN_INTERVAL_MS;

      if (hasDrop || windowExpired) {
        logStructuredEvent({
          level: hasDrop ? "warn" : "info",
          event: "stream.backpressure",
          details: hasDrop
            ? "Lifecycle stream backpressure dropped unseen events"
            : "Lifecycle stream backpressure (aggregated)",
          extra: {
            activations: pendingBackpressure.activations,
            droppedUnseenEvents: pendingBackpressure.droppedUnseenEvents,
            evictedBackfillEvents: pendingBackpressure.evictedBackfillEvents,
            windowMs: nowMs - lastBackpressureWarnAt,
          },
        });
        lastBackpressureWarnAt = nowMs;
        pendingBackpressure = { activations: 0, droppedUnseenEvents: 0, evictedBackfillEvents: 0 };
      }
    }

    if (frames.length === 0) {
      return;
    }

    for (const frame of frames) {
      for (const subscriber of streamSubscribers) {
        try {
          subscriber.sendLifecycle(frame);
          streamMetrics.lifecycleFramesSent += 1;
        } catch (err) {
          try {
            subscriber.sendError(
              API_ERROR_CODES.streamRuntimeFailed,
              err instanceof Error ? err.message : String(err),
            );
          } catch {
            // ignore subscriber transport failures
          }
        }
      }
    }

    for (const subscriber of streamSubscribers) {
      try {
        subscriber.sendSnapshot(snapshot);
        streamMetrics.snapshotFramesSent += 1;
      } catch (err) {
        try {
          subscriber.sendError(
            API_ERROR_CODES.streamRuntimeFailed,
            err instanceof Error ? err.message : String(err),
          );
        } catch {
          // ignore subscriber transport failures
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    streamMetrics.streamErrors += 1;
    logStructuredEvent({
      level: "error",
      event: "stream.poll.error",
      details: message,
    });
    for (const subscriber of streamSubscribers) {
      try {
        subscriber.sendError(API_ERROR_CODES.streamRuntimeFailed, message);
      } catch {
        // ignore subscriber transport failures
      }
    }
  } finally {
    pollInFlight = false;
  }
}

function ensureStreamPoller() {
  if (streamPoller) {
    return;
  }

  void pollStreamSnapshot();
  streamPoller = setInterval(() => {
    void pollStreamSnapshot();
  }, STREAM_POLL_INTERVAL_MS);
}

function stopStreamPollerIfIdle() {
  if (streamSubscribers.size > 0 || !streamPoller) {
    return;
  }

  clearInterval(streamPoller);
  streamPoller = null;
}

function createSubscriber(
  req: IncomingMessage,
  res: ServerResponse,
  context: ApiRequestContext,
): StreamSubscriber {
  const safeWrite = (chunk: string) => {
    if (!isClosed(req)) {
      res.write(chunk);
    }
  };

  return {
    sendSnapshot(snapshot) {
      safeWrite("event: snapshot\n");
      safeWrite(`data: ${JSON.stringify(snapshot)}\n\n`);
    },
    sendLifecycle(frame) {
      safeWrite(`id: ${frame.seq}\n`);
      safeWrite("event: lifecycle\n");
      safeWrite(`data: ${JSON.stringify(frame)}\n\n`);
    },
    sendBackfillGap(payload) {
      safeWrite("event: backfill-gap\n");
      safeWrite(`data: ${JSON.stringify(payload)}\n\n`);
    },
    sendError(code, message) {
      safeWrite("event: error\n");
      safeWrite(
        `data: ${JSON.stringify({
          code,
          error: message,
          requestId: context.requestId,
        })}\n\n`,
      );
    },
    close() {
      if (!isClosed(req)) {
        res.end();
      }
    },
  };
}

function handleStream(req: IncomingMessage, res: ServerResponse, context: ApiRequestContext) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Correlation-Id", context.requestId);

  const subscriber = createSubscriber(req, res, context);
  const cursor = collectCursor(req);
  let closed = false;
  let streamReady = false;
  const isStreamClosed = () => closed || isClosed(req);
  streamMetrics.activeConnections += 1;
  streamMetrics.totalConnections += 1;
  logStructuredEvent({
    level: "info",
    event: "stream.open",
    requestId: context.requestId,
    method: context.method,
    path: context.path,
    extra: { cursor },
  });

  void (async () => {
    try {
      const snapshot = await ensureInitialSnapshot();
      if (isStreamClosed()) {
        return;
      }
      subscriber.sendSnapshot(snapshot);
      streamMetrics.snapshotFramesSent += 1;

      if (cursor > 0) {
        const backfill = streamBridge.getBackfillWindow(cursor);
        if (backfill.gapDetected && typeof backfill.oldestSeq === "number") {
          const droppedCount = Math.max(0, backfill.oldestSeq - (cursor + 1));
          subscriber.sendBackfillGap({
            requestedCursor: cursor,
            oldestAvailableSeq: backfill.oldestSeq,
            latestAvailableSeq: backfill.latestSeq,
            droppedCount,
          });
          logStructuredEvent({
            level: "warn",
            event: "stream.backfill.gap",
            requestId: context.requestId,
            details: "Cursor is older than retained lifecycle backfill window",
            extra: {
              requestedCursor: cursor,
              oldestAvailableSeq: backfill.oldestSeq,
              latestAvailableSeq: backfill.latestSeq,
              droppedCount,
            },
          });
        }
        for (const frame of backfill.frames) {
          if (isStreamClosed()) {
            return;
          }
          subscriber.sendLifecycle(frame);
          streamMetrics.lifecycleFramesSent += 1;
        }
      }

      if (isStreamClosed()) {
        return;
      }
      streamSubscribers.add(subscriber);
      streamReady = true;
      ensureStreamPoller();
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      streamMetrics.streamErrors += 1;
      const durationMs = durationFrom(context.startedAt);
      recordRouteMetric("stream", false, durationMs);
      logStructuredEvent({
        level: "error",
        event: "stream.init.error",
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        durationMs,
        details,
      });
      try {
        subscriber.sendError(API_ERROR_CODES.streamInitFailed, details);
      } catch {
        // ignore subscriber transport failures
      }
    }
  })();

  const ping = setInterval(() => {
    if (!isStreamClosed()) {
      res.write(`: ping ${Date.now()}\n\n`);
    }
  }, STREAM_PING_INTERVAL_MS);

  const onClose = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(ping);
    streamSubscribers.delete(subscriber);
    stopStreamPollerIfIdle();
    subscriber.close();
    streamMetrics.activeConnections = Math.max(0, streamMetrics.activeConnections - 1);
    const durationMs = durationFrom(context.startedAt);
    if (streamReady) {
      recordRouteMetric("stream", true, durationMs);
    }
    logRouteResult({
      context,
      event: "stream.close",
      level: streamReady ? "info" : "warn",
      statusCode: streamReady ? 200 : 500,
      durationMs,
      extra: { activeConnections: streamMetrics.activeConnections },
    });
  };

  req.on("close", onClose);
}

async function handleOpenClawHub(res: ServerResponse, context: ApiRequestContext) {
  try {
    const snapshot = await buildOpenClawHubSnapshot();
    setJsonHeaders(res, context.requestId);
    res.statusCode = 200;
    res.end(JSON.stringify(snapshot));
    const durationMs = durationFrom(context.startedAt);
    recordRouteMetric("openclawHub", true, durationMs);
    logRouteResult({
      context,
      event: "openclaw-hub.ok",
      level: "info",
      statusCode: 200,
      durationMs,
      extra: {
        channels: snapshot.channels.length,
        skills: snapshot.skills.length,
        docs: snapshot.docs.length,
      },
    });
  } catch (err) {
    const details = asErrorDetails(err);
    const durationMs = durationFrom(context.startedAt);
    setJsonHeaders(res, context.requestId);
    res.statusCode = 500;
    res.end(
      JSON.stringify(
        toApiErrorBody({
          code: API_ERROR_CODES.openclawHubBuildFailed,
          message: "Failed to build OpenClaw hub snapshot",
          requestId: context.requestId,
          details,
        }),
      ),
    );
    recordRouteMetric("openclawHub", false, durationMs);
    logRouteResult({
      context,
      event: "openclaw-hub.error",
      level: "error",
      statusCode: 500,
      durationMs,
      details,
    });
  }
}

async function handleOpenClawHubDoc(req: IncomingMessage, res: ServerResponse, context: ApiRequestContext) {
  try {
    const parsedUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const docPath = parsedUrl.searchParams.get("path")?.trim();
    if (!docPath) {
      setJsonHeaders(res, context.requestId);
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: "Missing 'path' query parameter" } }));
      recordRouteMetric("openclawHubDoc", false, durationFrom(context.startedAt));
      return;
    }

    const projectDir = resolveOpenClawProjectDir();
    const content = await loadFullDocument(projectDir, docPath);
    if (content === null) {
      setJsonHeaders(res, context.requestId);
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "Document not found" } }));
      recordRouteMetric("openclawHubDoc", false, durationFrom(context.startedAt));
      return;
    }

    setJsonHeaders(res, context.requestId);
    res.statusCode = 200;
    res.end(JSON.stringify({ path: docPath, content }));
    const durationMs = durationFrom(context.startedAt);
    recordRouteMetric("openclawHubDoc", true, durationMs);
    logRouteResult({
      context,
      event: "openclaw-hub-doc.ok",
      level: "info",
      statusCode: 200,
      durationMs,
      extra: { path: docPath, size: content.length },
    });
  } catch (err) {
    const details = asErrorDetails(err);
    const durationMs = durationFrom(context.startedAt);
    setJsonHeaders(res, context.requestId);
    res.statusCode = 500;
    res.end(
      JSON.stringify(
        toApiErrorBody({
          code: API_ERROR_CODES.openclawHubDocFailed,
          message: "Failed to load document",
          requestId: context.requestId,
          details,
        }),
      ),
    );
    recordRouteMetric("openclawHubDoc", false, durationMs);
    logRouteResult({
      context,
      event: "openclaw-hub-doc.error",
      level: "error",
      statusCode: 500,
      durationMs,
      details,
    });
  }
}

function attachOfficeRoutes(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    const method = req.method?.toUpperCase();
    const pathname = (req.url ?? "").split("?")[0];

    if (method === "GET" && pathname === "/api/office/snapshot") {
      const context = buildRequestContext(req, pathname);
      void handleSnapshot(res, context);
      return;
    }

    if (method === "GET" && pathname === "/api/office/stream") {
      const context = buildRequestContext(req, pathname);
      handleStream(req, res, context);
      return;
    }

    if (method === "GET" && pathname === "/api/office/metrics") {
      const context = buildRequestContext(req, pathname);
      handleMetrics(res, context);
      return;
    }

    if (method === "GET" && pathname === "/api/office/replay/index") {
      const context = buildRequestContext(req, pathname);
      void handleReplayIndex(req, res, context);
      return;
    }

    if (method === "GET" && pathname === "/api/office/replay/snapshot") {
      const context = buildRequestContext(req, pathname);
      void handleReplaySnapshot(req, res, context);
      return;
    }

    if (method === "GET" && pathname === "/api/office/openclaw-hub") {
      const context = buildRequestContext(req, pathname);
      void handleOpenClawHub(res, context);
      return;
    }

    if (method === "GET" && pathname === "/api/office/openclaw-hub/doc") {
      const context = buildRequestContext(req, pathname);
      void handleOpenClawHubDoc(req, res, context);
      return;
    }

    next();
  });
}

export function openClawOfficeApiPlugin(): Plugin {
  return {
    name: "openclaw-office-api",
    configureServer(server) {
      attachOfficeRoutes(server);
    },
    configurePreviewServer(server) {
      attachOfficeRoutes(server);
    },
  };
}
