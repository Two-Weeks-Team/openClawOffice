import type { RoomSpec } from "./layout";

export type StageLayer = "floor" | "wall" | "object";

export type TileSprite = {
  atlas: string;
  tileSize: number;
  spacing: number;
  col: number;
  row: number;
};

export type BlueprintLayerTile<TSprite extends TileSprite> = {
  id: string;
  roomId: string;
  layer: StageLayer;
  x: number;
  y: number;
  z: number;
  sprite: TSprite;
};

export type BlueprintOcclusionBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type RoomBlueprintDiagnosticCode =
  | "BLUEPRINT_INVALID_ROOT"
  | "BLUEPRINT_ROOM_UNKNOWN"
  | "BLUEPRINT_ROOM_EMPTY"
  | "BLUEPRINT_ANCHOR_OUT_OF_BOUNDS"
  | "BLUEPRINT_ANCHOR_COLLISION"
  | "BLUEPRINT_TILE_MISSING";

export type RoomBlueprintDiagnostic = {
  level: "warning";
  code: RoomBlueprintDiagnosticCode;
  roomId?: string;
  anchorId?: string;
  message: string;
};

export type CompiledBlueprintLayers<TSprite extends TileSprite> = {
  tiles: BlueprintLayerTile<TSprite>[];
  occlusionByRoom: Map<string, BlueprintOcclusionBounds>;
  diagnostics: RoomBlueprintDiagnostic[];
};

type AnchorKind = "tile" | "wall" | "door" | "furniture";
type WallEdge = "top" | "left";

type RoomBlueprintAnchor = {
  id: string;
  kind: AnchorKind;
  edge?: WallEdge;
  col?: number;
  row?: number;
  colRatio?: number;
  rowRatio?: number;
  tile?: string;
};

type RoomBlueprintEntry = {
  roomId: string;
  generateFloor: boolean;
  generateWalls: boolean;
  base: {
    floorTile: string;
    wallTile: string;
    furnitureTile: string;
    doorTile: string;
  };
  anchors: RoomBlueprintAnchor[];
};

type RoomBlueprintConfig = {
  tileMetrics: {
    minGridCols: number;
    minGridRows: number;
    roomGridColStride: number;
    roomGridRowStride: number;
    tileHalfX: number;
    tileHalfY: number;
    originYOffset: number;
    wallTopYOffset: number;
    wallLeftYOffset: number;
    objectYOffset: number;
  };
  occlusion: {
    horizontalInset: number;
    topOffset: number;
    bottomRatio: number;
  };
  rooms: RoomBlueprintEntry[];
};

const FLOOR_Z_OFFSET = 40;
const WALL_Z_OFFSET = 190;
const OBJECT_Z_OFFSET = 230;

