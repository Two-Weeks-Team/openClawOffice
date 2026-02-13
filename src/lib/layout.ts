import type { OfficeEntity } from "../types/office";

export type RoomShape = "grid" | "ring" | "line" | "cluster";

export type RoomSpec = {
  id: string;
  label: string;
  shape: RoomShape;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  border: string;
};

export type Placement = {
  entity: OfficeEntity;
  roomId: string;
  x: number;
  y: number;
};

const ROOMS: RoomSpec[] = [
  {
    id: "strategy",
    label: "Strategy Room",
    shape: "ring",
    x: 280,
    y: 70,
    width: 330,
    height: 180,
    fill: "rgba(47, 106, 140, 0.82)",
    border: "#8cd7ff",
  },
  {
    id: "ops",
    label: "Ops Floor",
    shape: "grid",
    x: 70,
    y: 210,
    width: 420,
    height: 250,
    fill: "rgba(40, 88, 115, 0.85)",
    border: "#74d1f8",
  },
  {
    id: "build",
    label: "Build Pods",
    shape: "line",
    x: 560,
    y: 235,
    width: 330,
    height: 200,
    fill: "rgba(44, 125, 132, 0.84)",
    border: "#8cf8dc",
  },
  {
    id: "spawn",
    label: "Spawn Lab",
    shape: "cluster",
    x: 520,
    y: 70,
    width: 390,
    height: 160,
    fill: "rgba(17, 82, 111, 0.82)",
    border: "#5ec6ff",
  },
  {
    id: "lounge",
    label: "Recovery Lounge",
    shape: "cluster",
    x: 300,
    y: 470,
    width: 420,
    height: 150,
    fill: "rgba(13, 97, 120, 0.82)",
    border: "#70f2ff",
  },
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function layoutPoint(params: {
  shape: RoomShape;
  index: number;
  total: number;
  room: RoomSpec;
  seed: string;
}): { x: number; y: number } {
  const { shape, index, total, room, seed } = params;
  const ratio = total <= 1 ? 0.5 : index / (total - 1);

  if (shape === "ring") {
    const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
    const rx = room.width * 0.34;
    const ry = room.height * 0.28;
    return {
      x: room.x + room.width / 2 + Math.cos(angle) * rx,
      y: room.y + room.height / 2 + Math.sin(angle) * ry,
    };
  }

  if (shape === "grid") {
    const cols = Math.max(2, Math.ceil(Math.sqrt(total)));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const rows = Math.max(1, Math.ceil(total / cols));
    const x = room.x + 36 + (col / Math.max(cols - 1, 1)) * (room.width - 72);
    const y = room.y + 30 + (row / Math.max(rows - 1, 1)) * (room.height - 62);
    return { x, y };
  }

  if (shape === "line") {
    return {
      x: room.x + 28 + ratio * (room.width - 56),
      y: room.y + room.height * 0.3 + (index % 2 === 0 ? -20 : 22),
    };
  }

  const hash = hashString(seed);
  const jitterX = ((hash % 100) / 100 - 0.5) * room.width * 0.25;
  const jitterY = (((hash / 100) % 100) / 100 - 0.5) * room.height * 0.3;
  return {
    x: room.x + room.width * (0.18 + ratio * 0.64) + jitterX,
    y: room.y + room.height * (0.35 + ((index % 3) - 1) * 0.18) + jitterY,
  };
}

function classifyRoom(entity: OfficeEntity): string {
  if (entity.kind === "subagent") {
    // Completed or errored subagents go to Recovery Lounge
    if (entity.status === "ok" || entity.status === "error") {
      return "lounge";
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
    return "lounge";
  }
  return "ops";
}

export function getRooms(): RoomSpec[] {
  return ROOMS;
}

export function buildPlacements(entities: OfficeEntity[]): Placement[] {
  const roomBuckets = new Map<string, OfficeEntity[]>();
  for (const room of ROOMS) {
    roomBuckets.set(room.id, []);
  }

  for (const entity of entities) {
    const roomId = classifyRoom(entity);
    const bucket = roomBuckets.get(roomId);
    if (bucket) {
      bucket.push(entity);
    }
  }

  const placements: Placement[] = [];
  for (const room of ROOMS) {
    const bucket = roomBuckets.get(room.id) ?? [];
    bucket.sort((a, b) => a.label.localeCompare(b.label));
    bucket.forEach((entity, index) => {
      const point = layoutPoint({
        shape: room.shape,
        index,
        total: bucket.length,
        room,
        seed: entity.id,
      });
      placements.push({
        entity,
        roomId: room.id,
        x: point.x,
        y: point.y,
      });
    });
  }

  return placements;
}
