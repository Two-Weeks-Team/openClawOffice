import type { OfficeEntity, OfficeEntityStatus } from "../types/office";

export type RoomShape = "grid" | "ring" | "line" | "cluster";
export type ZonePriorityKey = "status" | "team" | "role" | "parent" | "recent";
export type EntityRole = "strategy" | "ops" | "build" | "spawn" | "recovery";
export type PlacementMode = "auto" | "manual";

type RoomRoutingSpec = {
  statuses: OfficeEntityStatus[];
  kinds: Array<OfficeEntity["kind"]>;
  recentWeight: number;
  teamWeight?: number;
};

export type RoomSpec = {
  id: string;
  label: string;
  shape: RoomShape;
  role: EntityRole;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  border: string;
  capacity: number;
  spacing: {
    x: number;
    y: number;
  };
  anchor: {
    x: number;
    y: number;
  };
  secondaryZoneId?: string;
  routing: RoomRoutingSpec;
};

export type ZoneLayoutConfig = {
  version: number;
  priorityOrder: ZonePriorityKey[];
  recentWindowMs: number;
  parentAffinityPx: number;
  defaultOverflowZoneId: string;
  rooms: RoomSpec[];
};

export type Placement = {
  entity: OfficeEntity;
  roomId: string;
  targetRoomId: string;
  x: number;
  y: number;
  overflowed: boolean;
};

export type PlacementCollision = {
  roomId: string;
  leftEntityId: string;
  rightEntityId: string;
  intersectionArea: number;
};

export type RoomDebugInfo = {
  roomId: string;
  capacity: number;
  assigned: number;
  targeted: number;
  overflowIn: number;
  overflowOut: number;
  utilizationPct: number;
  saturation: "low" | "medium" | "high";
  manualOverrides: number;
  collisionPairs: number;
  secondaryZoneId?: string;
};

export type PlacementResult = {
  rooms: RoomSpec[];
  placements: Placement[];
  collisionPairs: PlacementCollision[];
  roomDebug: Map<string, RoomDebugInfo>;
  configVersion: number;
};

const VALID_STATUSES: readonly OfficeEntityStatus[] = ["active", "idle", "offline", "ok", "error"];
const VALID_ENTITY_KINDS: readonly OfficeEntity["kind"][] = ["agent", "subagent"];
const DEFAULT_PRIORITY_ORDER: ZonePriorityKey[] = ["status", "team", "role", "parent", "recent"];
const VALID_PRIORITIES: readonly ZonePriorityKey[] = DEFAULT_PRIORITY_ORDER;
const TOKEN_COLLISION_WIDTH = 46;
const TOKEN_COLLISION_HEIGHT = 46;
const TOKEN_COLLISION_SPACING = 6;
const COLLISION_SEARCH_MAX_RING = 6;
const COLLISION_FALLBACK_SLOT_LIMIT = 400;
const COLLISION_OFFSETS = buildCollisionOffsets(COLLISION_SEARCH_MAX_RING);

const DEFAULT_ZONE_CONFIG: ZoneLayoutConfig = {
  version: 1,
  priorityOrder: DEFAULT_PRIORITY_ORDER,
  recentWindowMs: 5 * 60_000,
  parentAffinityPx: 64,
  defaultOverflowZoneId: "ops",
  rooms: [
    {
      id: "strategy",
      label: "Strategy Room",
      shape: "ring",
      role: "strategy",
      x: 20,
      y: 50,
      width: 320,
      height: 170,
      fill: "rgba(47, 106, 140, 0.82)",
      border: "#8cd7ff",
      capacity: 10,
      spacing: { x: 48, y: 32 },
      anchor: { x: 0.5, y: 0.48 },
      secondaryZoneId: "ops",
      routing: {
        statuses: ["active"],
        kinds: ["agent"],
        recentWeight: 0.2,
        teamWeight: 0.3,
      },
    },
    {
      id: "ops",
      label: "Ops Floor",
      shape: "grid",
      role: "ops",
      x: 20,
      y: 240,
      width: 360,
      height: 200,
      fill: "rgba(40, 88, 115, 0.85)",
      border: "#74d1f8",
      capacity: 16,
      spacing: { x: 64, y: 48 },
      anchor: { x: 0.5, y: 0.5 },
      secondaryZoneId: "build",
      routing: {
        statuses: ["ok", "offline"],
        kinds: ["agent"],
        recentWeight: 0.15,
        teamWeight: 0.18,
      },
    },
    {
      id: "build",
      label: "Build Pods",
      shape: "line",
      role: "build",
      x: 400,
      y: 240,
      width: 340,
      height: 200,
      fill: "rgba(44, 125, 132, 0.84)",
      border: "#8cf8dc",
      capacity: 12,
      spacing: { x: 56, y: 36 },
      anchor: { x: 0.5, y: 0.52 },
      secondaryZoneId: "ops",
      routing: {
        statuses: ["idle"],
        kinds: ["agent"],
        recentWeight: 0.1,
        teamWeight: 0.2,
      },
    },
    {
      id: "spawn",
      label: "Spawn Lab",
      shape: "cluster",
      role: "spawn",
      x: 360,
      y: 50,
      width: 320,
      height: 170,
      fill: "rgba(17, 82, 111, 0.82)",
      border: "#5ec6ff",
      capacity: 14,
      spacing: { x: 52, y: 32 },
      anchor: { x: 0.5, y: 0.52 },
      secondaryZoneId: "ops",
      routing: {
        statuses: ["active", "idle"],
        kinds: ["subagent"],
        recentWeight: 0.35,
        teamWeight: 0.32,
      },
    },
    {
      id: "lounge",
      label: "Recovery Lounge",
      shape: "cluster",
      role: "recovery",
      x: 20,
      y: 460,
      width: 720,
      height: 180,
      fill: "rgba(13, 97, 120, 0.82)",
      border: "#70f2ff",
      capacity: 28,
      spacing: { x: 56, y: 32 },
      anchor: { x: 0.5, y: 0.52 },
      secondaryZoneId: "ops",
      routing: {
        statuses: ["ok", "error", "offline"],
        kinds: ["agent", "subagent"],
        recentWeight: 0.25,
        teamWeight: 0.26,
      },
    },
  ],
};

