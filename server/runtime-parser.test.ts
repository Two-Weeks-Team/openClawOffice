import { describe, expect, it } from "vitest";
import {
  parseAgentIdFromSessionKey,
  parseSessionsStore,
  parseSubagentStore,
} from "./runtime-parser";

describe("parseAgentIdFromSessionKey", () => {
  it("extracts agent id from canonical session key", () => {
    expect(parseAgentIdFromSessionKey("agent:main:session:abc")).toBe("main");
  });

  it("returns undefined for invalid key", () => {
    expect(parseAgentIdFromSessionKey("subagent:main")).toBeUndefined();
  });
});

describe("parseSessionsStore", () => {
  it("parses valid session map and keeps latest metadata fields", () => {
    const parsed = parseSessionsStore(
      {
        "agent:main:1": { updatedAt: 1000, model: "openai/gpt-5" },
        "agent:main:2": { updatedAt: "2000", modelOverride: "openai/gpt-5-mini" },
      },
      "sessions.json",
    );

    expect(parsed.value).toHaveLength(2);
    expect(parsed.value[1]).toMatchObject({
      sessionKey: "agent:main:2",
      updatedAt: 2000,
      model: "openai/gpt-5-mini",
    });
    expect(parsed.diagnostics).toHaveLength(0);
  });

  it("degrades invalid shapes into diagnostics", () => {
    const parsed = parseSessionsStore(["bad"], "sessions.json");
    expect(parsed.value).toEqual([]);
    expect(parsed.diagnostics[0]?.code).toBe("SESSION_STORE_INVALID_SHAPE");
  });
});

describe("parseSubagentStore", () => {
  it("parses v1 map format", () => {
    const parsed = parseSubagentStore(
      {
        version: 1,
        runs: {
          "run-1": {
            runId: "run-1",
            childSessionKey: "agent:child-a:session:x",
            requesterSessionKey: "agent:parent-a:session:y",
            task: "Analyze queue",
            createdAt: 100,
            startedAt: 110,
          },
        },
      },
      "runs.json",
    );

    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0]).toMatchObject({
      runId: "run-1",
      childAgentId: "child-a",
      parentAgentId: "parent-a",
      status: "active",
    });
    expect(parsed.diagnostics).toHaveLength(0);
  });

  it("parses v2 array format with compatibility aliases", () => {
    const parsed = parseSubagentStore(
      {
        version: "2",
        runs: [
          {
            runId: "run-2",
            childSessionKey: "agent:child-b:session:x",
            requesterSession: "agent:parent-b:session:y",
            task: "Investigate failure",
            createdAt: "200",
            endedAt: 220,
          },
        ],
      },
      "runs.json",
    );

    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0]).toMatchObject({
      runId: "run-2",
      childAgentId: "child-b",
      parentAgentId: "parent-b",
      createdAt: 200,
      status: "ok",
    });
    expect(parsed.diagnostics).toHaveLength(0);
  });

  it("keeps mapping accuracy for 3 agents and 10 runs", () => {
    const runs = Array.from({ length: 10 }, (_, index) => {
      const child = ["alpha", "beta", "gamma"][index % 3];
      const parent = index % 2 === 0 ? "main" : "ops";
      return [
        `run-${index}`,
        {
          runId: `run-${index}`,
          childSessionKey: `agent:${child}:session:${index}`,
          requesterSessionKey: `agent:${parent}:session:${index}`,
          task: `task-${index}`,
          createdAt: 1_000 + index,
          startedAt: 1_010 + index,
          endedAt: index % 4 === 0 ? undefined : 1_020 + index,
          outcome: index % 4 === 0 ? { status: "error" } : { status: "ok" },
        },
      ];
    });

    const parsed = parseSubagentStore(
      {
        version: 1,
        runs: Object.fromEntries(runs),
      },
      "runs.json",
    );

    expect(parsed.value).toHaveLength(10);
    expect(parsed.diagnostics).toHaveLength(0);

    const idSet = new Set(parsed.value.map((run) => run.childAgentId));
    expect(idSet).toEqual(new Set(["alpha", "beta", "gamma"]));

    for (const run of parsed.value) {
      const index = Number(run.runId.replace("run-", ""));
      const expectedChild = ["alpha", "beta", "gamma"][index % 3];
      const expectedParent = index % 2 === 0 ? "main" : "ops";
      expect(run.childAgentId).toBe(expectedChild);
      expect(run.parentAgentId).toBe(expectedParent);
    }
  });

  it("degrades malformed run rows with diagnostics", () => {
    const parsed = parseSubagentStore(
      {
        version: 3,
        runs: {
          bad: { runId: "bad", childSessionKey: "agent:x:s" },
          good: {
            runId: "good",
            childSessionKey: "agent:x:s",
            requesterSessionKey: "agent:y:s",
            task: "ok",
            createdAt: 100,
          },
          alsoBad: {
            runId: "alsoBad",
            childSessionKey: "invalid",
            requesterSessionKey: "agent:y:s",
            task: "ok",
            createdAt: 101,
          },
        },
      },
      "runs.json",
    );

    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0]?.runId).toBe("good");
    expect(parsed.diagnostics.map((item) => item.code)).toContain("RUN_STORE_UNSUPPORTED_VERSION");
    expect(parsed.diagnostics.map((item) => item.code)).toContain("RUN_ENTRY_MISSING_REQUIRED_FIELD");
    expect(parsed.diagnostics.map((item) => item.code)).toContain("SESSION_KEY_PARSE_FAILED");
  });
});
