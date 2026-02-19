/**
 * Optional OpenClawWorld integration.
 * Polls the world server for agent positions when OPENCLAW_WORLD_URL is configured.
 *
 * Design:
 *  - Opt-in via OPENCLAW_WORLD_URL env var.
 *  - Rate-limited with exponential back-off on repeated failures.
 *  - All public functions are non-throwing; callers never need try/catch.
 */

export type WorldAgentPosition = {
  agentId: string;
  x: number;
  y: number;
  zone?: string;
  facing?: string;
};

export type WorldSnapshot = {
  positions: Map<string, WorldAgentPosition>;
  fetchedAt: number;
  roomId: string;
};

const WORLD_POLL_INTERVAL_MS = 5_000;
const WORLD_FETCH_TIMEOUT_MS = 3_000;

let cachedWorldSnapshot: WorldSnapshot | null = null;
let lastFetchAttempt = 0;
let consecutiveFailures = 0;

function resolveWorldUrl(): string | null {
  const raw = process.env.OPENCLAW_WORLD_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function resolveWorldRoomId(): string {
  return process.env.OPENCLAW_WORLD_ROOM_ID?.trim() || "default";
}

export function isWorldIntegrationEnabled(): boolean {
  return resolveWorldUrl() !== null;
}

export async function fetchWorldPositions(): Promise<WorldSnapshot | null> {
  const worldUrl = resolveWorldUrl();
  if (!worldUrl) return null;

  const now = Date.now();

  // Rate limit: don't fetch more often than the poll interval.
  if (cachedWorldSnapshot && now - lastFetchAttempt < WORLD_POLL_INTERVAL_MS) {
    return cachedWorldSnapshot;
  }

  // Exponential back-off after repeated failures (cap at 60 s).
  if (consecutiveFailures > 0) {
    const backoffMs = Math.min(
      60_000,
      WORLD_POLL_INTERVAL_MS * Math.pow(2, consecutiveFailures),
    );
    if (now - lastFetchAttempt < backoffMs) {
      return cachedWorldSnapshot;
    }
  }

  lastFetchAttempt = now;
  const roomId = resolveWorldRoomId();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORLD_FETCH_TIMEOUT_MS);

    const response = await fetch(`${worldUrl}/observe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "__dashboard__",
        roomId,
        radius: 9999,
        detail: "lite",
        includeSelf: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      consecutiveFailures++;
      return cachedWorldSnapshot;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const positions = new Map<string, WorldAgentPosition>();

    // Parse self position (unlikely for __dashboard__ but handle defensively).
    if (data.self && typeof data.self === "object") {
      parseEntityPosition(data.self as Record<string, unknown>, positions);
    }

    // Parse nearby entities.
    if (Array.isArray(data.nearby)) {
      for (const item of data.nearby) {
        if (item && typeof item === "object") {
          const observed = item as Record<string, unknown>;
          const entity = observed.entity as Record<string, unknown> | undefined;
          if (entity) {
            parseEntityPosition(entity, positions);
          }
        }
      }
    }

    consecutiveFailures = 0;
    cachedWorldSnapshot = {
      positions,
      fetchedAt: now,
      roomId,
    };

    return cachedWorldSnapshot;
  } catch {
    consecutiveFailures++;
    return cachedWorldSnapshot;
  }
}

function parseEntityPosition(
  entity: Record<string, unknown>,
  positions: Map<string, WorldAgentPosition>,
) {
  const id = typeof entity.id === "string" ? entity.id : undefined;
  const name = typeof entity.name === "string" ? entity.name : undefined;
  const kind = typeof entity.kind === "string" ? entity.kind : undefined;

  // Only track agents (not NPCs or objects).
  if (kind !== "agent" && kind !== "human") return;

  const pos = entity.pos as Record<string, unknown> | undefined;
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;

  const facing = typeof entity.facing === "string" ? entity.facing : undefined;

  // Use name as the key since it matches OpenClaw agent names.
  const agentId = name || id;
  if (!agentId) return;

  positions.set(agentId, {
    agentId,
    x: pos.x,
    y: pos.y,
    facing,
  });
}

/** Reset cached state (useful for tests). */
export function resetWorldClient(): void {
  cachedWorldSnapshot = null;
  lastFetchAttempt = 0;
  consecutiveFailures = 0;
}