type ScoreVector = Record<ZonePriorityKey, number>;

type AssignmentMeta = {
  roomId: string;
  targetRoomId: string;
  overflowed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRoomShape(value: unknown): value is RoomShape {
  return value === "grid" || value === "ring" || value === "line" || value === "cluster";
}

function isEntityRole(value: unknown): value is EntityRole {
  return (
    value === "strategy" ||
    value === "ops" ||
    value === "build" ||
    value === "spawn" ||
    value === "recovery"
  );
}

function filterArrayByGuard<T>(value: unknown, guard: (entry: unknown) => entry is T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(guard);
}

function normalizeArrayWithFallback<T>(
  value: unknown,
  fallback: T[],
  guard: (entry: unknown) => entry is T,
): T[] {
  const normalized = filterArrayByGuard(value, guard);
  return normalized.length > 0 ? normalized : fallback;
}

function dedupeAndAppendDefaults<T>(value: T[], defaults: readonly T[]): T[] {
  return [...new Set([...value, ...defaults])];
}

function isValidStatus(value: unknown): value is OfficeEntityStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

function isValidEntityKind(value: unknown): value is OfficeEntity["kind"] {
  return typeof value === "string" && (VALID_ENTITY_KINDS as readonly string[]).includes(value);
}

function isValidPriorityKey(value: unknown): value is ZonePriorityKey {
  return typeof value === "string" && (VALID_PRIORITIES as readonly string[]).includes(value);
}

function normalizeStatuses(value: unknown, fallback: OfficeEntityStatus[]): OfficeEntityStatus[] {
  return normalizeArrayWithFallback(value, fallback, isValidStatus);
}

function normalizeKinds(
  value: unknown,
  fallback: Array<OfficeEntity["kind"]>,
): Array<OfficeEntity["kind"]> {
  return normalizeArrayWithFallback(value, fallback, isValidEntityKind);
}

function normalizePriorityOrder(value: unknown): ZonePriorityKey[] {
  const normalized = filterArrayByGuard(value, isValidPriorityKey);
  if (normalized.length === 0) {
    return [...DEFAULT_PRIORITY_ORDER];
  }
  return dedupeAndAppendDefaults(normalized, DEFAULT_PRIORITY_ORDER);
}

function normalizeRoom(rawValue: unknown, fallback: RoomSpec): RoomSpec {
  const raw = isRecord(rawValue) ? rawValue : {};
  const rawSpacing = isRecord(raw.spacing) ? raw.spacing : {};
  const rawAnchor = isRecord(raw.anchor) ? raw.anchor : {};
  const rawRouting = isRecord(raw.routing) ? raw.routing : {};

  const room: RoomSpec = {
    ...fallback,
    label: toString(raw.label, fallback.label),
    shape: isRoomShape(raw.shape) ? raw.shape : fallback.shape,
    role: isEntityRole(raw.role) ? raw.role : fallback.role,
    x: toFiniteNumber(raw.x, fallback.x),
    y: toFiniteNumber(raw.y, fallback.y),
    width: Math.max(120, toFiniteNumber(raw.width, fallback.width)),
    height: Math.max(80, toFiniteNumber(raw.height, fallback.height)),
    fill: toString(raw.fill, fallback.fill),
    border: toString(raw.border, fallback.border),
    capacity: Math.max(1, Math.round(toFiniteNumber(raw.capacity, fallback.capacity))),
    spacing: {
      x: Math.max(18, toFiniteNumber(rawSpacing.x, fallback.spacing.x)),
      y: Math.max(14, toFiniteNumber(rawSpacing.y, fallback.spacing.y)),
    },
    anchor: {
      x: clamp(toFiniteNumber(rawAnchor.x, fallback.anchor.x), 0, 1),
      y: clamp(toFiniteNumber(rawAnchor.y, fallback.anchor.y), 0, 1),
    },
    secondaryZoneId:
      typeof raw.secondaryZoneId === "string" && raw.secondaryZoneId.length > 0
        ? raw.secondaryZoneId
        : fallback.secondaryZoneId,
    routing: {
      statuses: normalizeStatuses(rawRouting.statuses, fallback.routing.statuses),
      kinds: normalizeKinds(rawRouting.kinds, fallback.routing.kinds),
      recentWeight: toFiniteNumber(rawRouting.recentWeight, fallback.routing.recentWeight),
      teamWeight: toFiniteNumber(rawRouting.teamWeight, fallback.routing.teamWeight ?? 0),
    },
  };
  return room;
}

export function normalizeZoneConfig(rawValue: unknown): ZoneLayoutConfig {
  const raw = isRecord(rawValue) ? rawValue : {};
  const rawRoomsById = new Map<string, unknown>();
  if (Array.isArray(raw.rooms)) {
    for (const rawRoom of raw.rooms) {
      if (isRecord(rawRoom) && typeof rawRoom.id === "string") {
        rawRoomsById.set(rawRoom.id, rawRoom);
      }
    }
  }

  const rooms = DEFAULT_ZONE_CONFIG.rooms.map((fallback) =>
    normalizeRoom(rawRoomsById.get(fallback.id), fallback),
  );
  const roomIds = new Set(rooms.map((room) => room.id));
  for (const room of rooms) {
    if (room.secondaryZoneId && !roomIds.has(room.secondaryZoneId)) {
      room.secondaryZoneId = undefined;
    }
  }

  const defaultOverflowCandidate = toString(
    raw.defaultOverflowZoneId,
    DEFAULT_ZONE_CONFIG.defaultOverflowZoneId,
  );
  const defaultOverflowZoneId = roomIds.has(defaultOverflowCandidate)
    ? defaultOverflowCandidate
    : DEFAULT_ZONE_CONFIG.defaultOverflowZoneId;

  return {
    version: Math.max(1, Math.round(toFiniteNumber(raw.version, DEFAULT_ZONE_CONFIG.version))),
    priorityOrder: normalizePriorityOrder(raw.priorityOrder),
    recentWindowMs: Math.max(
      0,
      Math.round(toFiniteNumber(raw.recentWindowMs, DEFAULT_ZONE_CONFIG.recentWindowMs)),
    ),
    parentAffinityPx: Math.max(
      0,
      toFiniteNumber(raw.parentAffinityPx, DEFAULT_ZONE_CONFIG.parentAffinityPx),
    ),
    defaultOverflowZoneId: roomIds.has(defaultOverflowZoneId) ? defaultOverflowZoneId : rooms[0].id,
    rooms,
  };
}

function compareEntities(a: OfficeEntity, b: OfficeEntity): number {
  const kindOrder = a.kind === b.kind ? 0 : a.kind === "agent" ? -1 : 1;
  if (kindOrder !== 0) {
    return kindOrder;
  }
  const labelOrder = a.label.localeCompare(b.label);
  if (labelOrder !== 0) {
    return labelOrder;
  }
  return a.id.localeCompare(b.id);
}

function deriveRole(entity: OfficeEntity): EntityRole {
  if (entity.kind === "subagent") {
    if (entity.status === "ok" || entity.status === "error" || entity.status === "offline") {
      return "recovery";
    }
    return "spawn";
  }
  if (entity.status === "active") {
    return "strategy";
  }
  if (entity.status === "idle") {
    return "build";
  }
  if (entity.status === "error" || entity.status === "offline") {
    return "recovery";
  }
  return "ops";
}

function deriveModelTeam(model: string | undefined): string | undefined {
  if (typeof model !== "string") {
    return undefined;
  }
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const provider = normalized.split("/")[0];
  if (!provider) {
    return undefined;
  }
  return provider;
}

function deriveTeamId(entity: OfficeEntity, teamByAgentId: Map<string, string>): string | undefined {
  const modelTeam = deriveModelTeam(entity.model);
  if (modelTeam) {
    return modelTeam;
  }
  if (entity.parentAgentId) {
    const parentTeam = teamByAgentId.get(entity.parentAgentId);
    if (parentTeam) {
      return parentTeam;
    }
  }
  const primaryToken = entity.agentId.split("-")[0]?.trim().toLowerCase();
  if (primaryToken && primaryToken !== entity.agentId.toLowerCase()) {
    return primaryToken;
  }
  return undefined;
}

function incrementTeamLoad(
  teamLoadByRoom: Map<string, Map<string, number>>,
  roomId: string,
  teamId: string,
) {
  const roomLoad = teamLoadByRoom.get(roomId) ?? new Map<string, number>();
  roomLoad.set(teamId, (roomLoad.get(teamId) ?? 0) + 1);
  teamLoadByRoom.set(roomId, roomLoad);
}

function parseManualRoomOverride(entity: OfficeEntity, roomById: Map<string, RoomSpec>): string | undefined {
  const textSources = [entity.task, entity.bubble, entity.label];
  const patterns = [
    /\broom\s*[:=]\s*([a-z0-9_-]+)/i,
    /\[(?:room|zone)\s*:\s*([a-z0-9_-]+)\]/i,
  ];

  for (const source of textSources) {
    if (typeof source !== "string" || source.trim() === "") {
      continue;
    }
    for (const pattern of patterns) {
      const matched = source.match(pattern)?.[1]?.toLowerCase();
      if (matched && roomById.has(matched)) {
        return matched;
      }
    }
  }
  return undefined;
}

function scoreRoom(params: {
  entity: OfficeEntity;
  role: EntityRole;
  room: RoomSpec;
  parentRoomId?: string;
  teamId?: string;
  teamLoadByRoom: Map<string, Map<string, number>>;
  generatedAt: number;
  recentWindowMs: number;
}): ScoreVector {
  const { entity, role, room, parentRoomId, teamId, teamLoadByRoom, generatedAt, recentWindowMs } =
    params;
  const statusMatch = room.routing.statuses.includes(entity.status) ? 1 : 0;
  const kindMatch = room.routing.kinds.includes(entity.kind) ? 1 : 0;
  const roleMatch = room.role === role ? 1 : 0;
  const parentMatch = entity.kind === "subagent" && parentRoomId === room.id ? 1 : 0;
  const teamLoad = teamId ? (teamLoadByRoom.get(room.id)?.get(teamId) ?? 0) : 0;
  const teamMatch =
    teamLoad > 0
      ? 1 + Math.min(0.6, teamLoad * Math.max(0, room.routing.teamWeight ?? 0))
      : 0;
  const isRecent =
    typeof entity.lastUpdatedAt === "number" &&
    generatedAt - entity.lastUpdatedAt >= 0 &&
    generatedAt - entity.lastUpdatedAt <= recentWindowMs;

  return {
    status: statusMatch,
    team: teamMatch,
    role: kindMatch + roleMatch,
    parent: parentMatch,
    recent: isRecent ? room.routing.recentWeight : 0,
  };
}

function compareScoreVectors(
  left: ScoreVector,
  right: ScoreVector,
  priorityOrder: ZonePriorityKey[],
): number {
  for (const key of priorityOrder) {
    if (left[key] > right[key]) {
      return 1;
    }
    if (left[key] < right[key]) {
      return -1;
    }
  }
  return 0;
}

function shouldPromoteRoomCandidate(params: {
  candidateRoom: RoomSpec;
  candidateScore: ScoreVector;
  candidateOccupancy: number;
  currentRoom: RoomSpec;
  currentScore: ScoreVector;
  currentOccupancy: number;
  priorityOrder: ZonePriorityKey[];
}): boolean {
  const {
    candidateRoom,
    candidateScore,
    candidateOccupancy,
    currentRoom,
    currentScore,
    currentOccupancy,
    priorityOrder,
  } = params;
  const scoreOrder = compareScoreVectors(candidateScore, currentScore, priorityOrder);
  if (scoreOrder !== 0) {
    return scoreOrder > 0;
  }
  const candidateSpare = candidateRoom.capacity - candidateOccupancy;
  const currentSpare = currentRoom.capacity - currentOccupancy;
  if (candidateSpare !== currentSpare) {
    return candidateSpare > currentSpare;
  }
  const candidateUtilization = candidateOccupancy / Math.max(1, candidateRoom.capacity);
  const currentUtilization = currentOccupancy / Math.max(1, currentRoom.capacity);
  if (candidateUtilization !== currentUtilization) {
    return candidateUtilization < currentUtilization;
  }
  return candidateRoom.id.localeCompare(currentRoom.id) < 0;
}

function pickTargetRoom(params: {
  entity: OfficeEntity;
  rooms: RoomSpec[];
  priorityOrder: ZonePriorityKey[];
  generatedAt: number;
  recentWindowMs: number;
  parentRoomByAgentId: Map<string, string>;
  teamByAgentId: Map<string, string>;
  teamLoadByRoom: Map<string, Map<string, number>>;
  occupancyByRoom: Map<string, number>;
}): RoomSpec {
  const {
    entity,
    rooms,
    priorityOrder,
    generatedAt,
    recentWindowMs,
    parentRoomByAgentId,
    teamByAgentId,
    teamLoadByRoom,
    occupancyByRoom,
  } = params;
  const role = deriveRole(entity);
  const teamId = deriveTeamId(entity, teamByAgentId);
  const parentRoomId = entity.parentAgentId
    ? parentRoomByAgentId.get(entity.parentAgentId)
    : undefined;

  let bestRoom = rooms[0];
  let bestScore = scoreRoom({
    entity,
    role,
    room: bestRoom,
    parentRoomId,
    teamId,
    teamLoadByRoom,
    generatedAt,
    recentWindowMs,
  });
  let bestOccupancy = occupancyByRoom.get(bestRoom.id) ?? 0;

  for (let index = 1; index < rooms.length; index += 1) {
    const candidate = rooms[index];
    const candidateOccupancy = occupancyByRoom.get(candidate.id) ?? 0;
    const candidateScore = scoreRoom({
      entity,
      role,
      room: candidate,
      parentRoomId,
      teamId,
      teamLoadByRoom,
      generatedAt,
      recentWindowMs,
    });
    if (
      shouldPromoteRoomCandidate({
        candidateRoom: candidate,
        candidateScore,
        candidateOccupancy,
        currentRoom: bestRoom,
        currentScore: bestScore,
        currentOccupancy: bestOccupancy,
        priorityOrder,
      })
    ) {
      bestRoom = candidate;
      bestScore = candidateScore;
      bestOccupancy = candidateOccupancy;
    }
  }

  return bestRoom;
}

function resolveOverflowRoom(params: {
  targetRoom: RoomSpec;
  rooms: RoomSpec[];
  roomById: Map<string, RoomSpec>;
  occupancyByRoom: Map<string, number>;
  defaultOverflowZoneId: string;
  placementMode: PlacementMode;
}): { roomId: string; overflowed: boolean } {
  const { targetRoom, rooms, roomById, occupancyByRoom, defaultOverflowZoneId, placementMode } =
    params;
  const targetOccupancy = occupancyByRoom.get(targetRoom.id) ?? 0;
  if (targetOccupancy < targetRoom.capacity) {
    return { roomId: targetRoom.id, overflowed: false };
  }
  if (placementMode === "manual") {
    return { roomId: targetRoom.id, overflowed: true };
  }

  const visited = new Set<string>([targetRoom.id]);
  let nextId = targetRoom.secondaryZoneId ?? defaultOverflowZoneId;
  while (typeof nextId === "string" && nextId.length > 0 && !visited.has(nextId)) {
    visited.add(nextId);
    const room = roomById.get(nextId);
    if (!room) {
      break;
    }
    const occupancy = occupancyByRoom.get(room.id) ?? 0;
    if (occupancy < room.capacity) {
      return { roomId: room.id, overflowed: true };
    }
    nextId = room.secondaryZoneId ?? defaultOverflowZoneId;
  }

  let fallbackRoom = targetRoom;
  let bestSpare = targetRoom.capacity - targetOccupancy;
  for (const room of rooms) {
    const spare = room.capacity - (occupancyByRoom.get(room.id) ?? 0);
    if (spare > bestSpare || (spare === bestSpare && room.id.localeCompare(fallbackRoom.id) < 0)) {
      fallbackRoom = room;
      bestSpare = spare;
    }
  }

  return { roomId: fallbackRoom.id, overflowed: fallbackRoom.id !== targetRoom.id };
}

function clampPointToRoom(point: { x: number; y: number }, room: RoomSpec): { x: number; y: number } {
  const marginX = Math.max(16, room.spacing.x * 0.3);
  const marginY = Math.max(16, room.spacing.y * 0.3);
  return {
    x: clamp(point.x, room.x + marginX, room.x + room.width - marginX),
    y: clamp(point.y, room.y + marginY, room.y + room.height - marginY),
  };
}

function layoutPoint(params: {
  room: RoomSpec;
  index: number;
  total: number;
  seed: string;
}): { x: number; y: number } {
  const { room, index, total, seed } = params;
  const ratio = total <= 1 ? 0.5 : index / (total - 1);
  const anchorX = room.x + room.width * room.anchor.x;
  const anchorY = room.y + room.height * room.anchor.y;

  if (room.shape === "ring") {
    const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
    const rx = Math.max(room.spacing.x * 1.25, room.width * 0.22);
    const ry = Math.max(room.spacing.y * 1.1, room.height * 0.2);
    return clampPointToRoom(
      {
        x: anchorX + Math.cos(angle) * rx,
        y: anchorY + Math.sin(angle) * ry,
      },
      room,
    );
  }

  if (room.shape === "grid") {
    const cols = Math.max(1, Math.floor((room.width - room.spacing.x) / room.spacing.x));
    const rows = Math.max(1, Math.ceil(total / cols));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const startX = anchorX - ((cols - 1) * room.spacing.x) / 2;
    const startY = anchorY - ((rows - 1) * room.spacing.y) / 2;
    return clampPointToRoom(
      {
        x: startX + col * room.spacing.x,
        y: startY + row * room.spacing.y,
      },
      room,
    );
  }

  if (room.shape === "line") {
    const insetX = Math.max(20, room.spacing.x * 0.45);
    return clampPointToRoom(
      {
        x: room.x + insetX + ratio * (room.width - insetX * 2),
        y: anchorY + (index % 2 === 0 ? -1 : 1) * room.spacing.y * 0.45,
      },
      room,
    );
  }

  const hash = hashString(seed);
  const jitterX = ((hash % 101) / 100 - 0.5) * room.spacing.x * 2.1;
  const jitterY = (((Math.floor(hash / 101) % 101) / 100) - 0.5) * room.spacing.y * 1.8;
  const driftX = (ratio - 0.5) * room.spacing.x * 1.4;
  const driftY = ((index % 3) - 1) * room.spacing.y * 0.45;
  return clampPointToRoom(
    {
      x: anchorX + jitterX + driftX,
      y: anchorY + jitterY + driftY,
    },
    room,
  );
}

function applyParentAffinity(params: {
  point: { x: number; y: number };
  room: RoomSpec;
  parentPoint: { x: number; y: number };
  seed: string;
  parentAffinityPx: number;
}): { x: number; y: number } {
  const { point, room, parentPoint, seed, parentAffinityPx } = params;
  if (parentAffinityPx <= 0) {
    return point;
  }
  const hash = hashString(seed);
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 10 + (hash % Math.max(12, Math.round(parentAffinityPx * 0.75)));
  const distance = Math.min(parentAffinityPx, radius);
  return clampPointToRoom(
    {
      x: parentPoint.x + Math.cos(angle) * distance,
      y: parentPoint.y + Math.sin(angle) * distance * 0.72,
    },
    room,
  );
}

type CollisionOffset = {
  dx: number;
  dy: number;
};

type CollisionBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type CollisionPlacement = {
  placement: Placement;
  bounds: CollisionBounds;
};

function buildCollisionOffsets(maxRing: number): CollisionOffset[] {
  const offsets: CollisionOffset[] = [{ dx: 0, dy: 0 }];
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) {
          continue;
        }
        offsets.push({ dx, dy });
      }
    }
  }
  return offsets;
}

