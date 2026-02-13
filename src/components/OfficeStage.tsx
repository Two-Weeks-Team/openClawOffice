import { useMemo } from "react";
import { buildPlacements, getRooms } from "../lib/layout";
import type { OfficeSnapshot, OfficeEntity, OfficeRun } from "../types/office";

type Props = {
  snapshot: OfficeSnapshot;
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

export function OfficeStage({ snapshot }: Props) {
  const rooms = useMemo(() => getRooms(), []);
  const placements = useMemo(() => buildPlacements(snapshot.entities), [snapshot.entities]);

  const placementById = useMemo(() => {
    const map = new Map<string, (typeof placements)[number]>();
    for (const placement of placements) {
      map.set(placement.entity.id, placement);
      if (placement.entity.kind === "agent") {
        map.set(`agent:${placement.entity.agentId}`, placement);
      }
    }
    return map;
  }, [placements]);

  const runLinks = useMemo(() => {
    return snapshot.runs
      .map((run) => {
        const source = placementById.get(`agent:${run.parentAgentId}`);
        const target = placementById.get(`subagent:${run.runId}`);
        if (!source || !target) {
          return null;
        }

        const sx = source.x;
        const sy = source.y;
        const tx = target.x;
        const ty = target.y;
        const cx = (sx + tx) / 2;
        const cy = Math.min(sy, ty) - 42;

        return {
          id: `${run.runId}:${sx}:${sy}:${tx}:${ty}`,
          cls: runLineClass(run),
          d: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`,
        };
      })
      .filter((value): value is { id: string; cls: string; d: string } => Boolean(value));
  }, [snapshot.runs, placementById]);

  return (
    <div className="office-stage-wrap">
      <div className="office-stage-grid" />

      <svg className="office-lines" viewBox="0 0 980 660" preserveAspectRatio="none" aria-hidden>
        {runLinks.map((link) => (
          <path key={link.id} className={`run-link ${link.cls}`} d={link.d} />
        ))}
      </svg>

      {rooms.map((room) => (
        <section
          key={room.id}
          className="office-room"
          style={{
            left: room.x,
            top: room.y,
            width: room.width,
            height: room.height,
            background: room.fill,
            borderColor: room.border,
          }}
        >
          <header>{room.label}</header>
          <div className="shape-tag">{room.shape}</div>
        </section>
      ))}

      {placements.map((placement) => {
        const entity = placement.entity;
        return (
          <article
            key={entity.id}
            className={`entity-token ${statusClass(entity)} ${entity.kind}`}
            style={{ left: placement.x, top: placement.y }}
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
            {entity.bubble ? <p className="bubble">{entity.bubble}</p> : null}
          </article>
        );
      })}
    </div>
  );
}
