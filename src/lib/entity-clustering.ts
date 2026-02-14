import type { OfficeEntity } from "../types/office";

export type ClusterStatusBucket = "error" | "active" | "normal";

export type ClusterPlacement = {
  entity: OfficeEntity;
  roomId: string;
  x: number;
  y: number;
};

export type EntityCluster = {
  id: string;
  roomId: string;
  statusBucket: ClusterStatusBucket;
  relationKey: string;
  memberEntityIds: string[];
  memberCount: number;
  x: number;
  y: number;
  label: string;
  summary: string;
};

export type BuildEntityClustersOptions = {
  cellSize?: number;
  minMembers?: number;
};

const DEFAULT_CELL_SIZE = 88;
const DEFAULT_MIN_MEMBERS = 3;

function statusBucketForEntity(entity: OfficeEntity): ClusterStatusBucket {
  if (entity.status === "error") {
    return "error";
  }
  if (entity.status === "active") {
    return "active";
  }
  return "normal";
}

function relationKeyForEntity(entity: OfficeEntity): string {
  if (entity.kind === "subagent" && entity.runId) {
    return `run:${entity.runId}`;
  }
  if (entity.kind === "subagent" && entity.parentAgentId) {
    return `parent:${entity.parentAgentId}`;
  }
  return `agent:${entity.agentId}`;
}

function clusterLabel(statusBucket: ClusterStatusBucket): string {
  if (statusBucket === "error") {
    return "Error cluster";
  }
  if (statusBucket === "active") {
    return "Active cluster";
  }
  return "Dense cluster";
}

function relationSummary(relationKey: string): string {
  if (relationKey.startsWith("run:")) {
    return relationKey.replace(/^run:/, "run ");
  }
  if (relationKey.startsWith("parent:")) {
    return relationKey.replace(/^parent:/, "parent ");
  }
  return relationKey.replace(/^agent:/, "agent ");
}

export function buildEntityClusters(
  placements: ClusterPlacement[],
  options: BuildEntityClustersOptions = {},
): {
  clusters: EntityCluster[];
  memberToClusterId: Map<string, string>;
} {
  const cellSize = Math.max(32, options.cellSize ?? DEFAULT_CELL_SIZE);
  const minMembers = Math.max(2, options.minMembers ?? DEFAULT_MIN_MEMBERS);

  const grouped = new Map<string, ClusterPlacement[]>();
  for (const placement of placements) {
    const gridX = Math.floor(placement.x / cellSize);
    const gridY = Math.floor(placement.y / cellSize);
    const statusBucket = statusBucketForEntity(placement.entity);
    const relationKey = relationKeyForEntity(placement.entity);
    const key = `${placement.roomId}|${statusBucket}|${relationKey}|${gridX}:${gridY}`;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(placement);
    } else {
      grouped.set(key, [placement]);
    }
  }

  const clusters: EntityCluster[] = [];
  const memberToClusterId = new Map<string, string>();
  for (const [groupKey, group] of grouped.entries()) {
    if (group.length < minMembers) {
      continue;
    }
    const [roomId, statusBucketRaw, relationKey] = groupKey.split("|");
    const statusBucket = (statusBucketRaw as ClusterStatusBucket) ?? "normal";
    const clusterId = `cluster:${groupKey}`;
    const memberEntityIds = group.map((item) => item.entity.id);
    const centerX = group.reduce((sum, item) => sum + item.x, 0) / group.length;
    const centerY = group.reduce((sum, item) => sum + item.y, 0) / group.length;

    clusters.push({
      id: clusterId,
      roomId: roomId ?? "unknown",
      statusBucket,
      relationKey: relationKey ?? "agent:unknown",
      memberEntityIds,
      memberCount: group.length,
      x: Math.round(centerX),
      y: Math.round(centerY),
      label: clusterLabel(statusBucket),
      summary: `${group.length} entities - ${relationSummary(relationKey ?? "agent:unknown")}`,
    });
    for (const entityId of memberEntityIds) {
      memberToClusterId.set(entityId, clusterId);
    }
  }

  clusters.sort((left, right) => {
    if (left.memberCount !== right.memberCount) {
      return right.memberCount - left.memberCount;
    }
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    clusters,
    memberToClusterId,
  };
}