function collisionHalfWidth(): number {
  return TOKEN_COLLISION_WIDTH / 2 + TOKEN_COLLISION_SPACING / 2;
}

function collisionHalfHeight(): number {
  return TOKEN_COLLISION_HEIGHT / 2 + TOKEN_COLLISION_SPACING / 2;
}

function clampPointToRoomWithCollisionBounds(
  point: { x: number; y: number },
  room: RoomSpec,
): { x: number; y: number } {
  const halfWidth = collisionHalfWidth();
  const halfHeight = collisionHalfHeight();
  const minX = room.x + halfWidth;
  const maxX = room.x + room.width - halfWidth;
  const minY = room.y + halfHeight;
  const maxY = room.y + room.height - halfHeight;

  return {
    x: minX > maxX ? room.x + room.width / 2 : clamp(point.x, minX, maxX),
    y: minY > maxY ? room.y + room.height / 2 : clamp(point.y, minY, maxY),
  };
}

function collisionBoundsForPoint(point: { x: number; y: number }): CollisionBounds {
  const halfWidth = collisionHalfWidth();
  const halfHeight = collisionHalfHeight();
  return {
    left: point.x - halfWidth,
    right: point.x + halfWidth,
    top: point.y - halfHeight,
    bottom: point.y + halfHeight,
  };
}

