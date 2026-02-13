import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { buildPlacements, getRooms } from "../lib/layout";
import type { OfficeEntity, OfficeRun, OfficeSnapshot } from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
};

// Entity and overlay are rendered separately for independent depth control.
type StageLayer = "floor" | "wall" | "object";

type TileSourceSpec = {
  atlas: string;
  tileSize: number;
  spacing: number;
};

type TileRef = {
  id: string;
  source: string;
  col: number;
  row: number;
};

type TileCatalog = {
  atlas: string;
  tileSize: number;
  spacing: number;
  col: number;
  row: number;
};

type ManifestShape = {
  sources?: Record<string, { tileSize?: unknown; spacing?: unknown }>;
  tileset?: { tiles?: Array<{ id?: string; source?: string; col?: number; row?: number }> };
};

type LayerTile = {
  id: string;
  roomId: string;
  layer: StageLayer;
  x: number;
  y: number;
  z: number;
  sprite: TileCatalog;
};

type OcclusionBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const DEFAULT_SOURCES: Record<string, TileSourceSpec> = {
  city: {
    atlas: "/assets/kenney/tiles/city_tilemap.png",
    tileSize: 16,
    spacing: 0,
  },
  interior: {
    atlas: "/assets/kenney/interior/interior_tilemap.png",
    tileSize: 16,
    spacing: 1,
  },
  urban: {
    atlas: "/assets/kenney/urban/urban_tilemap.png",
    tileSize: 16,
    spacing: 0,
  },
};

const FALLBACK_TILE_REFS: TileRef[] = [
  { id: "floor_lobby", source: "city", col: 9, row: 1 },
  { id: "floor_office", source: "city", col: 5, row: 1 },
  { id: "floor_meeting", source: "city", col: 9, row: 2 },
  { id: "floor_lounge", source: "city", col: 13, row: 1 },
  { id: "floor_arcade", source: "city", col: 16, row: 19 },
  { id: "wall_brick", source: "city", col: 1, row: 5 },
  { id: "wall_stone", source: "city", col: 5, row: 5 },
  { id: "wall_glass", source: "city", col: 17, row: 6 },
  { id: "wall_indoor", source: "city", col: 21, row: 16 },
  { id: "bench", source: "city", col: 11, row: 11 },
  { id: "potted_plant", source: "city", col: 17, row: 1 },
  { id: "streetlamp", source: "city", col: 1, row: 11 },
];

const ROOM_SKINS: Record<string, { floor: string; wall: string; object: string }> = {
  strategy: { floor: "floor_meeting", wall: "wall_glass", object: "streetlamp" },
  ops: { floor: "floor_office", wall: "wall_indoor", object: "bench" },
  build: { floor: "floor_lobby", wall: "wall_stone", object: "streetlamp" },
  spawn: { floor: "floor_arcade", wall: "wall_brick", object: "bench" },
  lounge: { floor: "floor_lounge", wall: "wall_indoor", object: "potted_plant" },
};

const FLOOR_Z_OFFSET = 40;
const WALL_Z_OFFSET = 190;
const OBJECT_Z_OFFSET = 230;
const ENTITY_Z_OFFSET = 320;

const MIN_GRID_COLS = 4;
const MIN_GRID_ROWS = 3;
const ROOM_GRID_COL_STRIDE = 58;
const ROOM_GRID_ROW_STRIDE = 52;

const TILE_HALF_X = 16;
const TILE_HALF_Y = 8;
const ROOM_ORIGIN_Y_OFFSET = 30;
const WALL_TOP_Y_OFFSET = 18;
const WALL_LEFT_Y_OFFSET = 8;
const OBJECT_Y_OFFSET = 10;

const OBJECT_SLOT_ONE_COL_RATIO = 0.28;
const OBJECT_SLOT_ONE_ROW_RATIO = 0.45;
const OBJECT_SLOT_TWO_COL_RATIO = 0.7;
const OBJECT_SLOT_TWO_ROW_RATIO = 0.56;

