import { describe, expect, it } from "vitest";
import type { OfficeEntity } from "../types/office";
import { buildEntityClusters, type ClusterPlacement } from "./entity-clustering";

function makeEntity(partial: Partial<OfficeEntity> & { id: string }): OfficeEntity {
  return {
    id: partial.id,
    kind: partial.kind ?? "subagent",
    label: partial.label ?? partial.id,
    agentId: partial.agentId ?? "agent-x",
    parentAgentId: partial.parentAgentId,
    runId: partial.runId,
    status: partial.status ?? "active",
    sessions: partial.sessions ?? 1,
    activeSubagents: partial.activeSubagents ?? 0,
    lastUpdatedAt: partial.lastUpdatedAt,
    model: partial.model,
    bubble: partial.bubble,
    task: partial.task,
  };
}

function makePlacement(
  entity: OfficeEntity,
  partial: Partial<ClusterPlacement> = {},
): ClusterPlacement {
  return {
    entity,
    roomId: partial.roomId ?? "room:lobby",
    x: partial.x ?? 120,
    y: partial.y ?? 120,
  };
}

describe("buildEntityClusters", () => {
  it("clusters dense entities by space, status, and relation", () => {
    const placements: ClusterPlacement[] = [
      makePlacement(
        makeEntity({
          id: "subagent:run-a:1",
          runId: "run-a",
          status: "active",
        }),
        { x: 100, y: 100 },
      ),
      makePlacement(
        makeEntity({
          id: "subagent:run-a:2",
          runId: "run-a",
          status: "active",
        }),
        { x: 112, y: 110 },
      ),
      makePlacement(
        makeEntity({
          id: "subagent:run-a:3",
          runId: "run-a",
          status: "active",
        }),
        { x: 124, y: 116 },
      ),
    ];

    const result = buildEntityClusters(placements, {
      cellSize: 80,
      minMembers: 3,
    });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]?.statusBucket).toBe("active");
    expect(result.clusters[0]?.relationKey).toBe("run:run-a");
    expect(result.clusters[0]?.memberCount).toBe(3);
    expect(result.memberToClusterId.get("subagent:run-a:1")).toBe(result.clusters[0]?.id);
  });

  it("keeps unrelated or sparse groups unclustered", () => {
    const placements: ClusterPlacement[] = [
      makePlacement(
        makeEntity({
          id: "subagent:run-a:1",
          runId: "run-a",
          status: "active",
        }),
        { x: 100, y: 100 },
      ),
      makePlacement(
        makeEntity({
          id: "subagent:run-a:2",
          runId: "run-a",
          status: "active",
        }),
        { x: 104, y: 108 },
      ),
      makePlacement(
        makeEntity({
          id: "subagent:run-b:1",
          runId: "run-b",
          status: "active",
        }),
        { x: 110, y: 112 },
      ),
      makePlacement(
        makeEntity({
          id: "subagent:run-a:error",
          runId: "run-a",
          status: "error",
        }),
        { x: 108, y: 104 },
      ),
    ];

    const result = buildEntityClusters(placements, {
      cellSize: 90,
      minMembers: 3,
    });

    expect(result.clusters).toHaveLength(0);
    expect(result.memberToClusterId.size).toBe(0);
  });

  it("uses deterministic center points and summary labels", () => {
    const placements: ClusterPlacement[] = [
      makePlacement(makeEntity({ id: "agent:a", kind: "agent", status: "idle" }), { x: 200, y: 200 }),
      makePlacement(makeEntity({ id: "agent:b", kind: "agent", status: "idle" }), { x: 220, y: 220 }),
      makePlacement(makeEntity({ id: "agent:c", kind: "agent", status: "idle" }), { x: 240, y: 220 }),
    ];

    const result = buildEntityClusters(placements, {
      cellSize: 200,
      minMembers: 3,
    });

    expect(result.clusters[0]?.x).toBe(220);
    expect(result.clusters[0]?.y).toBe(213);
    expect(result.clusters[0]?.label).toContain("cluster");
    expect(result.clusters[0]?.summary).toContain("3 entities");
  });
});
