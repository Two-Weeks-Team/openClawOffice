import { describe, expect, it } from "vitest";
import { buildPlacements } from "./layout";
import type { OfficeEntity } from "../types/office";

function makeEntity(params: Partial<OfficeEntity> & Pick<OfficeEntity, "id" | "agentId" | "label">): OfficeEntity {
  return {
    id: params.id,
    kind: params.kind ?? "agent",
    label: params.label,
    agentId: params.agentId,
    status: params.status ?? "active",
    sessions: params.sessions ?? 1,
    activeSubagents: params.activeSubagents ?? 0,
    parentAgentId: params.parentAgentId,
    runId: params.runId,
    lastUpdatedAt: params.lastUpdatedAt,
    model: params.model,
    bubble: params.bubble,
    task: params.task,
  };
}

function toPlacementSnapshot(result: ReturnType<typeof buildPlacements>) {
  return result.placements
    .map((placement) => ({
      id: placement.entity.id,
      roomId: placement.roomId,
      targetRoomId: placement.targetRoomId,
      x: Math.round(placement.x * 1000) / 1000,
      y: Math.round(placement.y * 1000) / 1000,
      overflowed: placement.overflowed,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

describe("buildPlacements", () => {
  it("produces deterministic placement output for identical inputs", () => {
    const entities: OfficeEntity[] = [
      makeEntity({ id: "agent-1", agentId: "agent-1", label: "Agent 1", status: "active" }),
      makeEntity({ id: "agent-2", agentId: "agent-2", label: "Agent 2", status: "idle" }),
      makeEntity({
        id: "sub-1",
        kind: "subagent",
        agentId: "sub-1",
        label: "Subagent 1",
        parentAgentId: "agent-1",
        status: "active",
      }),
      makeEntity({
        id: "sub-2",
        kind: "subagent",
        agentId: "sub-2",
        label: "Subagent 2",
        parentAgentId: "agent-1",
        status: "ok",
      }),
    ];

    const first = buildPlacements({ entities, generatedAt: 1_000_000 });
    const second = buildPlacements({ entities, generatedAt: 1_000_000 });

    expect(toPlacementSnapshot(first)).toEqual(toPlacementSnapshot(second));
  });

  it("keeps all entities placed even when room capacity overflows", () => {
    const entities = Array.from({ length: 7 }, (_, index) =>
      makeEntity({
        id: `agent-overflow-${index + 1}`,
        agentId: `agent-overflow-${index + 1}`,
        label: `Overflow Agent ${index + 1}`,
        status: "active",
      }),
    );

    const result = buildPlacements({
      entities,
      generatedAt: 1_000_000,
      zoneConfig: {
        rooms: [
          {
            id: "strategy",
            capacity: 1,
            secondaryZoneId: "ops",
            routing: { statuses: ["active"], kinds: ["agent"], recentWeight: 0 },
          },
          {
            id: "ops",
            capacity: 1,
            secondaryZoneId: "build",
            routing: { statuses: ["active"], kinds: ["agent"], recentWeight: 0 },
          },
          {
            id: "build",
            capacity: 1,
            secondaryZoneId: "spawn",
            routing: { statuses: ["active"], kinds: ["agent"], recentWeight: 0 },
          },
          {
            id: "spawn",
            capacity: 1,
            secondaryZoneId: "lounge",
            routing: { statuses: ["active"], kinds: ["agent"], recentWeight: 0 },
          },
          {
            id: "lounge",
            capacity: 1,
            secondaryZoneId: "ops",
            routing: { statuses: ["active"], kinds: ["agent"], recentWeight: 0 },
          },
        ],
      },
    });

    expect(result.placements).toHaveLength(entities.length);
    expect(result.placements.some((placement) => placement.overflowed)).toBe(true);
    expect(result.roomDebug.get("strategy")?.overflowOut).toBeGreaterThan(0);
  });

  it("places subagents near parent agents when parent affinity is enabled", () => {
    const parent = makeEntity({
      id: "agent-parent",
      agentId: "agent-parent",
      label: "Parent Agent",
      status: "active",
    });
    const child = makeEntity({
      id: "sub-child",
      kind: "subagent",
      agentId: "sub-child",
      label: "Child Subagent",
      parentAgentId: "agent-parent",
      status: "active",
    });

    const parentAffinityPx = 56;
    const result = buildPlacements({
      entities: [parent, child],
      generatedAt: 1_000_000,
      zoneConfig: {
        parentAffinityPx,
        rooms: [
          {
            id: "strategy",
            routing: {
              statuses: ["active", "idle", "offline", "ok", "error"],
              kinds: ["agent", "subagent"],
              recentWeight: 0
            },
          },
          {
            id: "ops",
            routing: {
              statuses: ["ok"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "build",
            routing: {
              statuses: ["idle"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "spawn",
            routing: {
              statuses: ["idle"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "lounge",
            routing: {
              statuses: ["offline"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
        ],
      },
    });

    const parentPlacement = result.placements.find((placement) => placement.entity.id === parent.id);
    const childPlacement = result.placements.find((placement) => placement.entity.id === child.id);

    expect(parentPlacement).toBeDefined();
    expect(childPlacement).toBeDefined();
    expect(parentPlacement?.roomId).toBe("strategy");
    expect(childPlacement?.roomId).toBe("strategy");

    const dx = (parentPlacement?.x ?? 0) - (childPlacement?.x ?? 0);
    const dy = (parentPlacement?.y ?? 0) - (childPlacement?.y ?? 0);
    const distance = Math.sqrt(dx * dx + dy * dy);
    expect(distance).toBeLessThanOrEqual(parentAffinityPx * 1.15);
  });
});
