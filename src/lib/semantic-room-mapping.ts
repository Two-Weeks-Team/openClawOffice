export type SemanticAssetKey =
  | "desk_pair"
  | "meeting_table"
  | "plant_small"
  | "corridor_lamp"
  | "build_beacon"
  | "arcade_console"
  | "lounge_greenery";

export type SemanticRoomMappingDiagnosticCode = "SEMANTIC_KEY_UNKNOWN" | "SEMANTIC_TILE_UNRESOLVED";

export type SemanticRoomMappingDiagnostic = {
  level: "warning";
  code: SemanticRoomMappingDiagnosticCode;
  roomId?: string;
  anchorId?: string;
  message: string;
};

type PresetRoomId = "strategy" | "ops" | "build" | "spawn" | "lounge";

type CurationLike = {
  tileset?: {
    tiles?: Array<{ id?: unknown }>;
  };
};

const SEMANTIC_CANDIDATES: Record<SemanticAssetKey, string[]> = {
  desk_pair: ["bench", "sign"],
  meeting_table: ["bench", "fountain"],
  plant_small: ["potted_plant", "bush"],
  corridor_lamp: ["streetlamp", "sign"],
  build_beacon: ["streetlamp", "bench"],
  arcade_console: ["sign", "bench"],
  lounge_greenery: ["potted_plant", "bench"],
};

const DEFAULT_ROOM_OBJECT_PRESET: SemanticAssetKey[] = ["desk_pair", "plant_small"];

const ROOM_OBJECT_PRESETS = {
  strategy: ["meeting_table", "plant_small", "corridor_lamp"],
  ops: ["desk_pair", "corridor_lamp"],
  build: ["build_beacon", "desk_pair"],
  spawn: ["arcade_console", "corridor_lamp"],
  lounge: ["lounge_greenery", "meeting_table"],
} as const satisfies Record<PresetRoomId, readonly SemanticAssetKey[]>;

type Registry = Record<SemanticAssetKey, string[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSemanticKey(value: string): value is SemanticAssetKey {
  return value in SEMANTIC_CANDIDATES;
}

function collectAvailableTiles(curation: unknown): Set<string> {
  const available = new Set<string>();
  const root = isRecord(curation) ? (curation as CurationLike) : null;
  const tiles = root?.tileset?.tiles;
  if (!Array.isArray(tiles)) {
    return available;
  }
  for (const tile of tiles) {
    if (tile && typeof tile.id === "string" && tile.id.trim() !== "") {
      available.add(tile.id.trim());
    }
  }
  return available;
}

export function buildSemanticAssetRegistry(curation: unknown): Registry {
  const available = collectAvailableTiles(curation);
  const registry = {} as Registry;
  for (const [key, candidates] of Object.entries(SEMANTIC_CANDIDATES) as Array<
    [SemanticAssetKey, string[]]
  >) {
    const resolved = candidates.filter((candidate) => available.has(candidate));
    registry[key] = resolved.length > 0 ? resolved : [...candidates];
  }
  return registry;
}

export function roomObjectPreset(roomId: string): SemanticAssetKey[] {
  const preset = ROOM_OBJECT_PRESETS[roomId as PresetRoomId];
  return preset ? [...preset] : [...DEFAULT_ROOM_OBJECT_PRESET];
}

export function resolveSemanticTileId(
  registry: Registry,
  semanticKey: SemanticAssetKey,
): string | undefined {
  return registry[semanticKey]?.[0];
}

export function applySemanticRoomMappings(params: {
  rawBlueprint: unknown;
  registry: Registry;
}): {
  blueprint: unknown;
  diagnostics: SemanticRoomMappingDiagnostic[];
} {
  const diagnostics: SemanticRoomMappingDiagnostic[] = [];
  const rawRoot = isRecord(params.rawBlueprint) ? params.rawBlueprint : null;
  if (!rawRoot || !Array.isArray(rawRoot.rooms)) {
    return {
      blueprint: params.rawBlueprint,
      diagnostics,
    };
  }

  const nextRoot = {
    ...rawRoot,
    rooms: rawRoot.rooms.map((roomRaw) => {
      if (!isRecord(roomRaw)) {
        return roomRaw;
      }
      const roomId = typeof roomRaw.roomId === "string" ? roomRaw.roomId.trim() : "";
      const preset = roomObjectPreset(roomId);
      let presetIndex = 0;

      const anchorsRaw = Array.isArray(roomRaw.anchors) ? roomRaw.anchors : [];
      const anchors = anchorsRaw.map((anchorRaw) => {
        if (!isRecord(anchorRaw)) {
          return anchorRaw;
        }
        const nextAnchor: Record<string, unknown> = { ...anchorRaw };
        const anchorId =
          typeof nextAnchor.id === "string" && nextAnchor.id.trim() !== ""
            ? nextAnchor.id.trim()
            : undefined;
        const kind = typeof nextAnchor.kind === "string" ? nextAnchor.kind : "";
        const hasTile = typeof nextAnchor.tile === "string" && nextAnchor.tile.trim() !== "";
        let semanticKey: SemanticAssetKey | undefined;

        if (typeof nextAnchor.semantic === "string" && nextAnchor.semantic.trim() !== "") {
          const rawSemantic = nextAnchor.semantic.trim();
          if (isSemanticKey(rawSemantic)) {
            semanticKey = rawSemantic;
          } else {
            diagnostics.push({
              level: "warning",
              code: "SEMANTIC_KEY_UNKNOWN",
              roomId,
              anchorId,
              message: `Unknown semantic key "${rawSemantic}" in room "${roomId}".`,
            });
          }
        } else if (!hasTile && kind === "furniture") {
          semanticKey = preset[presetIndex % preset.length];
          presetIndex += 1;
          nextAnchor.semantic = semanticKey;
        }

        if (semanticKey && !hasTile) {
          const resolvedTileId = resolveSemanticTileId(params.registry, semanticKey);
          if (resolvedTileId) {
            nextAnchor.tile = resolvedTileId;
          } else {
            diagnostics.push({
              level: "warning",
              code: "SEMANTIC_TILE_UNRESOLVED",
              roomId,
              anchorId,
              message: `Semantic key "${semanticKey}" could not be resolved for room "${roomId}".`,
            });
          }
        }

        return nextAnchor;
      });

      return {
        ...roomRaw,
        anchors,
      };
    }),
  };

  return {
    blueprint: nextRoot,
    diagnostics,
  };
}