const OCCLUSION_HORIZONTAL_INSET = 24;
const OCCLUSION_TOP_OFFSET = 14;
const OCCLUSION_BOTTOM_RATIO = 0.43;

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function statusClass(entity: OfficeEntity) {
  if (entity.status === "active") {
    return "is-active";
  }
  if (entity.status === "idle") {
    return "is-idle";
  }
  if (entity.status === "error") {
    return "is-error";
  }
  if (entity.status === "ok") {
    return "is-ok";
  }
  return "is-offline";
}

function runLineClass(run: OfficeRun) {
  if (run.status === "error") {
    return "run-error";
  }
  if (run.status === "ok") {
    return "run-ok";
  }
  return "run-active";
}

function spriteStyle(entityId: string) {
  const framesPerRow = 54;
  const frameSize = 16;
  const spacing = 1;
  const maxRows = 12;
  const totalFrames = framesPerRow * maxRows;
  const frame = hashString(entityId) % totalFrames;
  const col = frame % framesPerRow;
  const row = Math.floor(frame / framesPerRow);
  const stride = frameSize + spacing;

  return {
    backgroundImage: 'url("/assets/kenney/characters/characters_spritesheet.png")',
    backgroundPosition: `-${col * stride}px -${row * stride}px`,
  };
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

function buildTileCatalog(manifest: ManifestShape | null) {
  const sourceSpecs = new Map<string, TileSourceSpec>();
  for (const [source, spec] of Object.entries(DEFAULT_SOURCES)) {
    const manifestSpec = manifest?.sources?.[source];
    const manifestTileSize = toFiniteNumber(manifestSpec?.tileSize);
    const manifestSpacing = toFiniteNumber(manifestSpec?.spacing);
    sourceSpecs.set(source, {
      atlas: spec.atlas,
      tileSize: manifestTileSize ?? spec.tileSize,
      spacing: manifestSpacing ?? spec.spacing,
    });
  }

  const refs: TileRef[] = [];
  const manifestTiles = manifest?.tileset?.tiles;
  if (Array.isArray(manifestTiles)) {
    for (const tile of manifestTiles) {
      if (
        typeof tile.id === "string" &&
        typeof tile.source === "string" &&
        typeof tile.col === "number" &&
        typeof tile.row === "number"
      ) {
        refs.push({
          id: tile.id,
          source: tile.source,
          col: tile.col,
          row: tile.row,
        });
      }
    }
  }

  for (const fallback of FALLBACK_TILE_REFS) {
    if (!refs.some((ref) => ref.id === fallback.id)) {
      refs.push(fallback);
    }
  }

  const catalog = new Map<string, TileCatalog>();
  for (const ref of refs) {
    const source = sourceSpecs.get(ref.source) ?? DEFAULT_SOURCES.city;
    catalog.set(ref.id, {
      atlas: source.atlas,
      tileSize: source.tileSize,
      spacing: source.spacing,
      col: ref.col,
      row: ref.row,
    });
  }

  return catalog;
}

function buildLayerTiles(params: {
  rooms: ReturnType<typeof getRooms>;
  tileCatalog: Map<string, TileCatalog>;
}) {
  const { rooms, tileCatalog } = params;
  const tiles: LayerTile[] = [];
  const occlusionByRoom = new Map<string, OcclusionBounds>();

  for (const room of rooms) {
    const skin = ROOM_SKINS[room.id] ?? ROOM_SKINS.ops;
    const floorTile = tileCatalog.get(skin.floor) ?? tileCatalog.get("floor_office");
    const wallTile = tileCatalog.get(skin.wall) ?? tileCatalog.get("wall_indoor");
    const objectTile = tileCatalog.get(skin.object) ?? tileCatalog.get("bench");

    if (!floorTile || !wallTile || !objectTile) {
      continue;
    }

    const cols = Math.max(MIN_GRID_COLS, Math.floor(room.width / ROOM_GRID_COL_STRIDE));
    const rows = Math.max(MIN_GRID_ROWS, Math.floor(room.height / ROOM_GRID_ROW_STRIDE));
    const originX = room.x + room.width / 2;
    const originY = room.y + ROOM_ORIGIN_Y_OFFSET;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = originX + (col - row) * TILE_HALF_X;
        const y = originY + (col + row) * TILE_HALF_Y;
        tiles.push({
          id: `${room.id}:floor:${row}:${col}`,
          roomId: room.id,
          layer: "floor",
          x,
          y,
          z: FLOOR_Z_OFFSET + Math.round(y),
          sprite: floorTile,
        });
      }
    }

    for (let col = 0; col < cols; col += 1) {
      const x = originX + (col + 1) * TILE_HALF_X;
      const y = originY + col * TILE_HALF_Y - WALL_TOP_Y_OFFSET;
      tiles.push({
        id: `${room.id}:wall:top:${col}`,
        roomId: room.id,
        layer: "wall",
        x,
        y,
        z: WALL_Z_OFFSET + Math.round(y),
        sprite: wallTile,
      });
    }

    for (let row = 0; row < rows; row += 1) {
      const x = originX - (row + 1) * TILE_HALF_X;
      const y = originY + row * TILE_HALF_Y - WALL_LEFT_Y_OFFSET;
      tiles.push({
        id: `${room.id}:wall:left:${row}`,
        roomId: room.id,
        layer: "wall",
        x,
        y,
        z: WALL_Z_OFFSET + Math.round(y),
        sprite: wallTile,
      });
    }

    const objectSlots: Array<[number, number]> = [
      [
        Math.max(1, Math.floor(cols * OBJECT_SLOT_ONE_COL_RATIO)),
        Math.max(1, Math.floor(rows * OBJECT_SLOT_ONE_ROW_RATIO)),
      ],
      [
        Math.max(2, Math.floor(cols * OBJECT_SLOT_TWO_COL_RATIO)),
        Math.max(1, Math.floor(rows * OBJECT_SLOT_TWO_ROW_RATIO)),
      ],
    ];

    objectSlots.forEach(([col, row], index) => {
      const x = originX + (col - row) * TILE_HALF_X;
      const y = originY + (col + row) * TILE_HALF_Y - OBJECT_Y_OFFSET;
      tiles.push({
        id: `${room.id}:object:${index}`,
        roomId: room.id,
        layer: "object",
        x,
        y,
        z: OBJECT_Z_OFFSET + Math.round(y),
        sprite: objectTile,
      });
    });

    occlusionByRoom.set(room.id, {
      left: room.x + OCCLUSION_HORIZONTAL_INSET,
      right: room.x + room.width - OCCLUSION_HORIZONTAL_INSET,
      top: room.y + OCCLUSION_TOP_OFFSET,
      bottom: room.y + room.height * OCCLUSION_BOTTOM_RATIO,
    });
  }

  tiles.sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z;
    }
    return a.id.localeCompare(b.id);
  });

  return { tiles, occlusionByRoom };
}

