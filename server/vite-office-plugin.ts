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
import {
  OfficeStreamBridge,
  parseLifecycleCursor,
  type LifecycleEnvelope,
} from "./stream-bridge";

const STREAM_POLL_INTERVAL_MS = 400;
const STREAM_PING_INTERVAL_MS = 15_000;

type ApiRoute = "snapshot" | "stream" | "metrics";

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
};

type StreamSubscriber = {
  sendSnapshot: (snapshot: OfficeSnapshot) => void;
  sendLifecycle: (frame: LifecycleEnvelope) => void;
  sendError: (code: ApiErrorCode, message: string) => void;
  close: () => void;
};

const streamBridge = new OfficeStreamBridge();
const streamSubscribers = new Set<StreamSubscriber>();
let streamPoller: NodeJS.Timeout | null = null;
let pollInFlight = false;
let initialSnapshotPromise: Promise<OfficeSnapshot> | null = null;

const routeMetrics: Record<ApiRoute, RouteMetric> = {
  snapshot: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  stream: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
  metrics: { requests: 0, success: 0, failure: 0, totalDurationMs: 0, maxDurationMs: 0 },
};

const streamMetrics: StreamMetric = {
  activeConnections: 0,
  totalConnections: 0,
  lifecycleFramesSent: 0,
  snapshotFramesSent: 0,
  streamErrors: 0,
};

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

function asErrorDetails(error: unknown): string | undefined {
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

async function handleSnapshot(res: ServerResponse, context: ApiRequestContext) {
  try {
    const snapshot = await buildOfficeSnapshot();
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

function handleMetrics(res: ServerResponse, context: ApiRequestContext) {
  try {
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
    const durationMs = durationFrom(context.startedAt);
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
    const frames = streamBridge.ingestSnapshot(snapshot);

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
  let streamReady = false;
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
      subscriber.sendSnapshot(snapshot);
      streamMetrics.snapshotFramesSent += 1;

      if (cursor > 0) {
        for (const frame of streamBridge.getBackfill(cursor)) {
          subscriber.sendLifecycle(frame);
          streamMetrics.lifecycleFramesSent += 1;
        }
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
    if (!isClosed(req)) {
      res.write(`: ping ${Date.now()}\n\n`);
    }
  }, STREAM_PING_INTERVAL_MS);

  const onClose = () => {
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
