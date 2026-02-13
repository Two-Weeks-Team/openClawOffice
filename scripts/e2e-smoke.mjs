import { spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5179";
const START_TIMEOUT_MS = 30_000;
const SSE_TIMEOUT_MS = 12_000;
const CORRELATION_ID = "e2e-smoke-correlation-id";
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForReady(logBuffer, getServerExitDetails) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    const exitDetails = getServerExitDetails();
    if (exitDetails) {
      throw new Error(`dev server exited before becoming ready (${exitDetails})\n${logBuffer.join("\n")}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/office/snapshot`, {
        headers: { "x-correlation-id": CORRELATION_ID },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // not ready yet
    }
    await delay(500);
  }
  throw new Error(`dev server did not become ready within ${START_TIMEOUT_MS}ms\n${logBuffer.join("\n")}`);
}

async function assertSnapshot() {
  const response = await fetch(`${BASE_URL}/api/office/snapshot`, {
    headers: { "x-correlation-id": CORRELATION_ID },
  });
  assert(response.ok, `snapshot endpoint failed with ${response.status}`);
  assert(
    response.headers.get("x-correlation-id") === CORRELATION_ID,
    "snapshot endpoint did not echo x-correlation-id",
  );
  const payload = await response.json();
  assert(typeof payload.generatedAt === "number", "snapshot.generatedAt must be a number");
  assert(Array.isArray(payload.entities), "snapshot.entities must be an array");
  assert(Array.isArray(payload.events), "snapshot.events must be an array");
  assert(typeof payload.source?.live === "boolean", "snapshot.source.live missing");
}

async function assertMetrics() {
  const response = await fetch(`${BASE_URL}/api/office/metrics`, {
    headers: { "x-correlation-id": CORRELATION_ID },
  });
  assert(response.ok, `metrics endpoint failed with ${response.status}`);
  assert(
    response.headers.get("x-correlation-id") === CORRELATION_ID,
    "metrics endpoint did not echo x-correlation-id",
  );
  const payload = await response.json();
  assert(payload?.routes?.snapshot, "metrics.routes.snapshot missing");
  assert(payload?.stream, "metrics.stream missing");
}

async function readSseChunk(reader, timeoutMs) {
  const readPromise = reader.read().then(
    (result) => ({ ...result, timedOut: false }),
    () => ({ done: true, value: undefined, timedOut: false }),
  );
  return Promise.race([
    readPromise,
    delay(timeoutMs).then(() => ({ done: true, value: undefined, timedOut: true })),
  ]);
}

async function safeCancelReader(reader) {
  try {
    await Promise.race([reader.cancel(), delay(1_000)]);
  } catch {
    // ignore cancel failures
  }
}

async function assertSse() {
  const response = await fetch(`${BASE_URL}/api/office/stream`, {
    headers: {
      Accept: "text/event-stream",
      "x-correlation-id": CORRELATION_ID,
    },
  });
  assert(response.ok, `stream endpoint failed with ${response.status}`);
  assert(response.body, "stream endpoint has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let buffer = "";
  while (Date.now() - startedAt < SSE_TIMEOUT_MS) {
    const remainingMs = Math.max(1, SSE_TIMEOUT_MS - (Date.now() - startedAt));
    const { done, value, timedOut } = await readSseChunk(reader, remainingMs);
    if (timedOut) {
      break;
    }
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("event: snapshot")) {
      await safeCancelReader(reader);
      return;
    }
  }
  await safeCancelReader(reader);
  throw new Error(`did not receive snapshot SSE frame within ${SSE_TIMEOUT_MS}ms`);
}

function terminateServer(server, signal) {
  if (!server || server.exitCode !== null) {
    return;
  }
  try {
    if (process.platform === "win32") {
      server.kill(signal);
      return;
    }
    if (server.pid) {
      process.kill(-server.pid, signal);
      return;
    }
  } catch {
    // ignore process termination errors
  }
}

async function shutdownServer(server) {
  if (!server || server.exitCode !== null) {
    return;
  }
  terminateServer(server, "SIGTERM");
  await Promise.race([once(server, "exit"), delay(2_000)]);
  if (server.exitCode === null) {
    terminateServer(server, "SIGKILL");
    await Promise.race([once(server, "exit"), delay(2_000)]);
  }
}

async function main() {
  const logBuffer = [];
  const server = spawn(pnpmCmd, ["dev"], {
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const getServerExitDetails = () => {
    if (server.exitCode === null && server.signalCode === null) {
      return undefined;
    }
    return `code=${server.exitCode ?? "null"}, signal=${server.signalCode ?? "null"}`;
  };

  const captureLog = (chunk, prefix) => {
    const text = String(chunk).trim();
    if (!text) {
      return;
    }
    logBuffer.push(`${prefix}${text}`);
    if (logBuffer.length > 60) {
      logBuffer.shift();
    }
  };

  server.stdout.on("data", (chunk) => captureLog(chunk, "[dev] "));
  server.stderr.on("data", (chunk) => captureLog(chunk, "[err] "));

  try {
    await waitForReady(logBuffer, getServerExitDetails);
    await assertSnapshot();
    await assertSse();
    await assertMetrics();
    console.log("e2e smoke passed");
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`e2e smoke failed: ${details}`);
    if (logBuffer.length > 0) {
      console.error("recent dev server logs:");
      for (const line of logBuffer.slice(-20)) {
        console.error(line);
      }
    }
    process.exitCode = 1;
  } finally {
    await shutdownServer(server);
  }
}

void main();