function tileStyle(tile: LayerTile): CSSProperties {
  const stride = tile.sprite.tileSize + tile.sprite.spacing;
  return {
    left: tile.x,
    top: tile.y,
    zIndex: tile.z,
    backgroundImage: `url("${tile.sprite.atlas}")`,
    backgroundPosition: `-${tile.sprite.col * stride}px -${tile.sprite.row * stride}px`,
  };
}

export function OfficeStage({ snapshot }: Props) {
  const rooms = useMemo(() => getRooms(), []);
  const placements = useMemo(() => buildPlacements(snapshot.entities), [snapshot.entities]);

  const [manifest, setManifest] = useState<ManifestShape | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadManifest = async () => {
      try {
        const response = await fetch("/assets/kenney/kenney-curation.json", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as ManifestShape;
        if (!cancelled) {
          setManifest(payload);
        }
      } catch (error) {
        console.error("Failed to load Kenney manifest, using fallback tiles.", error);
        // fallback tile catalog is used when manifest fetch fails
      }
    };

    void loadManifest();
    return () => {
      cancelled = true;
    };
  }, []);

  const tileCatalog = useMemo(() => buildTileCatalog(manifest), [manifest]);

  const layerState = useMemo(
    () => buildLayerTiles({ rooms, tileCatalog }),
    [rooms, tileCatalog],
  );

  const tilesByLayer = useMemo(() => {
    const grouped: Record<StageLayer, LayerTile[]> = {
      floor: [],
      wall: [],
      object: [],
    };
    for (const tile of layerState.tiles) {
      grouped[tile.layer].push(tile);
    }
    return grouped;
  }, [layerState.tiles]);

  const placementById = useMemo(() => {
    const map = new Map<string, (typeof placements)[number]>();
    for (const placement of placements) {
      map.set(placement.entity.id, placement);
      if (placement.entity.kind === "agent") {
        map.set(`agent:${placement.entity.agentId}`, placement);
      }
    }
    return map;
  }, [placements]);

  const sortedPlacements = useMemo(
    () => [...placements].sort((a, b) => a.y - b.y),
    [placements],
  );

  const runLinks = useMemo(() => {
    return snapshot.runs
      .filter((run) => run.status !== "ok" && run.status !== "error")
      .map((run) => {
        const source = placementById.get(`agent:${run.parentAgentId}`);
        const target = placementById.get(`subagent:${run.runId}`);
        if (!source || !target) {
          return null;
        }

        const sx = source.x;
        const sy = source.y;
        const tx = target.x;
        const ty = target.y;
        const cx = (sx + tx) / 2;
        const cy = Math.min(sy, ty) - 42;

        return {
          id: `${run.runId}:${sx}:${sy}:${tx}:${ty}`,
          cls: runLineClass(run),
          d: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`,
        };
      })
      .filter((value): value is { id: string; cls: string; d: string } => Boolean(value));
  }, [snapshot.runs, placementById]);

  return (
    <div className="office-stage-wrap">
      <div className="office-stage-grid" />

      <div className="iso-layer layer-floor" aria-hidden="true">
        {tilesByLayer.floor.map((tile) => (
          <span key={tile.id} className="iso-tile layer-floor" style={tileStyle(tile)} />
        ))}
      </div>

      <div className="iso-layer layer-wall" aria-hidden="true">
        {tilesByLayer.wall.map((tile) => (
          <span key={tile.id} className="iso-tile layer-wall" style={tileStyle(tile)} />
        ))}
      </div>

      <div className="iso-layer layer-object" aria-hidden="true">
        {tilesByLayer.object.map((tile) => (
          <span key={tile.id} className="iso-tile layer-object" style={tileStyle(tile)} />
        ))}
      </div>

      <svg className="office-lines" viewBox="0 0 980 660" preserveAspectRatio="none" aria-hidden>
        {runLinks.map((link) => (
          <path key={link.id} className={`run-link ${link.cls}`} d={link.d} />
        ))}
      </svg>

      {rooms.map((room) => (
        <section
          key={room.id}
          className="office-room"
          style={{
            left: room.x,
            top: room.y,
            width: room.width,
            height: room.height,
            background: room.fill,
            borderColor: room.border,
          }}
        >
          <header>{room.label}</header>
          <div className="shape-tag">{room.shape}</div>
        </section>
      ))}

      {sortedPlacements.map((placement) => {
        const entity = placement.entity;
        const occlusion = layerState.occlusionByRoom.get(placement.roomId);
        const isOccluded = occlusion
          ? placement.x >= occlusion.left &&
            placement.x <= occlusion.right &&
            placement.y >= occlusion.top &&
            placement.y <= occlusion.bottom
          : false;

        return (
          <article
            key={entity.id}
            className={`entity-token ${statusClass(entity)} ${entity.kind} ${isOccluded ? "is-occluded" : ""}`}
            style={{ left: placement.x, top: placement.y, zIndex: ENTITY_Z_OFFSET + Math.round(placement.y) }}
          >
            <div className="sprite-shell">
              <div className="sprite" style={spriteStyle(entity.id)} />
              <div className="sprite-fallback">{entity.kind === "agent" ? "A" : "S"}</div>
            </div>
            <div className="token-meta">
              <strong>{entity.label}</strong>
              <span>
                {entity.kind === "agent"
                  ? `${entity.sessions} session${entity.sessions === 1 ? "" : "s"}`
                  : entity.status}
              </span>
            </div>
            {entity.bubble ? <p className="bubble">{entity.bubble}</p> : null}
          </article>
        );
      })}
    </div>
  );
}
