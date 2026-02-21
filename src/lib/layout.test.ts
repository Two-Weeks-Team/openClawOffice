import { describe, expect, it } from "vitest";
import { buildPlacements, buildRoomCapacityPlan, detectPlacementCollisions } from "./layout";
import type { OfficeEntity } from "../types/office";
import { createLocal50Scenario } from "./local50-scenario";

function makeEntity(
  params: { id: string; agentId: string; label: string; kind?: "agent" | "subagent" } & Partial<
    Omit<import("../types/office").OfficeAgentEntity, "kind"> &
      Omit<import("../types/office").OfficeSubagentEntity, "kind">
  >,
): OfficeEntity {
  const kind = params.kind ?? "agent";
  if (kind === "subagent") {
    return {
      id: params.id,
      kind: "subagent",
      label: params.label,
      agentId: params.agentId,
      parentAgentId: params.parentAgentId ?? "parent-agent",
      runId: params.runId ?? params.id,
      status: params.status ?? "active",
      sessions: params.sessions ?? 1,
      activeSubagents: params.activeSubagents ?? 0,
      lastUpdatedAt: params.lastUpdatedAt,
      bubble: params.bubble,
      task: params.task,
    };
  }
  return {
    id: params.id,
    kind: "agent",
    label: params.label,
    agentId: params.agentId,
    status: params.status ?? "active",
    sessions: params.sessions ?? 1,
    activeSubagents: params.activeSubagents ?? 0,
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

  it("supports manual mode without overflow rerouting", () => {
    const entities = Array.from({ length: 3 }, (_, index) =>
      makeEntity({
        id: `agent-manual-${index + 1}`,
        agentId: `agent-manual-${index + 1}`,
        label: `Manual Agent ${index + 1}`,
        status: "active",
      }),
    );

    const zoneConfig = {
      rooms: [
        {
          id: "strategy",
          capacity: 1,
          secondaryZoneId: "ops",
          routing: { statuses: ["active"], kinds: ["agent"], recentWeight: 0 },
        },
        {
          id: "ops",
          capacity: 3,
          secondaryZoneId: "build",
          routing: { statuses: ["offline"], kinds: ["agent"], recentWeight: 0 },
        },
        {
          id: "build",
          capacity: 3,
          secondaryZoneId: "spawn",
          routing: { statuses: ["offline"], kinds: ["agent"], recentWeight: 0 },
        },
        {
          id: "spawn",
          capacity: 3,
          secondaryZoneId: "lounge",
          routing: { statuses: ["offline"], kinds: ["agent"], recentWeight: 0 },
        },
        {
          id: "lounge",
          capacity: 3,
          secondaryZoneId: "ops",
          routing: { statuses: ["offline"], kinds: ["agent"], recentWeight: 0 },
        },
      ],
    };

    const autoResult = buildPlacements({
      entities,
      generatedAt: 1_000_000,
      placementMode: "auto",
      zoneConfig,
    });
    const manualResult = buildPlacements({
      entities,
      generatedAt: 1_000_000,
      placementMode: "manual",
      zoneConfig,
    });

    expect(autoResult.placements.some((placement) => placement.roomId !== "strategy")).toBe(true);
    expect(manualResult.placements.every((placement) => placement.roomId === "strategy")).toBe(true);
    expect(manualResult.placements.some((placement) => placement.overflowed)).toBe(true);
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

  it("builds an explicit capacity plan table for local50 targets", () => {
    const plan = buildRoomCapacityPlan({ expectedEntities: 50 });
    expect(plan.totalCapacity).toBeGreaterThanOrEqual(50);
    expect(plan.entries.reduce((sum, room) => sum + room.capacity, 0)).toBe(plan.totalCapacity);
    expect(plan.entries).toHaveLength(5);
    expect(plan.entries.every((entry) => Number.isFinite(entry.targetSharePct))).toBe(true);
  });

  it("uses status/team/parent priorities to keep same-team agents together while spreading overflow", () => {
    const entities: OfficeEntity[] = [
      makeEntity({
        id: "team-openai-1",
        agentId: "team-openai-1",
        label: "OpenAI 1",
        status: "active",
        model: "openai/gpt-5",
      }),
      makeEntity({
        id: "team-openai-2",
        agentId: "team-openai-2",
        label: "OpenAI 2",
        status: "active",
        model: "openai/gpt-5",
      }),
      makeEntity({
        id: "team-anthropic-1",
        agentId: "team-anthropic-1",
        label: "Anthropic 1",
        status: "active",
        model: "anthropic/claude-sonnet",
      }),
    ];

    const result = buildPlacements({
      entities,
      generatedAt: 1_000_000,
      zoneConfig: {
        priorityOrder: ["status", "team", "role", "parent", "recent"],
        rooms: [
          {
            id: "strategy",
            role: "ops",
            capacity: 4,
            routing: {
              statuses: ["active"],
              kinds: ["agent"],
              recentWeight: 0,
              teamWeight: 0.9,
            },
          },
          {
            id: "ops",
            role: "ops",
            capacity: 4,
            routing: {
              statuses: ["active"],
              kinds: ["agent"],
              recentWeight: 0,
              teamWeight: 0.9,
            },
          },
          {
            id: "build",
            routing: {
              statuses: ["offline"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "spawn",
            routing: {
              statuses: ["offline"],
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

    const openAiRooms = result.placements
      .filter((placement) => placement.entity.id.startsWith("team-openai"))
      .map((placement) => placement.roomId);
    const anthropicRoom = result.placements.find((placement) =>
      placement.entity.id.startsWith("team-anthropic"),
    )?.roomId;

    expect(new Set(openAiRooms).size).toBe(1);
    expect(anthropicRoom).toBe("ops");
  });

  it("reports overlap pairs from explicit collision checks", () => {
    const first = makeEntity({
      id: "agent-overlap-a",
      agentId: "agent-overlap-a",
      label: "Overlap A",
      status: "active",
    });
    const second = makeEntity({
      id: "agent-overlap-b",
      agentId: "agent-overlap-b",
      label: "Overlap B",
      status: "active",
    });
    const collisions = detectPlacementCollisions([
      {
        entity: first,
        roomId: "ops",
        targetRoomId: "ops",
        x: 220,
        y: 220,
        overflowed: false,
      },
      {
        entity: second,
        roomId: "ops",
        targetRoomId: "ops",
        x: 230,
        y: 225,
        overflowed: false,
      },
    ]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.roomId).toBe("ops");
    expect(collisions[0]?.intersectionArea).toBeGreaterThan(0);
  });

  it("resolves placement collisions within a room and reports zero overlap pairs", () => {
    const entities = Array.from({ length: 10 }, (_, index) =>
      makeEntity({
        id: `agent-packed-${index + 1}`,
        agentId: `agent-packed-${index + 1}`,
        label: `Packed Agent ${index + 1}`,
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
            width: 460,
            height: 250,
            capacity: 12,
            spacing: { x: 64, y: 52 },
            routing: { statuses: ["active"], kinds: ["agent"], recentWeight: 0 },
          },
          {
            id: "ops",
            routing: {
              statuses: ["offline"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "build",
            routing: {
              statuses: ["offline"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "spawn",
            routing: {
              statuses: ["offline"],
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

    expect(result.collisionPairs).toHaveLength(0);
    expect(result.roomDebug.get("strategy")?.collisionPairs).toBe(0);
  });

  it("honors manual room override hints", () => {
    const entity = makeEntity({
      id: "agent-manual-override",
      agentId: "agent-manual-override",
      label: "Manual Override",
      status: "active",
      task: "investigate queue drift [room:build]",
    });

    const result = buildPlacements({
      entities: [entity],
      generatedAt: 1_000_000,
      zoneConfig: {
        rooms: [
          {
            id: "strategy",
            routing: {
              statuses: ["active"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "ops",
            routing: {
              statuses: ["offline"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "build",
            routing: {
              statuses: ["offline"],
              kinds: ["agent"],
              recentWeight: 0,
            },
          },
          {
            id: "spawn",
            routing: {
              statuses: ["offline"],
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

    expect(result.placements[0]?.roomId).toBe("build");
    expect(result.placements[0]?.targetRoomId).toBe("build");
    expect(result.roomDebug.get("build")?.manualOverrides).toBe(1);
  });

  it("auto-distributes local50 agents under room capacities", () => {
    const { snapshot } = createLocal50Scenario({ profile: "local50", seed: 19 });
    const agents = snapshot.entities.filter((entity) => entity.kind === "agent");

    const result = buildPlacements({
      entities: agents,
      generatedAt: snapshot.generatedAt,
    });

    const debug = [...result.roomDebug.values()];
    expect(debug.every((entry) => entry.assigned <= entry.capacity)).toBe(true);
    expect(debug.some((entry) => entry.overflowOut > 0)).toBe(true);
    // With higher lounge capacity (28), entities concentrate more in fewer rooms
    // Expect at least 3 rooms to have entities (was 4 before capacity increase)
    expect(debug.filter((entry) => entry.assigned > 0).length).toBeGreaterThanOrEqual(3);
  });
});
