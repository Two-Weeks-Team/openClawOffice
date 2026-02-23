import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { isOfficeSnapshot, type OfficeSnapshot } from "./office-types";
import { logStructuredEvent } from "./api-observability";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const INDEX_VERSION = 1;
const INDEX_FILE_NAME = "index.json";
const SNAPSHOT_FILE_SUFFIX = ".json.gz";

const DEFAULT_POLICY = {
  minIntervalMs: 15_000,
  maxSnapshots: 240,
  maxTotalBytes: 256 * 1024 * 1024,
  maxAgeMs: 3 * 24 * 60 * 60 * 1000,
} as const;

type SnapshotStoreIndexFile = {
  version: number;
  updatedAt: number;
  totalBytes: number;
  entries: ReplaySnapshotIndexEntry[];
};

type PersistResult = {
  stored: boolean;
  reason?: "interval";
  entry?: ReplaySnapshotIndexEntry;
};

export type SnapshotStorePolicy = {
  minIntervalMs: number;
  maxSnapshots: number;
  maxTotalBytes: number;
  maxAgeMs: number;
};

export type ReplaySnapshotIndexEntry = {
  snapshotId: string;
  generatedAt: number;
  storedAt: number;
  fileName: string;
  sizeBytes: number;
  runIds: string[];
  agentIds: string[];
  entityCount: number;
  eventCount: number;
};

export type ReplaySnapshotIndexQuery = {
  runId?: string;
  agentId?: string;
  from?: number;
  to?: number;
  limit?: number;
};

export type ReplaySnapshotIndexResult = {
  generatedAt: number;
  totalEntries: number;
  totalBytes: number;
  policy: SnapshotStorePolicy;
  entries: ReplaySnapshotIndexEntry[];
};

export type ReplaySnapshotResolveResult = {
  resolvedAt: number;
  entry: ReplaySnapshotIndexEntry;
  snapshot: OfficeSnapshot;
};

export type SnapshotStoreMetrics = {
  persistedSnapshots: number;
  skippedByInterval: number;
  evictedSnapshots: number;
  lastStoredAt: number;
  totalEntries: number;
  totalBytes: number;
  policy: SnapshotStorePolicy;
};

function parseInteger(input: string | undefined, fallback: number, min: number): number {
  if (!input) {
    return fallback;
  }
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.floor(parsed));
}

