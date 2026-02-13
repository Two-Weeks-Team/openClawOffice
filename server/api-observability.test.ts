import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  classifyServerError,
  resolveCorrelationId,
  toApiErrorBody,
} from "./api-observability";

describe("resolveCorrelationId", () => {
  it("uses a valid incoming header", () => {
    const requestId = resolveCorrelationId({ "x-correlation-id": "req-smoke-12345" });
    expect(requestId).toBe("req-smoke-12345");
  });

  it("falls back to generated id for invalid values", () => {
    const requestId = resolveCorrelationId({ "x-correlation-id": "???" });
    expect(requestId).not.toBe("???");
    expect(requestId.length).toBeGreaterThan(8);
  });
});

describe("classifyServerError", () => {
  it("classifies filesystem access errors", () => {
    expect(
      classifyServerError({ code: "EACCES", message: "permission denied" }, API_ERROR_CODES.snapshotBuildFailed),
    ).toBe(API_ERROR_CODES.snapshotStateAccessDenied);
    expect(
      classifyServerError({ code: "ENOENT", message: "not found" }, API_ERROR_CODES.snapshotBuildFailed),
    ).toBe(API_ERROR_CODES.snapshotStateNotFound);
  });

  it("classifies syntax parsing errors", () => {
    expect(classifyServerError(new SyntaxError("bad json"), API_ERROR_CODES.snapshotBuildFailed)).toBe(
      API_ERROR_CODES.snapshotStateParseFailed,
    );
  });

  it("returns fallback for unknown errors", () => {
    expect(classifyServerError(new Error("boom"), API_ERROR_CODES.streamRuntimeFailed)).toBe(
      API_ERROR_CODES.streamRuntimeFailed,
    );
  });
});

describe("toApiErrorBody", () => {
  it("creates a structured API error payload", () => {
    expect(
      toApiErrorBody({
        code: API_ERROR_CODES.snapshotBuildFailed,
        message: "snapshot failed",
        requestId: "req-1",
        details: "stack trimmed",
      }),
    ).toEqual({
      error: {
        code: API_ERROR_CODES.snapshotBuildFailed,
        message: "snapshot failed",
        requestId: "req-1",
        details: "stack trimmed",
      },
    });
  });
});