function collisionAreaBetweenBounds(left: CollisionBounds, right: CollisionBounds): number {
  const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }
  return overlapWidth * overlapHeight;
}

function areParentLinkedEntities(left: OfficeEntity, right: OfficeEntity): boolean {
  if (left.kind === "subagent" && left.parentAgentId && left.parentAgentId === right.agentId) {
    return true;
  }
  if (right.kind === "subagent" && right.parentAgentId && right.parentAgentId === left.agentId) {
    return true;
  }
  return false;
}

function placementCollisionArea(left: Placement, right: Placement): number {
  if (left.roomId !== right.roomId) {
    return 0;
  }
  if (areParentLinkedEntities(left.entity, right.entity)) {
    return 0;
  }
  return collisionAreaBetweenBounds(
    collisionBoundsForPoint({ x: left.x, y: left.y }),
    collisionBoundsForPoint({ x: right.x, y: right.y }),
  );
}

function hasCollisionAtPoint(
  point: { x: number; y: number },
  entity: OfficeEntity,
  placed: CollisionPlacement[],
): boolean {
  const candidateBounds = collisionBoundsForPoint(point);
  for (const entry of placed) {
    if (areParentLinkedEntities(entity, entry.placement.entity)) {
      continue;
    }
    if (collisionAreaBetweenBounds(candidateBounds, entry.bounds) > 0) {
      return true;
    }
  }
  return false;
}