function policyFromEnv(): SnapshotStorePolicy {
  return {
    minIntervalMs: parseInteger(
      process.env.OPENCLAW_SNAPSHOT_MIN_INTERVAL_MS,
      DEFAULT_POLICY.minIntervalMs,
      0,
    ),
    maxSnapshots: parseInteger(process.env.OPENCLAW_SNAPSHOT_MAX_ENTRIES, DEFAULT_POLICY.maxSnapshots, 1),
    maxTotalBytes: parseInteger(
      process.env.OPENCLAW_SNAPSHOT_MAX_BYTES,
      DEFAULT_POLICY.maxTotalBytes,
      1_048_576,
    ),
    maxAgeMs: parseInteger(process.env.OPENCLAW_SNAPSHOT_MAX_AGE_MS, DEFAULT_POLICY.maxAgeMs, 60_000),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizePolicy(input?: Partial<SnapshotStorePolicy>): SnapshotStorePolicy {
  const defaults = policyFromEnv();
  return {
    minIntervalMs: Math.max(0, Math.floor(input?.minIntervalMs ?? defaults.minIntervalMs)),
    maxSnapshots: Math.max(1, Math.floor(input?.maxSnapshots ?? defaults.maxSnapshots)),
    maxTotalBytes: Math.max(1_048_576, Math.floor(input?.maxTotalBytes ?? defaults.maxTotalBytes)),
    maxAgeMs: Math.max(60_000, Math.floor(input?.maxAgeMs ?? defaults.maxAgeMs)),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeEntry(value: unknown): ReplaySnapshotIndexEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Partial<ReplaySnapshotIndexEntry>;
  if (
    typeof entry.snapshotId !== "string" ||
    !isFiniteNumber(entry.generatedAt) ||
    !isFiniteNumber(entry.storedAt) ||
    typeof entry.fileName !== "string" ||
    !isFiniteNumber(entry.sizeBytes)
  ) {
    return null;
  }
  return {
    snapshotId: entry.snapshotId,
    generatedAt: Math.floor(entry.generatedAt),
    storedAt: Math.floor(entry.storedAt),
    fileName: entry.fileName,
    sizeBytes: Math.max(0, Math.floor(entry.sizeBytes)),
    runIds: uniqueSorted(Array.isArray(entry.runIds) ? entry.runIds.filter((item): item is string => typeof item === "string") : []),
    agentIds: uniqueSorted(
      Array.isArray(entry.agentIds) ? entry.agentIds.filter((item): item is string => typeof item === "string") : [],
    ),
    entityCount: isFiniteNumber(entry.entityCount) ? Math.max(0, Math.floor(entry.entityCount)) : 0,
    eventCount: isFiniteNumber(entry.eventCount) ? Math.max(0, Math.floor(entry.eventCount)) : 0,
  };
}

function normalizeIndexFile(value: unknown): SnapshotStoreIndexFile {
  if (!value || typeof value !== "object") {
    return {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      totalBytes: 0,
      entries: [],
    };
  }
  const parsed = value as Partial<SnapshotStoreIndexFile>;
  const entries = Array.isArray(parsed.entries)
    ? parsed.entries
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is ReplaySnapshotIndexEntry => Boolean(entry))
        .sort((left, right) => right.generatedAt - left.generatedAt || right.storedAt - left.storedAt)
    : [];
  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  return {
    version: INDEX_VERSION,
    updatedAt: isFiniteNumber(parsed.updatedAt) ? Math.floor(parsed.updatedAt) : Date.now(),
    totalBytes,
    entries,
  };
}

function toSnapshotId(generatedAt: number): string {
  return `${generatedAt}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Error codes that indicate the storage directory is permanently unwritable. */
const READONLY_FS_CODES = new Set(["EROFS", "EACCES", "EPERM"]);

export class OfficeSnapshotStore {
  private readonly rootDir: string;
  private readonly indexPath: string;
  private readonly policy: SnapshotStorePolicy;
  private indexCache: SnapshotStoreIndexFile | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private lastPersistAttemptAt = 0;
  private metrics: SnapshotStoreMetrics;
  /** Set to true after a permanent write failure so subsequent calls are skipped silently. */
  private persistenceDisabled = false;

  constructor(rootDir: string, policy?: Partial<SnapshotStorePolicy>) {
    this.rootDir = rootDir;
    this.indexPath = path.join(rootDir, INDEX_FILE_NAME);
    this.policy = normalizePolicy(policy);
    this.metrics = {
      persistedSnapshots: 0,
      skippedByInterval: 0,
      evictedSnapshots: 0,
      lastStoredAt: 0,
      totalEntries: 0,
      totalBytes: 0,
      policy: this.policy,
    };
  }

  static forStateDir(stateDir: string, policy?: Partial<SnapshotStorePolicy>): OfficeSnapshotStore {
    return new OfficeSnapshotStore(path.join(stateDir, ".openclawoffice", "replay-snapshots"), policy);
  }

  /**
   * Create a store that writes to a dedicated replay directory.
   * Use when `OPENCLAW_REPLAY_DIR` is set to keep replay data on a writable
   * volume separate from the (potentially read-only) state dir.
   */
  static forReplayDir(replayDir: string, policy?: Partial<SnapshotStorePolicy>): OfficeSnapshotStore {
    return new OfficeSnapshotStore(replayDir, policy);
  }

  /** Returns true when persistence has been permanently disabled due to a write error. */
  isPersistenceDisabled(): boolean {
    return this.persistenceDisabled;
  }

  getMetrics(): SnapshotStoreMetrics {
    return {
      ...this.metrics,
      policy: { ...this.policy },
    };
  }

  async queryIndex(query: ReplaySnapshotIndexQuery = {}): Promise<ReplaySnapshotIndexResult> {
    const index = await this.loadIndexFile();
    const limit = Math.min(500, Math.max(1, Math.floor(query.limit ?? 120)));
    const runId = query.runId?.trim();
    const agentId = query.agentId?.trim();
    const from = isFiniteNumber(query.from) ? Math.floor(query.from) : undefined;
    const to = isFiniteNumber(query.to) ? Math.floor(query.to) : undefined;

    const entries = index.entries
      .filter((entry) => {
        if (runId && !entry.runIds.includes(runId)) {
          return false;
        }
        if (agentId && !entry.agentIds.includes(agentId)) {
          return false;
        }
        if (from !== undefined && entry.generatedAt < from) {
          return false;
        }
        if (to !== undefined && entry.generatedAt > to) {
          return false;
        }
        return true;
      })
      .slice(0, limit);

    this.syncMetricsFromIndex(index);

    return {
      generatedAt: Date.now(),
      totalEntries: index.entries.length,
      totalBytes: index.totalBytes,
      policy: { ...this.policy },
      entries,
    };
  }

  async readSnapshotById(snapshotId: string): Promise<ReplaySnapshotResolveResult | null> {
    const index = await this.loadIndexFile();
    const normalizedId = snapshotId.trim();
    if (!normalizedId) {
      return null;
    }
    const entry = index.entries.find((item) => item.snapshotId === normalizedId);
    if (!entry) {
      return null;
    }
    const snapshot = await this.readSnapshotFile(entry.fileName);
    return {
      resolvedAt: entry.generatedAt,
      entry,
      snapshot,
    };
  }

  async readSnapshotAt(timestamp: number): Promise<ReplaySnapshotResolveResult | null> {
    const index = await this.loadIndexFile();
    if (index.entries.length === 0 || !Number.isFinite(timestamp)) {
      return null;
    }
    const target = Math.floor(timestamp);
    const entry =
      index.entries.find((item) => item.generatedAt <= target) ??
      index.entries[index.entries.length - 1] ??
      null;
    if (!entry) {
      return null;
    }
    const snapshot = await this.readSnapshotFile(entry.fileName);
    return {
      resolvedAt: entry.generatedAt,
      entry,
      snapshot,
    };
  }

  async persistSnapshot(snapshot: OfficeSnapshot): Promise<PersistResult> {
    if (this.persistenceDisabled) {
      return { stored: false, reason: "interval" };
    }
    const now = Date.now();
    if (now - this.lastPersistAttemptAt < this.policy.minIntervalMs) {
      this.metrics.skippedByInterval += 1;
      return {
        stored: false,
        reason: "interval",
      };
    }
    this.lastPersistAttemptAt = now;

    return this.withMutation(async () => {
      const index = await this.loadIndexFile();
      // loadIndexFile calls ensureRootDir; if that detected a read-only FS, bail now.
      if (this.persistenceDisabled) {
        return { stored: false, reason: "interval" as const };
      }
      const snapshotId = toSnapshotId(snapshot.generatedAt);
      const fileName = `${snapshotId}${SNAPSHOT_FILE_SUFFIX}`;
      const compressed = await gzipAsync(Buffer.from(JSON.stringify(snapshot), "utf-8"), { level: 9 });
      await this.ensureRootDir();
      if (this.persistenceDisabled) {
        return { stored: false, reason: "interval" as const };
      }
      await fs.writeFile(path.join(this.rootDir, fileName), compressed);

      const runIds = uniqueSorted(snapshot.runs.map((run) => run.runId));
      const agentIds = uniqueSorted(snapshot.entities.map((entity) => entity.agentId));
      const entry: ReplaySnapshotIndexEntry = {
        snapshotId,
        generatedAt: snapshot.generatedAt,
        storedAt: Date.now(),
        fileName,
        sizeBytes: compressed.byteLength,
        runIds,
        agentIds,
        entityCount: snapshot.entities.length,
        eventCount: snapshot.events.length,
      };

      index.entries.unshift(entry);
      index.totalBytes += entry.sizeBytes;
      const evicted = await this.enforceRetention(index);
      index.updatedAt = Date.now();
      await this.writeIndexFile(index);

      this.metrics.persistedSnapshots += 1;
      this.metrics.evictedSnapshots += evicted.length;
      this.metrics.lastStoredAt = entry.storedAt;
      this.syncMetricsFromIndex(index);

      return {
        stored: true,
        entry,
      };
    });
  }

  private async withMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(task, task);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureRootDir() {
    try {
      await fs.mkdir(this.rootDir, { recursive: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (READONLY_FS_CODES.has(code)) {
        if (!this.persistenceDisabled) {
          this.persistenceDisabled = true;
          logStructuredEvent({
            level: "info",
            event: "replay-store.disabled",
            details: "Replay persistence disabled: storage directory is not writable. Set OPENCLAW_REPLAY_DIR to a writable path to enable.",
            extra: { rootDir: this.rootDir, errorCode: code },
          });
        }
        return;
      }
      throw error;
    }
  }

  private async loadIndexFile(): Promise<SnapshotStoreIndexFile> {
    if (this.indexCache) {
      return this.indexCache;
    }
    await this.ensureRootDir();
    try {
      const raw = await fs.readFile(this.indexPath, "utf-8");
      this.indexCache = normalizeIndexFile(JSON.parse(raw) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.indexCache = normalizeIndexFile(null);
      } else {
        logStructuredEvent({ level: "warn", event: "snapshot-store.index.read.error", extra: { path: this.indexPath, error: String(error) } });
        this.indexCache = normalizeIndexFile(null);
      }
    }
    return this.indexCache;
  }

  private async writeIndexFile(index: SnapshotStoreIndexFile) {
    await this.ensureRootDir();
    const tmpPath = `${this.indexPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(index), "utf-8");
    await fs.rename(tmpPath, this.indexPath);
    this.indexCache = index;
  }

  private async enforceRetention(index: SnapshotStoreIndexFile): Promise<ReplaySnapshotIndexEntry[]> {
    const now = Date.now();
    const retained: ReplaySnapshotIndexEntry[] = [];
    const evicted: ReplaySnapshotIndexEntry[] = [];
    let retainedBytes = 0;

    for (const entry of index.entries) {
      const tooOld = now - entry.generatedAt > this.policy.maxAgeMs;
      const overCount = retained.length >= this.policy.maxSnapshots;
      const overBytes = retained.length > 0 && retainedBytes + entry.sizeBytes > this.policy.maxTotalBytes;
      if (tooOld || overCount || overBytes) {
        evicted.push(entry);
        continue;
      }
      retained.push(entry);
      retainedBytes += entry.sizeBytes;
    }

    index.entries = retained;
    index.totalBytes = retainedBytes;

    await Promise.all(
      evicted.map(async (entry) => {
        try {
          await fs.rm(path.join(this.rootDir, entry.fileName), { force: true });
        } catch {
          // best-effort eviction cleanup
        }
      }),
    );

    return evicted;
  }

  private async readSnapshotFile(fileName: string): Promise<OfficeSnapshot> {
    const compressed = await fs.readFile(path.join(this.rootDir, fileName));
    const payload = (await gunzipAsync(compressed)).toString("utf-8");
    const parsed: unknown = JSON.parse(payload);
    if (!isOfficeSnapshot(parsed)) {
      throw new Error(`Invalid snapshot format in ${fileName}`);
    }
    return parsed;
  }

  private syncMetricsFromIndex(index: SnapshotStoreIndexFile) {
    this.metrics.totalEntries = index.entries.length;
    this.metrics.totalBytes = index.totalBytes;
  }
}
