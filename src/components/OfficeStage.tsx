import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildPlacements } from "../lib/layout";
import { compileRoomBlueprintLayers } from "../lib/room-blueprint";
import { indexRunsById } from "../lib/run-graph";
import { applySemanticRoomMappings, buildSemanticAssetRegistry } from "../lib/semantic-room-mapping";
import type { OfficeEntity, OfficeRun, OfficeSnapshot } from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
  selectedEntityId?: string | null;
  highlightRunId?: string | null;
  highlightAgentId?: string | null;
  filterEntityIds?: string[];
  hasEntityFilter?: boolean;
  roomFilterId?: string;
  focusMode?: boolean;
  onRoomOptionsChange?: (roomIds: string[]) => void;
  onFilterMatchCountChange?: (count: number) => void;
  onSelectEntity?: (entityId: string) => void;
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

const ENTITY_Z_OFFSET = 320;

const SPAWN_PULSE_WINDOW_MS = 12_000;
const BUBBLE_VISIBLE_WINDOW_MS = 45_000;
const RUN_RECENT_WINDOW_MS = 10_000;
const RUN_STALE_WINDOW_MS = 120_000;
const START_ORBIT_WINDOW_MS = 12_000;
const END_SETTLE_WINDOW_MS = 20_000;
const CLEANUP_FADE_WINDOW_MS = 30_000;
const ERROR_SHAKE_WINDOW_MS = 18_000;

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

