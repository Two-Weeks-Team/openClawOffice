import { describe, expect, it } from "vitest";
import { buildEntitySearchIndex, searchEntityIds } from "./entity-search";
import type { OfficeSnapshot } from "../types/office";

function makeSnapshot(): OfficeSnapshot {
  return {
    generatedAt: 1_000_000,
    source: { stateDir: "/tmp/openclaw", live: true },
    diagnostics: [],
    entities: [
      {
        id: "agent:main",
        kind: "agent",
        label: "main",
        agentId: "main",
        status: "active",
        sessions: 4,
        activeSubagents: 1,
        bubble: "reviewing queue",
      },
      {
        id: "subagent:run-abc",
        kind: "subagent",
        label: "worker-alpha",
        agentId: "research",
        parentAgentId: "main",
        runId: "run-abc",
        status: "active",
        sessions: 1,
        activeSubagents: 0,
        task: "collect timeline replay evidence",
      },
    ],
    runs: [
      {
        runId: "run-abc",
        childSessionKey: "agent:research:session:1",
        requesterSessionKey: "agent:main:session:1",
        childAgentId: "research",
        parentAgentId: "main",
        status: "active",
        task: "collect timeline replay evidence",
        cleanup: "keep",
        createdAt: 990_000,
      },
      {
        runId: "run-def",
        childSessionKey: "agent:ops:session:2",
        requesterSessionKey: "agent:main:session:2",
        childAgentId: "ops",
        parentAgentId: "main",
        status: "error",
        task: "investigate gateway timeout",
        cleanup: "delete",
        createdAt: 980_000,
      },
    ],
    events: [],
  };
}

describe("entity search index", () => {
  it("matches by run id and task keyword", () => {
    const index = buildEntitySearchIndex(makeSnapshot());
    expect(searchEntityIds(index, "run-abc")).toEqual(new Set(["agent:main", "subagent:run-abc"]));
    expect(searchEntityIds(index, "replay evidence")).toEqual(new Set(["agent:main", "subagent:run-abc"]));
  });

  it("matches by agent id and supports empty query", () => {
    const index = buildEntitySearchIndex(makeSnapshot());
    expect(searchEntityIds(index, "research")).toEqual(new Set(["subagent:run-abc"]));
    expect(searchEntityIds(index, "   ")).toEqual(new Set(["agent:main", "subagent:run-abc"]));
  });
});
