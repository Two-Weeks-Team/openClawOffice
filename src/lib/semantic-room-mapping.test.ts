import { describe, expect, it } from "vitest";
import type { RoomSpec } from "./layout";
import { compileRoomBlueprintLayers, type TileSprite } from "./room-blueprint";
import {
  applySemanticRoomMappings,
  buildSemanticAssetRegistry,
  resolveSemanticTileId,
} from "./semantic-room-mapping";

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
    ["floor_arcade", sprite(10)],
    ["wall_brick", sprite(11)],
    ["bench", sprite(3)],
    ["door_open", sprite(4)],
  ]);
}

describe("semantic room mapping", () => {
  it("builds registry from curation tileset with fallback candidates", () => {
    const registry = buildSemanticAssetRegistry({
      tileset: {
        tiles: [{ id: "bench" }, { id: "streetlamp" }, { id: "potted_plant" }],
      },
    });

    expect(resolveSemanticTileId(registry, "desk_pair")).toBe("bench");
    expect(resolveSemanticTileId(registry, "corridor_lamp")).toBe("streetlamp");
    expect(resolveSemanticTileId(registry, "lounge_greenery")).toBe("potted_plant");
  });

  it("applies explicit semantic keys to anchors", () => {
    const registry = buildSemanticAssetRegistry({
      tileset: {
        tiles: [{ id: "bench" }, { id: "streetlamp" }],
      },
    });
    const mapped = applySemanticRoomMappings({
      rawBlueprint: {
        rooms: [
          {
            roomId: "ops",
            anchors: [{ id: "a1", kind: "furniture", semantic: "corridor_lamp" }],
          },
        ],
      },
      registry,
    });

    const firstAnchor = (mapped.blueprint as { rooms: Array<{ anchors: Array<{ tile?: string }> }> }).rooms[0]
      ?.anchors?.[0];
    expect(firstAnchor?.tile).toBe("streetlamp");
    expect(mapped.diagnostics).toHaveLength(0);
  });

  it("uses room presets and reports unknown semantic keys", () => {
    const registry = buildSemanticAssetRegistry({
      tileset: {
        tiles: [{ id: "bench" }, { id: "potted_plant" }],
      },
    });
    const mapped = applySemanticRoomMappings({
      rawBlueprint: {
        rooms: [
          {
            roomId: "lounge",
            anchors: [
              { id: "p1", kind: "furniture" },
              { id: "bad", kind: "furniture", semantic: "unknown_key" },
            ],
          },
        ],
      },
      registry,
    });

    const anchors = (mapped.blueprint as { rooms: Array<{ anchors: Array<{ tile?: string; semantic?: string }> }> })
      .rooms[0]?.anchors;
    expect(anchors?.[0]?.semantic).toBe("lounge_greenery");
    expect(anchors?.[0]?.tile).toBe("potted_plant");
    expect(mapped.diagnostics.map((item) => item.code)).toContain("SEMANTIC_KEY_UNKNOWN");
  });

  it("falls back to base furniture tile when resolved semantic tile sprite is missing", () => {
    const registry = buildSemanticAssetRegistry({
      tileset: {
        tiles: [{ id: "sign" }],
      },
    });
    const mapped = applySemanticRoomMappings({
      rawBlueprint: {
        rooms: [
          {
            roomId: "spawn",
            anchors: [
              {
                id: "spawn-furniture-a",
                kind: "furniture",
                semantic: "arcade_console",
                colRatio: 0.3,
                rowRatio: 0.46,
              },
            ],
          },
        ],
      },
      registry,
    });

    expect(mapped.diagnostics).toHaveLength(0);

    const compiled = compileRoomBlueprintLayers({
      rawBlueprint: mapped.blueprint,
      rooms: [makeRoom("spawn")],
      tileCatalog: makeTileCatalog(),
    });

    expect(compiled.diagnostics).toHaveLength(0);
    const anchorTile = compiled.tiles.find((tile) => tile.id === "spawn:anchor:spawn-furniture-a");
    expect(anchorTile?.sprite.col).toBe(3);
  });
});