function overflowSafeSlotPoint(room: RoomSpec, slotIndex: number): { x: number; y: number } {
  const slotWidth = TOKEN_COLLISION_WIDTH + TOKEN_COLLISION_SPACING;
  const slotHeight = TOKEN_COLLISION_HEIGHT + TOKEN_COLLISION_SPACING;
  const halfWidth = collisionHalfWidth();
  const halfHeight = collisionHalfHeight();
  const usableWidth = Math.max(slotWidth, room.width - halfWidth * 2);
  const columns = Math.max(1, Math.floor(usableWidth / slotWidth));
  const column = slotIndex % columns;
  const row = Math.floor(slotIndex / columns);
  const candidate = {
    x: room.x + halfWidth + column * slotWidth,
    y: room.y + room.height - halfHeight - row * slotHeight,
  };
  return clampPointToRoomWithCollisionBounds(candidate, room);
}

function groupPlacementsByRoom(placements: Placement[]): Map<string, Placement[]> {
  const placementsByRoomId = new Map<string, Placement[]>();
  for (const placement of placements) {
    const bucket = placementsByRoomId.get(placement.roomId) ?? [];
    bucket.push(placement);
    placementsByRoomId.set(placement.roomId, bucket);
  }
  return placementsByRoomId;
}

function resolveCollisionPointForRoom(params: {
  basePoint: { x: number; y: number };
  entity: OfficeEntity;
  room: RoomSpec;
  placed: CollisionPlacement[];
  seed: string;
  fallbackIndex: number;
}): { point: { x: number; y: number }; nextFallbackIndex: number } {
  const { basePoint, entity, room, placed, seed, fallbackIndex } = params;
  const stepX = Math.max(room.spacing.x, TOKEN_COLLISION_WIDTH + TOKEN_COLLISION_SPACING);
  const stepY = Math.max(room.spacing.y, TOKEN_COLLISION_HEIGHT + TOKEN_COLLISION_SPACING);
  const rotation = hashString(seed) % COLLISION_OFFSETS.length;
  const clampedBasePoint = clampPointToRoomWithCollisionBounds(basePoint, room);

  if (!hasCollisionAtPoint(clampedBasePoint, entity, placed)) {
    return {
      point: clampedBasePoint,
      nextFallbackIndex: fallbackIndex,
    };
  }

  for (let index = 1; index < COLLISION_OFFSETS.length; index += 1) {
    const offset = COLLISION_OFFSETS[(rotation + index) % COLLISION_OFFSETS.length];
    if (offset.dx === 0 && offset.dy === 0) {
      continue;
    }
    const candidate = clampPointToRoomWithCollisionBounds(
      {
        x: basePoint.x + offset.dx * stepX,
        y: basePoint.y + offset.dy * stepY,
      },
      room,
    );
    if (!hasCollisionAtPoint(candidate, entity, placed)) {
      return {
        point: candidate,
        nextFallbackIndex: fallbackIndex,
      };
    }
  }

  for (let probe = 0; probe < COLLISION_FALLBACK_SLOT_LIMIT; probe += 1) {
    const slotIndex = fallbackIndex + probe;
    const candidate = overflowSafeSlotPoint(room, slotIndex);
    if (!hasCollisionAtPoint(candidate, entity, placed)) {
      return {
        point: candidate,
        nextFallbackIndex: slotIndex + 1,
      };
    }
  }

  return {
    point: overflowSafeSlotPoint(room, fallbackIndex),
    nextFallbackIndex: fallbackIndex + 1,
  };
}

