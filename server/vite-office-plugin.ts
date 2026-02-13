import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { buildOfficeSnapshot } from "./office-state";

function setJsonHeaders(res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
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

function isClosed(req: IncomingMessage) {
  return req.destroyed || (req as IncomingMessage & { aborted?: boolean }).aborted === true;
}

function handleStream(req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendSnapshot = async () => {
    if (isClosed(req)) {
      return;
    }
    try {
      const snapshot = await buildOfficeSnapshot();
      res.write(`event: snapshot\n`);
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (err) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
    }
  };

  void sendSnapshot();

  const ticker = setInterval(() => {
    void sendSnapshot();
  }, 2_500);

  const ping = setInterval(() => {
    if (!isClosed(req)) {
      res.write(`: ping ${Date.now()}\n\n`);
    }
  }, 15_000);

  const onClose = () => {
    clearInterval(ticker);
    clearInterval(ping);
    res.end();
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
