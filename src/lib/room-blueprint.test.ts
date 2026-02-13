import { describe, expect, it } from "vitest";
import type { RoomSpec } from "./layout";
import { compileRoomBlueprintLayers, type TileSprite } from "./room-blueprint";

function makeRoom(id: string): RoomSpec {
  return {
    id,
    label: id,
    shape: "grid",
    role: "ops",
    x: 100,
    y: 100,
    width: 360,
    height: 220,
    fill: "#000",
    border: "#fff",
    capacity: 8,
    spacing: { x: 48, y: 32 },
    anchor: { x: 0.5, y: 0.5 },
    routing: {
      statuses: ["active", "idle", "ok", "error", "offline"],
      kinds: ["agent", "subagent"],
      recentWeight: 0.2,
    },
  };
}

function makeTileCatalog() {
  const sprite = (id: number): TileSprite => ({
    atlas: `/atlas/${id}.png`,
    tileSize: 16,
    spacing: 0,
    col: id,
    row: 0,
  });
  return new Map<string, TileSprite>([
    ["floor_office", sprite(1)],
    ["wall_indoor", sprite(2)],
    ["bench", sprite(3)],
    ["door_open", sprite(4)],
    ["floor_meeting", sprite(5)],
    ["wall_glass", sprite(6)],
    ["streetlamp", sprite(7)],
    ["floor_lobby", sprite(8)],
    ["wall_stone", sprite(9)],
    ["floor_arcade", sprite(10)],
    ["wall_brick", sprite(11)],
    ["floor_lounge", sprite(12)],
    ["potted_plant", sprite(13)],
  ]);
}

describe("compileRoomBlueprintLayers", () => {
  it("compiles blueprint into floor/wall/object layers", () => {
    const room = makeRoom("ops");
    const result = compileRoomBlueprintLayers({
      rawBlueprint: {
        rooms: [
          {
            roomId: "ops",
            anchors: [
              { id: "furn-a", kind: "furniture", colRatio: 0.3, rowRatio: 0.4 },
              { id: "door-a", kind: "door", edge: "left", rowRatio: 0.5 },
            ],
          },
        ],
      },
      rooms: [room],
      tileCatalog: makeTileCatalog(),
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.tiles.some((tile) => tile.layer === "floor")).toBe(true);
    expect(result.tiles.some((tile) => tile.layer === "wall")).toBe(true);
    expect(result.tiles.some((tile) => tile.id === "ops:anchor:furn-a")).toBe(true);
    expect(result.occlusionByRoom.has("ops")).toBe(true);
  });

  it("detects out-of-bounds and anchor collision", () => {
    const result = compileRoomBlueprintLayers({
      rawBlueprint: {
        rooms: [
          {
            roomId: "ops",
            generateFloor: false,
            generateWalls: false,
            anchors: [
              { id: "bad", kind: "furniture", col: 99, row: 0 },
              { id: "door-a", kind: "door", edge: "top", col: 0 },
              { id: "door-b", kind: "door", edge: "top", col: 0 },
            ],
          },
        ],
      },
      rooms: [makeRoom("ops")],
      tileCatalog: makeTileCatalog(),
    });

    const codes = result.diagnostics.map((item) => item.code);
    expect(codes).toContain("BLUEPRINT_ANCHOR_OUT_OF_BOUNDS");
    expect(codes).toContain("BLUEPRINT_ANCHOR_COLLISION");
  });

  it("detects unknown room definitions and empty room output", () => {
    const result = compileRoomBlueprintLayers({
      rawBlueprint: {
        rooms: [
          {
            roomId: "ghost-room",
            anchors: [{ id: "x", kind: "furniture", col: 0, row: 0 }],
          },
          {
            roomId: "ops",
            generateFloor: false,
            generateWalls: false,
            anchors: [],
          },
        ],
      },
      rooms: [makeRoom("ops")],
      tileCatalog: makeTileCatalog(),
    });

    const codes = result.diagnostics.map((item) => item.code);
    expect(codes).toContain("BLUEPRINT_ROOM_UNKNOWN");
    expect(codes).toContain("BLUEPRINT_ROOM_EMPTY");
  });
});
