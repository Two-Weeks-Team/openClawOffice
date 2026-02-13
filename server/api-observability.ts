import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export const API_ERROR_CODES = {
  snapshotBuildFailed: "SNAPSHOT_BUILD_FAILED",
  snapshotStateNotFound: "SNAPSHOT_STATE_NOT_FOUND",
  snapshotStateAccessDenied: "SNAPSHOT_STATE_ACCESS_DENIED",
  snapshotStateParseFailed: "SNAPSHOT_STATE_PARSE_FAILED",
  streamInitFailed: "STREAM_INIT_FAILED",
  streamRuntimeFailed: "STREAM_RUNTIME_FAILED",
  metricsReadFailed: "METRICS_READ_FAILED",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

type ApiLogLevel = "info" | "warn" | "error";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{6,96}$/;
const LOG_WRITERS: Record<ApiLogLevel, (line: string) => void> = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveCorrelationId(headers: IncomingHttpHeaders): string {
  const requested = normalizeHeaderValue(headers["x-correlation-id"]);
  if (requested && CORRELATION_ID_PATTERN.test(requested)) {
    return requested;
  }
  return randomUUID();
}

export function classifyServerError(error: unknown, fallback: ApiErrorCode): ApiErrorCode {
  if (error instanceof SyntaxError) {
    return API_ERROR_CODES.snapshotStateParseFailed;
  }

  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") {
      return API_ERROR_CODES.snapshotStateNotFound;
    }
    if (code === "EACCES" || code === "EPERM") {
      return API_ERROR_CODES.snapshotStateAccessDenied;
    }
  }

  return fallback;
}

export function toApiErrorBody(params: {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: string;
}) {
  return {
    error: {
      code: params.code,
      message: params.message,
      requestId: params.requestId,
      details: params.details,
    },
  };
}

export function logStructuredEvent(params: {
  level: ApiLogLevel;
  event: string;
  requestId?: string;
  method?: string;
  path?: string;
  durationMs?: number;
  statusCode?: number;
  details?: string;
  extra?: Record<string, unknown>;
}) {
  const payload = {
    ...params.extra,
    ts: new Date().toISOString(),
    level: params.level,
    event: params.event,
    requestId: params.requestId,
    method: params.method,
    path: params.path,
    durationMs: params.durationMs,
    statusCode: params.statusCode,
    details: params.details,
  };
  const line = JSON.stringify(payload);
  LOG_WRITERS[params.level](line);
}