function resolvePlacementCollisions(params: {
  rooms: RoomSpec[];
  placements: Placement[];
}): void {
  const placementsByRoomId = groupPlacementsByRoom(params.placements);

  for (const room of params.rooms) {
    const bucket = placementsByRoomId.get(room.id) ?? [];
    bucket.sort((left, right) => compareEntities(left.entity, right.entity));
    const settledPlacements: CollisionPlacement[] = [];
    let fallbackIndex = 0;

    for (const placement of bucket) {
      const resolved = resolveCollisionPointForRoom({
        basePoint: { x: placement.x, y: placement.y },
        entity: placement.entity,
        room,
        placed: settledPlacements,
        seed: placement.entity.id,
        fallbackIndex,
      });
      placement.x = resolved.point.x;
      placement.y = resolved.point.y;
      fallbackIndex = resolved.nextFallbackIndex;
      settledPlacements.push({
        placement,
        bounds: collisionBoundsForPoint(resolved.point),
      });
    }
  }
}

export function detectPlacementCollisions(placements: Placement[]): PlacementCollision[] {
  const placementsByRoomId = groupPlacementsByRoom(placements);

  const collisionPairs: PlacementCollision[] = [];
  for (const [roomId, bucket] of placementsByRoomId.entries()) {
    bucket.sort((left, right) => compareEntities(left.entity, right.entity));
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      const left = bucket[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const right = bucket[rightIndex];
        const intersectionArea = placementCollisionArea(left, right);
        if (intersectionArea <= 0) {
          continue;
        }
        collisionPairs.push({
          roomId,
          leftEntityId: left.entity.id,
          rightEntityId: right.entity.id,
          intersectionArea: Math.round(intersectionArea * 100) / 100,
        });
      }
    }
  }

  return collisionPairs;
}

