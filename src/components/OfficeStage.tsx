import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildPlacements, type PlacementMode } from "../lib/layout";
import {
  compileRoomBlueprintLayers,
  type TileSprite,
  type TileStageLayer,
} from "../lib/room-blueprint";
import { indexRunsById } from "../lib/run-graph";
import { applySemanticRoomMappings, buildSemanticAssetRegistry } from "../lib/semantic-room-mapping";
import type { OfficeEntity, OfficeRun, OfficeSnapshot } from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
  selectedEntityId?: string | null;
  selectedEntityIds?: string[];
  pinnedEntityIds?: string[];
  watchedEntityIds?: string[];
  highlightRunId?: string | null;
  highlightAgentId?: string | null;
  filterEntityIds?: string[];
  hasEntityFilter?: boolean;
  roomFilterId?: string;
  focusMode?: boolean;
  placementMode?: PlacementMode;
  onRoomOptionsChange?: (roomIds: string[]) => void;
  onRoomAssignmentsChange?: (roomByAgentId: Map<string, string>) => void;
  onFilterMatchCountChange?: (count: number) => void;
  onSelectEntity?: (entityId: string, mode?: "single" | "toggle") => void;
};

type ResolvedTile = TileSprite;

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

type ManifestShape = {
  sources?: Record<string, { tileSize?: unknown; spacing?: unknown }>;
  tileset?: { tiles?: Array<{ id?: string; source?: string; col?: number; row?: number }> };
};