export function OfficeStage({
  snapshot,
  selectedEntityId = null,
  highlightRunId = null,
  highlightAgentId = null,
  filterEntityIds = [],
  hasEntityFilter = false,
  roomFilterId = "all",
  focusMode = false,
  onRoomOptionsChange,
  onFilterMatchCountChange,
  onSelectEntity,
}: Props) {
  const [manifest, setManifest] = useState<ManifestShape | null>(null);
  const [zoneConfig, setZoneConfig] = useState<unknown>(null);
  const [roomBlueprint, setRoomBlueprint] = useState<unknown>(null);
  const previousRoomOptionsKeyRef = useRef("");
  const previousBlueprintDiagnosticKeyRef = useRef("");

  const layoutState = useMemo(
    () =>
      buildPlacements({
        entities: snapshot.entities,
        generatedAt: snapshot.generatedAt,
        zoneConfig,
      }),
    [snapshot.entities, snapshot.generatedAt, zoneConfig],
  );

  const rooms = layoutState.rooms;
  const placements = layoutState.placements;
  const filteredEntityIdSet = useMemo(() => new Set(filterEntityIds), [filterEntityIds]);
  const normalizedRoomFilterId =
    roomFilterId.trim() !== "" && roomFilterId !== "all" ? roomFilterId : null;
  const hasRoomFilter = Boolean(normalizedRoomFilterId);
  const hasOpsFilter = hasEntityFilter || hasRoomFilter;

  useEffect(() => {
    if (!onRoomOptionsChange) {
      return;
    }
    const roomIds = [...rooms.map((room) => room.id)].sort((a, b) => a.localeCompare(b));
    const roomOptionsKey = roomIds.join(",");
    if (roomOptionsKey === previousRoomOptionsKeyRef.current) {
      return;
    }
    previousRoomOptionsKeyRef.current = roomOptionsKey;
    onRoomOptionsChange(roomIds);
  }, [onRoomOptionsChange, rooms]);

  const matchedEntityCount = useMemo(() => {
    let count = 0;
    for (const placement of placements) {
      const entity = placement.entity;
      const matchesEntityFilter = !hasEntityFilter || filteredEntityIdSet.has(entity.id);
      const matchesRoomFilter =
        !normalizedRoomFilterId || placement.roomId === normalizedRoomFilterId;
      if (matchesEntityFilter && matchesRoomFilter) {
        count += 1;
      }
    }
    return count;
  }, [filteredEntityIdSet, hasEntityFilter, normalizedRoomFilterId, placements]);

  useEffect(() => {
    if (!onFilterMatchCountChange) {
      return;
    }
    onFilterMatchCountChange(matchedEntityCount);
  }, [matchedEntityCount, onFilterMatchCountChange]);

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

  useEffect(() => {
    let cancelled = false;

    const loadZoneConfig = async () => {
      try {
        const response = await fetch("/assets/layout/zone-config.json", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as unknown;
        if (!cancelled) {
          setZoneConfig(payload);
        }
      } catch (error) {
        console.error("Failed to load zone config, using default layout policy.", error);
      }
    };

    void loadZoneConfig();
    const intervalId = window.setInterval(() => {
      void loadZoneConfig();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadRoomBlueprint = async () => {
      try {
        const response = await fetch("/assets/layout/room-blueprint.json", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as unknown;
        if (!cancelled) {
          setRoomBlueprint(payload);
        }
      } catch (error) {
        console.error("Failed to load room blueprint, using default room compiler blueprint.", error);
      }
    };

    void loadRoomBlueprint();
    const intervalId = window.setInterval(() => {
      void loadRoomBlueprint();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const tileCatalog = useMemo(() => buildTileCatalog(manifest), [manifest]);
  const semanticRegistry = useMemo(() => buildSemanticAssetRegistry(manifest), [manifest]);
  const mappedBlueprint = useMemo(
    () =>
      applySemanticRoomMappings({
        rawBlueprint: roomBlueprint,
        registry: semanticRegistry,
      }),
    [roomBlueprint, semanticRegistry],
  );

  const layerState = useMemo(() => {
    const compiled = compileRoomBlueprintLayers({
      rawBlueprint: mappedBlueprint.blueprint,
      rooms,
      tileCatalog,
    });
    return {
      ...compiled,
      diagnostics: [...mappedBlueprint.diagnostics, ...compiled.diagnostics],
    };
  }, [mappedBlueprint, rooms, tileCatalog]);

  useEffect(() => {
    if (layerState.diagnostics.length === 0) {
      previousBlueprintDiagnosticKeyRef.current = "";
      return;
    }

    const signature = layerState.diagnostics
      .map((item) => `${item.code}:${item.roomId ?? ""}:${item.anchorId ?? ""}:${item.message}`)
      .join("|");
    if (signature === previousBlueprintDiagnosticKeyRef.current) {
      return;
    }
    previousBlueprintDiagnosticKeyRef.current = signature;
    console.warn("Room blueprint diagnostics", layerState.diagnostics);
  }, [layerState.diagnostics]);

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
      if (placement.entity.kind === "subagent" && placement.entity.runId) {
        map.set(`subagent:${placement.entity.runId}`, placement);
      }
    }
    return map;
  }, [placements]);

  const runById = useMemo(() => {
    return indexRunsById(snapshot.runs);
  }, [snapshot.runs]);

  const normalizedHighlightRunId =
    typeof highlightRunId === "string" && highlightRunId.trim().length > 0
      ? highlightRunId.trim()
      : null;
  const normalizedHighlightAgentId =
    typeof highlightAgentId === "string" && highlightAgentId.trim().length > 0
      ? highlightAgentId.trim()
      : null;
  const highlightedRun = normalizedHighlightRunId ? runById.get(normalizedHighlightRunId) : undefined;

  const sortedPlacements = useMemo(
    () => [...placements].sort((a, b) => a.y - b.y),
    [placements],
  );

  const runLinks = useMemo(() => {
    const hasTimelineHighlight = Boolean(normalizedHighlightRunId || normalizedHighlightAgentId);
    const runEdges = snapshot.runGraph.edges.filter((edge) => edge.kind === "runId");
    return runEdges
      .map((edge) => {
        const run = runById.get(edge.runId);
        if (!run) {
          return null;
        }
        if (run.status === "ok" || run.status === "error") {
          const highlightByRunId = normalizedHighlightRunId && run.runId === normalizedHighlightRunId;
          const highlightByAgentId =
            normalizedHighlightAgentId &&
            (run.parentAgentId === normalizedHighlightAgentId ||
              run.childAgentId === normalizedHighlightAgentId);
          if (!highlightByRunId && !highlightByAgentId) {
            return null;
          }
        }

        const source = placementById.get(edge.from);
        const target = placementById.get(edge.to);
        if (!source || !target) {
          return null;
        }
        const sourceMatchesOps =
          (!hasEntityFilter || filteredEntityIdSet.has(source.entity.id)) &&
          (!normalizedRoomFilterId || source.roomId === normalizedRoomFilterId);
        const targetMatchesOps =
          (!hasEntityFilter || filteredEntityIdSet.has(target.entity.id)) &&
          (!normalizedRoomFilterId || target.roomId === normalizedRoomFilterId);
        const linkMatchesOps = sourceMatchesOps && targetMatchesOps;
        if (hasOpsFilter && !focusMode && !linkMatchesOps) {
          return null;
        }

        const sx = source.x;
        const sy = source.y;
        const tx = target.x;
        const ty = target.y;
        const cx = (sx + tx) / 2;
        const cy = Math.min(sy, ty) - 42;
        const runStartedAt = run.startedAt ?? run.createdAt;
        const runAgeMs = Math.max(0, snapshot.generatedAt - runStartedAt);
        const lifecycleClass =
          runAgeMs <= RUN_RECENT_WINDOW_MS
            ? "run-recent"
            : runAgeMs >= RUN_STALE_WINDOW_MS
              ? "run-stale"
              : "";
        const isHighlighted =
          (normalizedHighlightRunId && run.runId === normalizedHighlightRunId) ||
          (normalizedHighlightAgentId &&
            (run.parentAgentId === normalizedHighlightAgentId ||
              run.childAgentId === normalizedHighlightAgentId));
        const isOpsHighlighted = hasOpsFilter && linkMatchesOps;
        const hasHighlight = isHighlighted || isOpsHighlighted;

        return {
          id: `${run.runId}:${sx}:${sy}:${tx}:${ty}`,
          cls: [
            runLineClass(run),
            lifecycleClass,
            hasHighlight ? "run-highlight" : "",
            hasTimelineHighlight && !isHighlighted ? "run-muted" : "",
            hasOpsFilter && focusMode && !linkMatchesOps ? "run-muted" : "",
          ]
            .filter(Boolean)
            .join(" "),
          d: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`,
        };
      })
      .filter((value): value is { id: string; cls: string; d: string } => Boolean(value));
  }, [
    normalizedHighlightAgentId,
    normalizedHighlightRunId,
    filteredEntityIdSet,
    focusMode,
    hasEntityFilter,
    hasOpsFilter,
    normalizedRoomFilterId,
    placementById,
    snapshot.generatedAt,
    snapshot.runGraph.edges,
    runById,
  ]);
  const hasTimelineHighlight = Boolean(normalizedHighlightRunId || normalizedHighlightAgentId);

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

      {rooms.map((room) => {
        const debug = layoutState.roomDebug.get(room.id);
        const overflowCount = (debug?.overflowIn ?? 0) + (debug?.overflowOut ?? 0);
        return (
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
            {debug ? (
              <div className={`zone-debug ${overflowCount > 0 ? "has-overflow" : ""}`} aria-hidden="true">
                <span>
                  cap {debug.assigned}/{debug.capacity}
                </span>
                <span>target {debug.targeted}</span>
                {debug.overflowOut > 0 ? <span>out +{debug.overflowOut}</span> : null}
                {debug.overflowIn > 0 ? <span>in +{debug.overflowIn}</span> : null}
              </div>
            ) : null}
          </section>
        );
      })}

      {sortedPlacements.map((placement) => {
        const entity = placement.entity;
        const occlusion = layerState.occlusionByRoom.get(placement.roomId);
        const isSelected = selectedEntityId === entity.id;
        const matchesEntityFilter = !hasEntityFilter || filteredEntityIdSet.has(entity.id);
        const matchesRoomFilter =
          !normalizedRoomFilterId || placement.roomId === normalizedRoomFilterId;
        const matchesOpsFilter = matchesEntityFilter && matchesRoomFilter;
        if (hasOpsFilter && !focusMode && !matchesOpsFilter && !isSelected) {
          return null;
        }
        const runHighlightMatch = normalizedHighlightRunId
          ? entity.kind === "subagent"
            ? entity.runId === normalizedHighlightRunId
            : highlightedRun
              ? highlightedRun.parentAgentId === entity.agentId ||
                highlightedRun.childAgentId === entity.agentId
              : false
          : false;
        const agentHighlightMatch = normalizedHighlightAgentId
          ? entity.agentId === normalizedHighlightAgentId ||
            entity.parentAgentId === normalizedHighlightAgentId
          : false;
        const isLinked = runHighlightMatch || agentHighlightMatch;
        const linkedRun =
          entity.kind === "subagent" && entity.runId ? runById.get(entity.runId) : undefined;
        const getAge = (timestamp?: number, fallback: number = Number.POSITIVE_INFINITY) =>
          typeof timestamp === "number" ? Math.max(0, snapshot.generatedAt - timestamp) : fallback;
        const entityAgeMs = getAge(entity.lastUpdatedAt);
        const spawnAgeMs = getAge(linkedRun?.createdAt, entityAgeMs);
        const runStartAt = linkedRun?.startedAt ?? linkedRun?.createdAt;
        const startAgeMs = getAge(runStartAt, entityAgeMs);
        const endAgeMs = getAge(linkedRun?.endedAt, entityAgeMs);
        const cleanupAgeMs = getAge(linkedRun?.cleanupCompletedAt);
        const showSpawnPulse =
          entity.kind === "subagent" && entity.status === "active" && spawnAgeMs <= SPAWN_PULSE_WINDOW_MS;
        const showStartOrbit =
          entity.status === "active" &&
          entity.kind === "subagent" &&
          startAgeMs <= START_ORBIT_WINDOW_MS;
        const showRunOrbit = entity.status === "active";
        const showErrorMotion = entity.status === "error" && entityAgeMs <= ERROR_SHAKE_WINDOW_MS;
        const showEndSettle = entity.kind === "subagent" && entity.status === "ok" && endAgeMs <= END_SETTLE_WINDOW_MS;
        const showCleanupFade =
          entity.kind === "subagent" &&
          entity.status === "ok" &&
          cleanupAgeMs <= CLEANUP_FADE_WINDOW_MS;
        const bubbleVisible =
          Boolean(entity.bubble) &&
          (entity.status === "active" ||
            entity.status === "error" ||
            entityAgeMs <= BUBBLE_VISIBLE_WINDOW_MS);
        const bubbleClass = spawnAgeMs <= SPAWN_PULSE_WINDOW_MS ? "is-fresh" : "is-calm";
        const isOccluded = occlusion
          ? placement.x >= occlusion.left &&
            placement.x <= occlusion.right &&
            placement.y >= occlusion.top &&
            placement.y <= occlusion.bottom
          : false;
        const motionClasses = [
          showSpawnPulse ? "motion-spawn" : "",
          showStartOrbit ? "motion-start" : "",
          showRunOrbit ? "motion-run" : "",
          showErrorMotion ? "motion-error" : "",
          showEndSettle ? "motion-end" : "",
          showCleanupFade ? "motion-cleanup" : "",
          placement.overflowed ? "is-overflowed" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const isMutedByTimeline = hasTimelineHighlight && !isLinked;
        const isMutedByFocus = hasOpsFilter && focusMode && !matchesOpsFilter;

        return (
          <article
            key={entity.id}
            className={`entity-token ${statusClass(entity)} ${entity.kind} ${isOccluded ? "is-occluded" : ""} ${motionClasses} ${
              isSelected ? "is-selected" : ""
            } ${isLinked ? "is-linked" : ""} ${hasOpsFilter && matchesOpsFilter ? "is-filter-hit" : ""} ${
              isMutedByFocus ? "is-filtered-out" : ""
            } ${isMutedByTimeline || isMutedByFocus ? "is-muted" : ""}`}
            style={{ left: placement.x, top: placement.y, zIndex: ENTITY_Z_OFFSET + Math.round(placement.y) }}
            role="button"
            tabIndex={0}
            aria-label={`Open detail panel for ${entity.label}`}
            aria-pressed={isSelected}
            onClick={() => {
              onSelectEntity?.(entity.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectEntity?.(entity.id);
              }
            }}
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
            {bubbleVisible ? <p className={`bubble ${bubbleClass}`}>{entity.bubble}</p> : null}
          </article>
        );
      })}
    </div>
  );
}
