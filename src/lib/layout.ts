import type { OfficeEntity, OfficeEntityStatus } from "../types/office";

export type RoomShape = "grid" | "ring" | "line" | "cluster";
export type ZonePriorityKey = "status" | "role" | "parent" | "recent";
export type EntityRole = "strategy" | "ops" | "build" | "spawn" | "recovery";

type RoomRoutingSpec = {
  statuses: OfficeEntityStatus[];
  kinds: Array<OfficeEntity["kind"]>;
  recentWeight: number;
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

export type RoomDebugInfo = {
  roomId: string;
  capacity: number;
  assigned: number;
  targeted: number;
  overflowIn: number;
  overflowOut: number;
  secondaryZoneId?: string;
};

export type PlacementResult = {
  rooms: RoomSpec[];
  placements: Placement[];
  roomDebug: Map<string, RoomDebugInfo>;
  configVersion: number;
};

const VALID_STATUSES: readonly OfficeEntityStatus[] = ["active", "idle", "offline", "ok", "error"];
const VALID_PRIORITIES: readonly ZonePriorityKey[] = ["status", "role", "parent", "recent"];
const DEFAULT_PRIORITY_ORDER: ZonePriorityKey[] = ["status", "role", "parent", "recent"];

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
      x: 280,
      y: 70,
      width: 330,
      height: 180,
      fill: "rgba(47, 106, 140, 0.82)",
      border: "#8cd7ff",
      capacity: 10,
      spacing: { x: 42, y: 28 },
      anchor: { x: 0.5, y: 0.48 },
      secondaryZoneId: "ops",
      routing: {
        statuses: ["active"],
        kinds: ["agent"],
        recentWeight: 0.2,
      },
    },
    {
      id: "ops",
      label: "Ops Floor",
      shape: "grid",
      role: "ops",
      x: 70,
      y: 210,
      width: 420,
      height: 250,
      fill: "rgba(40, 88, 115, 0.85)",
      border: "#74d1f8",
      capacity: 16,
      spacing: { x: 64, y: 52 },
      anchor: { x: 0.5, y: 0.5 },
      secondaryZoneId: "build",
      routing: {
        statuses: ["ok", "offline"],
        kinds: ["agent"],
        recentWeight: 0.15,
      },
    },
    {
      id: "build",
      label: "Build Pods",
      shape: "line",
      role: "build",
      x: 560,
      y: 235,
      width: 330,
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
      },
    },
    {
      id: "spawn",
      label: "Spawn Lab",
      shape: "cluster",
      role: "spawn",
      x: 520,
      y: 70,
      width: 390,
      height: 160,
      fill: "rgba(17, 82, 111, 0.82)",
      border: "#5ec6ff",
      capacity: 14,
      spacing: { x: 48, y: 30 },
      anchor: { x: 0.54, y: 0.52 },
      secondaryZoneId: "ops",
      routing: {
        statuses: ["active", "idle"],
        kinds: ["subagent"],
        recentWeight: 0.35,
      },
    },
    {
      id: "lounge",
      label: "Recovery Lounge",
      shape: "cluster",
      role: "recovery",
      x: 300,
      y: 470,
      width: 420,
      height: 150,
      fill: "rgba(13, 97, 120, 0.82)",
      border: "#70f2ff",
      capacity: 12,
      spacing: { x: 54, y: 28 },
      anchor: { x: 0.5, y: 0.52 },
      secondaryZoneId: "ops",
      routing: {
        statuses: ["ok", "error", "offline"],
        kinds: ["agent", "subagent"],
        recentWeight: 0.25,
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

function normalizeStatuses(value: unknown, fallback: OfficeEntityStatus[]): OfficeEntityStatus[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value.filter(
    (entry): entry is OfficeEntityStatus =>
      typeof entry === "string" && (VALID_STATUSES as readonly string[]).includes(entry),
  );
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeKinds(
  value: unknown,
  fallback: Array<OfficeEntity["kind"]>,
): Array<OfficeEntity["kind"]> {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value.filter(
    (entry): entry is OfficeEntity["kind"] => entry === "agent" || entry === "subagent",
  );
  return normalized.length > 0 ? normalized : fallback;
}

function normalizePriorityOrder(value: unknown): ZonePriorityKey[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PRIORITY_ORDER;
  }
  const normalized = value.filter(
    (entry): entry is ZonePriorityKey =>
      typeof entry === "string" && (VALID_PRIORITIES as readonly string[]).includes(entry),
  );
  if (normalized.length === 0) {
    return DEFAULT_PRIORITY_ORDER;
  }
  const deduped: ZonePriorityKey[] = [];
  for (const key of normalized) {
    if (!deduped.includes(key)) {
      deduped.push(key);
    }
  }
  for (const key of DEFAULT_PRIORITY_ORDER) {
    if (!deduped.includes(key)) {
      deduped.push(key);
    }
  }
  return deduped;
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

function scoreRoom(params: {
  entity: OfficeEntity;
  role: EntityRole;
  room: RoomSpec;
  parentRoomId?: string;
  generatedAt: number;
  recentWindowMs: number;
}): ScoreVector {
  const { entity, role, room, parentRoomId, generatedAt, recentWindowMs } = params;
  const statusMatch = room.routing.statuses.includes(entity.status) ? 1 : 0;
  const kindMatch = room.routing.kinds.includes(entity.kind) ? 1 : 0;
  const roleMatch = room.role === role ? 1 : 0;
  const parentMatch = entity.kind === "subagent" && parentRoomId === room.id ? 1 : 0;
  const isRecent =
    typeof entity.lastUpdatedAt === "number" &&
    generatedAt - entity.lastUpdatedAt >= 0 &&
    generatedAt - entity.lastUpdatedAt <= recentWindowMs;

  return {
    status: statusMatch,
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

function pickTargetRoom(params: {
  entity: OfficeEntity;
  rooms: RoomSpec[];
  priorityOrder: ZonePriorityKey[];
  generatedAt: number;
  recentWindowMs: number;
  parentRoomByAgentId: Map<string, string>;
}): RoomSpec {
  const { entity, rooms, priorityOrder, generatedAt, recentWindowMs, parentRoomByAgentId } = params;
  const role = deriveRole(entity);
  const parentRoomId = entity.parentAgentId
    ? parentRoomByAgentId.get(entity.parentAgentId)
    : undefined;

  let bestRoom = rooms[0];
  let bestScore = scoreRoom({
    entity,
    role,
    room: bestRoom,
    parentRoomId,
    generatedAt,
    recentWindowMs,
  });

  for (let index = 1; index < rooms.length; index += 1) {
    const candidate = rooms[index];
    const candidateScore = scoreRoom({
      entity,
      role,
      room: candidate,
      parentRoomId,
      generatedAt,
      recentWindowMs,
    });
    const comparison = compareScoreVectors(candidateScore, bestScore, priorityOrder);
    if (comparison > 0 || (comparison === 0 && candidate.id.localeCompare(bestRoom.id) < 0)) {
      bestRoom = candidate;
      bestScore = candidateScore;
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
}): { roomId: string; overflowed: boolean } {
  const { targetRoom, rooms, roomById, occupancyByRoom, defaultOverflowZoneId } = params;
  const targetOccupancy = occupancyByRoom.get(targetRoom.id) ?? 0;
  if (targetOccupancy < targetRoom.capacity) {
    return { roomId: targetRoom.id, overflowed: false };
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

export function getRooms(zoneConfig?: unknown): RoomSpec[] {
  return normalizeZoneConfig(zoneConfig).rooms;
}

export function buildPlacements(params: {
  entities: OfficeEntity[];
  generatedAt: number;
  zoneConfig?: unknown;
}): PlacementResult {
  const config = normalizeZoneConfig(params.zoneConfig);
  const rooms = config.rooms;
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  const roomBuckets = new Map<string, OfficeEntity[]>();
  const occupancyByRoom = new Map<string, number>();
  const targetedByRoom = new Map<string, number>();
  const overflowOutByRoom = new Map<string, number>();
  const overflowInByRoom = new Map<string, number>();
  const parentRoomByAgentId = new Map<string, string>();
  const assignmentByEntityId = new Map<string, AssignmentMeta>();

  for (const room of rooms) {
    roomBuckets.set(room.id, []);
    occupancyByRoom.set(room.id, 0);
  }

  const assignmentOrder = [...params.entities].sort(compareEntities);

  for (const entity of assignmentOrder) {
    const targetRoom = pickTargetRoom({
      entity,
      rooms,
      priorityOrder: config.priorityOrder,
      generatedAt: params.generatedAt,
      recentWindowMs: config.recentWindowMs,
      parentRoomByAgentId,
    });

    targetedByRoom.set(targetRoom.id, (targetedByRoom.get(targetRoom.id) ?? 0) + 1);

    const resolved = resolveOverflowRoom({
      targetRoom,
      rooms,
      roomById,
      occupancyByRoom,
      defaultOverflowZoneId: config.defaultOverflowZoneId,
    });
    occupancyByRoom.set(resolved.roomId, (occupancyByRoom.get(resolved.roomId) ?? 0) + 1);

    if (resolved.overflowed) {
      overflowOutByRoom.set(targetRoom.id, (overflowOutByRoom.get(targetRoom.id) ?? 0) + 1);
      overflowInByRoom.set(resolved.roomId, (overflowInByRoom.get(resolved.roomId) ?? 0) + 1);
    }

    roomBuckets.get(resolved.roomId)?.push(entity);
    assignmentByEntityId.set(entity.id, {
      roomId: resolved.roomId,
      targetRoomId: targetRoom.id,
      overflowed: resolved.overflowed,
    });

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

  const roomDebug = new Map<string, RoomDebugInfo>();
  for (const room of rooms) {
    const assigned = roomBuckets.get(room.id)?.length ?? 0;
    const targeted = targetedByRoom.get(room.id) ?? 0;
    roomDebug.set(room.id, {
      roomId: room.id,
      capacity: room.capacity,
      assigned,
      targeted,
      overflowIn: overflowInByRoom.get(room.id) ?? 0,
      overflowOut: overflowOutByRoom.get(room.id) ?? 0,
      secondaryZoneId: room.secondaryZoneId,
    });
  }

  return {
    rooms,
    placements,
    roomDebug,
    configVersion: config.version,
  };
}