export type RoomCapacityPlanEntry = {
  roomId: string;
  label: string;
  capacity: number;
  targetSharePct: number;
  recommendedLoad: number;
  headroom: number;
  secondaryZoneId?: string;
};

export type RoomCapacityPlan = {
  totalCapacity: number;
  expectedEntities: number;
  utilizationTargetPct: number;
  entries: RoomCapacityPlanEntry[];
};

export function buildRoomCapacityPlan(params?: {
  zoneConfig?: unknown;
  expectedEntities?: number;
}): RoomCapacityPlan {
  const config = normalizeZoneConfig(params?.zoneConfig);
  const totalCapacity = config.rooms.reduce((sum, room) => sum + room.capacity, 0);
  const expectedEntities = Math.max(0, Math.round(params?.expectedEntities ?? totalCapacity));
  const entries = config.rooms.map((room) => {
    const targetSharePct = totalCapacity > 0 ? (room.capacity / totalCapacity) * 100 : 0;
    const recommendedLoad = Math.round((targetSharePct / 100) * expectedEntities);
    const headroom = room.capacity - recommendedLoad;
    return {
      roomId: room.id,
      label: room.label,
      capacity: room.capacity,
      targetSharePct: Number(targetSharePct.toFixed(2)),
      recommendedLoad,
      headroom,
      secondaryZoneId: room.secondaryZoneId,
    };
  });

  return {
    totalCapacity,
    expectedEntities,
    utilizationTargetPct:
      totalCapacity > 0 ? Number(((expectedEntities / totalCapacity) * 100).toFixed(2)) : 0,
    entries,
  };
}

export function getRooms(zoneConfig?: unknown): RoomSpec[] {
  return normalizeZoneConfig(zoneConfig).rooms;
}