type LayerTile = {
  id: string;
  roomId: string;
  layer: TileStageLayer;
  x: number;
  y: number;
  z: number;
  sprite: ResolvedTile;
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
const STAGE_WIDTH = 980;
const STAGE_HEIGHT = 660;
const CAMERA_MIN_ZOOM = 0.72;
const CAMERA_MAX_ZOOM = 2.4;
const CAMERA_ZOOM_STEP = 0.16;

type CameraState = {
  zoom: number;
  panX: number;
  panY: number;
  followSelected: boolean;
};

type TouchPanGesture = {
  startX: number;
  startY: number;
  panX: number;
  panY: number;
};

type TouchPinchGesture = {
  startZoom: number;
  startDistance: number;
  startCenterX: number;
  startCenterY: number;
  startPanX: number;
  startPanY: number;
};

type TouchPoint = {
  clientX: number;
  clientY: number;
};

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

  const catalog = new Map<string, ResolvedTile>();
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampCameraPan(
  panX: number,
  panY: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const contentWidth = STAGE_WIDTH * zoom;
  const contentHeight = STAGE_HEIGHT * zoom;

  let nextPanX = panX;
  if (contentWidth <= viewportWidth) {
    nextPanX = (viewportWidth - contentWidth) / 2;
  } else {
    nextPanX = clamp(panX, viewportWidth - contentWidth, 0);
  }

  let nextPanY = panY;
  if (contentHeight <= viewportHeight) {
    nextPanY = (viewportHeight - contentHeight) / 2;
  } else {
    nextPanY = clamp(panY, viewportHeight - contentHeight, 0);
  }

  return {
    panX: nextPanX,
    panY: nextPanY,
  };
}

function touchDistance(a: TouchPoint, b: TouchPoint) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchCenter(a: TouchPoint, b: TouchPoint) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

function statusFocusAccent(status: OfficeEntity["status"]): string {
  if (status === "error") {
    return "255, 150, 150";
  }
  if (status === "active") {
    return "255, 217, 136";
  }
  if (status === "ok") {
    return "130, 255, 190";
  }
  if (status === "idle") {
    return "139, 226, 255";
  }
  return "173, 231, 250";
}

export function OfficeStage({
  snapshot,
  selectedEntityId = null,
  selectedEntityIds = [],
  pinnedEntityIds = [],
  watchedEntityIds = [],
  highlightRunId = null,
  highlightAgentId = null,
  filterEntityIds = [],
  hasEntityFilter = false,
  roomFilterId = "all",
  focusMode = false,
  placementMode = "auto",
  onRoomOptionsChange,
  onRoomAssignmentsChange,
  onFilterMatchCountChange,
  onSelectEntity,
}: Props) {
  const [manifest, setManifest] = useState<ManifestShape | null>(null);
  const [zoneConfig, setZoneConfig] = useState<unknown>(null);
  const [roomBlueprint, setRoomBlueprint] = useState<unknown>(null);
  const [viewportSize, setViewportSize] = useState({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
  });
  const [camera, setCamera] = useState<CameraState>({
    zoom: 1,
    panX: 0,
    panY: 0,
    followSelected: false,
  });
  const previousRoomOptionsKeyRef = useRef("");
  const previousRoomAssignmentsKeyRef = useRef("");
  const previousBlueprintDiagnosticKeyRef = useRef("");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mousePanGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const touchPanGestureRef = useRef<TouchPanGesture | null>(null);
  const touchPinchGestureRef = useRef<TouchPinchGesture | null>(null);
  const selectedEntityIdSet = useMemo(() => new Set(selectedEntityIds), [selectedEntityIds]);
  const pinnedEntityIdSet = useMemo(() => new Set(pinnedEntityIds), [pinnedEntityIds]);
  const watchedEntityIdSet = useMemo(() => new Set(watchedEntityIds), [watchedEntityIds]);

  const layoutState = useMemo(
    () =>
      buildPlacements({
        entities: snapshot.entities,
        generatedAt: snapshot.generatedAt,
        placementMode,
        zoneConfig,
      }),
    [placementMode, snapshot.entities, snapshot.generatedAt, zoneConfig],
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

  useEffect(() => {
    if (!onRoomAssignmentsChange) {
      return;
    }
    const roomByAgentId = new Map<string, string>();
    for (const placement of placements) {
      if (!roomByAgentId.has(placement.entity.agentId)) {
        roomByAgentId.set(placement.entity.agentId, placement.roomId);
      }
    }
    const entries = [...roomByAgentId.entries()];
    entries.sort((left, right) => left[0].localeCompare(right[0]));
    const roomAssignmentsKey = entries.map(([agentId, roomId]) => `${agentId}:${roomId}`).join("|");
    if (roomAssignmentsKey === previousRoomAssignmentsKeyRef.current) {
      return;
    }
    previousRoomAssignmentsKeyRef.current = roomAssignmentsKey;
    onRoomAssignmentsChange(new Map(entries));
  }, [onRoomAssignmentsChange, placements]);

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
    // TileStageLayer covers only tile passes; entities and overlays are rendered later.
    const grouped: Record<TileStageLayer, LayerTile[]> = {
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

  const sortedPlacements = useMemo(() => {
    const watchedBoost = 2;
    const pinnedBoost = 1;
    return [...placements].sort((left, right) => {
      const leftPriority =
        (watchedEntityIdSet.has(left.entity.id) ? watchedBoost : 0) +
        (pinnedEntityIdSet.has(left.entity.id) ? pinnedBoost : 0);
      const rightPriority =
        (watchedEntityIdSet.has(right.entity.id) ? watchedBoost : 0) +
        (pinnedEntityIdSet.has(right.entity.id) ? pinnedBoost : 0);
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }
      return left.y - right.y;
    });
  }, [pinnedEntityIdSet, placements, watchedEntityIdSet]);

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
  const selectedPlacement = selectedEntityId ? placementById.get(selectedEntityId) : undefined;
  const shouldFollowSelected = camera.followSelected && Boolean(selectedPlacement);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) {
      return;
    }

    const syncViewportSize = (nextWidth: number, nextHeight: number) => {
      setViewportSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      syncViewportSize(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const getViewportSize = () => {
    const node = viewportRef.current;
    return {
      width: node?.clientWidth ?? viewportSize.width,
      height: node?.clientHeight ?? viewportSize.height,
    };
  };

  const resolveCameraPan = (state: CameraState, viewportWidth: number, viewportHeight: number) => {
    if (state.followSelected && selectedPlacement) {
      const centeredPan = {
        panX: viewportWidth / 2 - selectedPlacement.x * state.zoom,
        panY: viewportHeight / 2 - selectedPlacement.y * state.zoom,
      };
      return clampCameraPan(
        centeredPan.panX,
        centeredPan.panY,
        state.zoom,
        viewportWidth,
        viewportHeight,
      );
    }

    return clampCameraPan(state.panX, state.panY, state.zoom, viewportWidth, viewportHeight);
  };

  const resolvedCameraPan = resolveCameraPan(camera, viewportSize.width, viewportSize.height);
  const cameraStyle: CSSProperties = {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    transformOrigin: "0 0",
    transform: `translate(${resolvedCameraPan.panX}px, ${resolvedCameraPan.panY}px) scale(${camera.zoom})`,
  };

  const viewportBox = {
    x: clamp(-resolvedCameraPan.panX / camera.zoom, 0, STAGE_WIDTH),
    y: clamp(-resolvedCameraPan.panY / camera.zoom, 0, STAGE_HEIGHT),
    width: clamp(viewportSize.width / camera.zoom, 0, STAGE_WIDTH),
    height: clamp(viewportSize.height / camera.zoom, 0, STAGE_HEIGHT),
  };
  const hasFocusSelection = focusMode && Boolean(selectedPlacement);
  const focusPoint = hasFocusSelection && selectedPlacement
    ? {
        x: selectedPlacement.x * camera.zoom + resolvedCameraPan.panX,
        y: selectedPlacement.y * camera.zoom + resolvedCameraPan.panY,
      }
    : null;
  const focusAccentColor = selectedPlacement
    ? statusFocusAccent(selectedPlacement.entity.status)
    : statusFocusAccent("idle");
  const focusRadius = Math.max(
    150,
    Math.min(Math.max(viewportSize.width, STAGE_WIDTH), Math.max(viewportSize.height, STAGE_HEIGHT)) * 0.22,
  );
  const focusFogStyle: CSSProperties | undefined = focusPoint
    ? {
        background: `radial-gradient(circle at ${focusPoint.x}px ${focusPoint.y}px, rgba(${focusAccentColor}, 0.28) 0px, rgba(${focusAccentColor}, 0.16) ${focusRadius * 0.58}px, rgba(7, 20, 30, 0.14) ${focusRadius}px, rgba(4, 15, 24, 0.58) ${focusRadius * 1.75}px, rgba(2, 10, 16, 0.78) 100%)`,
      }
    : undefined;
  const focusAccentStyle: CSSProperties | undefined = focusPoint
    ? {
        left: focusPoint.x,
        top: focusPoint.y,
        boxShadow: `0 0 48px rgba(${focusAccentColor}, 0.5), 0 0 112px rgba(${focusAccentColor}, 0.28)`,
      }
    : undefined;
  const stageClassName = [
    "office-stage-wrap",
    focusMode ? "is-focus-mode" : "",
    hasFocusSelection ? "has-focus-selection" : "",
    focusMode && selectedPlacement ? `focus-status-${selectedPlacement.entity.status}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const applyZoomAtPoint = (nextZoom: number, anchorX: number, anchorY: number) => {
    const { width, height } = getViewportSize();
    setCamera((prev) => {
      const targetZoom = clamp(nextZoom, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
      const currentPan = resolveCameraPan(prev, width, height);
      const stageX = (anchorX - currentPan.panX) / prev.zoom;
      const stageY = (anchorY - currentPan.panY) / prev.zoom;
      const nextPanX = anchorX - stageX * targetZoom;
      const nextPanY = anchorY - stageY * targetZoom;
      const clampedPan = clampCameraPan(nextPanX, nextPanY, targetZoom, width, height);
      return {
        zoom: targetZoom,
        panX: clampedPan.panX,
        panY: clampedPan.panY,
        followSelected: false,
      };
    });
  };

  const centerCameraOnPoint = (x: number, y: number) => {
    const { width, height } = getViewportSize();
    setCamera((prev) => {
      const nextPan = clampCameraPan(
        width / 2 - x * prev.zoom,
        height / 2 - y * prev.zoom,
        prev.zoom,
        width,
        height,
      );
      return {
        ...prev,
        panX: nextPan.panX,
        panY: nextPan.panY,
        followSelected: false,
      };
    });
  };

  return (
    <div className={stageClassName}>
      <div className="camera-controls">
        <button
          type="button"
          onClick={() => {
            const { width, height } = getViewportSize();
            applyZoomAtPoint(camera.zoom + CAMERA_ZOOM_STEP, width / 2, height / 2);
          }}
        >
          Zoom +
        </button>
        <button
          type="button"
          onClick={() => {
            const { width, height } = getViewportSize();
            applyZoomAtPoint(camera.zoom - CAMERA_ZOOM_STEP, width / 2, height / 2);
          }}
        >
          Zoom -
        </button>
        <button
          type="button"
          onClick={() => {
            setCamera({
              zoom: 1,
              panX: 0,
              panY: 0,
              followSelected: false,
            });
          }}
        >
          Reset
        </button>
        <button
          type="button"
          disabled={!selectedPlacement}
          onClick={() => {
            setCamera((prev) => ({
              ...prev,
              followSelected: !prev.followSelected,
            }));
          }}
        >
          {shouldFollowSelected ? "Follow on" : "Follow off"}
        </button>
        <span>{Math.round(camera.zoom * 100)}%</span>
      </div>

      <aside className="camera-minimap">
        <header>
          <strong>Minimap</strong>
          <span>Tap to center</span>
        </header>
        <button
          type="button"
          className="camera-minimap-surface"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) {
              return;
            }
            const normalizedX = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
            const normalizedY = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
            centerCameraOnPoint(normalizedX * STAGE_WIDTH, normalizedY * STAGE_HEIGHT);
          }}
        >
          <svg viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`} preserveAspectRatio="none" aria-hidden>
            {rooms.map((room) => (
              <rect
                key={`mini:${room.id}`}
                x={room.x}
                y={room.y}
                width={room.width}
                height={room.height}
                className="camera-minimap-room"
              />
            ))}
            {selectedPlacement ? (
              <circle
                cx={selectedPlacement.x}
                cy={selectedPlacement.y}
                r={12}
                className="camera-minimap-selected"
              />
            ) : null}
            <rect
              x={viewportBox.x}
              y={viewportBox.y}
              width={viewportBox.width}
              height={viewportBox.height}
              className="camera-minimap-viewport"
            />
          </svg>
        </button>
      </aside>

      <div
        ref={viewportRef}
        className="office-stage-camera-viewport"
        onWheel={(event) => {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          const anchorX = event.clientX - bounds.left;
          const anchorY = event.clientY - bounds.top;
          const direction = event.deltaY > 0 ? -1 : 1;
          applyZoomAtPoint(camera.zoom + direction * CAMERA_ZOOM_STEP, anchorX, anchorY);
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") {
            return;
          }
          if (event.pointerType === "mouse" && event.button !== 0) {
            return;
          }
          const target = event.target as HTMLElement;
          if (target.closest(".entity-token, .camera-controls, .camera-minimap")) {
            return;
          }
          mousePanGestureRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            panX: resolvedCameraPan.panX,
            panY: resolvedCameraPan.panY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const gesture = mousePanGestureRef.current;
          if (!gesture || gesture.pointerId !== event.pointerId) {
            return;
          }
          const deltaX = event.clientX - gesture.startX;
          const deltaY = event.clientY - gesture.startY;
          const { width, height } = getViewportSize();
          setCamera((prev) => {
            const nextPan = clampCameraPan(
              gesture.panX + deltaX,
              gesture.panY + deltaY,
              prev.zoom,
              width,
              height,
            );
            return {
              ...prev,
              panX: nextPan.panX,
              panY: nextPan.panY,
              followSelected: false,
            };
          });
        }}
        onPointerUp={(event) => {
          const gesture = mousePanGestureRef.current;
          if (gesture && gesture.pointerId === event.pointerId) {
            mousePanGestureRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          mousePanGestureRef.current = null;
        }}
        onTouchStart={(event) => {
          if (event.touches.length === 1) {
            const touch = event.touches[0];
            touchPanGestureRef.current = {
              startX: touch.clientX,
              startY: touch.clientY,
              panX: resolvedCameraPan.panX,
              panY: resolvedCameraPan.panY,
            };
            touchPinchGestureRef.current = null;
            return;
          }
          if (event.touches.length === 2) {
            const first = event.touches[0];
            const second = event.touches[1];
            const center = touchCenter(first, second);
            touchPinchGestureRef.current = {
              startZoom: camera.zoom,
              startDistance: touchDistance(first, second),
              startCenterX: center.x,
              startCenterY: center.y,
              startPanX: resolvedCameraPan.panX,
              startPanY: resolvedCameraPan.panY,
            };
            touchPanGestureRef.current = null;
          }
        }}
        onTouchMove={(event) => {
          if (event.touches.length === 2 && touchPinchGestureRef.current) {
            event.preventDefault();
            const first = event.touches[0];
            const second = event.touches[1];
            const center = touchCenter(first, second);
            const distance = touchDistance(first, second);
            const gesture = touchPinchGestureRef.current;
            const nextZoom = clamp(
              gesture.startZoom * (distance / Math.max(1, gesture.startDistance)),
              CAMERA_MIN_ZOOM,
              CAMERA_MAX_ZOOM,
            );
            const bounds = event.currentTarget.getBoundingClientRect();
            const anchorX = center.x - bounds.left;
            const anchorY = center.y - bounds.top;
            const startAnchorX = gesture.startCenterX - bounds.left;
            const startAnchorY = gesture.startCenterY - bounds.top;
            const stageX = (startAnchorX - gesture.startPanX) / gesture.startZoom;
            const stageY = (startAnchorY - gesture.startPanY) / gesture.startZoom;
            const { width, height } = getViewportSize();
            const nextPan = clampCameraPan(
              anchorX - stageX * nextZoom,
              anchorY - stageY * nextZoom,
              nextZoom,
              width,
              height,
            );
            setCamera({
              zoom: nextZoom,
              panX: nextPan.panX,
              panY: nextPan.panY,
              followSelected: false,
            });
            return;
          }

          if (event.touches.length === 1 && touchPanGestureRef.current) {
            event.preventDefault();
            const touch = event.touches[0];
            const gesture = touchPanGestureRef.current;
            if (!gesture) {
              return;
            }
            const deltaX = touch.clientX - gesture.startX;
            const deltaY = touch.clientY - gesture.startY;
            const { width, height } = getViewportSize();
            setCamera((prev) => {
              const nextPan = clampCameraPan(
                gesture.panX + deltaX,
                gesture.panY + deltaY,
                prev.zoom,
                width,
                height,
              );
              return {
                ...prev,
                panX: nextPan.panX,
                panY: nextPan.panY,
                followSelected: false,
              };
            });
          }
        }}
        onTouchEnd={(event) => {
          if (event.touches.length === 0) {
            touchPanGestureRef.current = null;
            touchPinchGestureRef.current = null;
            return;
          }
          if (event.touches.length === 1) {
            const touch = event.touches[0];
            touchPanGestureRef.current = {
              startX: touch.clientX,
              startY: touch.clientY,
              panX: resolvedCameraPan.panX,
              panY: resolvedCameraPan.panY,
            };
            touchPinchGestureRef.current = null;
          }
        }}
      >
        {hasFocusSelection && focusPoint ? (
          <>
            <div className="focus-fog-layer" style={focusFogStyle} aria-hidden="true" />
            <div className="focus-accent-ring" style={focusAccentStyle} aria-hidden="true" />
          </>
        ) : null}
        <div className="office-stage-camera" style={cameraStyle}>
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
        const occupancyRatio = debug ? debug.assigned / Math.max(1, debug.capacity) : 0;
        const occupancyPercent = Math.round(occupancyRatio * 100);
        const occupancyHeatLevel =
          occupancyRatio >= 1 ? "high" : occupancyRatio >= 0.7 ? "medium" : "low";
        return (
          <section
            key={room.id}
            className={`office-room heat-${occupancyHeatLevel}`}
            style={{
              left: room.x,
              top: room.y,
              width: room.width,
              height: room.height,
              background: room.fill,
              borderColor: room.border,
            }}
          >
            <div className={`occupancy-heat heat-${occupancyHeatLevel}`} aria-hidden="true" />
            <header>{room.label}</header>
            <div className="shape-tag">{room.shape}</div>
            {debug ? (
              <div className={`zone-debug ${overflowCount > 0 ? "has-overflow" : ""}`} aria-hidden="true">
                <span>
                  cap {debug.assigned}/{debug.capacity}
                </span>
                <span>occ {occupancyPercent}%</span>
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
        const isSelected = selectedEntityIdSet.has(entity.id);
        const isPinned = pinnedEntityIdSet.has(entity.id);
        const isWatched = watchedEntityIdSet.has(entity.id);
        const matchesEntityFilter = !hasEntityFilter || filteredEntityIdSet.has(entity.id);
        const matchesRoomFilter =
          !normalizedRoomFilterId || placement.roomId === normalizedRoomFilterId;
        const matchesOpsFilter = matchesEntityFilter && matchesRoomFilter;
        if (hasOpsFilter && !focusMode && !matchesOpsFilter && !isSelected && !isWatched) {
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
        const isMutedByFocus = hasOpsFilter && focusMode && !matchesOpsFilter && !isWatched;
        const renderPriorityBoost = isWatched ? 220 : isPinned ? 140 : 0;
        const tokenClassName = [
          "entity-token",
          statusClass(entity),
          entity.kind,
          isOccluded ? "is-occluded" : "",
          motionClasses,
          isSelected ? "is-selected" : "",
          isPinned ? "is-pinned" : "",
          isWatched ? "is-watched" : "",
          isLinked ? "is-linked" : "",
          hasOpsFilter && matchesOpsFilter ? "is-filter-hit" : "",
          isMutedByFocus ? "is-filtered-out" : "",
          isMutedByTimeline || isMutedByFocus ? "is-muted" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <article
            key={entity.id}
            className={tokenClassName}
            style={{
              left: placement.x,
              top: placement.y,
              zIndex: ENTITY_Z_OFFSET + Math.round(placement.y) + renderPriorityBoost,
            }}
            role="button"
            tabIndex={0}
            aria-label={`Open detail panel for ${entity.label}`}
            aria-pressed={isSelected}
            onClick={(event) => {
              const multiToggle = event.metaKey || event.ctrlKey;
              onSelectEntity?.(entity.id, multiToggle ? "toggle" : "single");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectEntity?.(entity.id, "single");
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
      </div>
    </div>
  );
}
