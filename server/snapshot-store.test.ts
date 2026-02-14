import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRunGraph } from "../src/lib/run-graph";
import type { OfficeSnapshot } from "./office-types";
import { OfficeSnapshotStore } from "./snapshot-store";

const tempDirs: string[] = [];

function makeSnapshot(
  generatedAt: number,
  input: { runId: string; childAgentId: string; parentAgentId: string },
): OfficeSnapshot {
  const run = {
    runId: input.runId,
    childSessionKey: `child:${input.runId}`,
    requesterSessionKey: `parent:${input.runId}`,
    childAgentId: input.childAgentId,
    parentAgentId: input.parentAgentId,
    status: "active" as const,
    task: `task:${input.runId}`,
    cleanup: "keep" as const,
    createdAt: generatedAt - 10,
    startedAt: generatedAt - 5,
  };

  return {
    generatedAt,
    source: {
      stateDir: "/tmp/.openclaw",
      live: true,
    },
    diagnostics: [],
    entities: [
      {
        id: `agent:${input.parentAgentId}`,
        kind: "agent",
        label: input.parentAgentId,
        agentId: input.parentAgentId,
        status: "active",
        sessions: 1,
        activeSubagents: 1,
      },
      {
        id: `subagent:${input.runId}`,
        kind: "subagent",
        label: input.runId,
        agentId: input.childAgentId,
        parentAgentId: input.parentAgentId,
        runId: input.runId,
        status: "active",
        sessions: 1,
        activeSubagents: 0,
      },
    ],
    runs: [run],
    runGraph: buildRunGraph([run]),
    events: [
      {
        id: `${input.runId}:spawn:${generatedAt - 10}`,
        type: "spawn",
        runId: input.runId,
        at: generatedAt - 10,
        agentId: input.childAgentId,
        parentAgentId: input.parentAgentId,
        text: "spawn",
      },
      {
        id: `${input.runId}:start:${generatedAt - 5}`,
        type: "start",
        runId: input.runId,
        at: generatedAt - 5,
        agentId: input.childAgentId,
        parentAgentId: input.parentAgentId,
        text: "start",
      },
    ],
  };
}

async function createStore(
  policy: ConstructorParameters<typeof OfficeSnapshotStore>[1] = {
    minIntervalMs: 0,
    maxSnapshots: 32,
    maxTotalBytes: 32 * 1024 * 1024,
    maxAgeMs: 24 * 60 * 60 * 1000,
  },
) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-replay-store-"));
  tempDirs.push(rootDir);
  return new OfficeSnapshotStore(rootDir, policy);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (pathname) => {
      await fs.rm(pathname, { recursive: true, force: true });
    }),
  );
});

describe("OfficeSnapshotStore", () => {
  it("persists snapshots and supports replay index filtering", async () => {
    const store = await createStore();
    const base = Date.now();
    await store.persistSnapshot(
      makeSnapshot(base + 1_000, {
        runId: "run-a",
        childAgentId: "agent-x",
        parentAgentId: "agent-main",
      }),
    );
    await store.persistSnapshot(
      makeSnapshot(base + 2_000, {
        runId: "run-b",
        childAgentId: "agent-y",
        parentAgentId: "agent-main",
      }),
    );

    const allEntries = await store.queryIndex({ limit: 10 });
    expect(allEntries.entries).toHaveLength(2);
    expect(allEntries.entries[0]?.generatedAt).toBe(base + 2_000);
    expect(allEntries.entries[1]?.generatedAt).toBe(base + 1_000);

    const byRun = await store.queryIndex({ runId: "run-a", limit: 10 });
    expect(byRun.entries).toHaveLength(1);
    expect(byRun.entries[0]?.runIds).toContain("run-a");

    const byAgent = await store.queryIndex({ agentId: "agent-y", limit: 10 });
    expect(byAgent.entries).toHaveLength(1);
    expect(byAgent.entries[0]?.agentIds).toContain("agent-y");
  });

  it("loads snapshots by id and by timestamp selector", async () => {
    const store = await createStore();
    const base = Date.now();
    await store.persistSnapshot(
      makeSnapshot(base + 5_000, {
        runId: "run-5",
        childAgentId: "agent-a",
        parentAgentId: "agent-main",
      }),
    );
    await store.persistSnapshot(
      makeSnapshot(base + 6_000, {
        runId: "run-6",
        childAgentId: "agent-b",
        parentAgentId: "agent-main",
      }),
    );

    const index = await store.queryIndex({ limit: 10 });
    const oldestEntry = index.entries[index.entries.length - 1];
    expect(oldestEntry).toBeDefined();
    const byId = await store.readSnapshotById(oldestEntry?.snapshotId ?? "");
    expect(byId?.snapshot.generatedAt).toBe(base + 5_000);

    const byAt = await store.readSnapshotAt(base + 5_500);
    expect(byAt?.entry.generatedAt).toBe(base + 5_000);
    expect(byAt?.snapshot.runs[0]?.runId).toBe("run-5");
  });

  it("applies retention policy by entry count", async () => {
    const store = await createStore({
      minIntervalMs: 0,
      maxSnapshots: 2,
      maxTotalBytes: 64 * 1024 * 1024,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    const base = Date.now();

    await store.persistSnapshot(
      makeSnapshot(base + 10_000, {
        runId: "run-10",
        childAgentId: "agent-a",
        parentAgentId: "agent-main",
      }),
    );
    await store.persistSnapshot(
      makeSnapshot(base + 20_000, {
        runId: "run-20",
        childAgentId: "agent-b",
        parentAgentId: "agent-main",
      }),
    );
    await store.persistSnapshot(
      makeSnapshot(base + 30_000, {
        runId: "run-30",
        childAgentId: "agent-c",
        parentAgentId: "agent-main",
      }),
    );

    const index = await store.queryIndex({ limit: 10 });
    expect(index.entries).toHaveLength(2);
    expect(index.entries.map((entry) => entry.generatedAt)).toEqual([base + 30_000, base + 20_000]);

    const metrics = store.getMetrics();
    expect(metrics.evictedSnapshots).toBeGreaterThan(0);
    expect(metrics.totalEntries).toBe(2);
  });

  it("skips persist when minimum interval has not elapsed", async () => {
    const store = await createStore({
      minIntervalMs: 60_000,
      maxSnapshots: 10,
      maxTotalBytes: 32 * 1024 * 1024,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    const first = await store.persistSnapshot(
      makeSnapshot(50_000, { runId: "run-first", childAgentId: "agent-a", parentAgentId: "agent-main" }),
    );
    const second = await store.persistSnapshot(
      makeSnapshot(60_000, { runId: "run-second", childAgentId: "agent-b", parentAgentId: "agent-main" }),
    );

    expect(first.stored).toBe(true);
    expect(second.stored).toBe(false);
    expect(second.reason).toBe("interval");
    expect(store.getMetrics().skippedByInterval).toBeGreaterThanOrEqual(1);
  });
});
