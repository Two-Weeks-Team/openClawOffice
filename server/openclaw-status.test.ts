import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGatewayPort, resolveOpenClawProjectDir } from "./openclaw-status";

describe("resolveOpenClawProjectDir", () => {
  const originalEnv = process.env.OPENCLAW_PROJECT_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCLAW_PROJECT_DIR;
    } else {
      process.env.OPENCLAW_PROJECT_DIR = originalEnv;
    }
  });

  it("returns default path (../openclaw from cwd) when env is not set", () => {
    delete process.env.OPENCLAW_PROJECT_DIR;
    const result = resolveOpenClawProjectDir();
    expect(result).toBe(path.resolve(process.cwd(), "../openclaw"));
  });

  it("returns resolved path from env var", () => {
    process.env.OPENCLAW_PROJECT_DIR = "/custom/openclaw";
    const result = resolveOpenClawProjectDir();
    expect(result).toBe("/custom/openclaw");
  });

  it("ignores empty/whitespace env var", () => {
    process.env.OPENCLAW_PROJECT_DIR = "   ";
    const result = resolveOpenClawProjectDir();
    expect(result).toBe(path.resolve(process.cwd(), "../openclaw"));
  });
});

describe("resolveGatewayPort", () => {
  const originalEnv = process.env.OPENCLAW_GATEWAY_PORT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCLAW_GATEWAY_PORT;
    } else {
      process.env.OPENCLAW_GATEWAY_PORT = originalEnv;
    }
  });

  it("returns default port 18789 when env is not set", () => {
    delete process.env.OPENCLAW_GATEWAY_PORT;
    expect(resolveGatewayPort()).toBe(18789);
  });

  it("returns port from env var when valid", () => {
    process.env.OPENCLAW_GATEWAY_PORT = "9000";
    expect(resolveGatewayPort()).toBe(9000);
  });

  it("returns default for non-numeric env var", () => {
    process.env.OPENCLAW_GATEWAY_PORT = "abc";
    expect(resolveGatewayPort()).toBe(18789);
  });

  it("returns default for zero or negative port", () => {
    process.env.OPENCLAW_GATEWAY_PORT = "0";
    expect(resolveGatewayPort()).toBe(18789);

    process.env.OPENCLAW_GATEWAY_PORT = "-1";
    expect(resolveGatewayPort()).toBe(18789);
  });

  it("returns default for empty string", () => {
    process.env.OPENCLAW_GATEWAY_PORT = "";
    expect(resolveGatewayPort()).toBe(18789);
  });
});
