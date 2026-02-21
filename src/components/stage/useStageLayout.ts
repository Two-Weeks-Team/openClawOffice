import { useEffect, useMemo, useRef } from "react";
import {
  buildPlacements,
  type Placement,
  type PlacementMode,
  type PlacementResult,
  type RoomDebugInfo,
  type RoomSpec,
} from "../../lib/layout";
import type { OfficeEntity, OfficeSnapshot } from "../../types/office";

type UseStageLayoutOptions = {
  snapshot: OfficeSnapshot;
  activeEntities: OfficeEntity[];
  placementMode: PlacementMode;
  zoneConfig: unknown;
  filterEntityIds: string[];
  hasEntityFilter: boolean;
  roomFilterId: string;
  onRoomOptionsChange?: (roomIds: string[]) => void;
  onRoomAssignmentsChange?: (roomByAgentId: Map<string, string>) => void;
  onFilterMatchCountChange?: (count: number) => void;
};

type StageLayoutResult = {
  layoutState: PlacementResult;
  rooms: RoomSpec[];
  placements: Placement[];
  collisionPairCount: number;
  roomDebug: Map<string, RoomDebugInfo>;
  roomDensityMode: Map<string, "standard" | "compact" | "dense">;
  placementByEntityId: Map<string, Placement>;
  placementById: Map<string, Placement>;
  filteredEntityIdSet: Set<string>;
  normalizedRoomFilterId: string | null;
  hasRoomFilter: boolean;
  hasOpsFilter: boolean;
  matchedEntityCount: number;
};

export function useStageLayout({
  snapshot,
  activeEntities,
  placementMode,
  zoneConfig,
  filterEntityIds,
  hasEntityFilter,
  roomFilterId,
  onRoomOptionsChange,
  onRoomAssignmentsChange,
  onFilterMatchCountChange,
}: UseStageLayoutOptions): StageLayoutResult {
  const previousRoomOptionsKeyRef = useRef("");
  const previousRoomAssignmentsKeyRef = useRef("");

  const layoutState = useMemo(
    () =>
      buildPlacements({
        entities: activeEntities,
        generatedAt: snapshot.generatedAt,
        placementMode,
        zoneConfig,
      }),
    [placementMode, activeEntities, snapshot.generatedAt, zoneConfig],
  );

  const rooms = layoutState.rooms;
  const placements = layoutState.placements;
  const collisionPairCount = layoutState.collisionPairs.length;
  const filteredEntityIdSet = useMemo(() => new Set(filterEntityIds), [filterEntityIds]);

  const roomDensityMode = useMemo(() => {
    const densityByRoom = new Map<string, "standard" | "compact" | "dense">();
    for (const room of rooms) {
      const debug = layoutState.roomDebug.get(room.id);
      const count = debug?.assigned ?? 0;
      if (count >= 26) {
        densityByRoom.set(room.id, "dense");
      } else if (count >= 10) {
        densityByRoom.set(room.id, "compact");
      } else {
        densityByRoom.set(room.id, "standard");
      }
    }
    return densityByRoom;
  }, [rooms, layoutState.roomDebug]);

  const placementByEntityId = useMemo(
    () => new Map(placements.map((p) => [p.entity.id, p] as const)),
    [placements],
  );

  const placementById = useMemo(() => {
    const map = new Map<string, Placement>();
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

  const normalizedRoomFilterId =
    roomFilterId.trim() !== "" && roomFilterId !== "all" ? roomFilterId : null;
  const hasRoomFilter = Boolean(normalizedRoomFilterId);
  const hasOpsFilter = hasEntityFilter || hasRoomFilter;

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

  useEffect(() => {
    if (!onFilterMatchCountChange) {
      return;
    }
    onFilterMatchCountChange(matchedEntityCount);
  }, [matchedEntityCount, onFilterMatchCountChange]);

  return {
    layoutState,
    rooms,
    placements,
    collisionPairCount,
    roomDebug: layoutState.roomDebug,
    roomDensityMode,
    placementByEntityId,
    placementById,
    filteredEntityIdSet,
    normalizedRoomFilterId,
    hasRoomFilter,
    hasOpsFilter,
    matchedEntityCount,
  };
}
