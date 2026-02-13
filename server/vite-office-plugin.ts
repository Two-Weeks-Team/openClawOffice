import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { buildOfficeSnapshot } from "./office-state";
import type { OfficeSnapshot } from "./office-types";
import {
  OfficeStreamBridge,
  parseLifecycleCursor,
  type LifecycleEnvelope,
} from "./stream-bridge";

const STREAM_POLL_INTERVAL_MS = 400;
const STREAM_PING_INTERVAL_MS = 15_000;

type StreamSubscriber = {
  sendSnapshot: (snapshot: OfficeSnapshot) => void;
  sendLifecycle: (frame: LifecycleEnvelope) => void;
  sendError: (message: string) => void;
  close: () => void;
};

const streamBridge = new OfficeStreamBridge();
const streamSubscribers = new Set<StreamSubscriber>();
let streamPoller: NodeJS.Timeout | null = null;
let pollInFlight = false;
let initialSnapshotPromise: Promise<OfficeSnapshot> | null = null;

function setJsonHeaders(res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
}

function isClosed(req: IncomingMessage) {
  return req.destroyed;
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

async function handleSnapshot(res: ServerResponse) {
  try {
    const snapshot = await buildOfficeSnapshot();
    setJsonHeaders(res);
    res.statusCode = 200;
    res.end(JSON.stringify(snapshot));
  } catch (err) {
    setJsonHeaders(res);
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: "Failed to build office snapshot",
        details: err instanceof Error ? err.message : String(err),
      }),
    );
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
        } catch (err) {
          try {
            subscriber.sendError(err instanceof Error ? err.message : String(err));
          } catch {
            // ignore subscriber transport failures
          }
        }
      }
    }

    for (const subscriber of streamSubscribers) {
      try {
        subscriber.sendSnapshot(snapshot);
      } catch (err) {
        try {
          subscriber.sendError(err instanceof Error ? err.message : String(err));
        } catch {
          // ignore subscriber transport failures
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const subscriber of streamSubscribers) {
      subscriber.sendError(message);
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

function createSubscriber(req: IncomingMessage, res: ServerResponse): StreamSubscriber {
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
    sendError(message) {
      safeWrite("event: error\n");
      safeWrite(`data: ${JSON.stringify({ error: message })}\n\n`);
    },
    close() {
      if (!isClosed(req)) {
        res.end();
      }
    },
  };
}

function handleStream(req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const subscriber = createSubscriber(req, res);
  const cursor = collectCursor(req);

  void (async () => {
    try {
      const snapshot = await ensureInitialSnapshot();
      subscriber.sendSnapshot(snapshot);

      if (cursor > 0) {
        for (const frame of streamBridge.getBackfill(cursor)) {
          subscriber.sendLifecycle(frame);
        }
      }

      streamSubscribers.add(subscriber);
      ensureStreamPoller();
    } catch (err) {
      subscriber.sendError(err instanceof Error ? err.message : String(err));
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
  };

  req.on("close", onClose);
}

function attachOfficeRoutes(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    const method = req.method?.toUpperCase();
    const pathname = (req.url ?? "").split("?")[0];

    if (method === "GET" && pathname === "/api/office/snapshot") {
      void handleSnapshot(res);
      return;
    }

    if (method === "GET" && pathname === "/api/office/stream") {
      handleStream(req, res);
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