const DEFAULT_CONFIG: RoomBlueprintConfig = {
  tileMetrics: {
    minGridCols: 4,
    minGridRows: 3,
    roomGridColStride: 58,
    roomGridRowStride: 52,
    tileHalfX: 16,
    tileHalfY: 8,
    originYOffset: 30,
    wallTopYOffset: 18,
    wallLeftYOffset: 8,
    objectYOffset: 10,
  },
  occlusion: {
    horizontalInset: 24,
    topOffset: 14,
    bottomRatio: 0.43,
  },
  rooms: [
    {
      roomId: "strategy",
      generateFloor: true,
      generateWalls: true,
      base: {
        floorTile: "floor_meeting",
        wallTile: "wall_glass",
        furnitureTile: "streetlamp",
        doorTile: "door_open",
      },
      anchors: [
        {
          id: "strategy-furniture-a",
          kind: "furniture",
          colRatio: 0.28,
          rowRatio: 0.45,
        },
        {
          id: "strategy-furniture-b",
          kind: "furniture",
          colRatio: 0.7,
          rowRatio: 0.56,
        },
        {
          id: "strategy-door-top",
          kind: "door",
          edge: "top",
          colRatio: 0.36,
        },
      ],
    },
    {
      roomId: "ops",
      generateFloor: true,
      generateWalls: true,
      base: {
        floorTile: "floor_office",
        wallTile: "wall_indoor",
        furnitureTile: "bench",
        doorTile: "door_open",
      },
      anchors: [
        {
          id: "ops-furniture-a",
          kind: "furniture",
          colRatio: 0.26,
          rowRatio: 0.44,
        },
        {
          id: "ops-furniture-b",
          kind: "furniture",
          colRatio: 0.72,
          rowRatio: 0.58,
        },
        {
          id: "ops-door-left",
          kind: "door",
          edge: "left",
          rowRatio: 0.52,
        },
      ],
    },
    {
      roomId: "build",
      generateFloor: true,
      generateWalls: true,
      base: {
        floorTile: "floor_lobby",
        wallTile: "wall_stone",
        furnitureTile: "streetlamp",
        doorTile: "door_open",
      },
      anchors: [
        {
          id: "build-furniture-a",
          kind: "furniture",
          colRatio: 0.3,
          rowRatio: 0.45,
        },
        {
          id: "build-furniture-b",
          kind: "furniture",
          colRatio: 0.7,
          rowRatio: 0.58,
        },
      ],
    },
    {
      roomId: "spawn",
      generateFloor: true,
      generateWalls: true,
      base: {
        floorTile: "floor_arcade",
        wallTile: "wall_brick",
        furnitureTile: "bench",
        doorTile: "door_open",
      },
      anchors: [
        {
          id: "spawn-furniture-a",
          kind: "furniture",
          colRatio: 0.3,
          rowRatio: 0.46,
        },
        {
          id: "spawn-furniture-b",
          kind: "furniture",
          colRatio: 0.72,
          rowRatio: 0.56,
        },
        {
          id: "spawn-door-top",
          kind: "door",
          edge: "top",
          colRatio: 0.42,
        },
      ],
    },
    {
      roomId: "lounge",
      generateFloor: true,
      generateWalls: true,
      base: {
        floorTile: "floor_lounge",
        wallTile: "wall_indoor",
        furnitureTile: "potted_plant",
        doorTile: "door_open",
      },
      anchors: [
        {
          id: "lounge-furniture-a",
          kind: "furniture",
          colRatio: 0.26,
          rowRatio: 0.42,
        },
        {
          id: "lounge-furniture-b",
          kind: "furniture",
          colRatio: 0.73,
          rowRatio: 0.54,
        },
      ],
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isAnchorKind(value: unknown): value is AnchorKind {
  return value === "tile" || value === "wall" || value === "door" || value === "furniture";
}

function isWallEdge(value: unknown): value is WallEdge {
  return value === "top" || value === "left";
}

function normalizeTileMetrics(rawMetrics: unknown): RoomBlueprintConfig["tileMetrics"] {
  const fallback = DEFAULT_CONFIG.tileMetrics;
  const raw = isRecord(rawMetrics) ? rawMetrics : {};
  return {
    minGridCols: Math.max(1, Math.floor(toFiniteNumber(raw.minGridCols) ?? fallback.minGridCols)),
    minGridRows: Math.max(1, Math.floor(toFiniteNumber(raw.minGridRows) ?? fallback.minGridRows)),
    roomGridColStride: Math.max(12, toFiniteNumber(raw.roomGridColStride) ?? fallback.roomGridColStride),
    roomGridRowStride: Math.max(12, toFiniteNumber(raw.roomGridRowStride) ?? fallback.roomGridRowStride),
    tileHalfX: Math.max(1, toFiniteNumber(raw.tileHalfX) ?? fallback.tileHalfX),
    tileHalfY: Math.max(1, toFiniteNumber(raw.tileHalfY) ?? fallback.tileHalfY),
    originYOffset: toFiniteNumber(raw.originYOffset) ?? fallback.originYOffset,
    wallTopYOffset: toFiniteNumber(raw.wallTopYOffset) ?? fallback.wallTopYOffset,
    wallLeftYOffset: toFiniteNumber(raw.wallLeftYOffset) ?? fallback.wallLeftYOffset,
    objectYOffset: toFiniteNumber(raw.objectYOffset) ?? fallback.objectYOffset,
  };
}

function normalizeOcclusion(rawOcclusion: unknown): RoomBlueprintConfig["occlusion"] {
  const fallback = DEFAULT_CONFIG.occlusion;
  const raw = isRecord(rawOcclusion) ? rawOcclusion : {};
  return {
    horizontalInset: Math.max(0, toFiniteNumber(raw.horizontalInset) ?? fallback.horizontalInset),
    topOffset: Math.max(0, toFiniteNumber(raw.topOffset) ?? fallback.topOffset),
    bottomRatio: clamp(toFiniteNumber(raw.bottomRatio) ?? fallback.bottomRatio, 0, 1),
  };
}

function normalizeAnchor(rawAnchor: unknown, fallbackId: string): RoomBlueprintAnchor | undefined {
  const raw = isRecord(rawAnchor) ? rawAnchor : null;
  if (!raw) {
    return undefined;
  }
  if (!isAnchorKind(raw.kind)) {
    return undefined;
  }
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const edge = isWallEdge(raw.edge) ? raw.edge : undefined;
  const col = toFiniteNumber(raw.col);
  const row = toFiniteNumber(raw.row);
  const colRatio = toFiniteNumber(raw.colRatio);
  const rowRatio = toFiniteNumber(raw.rowRatio);
  const tile = typeof raw.tile === "string" && raw.tile.trim() ? raw.tile.trim() : undefined;

  return {
    id,
    kind: raw.kind,
    edge,
    col: col === undefined ? undefined : Math.floor(col),
    row: row === undefined ? undefined : Math.floor(row),
    colRatio: colRatio === undefined ? undefined : clamp(colRatio, 0, 1),
    rowRatio: rowRatio === undefined ? undefined : clamp(rowRatio, 0, 1),
    tile,
  };
}

function mergeRoomEntry(
  fallback: RoomBlueprintEntry,
  rawRoom: unknown,
): RoomBlueprintEntry | undefined {
  const raw = isRecord(rawRoom) ? rawRoom : null;
  if (!raw || typeof raw.roomId !== "string" || raw.roomId.trim() === "") {
    return undefined;
  }

  const roomId = raw.roomId.trim();
  const baseRaw = isRecord(raw.base) ? raw.base : {};
  const anchors: RoomBlueprintAnchor[] = [];
  const rawAnchors = Array.isArray(raw.anchors) ? raw.anchors : undefined;
  const hasRawAnchors = Array.isArray(rawAnchors);
  if (rawAnchors) {
    for (let anchorIndex = 0; anchorIndex < rawAnchors.length; anchorIndex += 1) {
      const normalized = normalizeAnchor(rawAnchors[anchorIndex], `${roomId}:anchor:${anchorIndex}`);
      if (normalized) {
        anchors.push(normalized);
      }
    }
  }

  return {
    roomId,
    generateFloor:
      typeof raw.generateFloor === "boolean" ? raw.generateFloor : fallback.generateFloor,
    generateWalls:
      typeof raw.generateWalls === "boolean" ? raw.generateWalls : fallback.generateWalls,
    base: {
      floorTile:
        typeof baseRaw.floorTile === "string" && baseRaw.floorTile.trim()
          ? baseRaw.floorTile.trim()
          : fallback.base.floorTile,
      wallTile:
        typeof baseRaw.wallTile === "string" && baseRaw.wallTile.trim()
          ? baseRaw.wallTile.trim()
          : fallback.base.wallTile,
      furnitureTile:
        typeof baseRaw.furnitureTile === "string" && baseRaw.furnitureTile.trim()
          ? baseRaw.furnitureTile.trim()
          : fallback.base.furnitureTile,
      doorTile:
        typeof baseRaw.doorTile === "string" && baseRaw.doorTile.trim()
          ? baseRaw.doorTile.trim()
          : fallback.base.doorTile,
    },
    anchors: hasRawAnchors ? anchors : fallback.anchors,
  };
}

function normalizeBlueprint(rawBlueprint: unknown): {
  config: RoomBlueprintConfig;
  providedRoomIds: Set<string>;
  diagnostics: RoomBlueprintDiagnostic[];
} {
  if (rawBlueprint === null || rawBlueprint === undefined) {
    return {
      config: DEFAULT_CONFIG,
      providedRoomIds: new Set<string>(),
      diagnostics: [],
    };
  }

  const diagnostics: RoomBlueprintDiagnostic[] = [];
  const rawRoot = isRecord(rawBlueprint) ? rawBlueprint : null;
  if (!rawRoot) {
    diagnostics.push({
      level: "warning",
      code: "BLUEPRINT_INVALID_ROOT",
      message: "room-blueprint root must be an object. Falling back to defaults.",
    });
    return {
      config: DEFAULT_CONFIG,
      providedRoomIds: new Set<string>(),
      diagnostics,
    };
  }

  const tileMetrics = normalizeTileMetrics(rawRoot.tileMetrics);
  const occlusion = normalizeOcclusion(rawRoot.occlusion);

  const defaultByRoom = new Map(DEFAULT_CONFIG.rooms.map((room) => [room.roomId, room]));
  const roomEntries = new Map<string, RoomBlueprintEntry>();
  const providedRoomIds = new Set<string>();
  for (const room of DEFAULT_CONFIG.rooms) {
    roomEntries.set(room.roomId, room);
  }

  if (Array.isArray(rawRoot.rooms)) {
    for (let index = 0; index < rawRoot.rooms.length; index += 1) {
      const rawEntry = rawRoot.rooms[index];
      const rawEntryRecord = isRecord(rawEntry) ? rawEntry : null;
      const roomId =
        rawEntryRecord && typeof rawEntryRecord.roomId === "string" ? rawEntryRecord.roomId.trim() : "";
      const fallback = defaultByRoom.get(roomId) ?? DEFAULT_CONFIG.rooms[0]!;
      const normalized = mergeRoomEntry(fallback, rawEntry);
      if (!normalized) {
        continue;
      }
      providedRoomIds.add(normalized.roomId);
      roomEntries.set(normalized.roomId, normalized);
    }
  }

  return {
    config: {
      tileMetrics,
      occlusion,
      rooms: [...roomEntries.values()],
    },
    providedRoomIds,
    diagnostics,
  };
}

function gridSize(room: RoomSpec, metrics: RoomBlueprintConfig["tileMetrics"]) {
  const cols = Math.max(metrics.minGridCols, Math.floor(room.width / metrics.roomGridColStride));
  const rows = Math.max(metrics.minGridRows, Math.floor(room.height / metrics.roomGridRowStride));
  return { cols, rows };
}

function resolveGridIndex(
  value: number | undefined,
  ratio: number | undefined,
  size: number,
): number | undefined {
  if (typeof value === "number") {
    return Math.floor(value);
  }
  if (typeof ratio === "number") {
    const capped = clamp(ratio, 0, 1);
    return Math.floor(capped * Math.max(0, size - 1));
  }
  return undefined;
}

function resolveSprite<TSprite extends TileSprite>(
  tileCatalog: Map<string, TSprite>,
  tileId: string,
  fallbackTileId: string,
): TSprite | undefined {
  return tileCatalog.get(tileId) ?? tileCatalog.get(fallbackTileId);
}

function anchorCollisionKey(anchor: RoomBlueprintAnchor, col: number | undefined, row: number | undefined): string {
  if (anchor.kind === "wall" || anchor.kind === "door") {
    const wallEdge = anchor.edge ?? "top";
    const axisValue = wallEdge === "top" ? col : row;
    return `${anchor.kind}:${wallEdge}:${axisValue ?? -1}`;
  }
  return `${anchor.kind}:${col ?? -1}:${row ?? -1}`;
}

export function compileRoomBlueprintLayers<TSprite extends TileSprite>(params: {
  rawBlueprint: unknown;
  rooms: RoomSpec[];
  tileCatalog: Map<string, TSprite>;
}): CompiledBlueprintLayers<TSprite> {
  const normalized = normalizeBlueprint(params.rawBlueprint);
  const diagnostics: RoomBlueprintDiagnostic[] = [...normalized.diagnostics];
  const roomBlueprintById = new Map(normalized.config.rooms.map((entry) => [entry.roomId, entry]));

  for (const roomId of normalized.providedRoomIds) {
    if (!params.rooms.some((room) => room.id === roomId)) {
      diagnostics.push({
        level: "warning",
        code: "BLUEPRINT_ROOM_UNKNOWN",
        roomId,
        message: `Blueprint room "${roomId}" is not present in active zone config and will be ignored.`,
      });
    }
  }

  const tiles: BlueprintLayerTile<TSprite>[] = [];
  const occlusionByRoom = new Map<string, BlueprintOcclusionBounds>();

  for (const room of params.rooms) {
    const blueprintEntry = roomBlueprintById.get(room.id) ?? DEFAULT_CONFIG.rooms[0]!;
    const metrics = normalized.config.tileMetrics;
    const { cols, rows } = gridSize(room, metrics);
    const originX = room.x + room.width / 2;
    const originY = room.y + metrics.originYOffset;
    const collisionSet = new Set<string>();

    const floorSprite = resolveSprite(
      params.tileCatalog,
      blueprintEntry.base.floorTile,
      "floor_office",
    );
    const wallSprite = resolveSprite(
      params.tileCatalog,
      blueprintEntry.base.wallTile,
      "wall_indoor",
    );
    const furnitureSprite = resolveSprite(
      params.tileCatalog,
      blueprintEntry.base.furnitureTile,
      "bench",
    );
    const doorSprite = resolveSprite(
      params.tileCatalog,
      blueprintEntry.base.doorTile,
      "door_open",
    );

    if (!blueprintEntry.generateFloor && !blueprintEntry.generateWalls && blueprintEntry.anchors.length === 0) {
      diagnostics.push({
        level: "warning",
        code: "BLUEPRINT_ROOM_EMPTY",
        roomId: room.id,
        message: `Room "${room.id}" has no generated layers and no anchors.`,
      });
    }

    if (blueprintEntry.generateFloor) {
      if (!floorSprite) {
        diagnostics.push({
          level: "warning",
          code: "BLUEPRINT_TILE_MISSING",
          roomId: room.id,
          message: `Missing floor tile "${blueprintEntry.base.floorTile}" for room "${room.id}".`,
        });
      } else {
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const x = originX + (col - row) * metrics.tileHalfX;
            const y = originY + (col + row) * metrics.tileHalfY;
            tiles.push({
              id: `${room.id}:floor:${row}:${col}`,
              roomId: room.id,
              layer: "floor",
              x,
              y,
              z: FLOOR_Z_OFFSET + Math.round(y),
              sprite: floorSprite,
            });
          }
        }
      }
    }

    if (blueprintEntry.generateWalls) {
      if (!wallSprite) {
        diagnostics.push({
          level: "warning",
          code: "BLUEPRINT_TILE_MISSING",
          roomId: room.id,
          message: `Missing wall tile "${blueprintEntry.base.wallTile}" for room "${room.id}".`,
        });
      } else {
        for (let col = 0; col < cols; col += 1) {
          const x = originX + (col + 1) * metrics.tileHalfX;
          const y = originY + col * metrics.tileHalfY - metrics.wallTopYOffset;
          tiles.push({
            id: `${room.id}:wall:top:${col}`,
            roomId: room.id,
            layer: "wall",
            x,
            y,
            z: WALL_Z_OFFSET + Math.round(y),
            sprite: wallSprite,
          });
        }
        for (let row = 0; row < rows; row += 1) {
          const x = originX - (row + 1) * metrics.tileHalfX;
          const y = originY + row * metrics.tileHalfY - metrics.wallLeftYOffset;
          tiles.push({
            id: `${room.id}:wall:left:${row}`,
            roomId: room.id,
            layer: "wall",
            x,
            y,
            z: WALL_Z_OFFSET + Math.round(y),
            sprite: wallSprite,
          });
        }
      }
    }

    for (const anchor of blueprintEntry.anchors) {
      const col = resolveGridIndex(anchor.col, anchor.colRatio, cols);
      const row = resolveGridIndex(anchor.row, anchor.rowRatio, rows);
      const collisionKey = anchorCollisionKey(anchor, col, row);
      if (collisionSet.has(collisionKey)) {
        diagnostics.push({
          level: "warning",
          code: "BLUEPRINT_ANCHOR_COLLISION",
          roomId: room.id,
          anchorId: anchor.id,
          message: `Anchor "${anchor.id}" collides with another anchor in room "${room.id}".`,
        });
        continue;
      }

      let x = 0;
      let y = 0;
      let z = 0;
      let layer: StageLayer = "object";
      let sprite: TSprite | undefined;

      if (anchor.kind === "tile" || anchor.kind === "furniture") {
        if (col === undefined || row === undefined || col < 0 || row < 0 || col >= cols || row >= rows) {
          diagnostics.push({
            level: "warning",
            code: "BLUEPRINT_ANCHOR_OUT_OF_BOUNDS",
            roomId: room.id,
            anchorId: anchor.id,
            message: `Anchor "${anchor.id}" is out of room bounds (${cols}x${rows}).`,
          });
          continue;
        }

        layer = anchor.kind === "tile" ? "floor" : "object";
        x = originX + (col - row) * metrics.tileHalfX;
        y =
          originY +
          (col + row) * metrics.tileHalfY +
          (anchor.kind === "furniture" ? -metrics.objectYOffset : 0);
        z = (anchor.kind === "tile" ? FLOOR_Z_OFFSET : OBJECT_Z_OFFSET) + Math.round(y);
        sprite =
          resolveSprite(
            params.tileCatalog,
            anchor.tile ?? (anchor.kind === "tile" ? blueprintEntry.base.floorTile : blueprintEntry.base.furnitureTile),
            anchor.kind === "tile" ? "floor_office" : "bench",
          ) ?? (anchor.kind === "tile" ? floorSprite : furnitureSprite);
      } else {
        const edge = anchor.edge ?? "top";
        const axis = edge === "top" ? col : row;
        const axisLimit = edge === "top" ? cols : rows;
        if (axis === undefined || axis < 0 || axis >= axisLimit) {
          diagnostics.push({
            level: "warning",
            code: "BLUEPRINT_ANCHOR_OUT_OF_BOUNDS",
            roomId: room.id,
            anchorId: anchor.id,
            message: `Anchor "${anchor.id}" edge index is out of bounds for room "${room.id}".`,
          });
          continue;
        }

        layer = "wall";
        if (edge === "top") {
          x = originX + (axis + 1) * metrics.tileHalfX;
          y = originY + axis * metrics.tileHalfY - metrics.wallTopYOffset;
        } else {
          x = originX - (axis + 1) * metrics.tileHalfX;
          y = originY + axis * metrics.tileHalfY - metrics.wallLeftYOffset;
        }
        z = WALL_Z_OFFSET + Math.round(y);
        const preferredTileId = anchor.tile ?? (anchor.kind === "door" ? blueprintEntry.base.doorTile : blueprintEntry.base.wallTile);
        const fallbackTileId = anchor.kind === "door" ? "door_open" : "wall_indoor";
        sprite =
          resolveSprite(params.tileCatalog, preferredTileId, fallbackTileId) ??
          (anchor.kind === "door" ? doorSprite : wallSprite);
      }

      if (!sprite) {
        diagnostics.push({
          level: "warning",
          code: "BLUEPRINT_TILE_MISSING",
          roomId: room.id,
          anchorId: anchor.id,
          message: `Anchor "${anchor.id}" references a missing tile.`,
        });
        continue;
      }

      collisionSet.add(collisionKey);
      tiles.push({
        id: `${room.id}:anchor:${anchor.id}`,
        roomId: room.id,
        layer,
        x,
        y,
        z,
        sprite,
      });
    }

    const occlusion = normalized.config.occlusion;
    occlusionByRoom.set(room.id, {
      left: room.x + occlusion.horizontalInset,
      right: room.x + room.width - occlusion.horizontalInset,
      top: room.y + occlusion.topOffset,
      bottom: room.y + room.height * occlusion.bottomRatio,
    });
  }

  tiles.sort((left, right) => {
    if (left.z !== right.z) {
      return left.z - right.z;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    tiles,
    occlusionByRoom,
    diagnostics,
  };
}
