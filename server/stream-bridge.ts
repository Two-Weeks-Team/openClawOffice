import type { OfficeEvent, OfficeSnapshot } from "./office-types";

export type LifecycleEnvelope = {
  seq: number;
  event: OfficeEvent;
};

type BridgeOptions = {
  maxQueue: number;
  maxSeen: number;
  maxEmitPerSnapshot: number;
};

const DEFAULT_OPTIONS: BridgeOptions = {
  maxQueue: 1200,
  maxSeen: 4000,
  maxEmitPerSnapshot: 180,
};

export type StreamPressureStats = {
  backpressureActivations: number;
  droppedUnseenEvents: number;
  evictedBackfillEvents: number;
};

function lifecycleEventOrder(a: OfficeEvent, b: OfficeEvent): number {
  if (a.at !== b.at) {
    return a.at - b.at;
  }
  const runOrder = a.runId.localeCompare(b.runId);
  if (runOrder !== 0) {
    return runOrder;
  }
  const typeOrder = a.type.localeCompare(b.type);
  if (typeOrder !== 0) {
    return typeOrder;
  }
  return a.id.localeCompare(b.id);
}

export class OfficeStreamBridge {
  private readonly options: BridgeOptions;

  private seq = 0;

  private latestSnapshot: OfficeSnapshot | null = null;

  private readonly seenEventIds = new Set<string>();

  private readonly seenOrder: string[] = [];

  private readonly queue: LifecycleEnvelope[] = [];

  private pendingPressureStats: StreamPressureStats = {
    backpressureActivations: 0,
    droppedUnseenEvents: 0,
    evictedBackfillEvents: 0,
  };

  constructor(options?: Partial<BridgeOptions>) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  getLatestSnapshot() {
    return this.latestSnapshot;
  }

  getBackfill(afterSeq: number): LifecycleEnvelope[] {
    const firstIndex = this.queue.findIndex((entry) => entry.seq > afterSeq);
    if (firstIndex === -1) {
      return [];
    }
    return this.queue.slice(firstIndex);
  }

  consumePressureStats(): StreamPressureStats {
    const stats = this.pendingPressureStats;
    this.pendingPressureStats = {
      backpressureActivations: 0,
      droppedUnseenEvents: 0,
      evictedBackfillEvents: 0,
    };
    return stats;
  }

  ingestSnapshot(snapshot: OfficeSnapshot): LifecycleEnvelope[] {
    this.latestSnapshot = snapshot;

    const firstSnapshot = this.seenEventIds.size === 0;
    if (firstSnapshot) {
      this.rememberEvents(snapshot.events);
      return [];
    }

    const unseen = snapshot.events.filter((event) => !this.seenEventIds.has(event.id));
    if (unseen.length === 0) {
      return [];
    }

    unseen.sort(lifecycleEventOrder);
    this.rememberEvents(unseen);

    let toEmit = unseen;
    if (unseen.length > this.options.maxEmitPerSnapshot) {
      const dropCount = unseen.length - this.options.maxEmitPerSnapshot;
      toEmit = unseen.slice(dropCount);
      this.pendingPressureStats.backpressureActivations += 1;
      this.pendingPressureStats.droppedUnseenEvents += dropCount;
    }

    const frames: LifecycleEnvelope[] = [];
    for (const event of toEmit) {
      this.seq += 1;
      const frame = { seq: this.seq, event };
      this.queue.push(frame);
      frames.push(frame);
    }

    if (this.queue.length > this.options.maxQueue) {
      const removeCount = this.queue.length - this.options.maxQueue;
      this.queue.splice(0, removeCount);
      this.pendingPressureStats.backpressureActivations += 1;
      this.pendingPressureStats.evictedBackfillEvents += removeCount;
    }

    return frames;
  }

  private rememberEvents(events: OfficeEvent[]) {
    for (const event of events) {
      if (this.seenEventIds.has(event.id)) {
        continue;
      }
      this.seenEventIds.add(event.id);
      this.seenOrder.push(event.id);
    }

    if (this.seenOrder.length > this.options.maxSeen) {
      const removeCount = this.seenOrder.length - this.options.maxSeen;
      const removed = this.seenOrder.splice(0, removeCount);
      for (const removedId of removed) {
        this.seenEventIds.delete(removedId);
      }
    }
  }
}

export function parseLifecycleCursor(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  if (parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}