export function buildPlacements(params: {
  entities: OfficeEntity[];
  generatedAt: number;
  placementMode?: PlacementMode;
  zoneConfig?: unknown;
}): PlacementResult {
  const config = normalizeZoneConfig(params.zoneConfig);
  const placementMode = params.placementMode ?? "auto";
  const rooms = config.rooms;
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  const roomBuckets = new Map<string, OfficeEntity[]>();
  const occupancyByRoom = new Map<string, number>();
  const targetedByRoom = new Map<string, number>();
  const overflowOutByRoom = new Map<string, number>();
  const overflowInByRoom = new Map<string, number>();
  const parentRoomByAgentId = new Map<string, string>();
  const teamByAgentId = new Map<string, string>();
  const teamLoadByRoom = new Map<string, Map<string, number>>();
  const manualOverridesByRoom = new Map<string, number>();
  const assignmentByEntityId = new Map<string, AssignmentMeta>();

  for (const room of rooms) {
    roomBuckets.set(room.id, []);
    occupancyByRoom.set(room.id, 0);
  }

  const assignmentOrder = [...params.entities].sort(compareEntities);

  for (const entity of assignmentOrder) {
    const manualOverrideRoomId = parseManualRoomOverride(entity, roomById);
    const targetRoom =
      manualOverrideRoomId && roomById.has(manualOverrideRoomId)
        ? (roomById.get(manualOverrideRoomId) as RoomSpec)
        : pickTargetRoom({
            entity,
            rooms,
            priorityOrder: config.priorityOrder,
            generatedAt: params.generatedAt,
            recentWindowMs: config.recentWindowMs,
            parentRoomByAgentId,
            teamByAgentId,
            teamLoadByRoom,
            occupancyByRoom,
          });

    if (manualOverrideRoomId && targetRoom.id === manualOverrideRoomId) {
      manualOverridesByRoom.set(targetRoom.id, (manualOverridesByRoom.get(targetRoom.id) ?? 0) + 1);
    }

    targetedByRoom.set(targetRoom.id, (targetedByRoom.get(targetRoom.id) ?? 0) + 1);

    const resolved = resolveOverflowRoom({
      targetRoom,
      rooms,
      roomById,
      occupancyByRoom,
      defaultOverflowZoneId: config.defaultOverflowZoneId,
      placementMode: manualOverrideRoomId ? "manual" : placementMode,
    });
    occupancyByRoom.set(resolved.roomId, (occupancyByRoom.get(resolved.roomId) ?? 0) + 1);

    if (resolved.overflowed && resolved.roomId !== targetRoom.id) {
      overflowOutByRoom.set(targetRoom.id, (overflowOutByRoom.get(targetRoom.id) ?? 0) + 1);
      overflowInByRoom.set(resolved.roomId, (overflowInByRoom.get(resolved.roomId) ?? 0) + 1);
    }

    roomBuckets.get(resolved.roomId)?.push(entity);
    assignmentByEntityId.set(entity.id, {
      roomId: resolved.roomId,
      targetRoomId: targetRoom.id,
      overflowed: resolved.overflowed,
    });

    const teamId = deriveTeamId(entity, teamByAgentId);
    if (teamId) {
      incrementTeamLoad(teamLoadByRoom, resolved.roomId, teamId);
      if (entity.kind === "agent") {
        teamByAgentId.set(entity.agentId, teamId);
      }
    }

    if (entity.kind === "agent") {
      parentRoomByAgentId.set(entity.agentId, resolved.roomId);
    }
  }

  const placements: Placement[] = [];
  const agentPointByAgentId = new Map<string, { x: number; y: number; roomId: string }>();

  for (const room of rooms) {
    const bucket = roomBuckets.get(room.id) ?? [];
    bucket.sort(compareEntities);
    bucket.forEach((entity, index) => {
      let point = layoutPoint({
        room,
        index,
        total: bucket.length,
        seed: entity.id,
      });

      if (entity.kind === "subagent" && entity.parentAgentId) {
        const parentPoint = agentPointByAgentId.get(entity.parentAgentId);
        if (parentPoint && parentPoint.roomId === room.id) {
          point = applyParentAffinity({
            point,
            room,
            parentPoint,
            seed: entity.id,
            parentAffinityPx: config.parentAffinityPx,
          });
        }
      }

      const assignment = assignmentByEntityId.get(entity.id);
      if (!assignment) {
        return;
      }

      placements.push({
        entity,
        roomId: room.id,
        targetRoomId: assignment.targetRoomId,
        x: point.x,
        y: point.y,
        overflowed: assignment.overflowed,
      });

      if (entity.kind === "agent") {
        agentPointByAgentId.set(entity.agentId, {
          x: point.x,
          y: point.y,
          roomId: room.id,
        });
      }
    });
  }

  resolvePlacementCollisions({ rooms, placements });
  const collisionPairs = detectPlacementCollisions(placements);
  const collisionPairsByRoomId = new Map<string, number>();
  for (const pair of collisionPairs) {
    collisionPairsByRoomId.set(pair.roomId, (collisionPairsByRoomId.get(pair.roomId) ?? 0) + 1);
  }

  const roomDebug = new Map<string, RoomDebugInfo>();
  for (const room of rooms) {
    const assigned = roomBuckets.get(room.id)?.length ?? 0;
    const targeted = targetedByRoom.get(room.id) ?? 0;
    const utilizationPct = Math.round((assigned / Math.max(1, room.capacity)) * 100);
    const saturation: RoomDebugInfo["saturation"] =
      utilizationPct >= 100 ? "high" : utilizationPct >= 70 ? "medium" : "low";
    roomDebug.set(room.id, {
      roomId: room.id,
      capacity: room.capacity,
      assigned,
      targeted,
      overflowIn: overflowInByRoom.get(room.id) ?? 0,
      overflowOut: overflowOutByRoom.get(room.id) ?? 0,
      utilizationPct,
      saturation,
      manualOverrides: manualOverridesByRoom.get(room.id) ?? 0,
      collisionPairs: collisionPairsByRoomId.get(room.id) ?? 0,
      secondaryZoneId: room.secondaryZoneId,
    });
  }

  return {
    rooms,
    placements,
    collisionPairs,
    roomDebug,
    configVersion: config.version,
  };
}
