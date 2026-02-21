import { memo } from "react";

type RoomDebugInfo = {
  assigned: number;
  capacity: number;
  overflowIn: number;
  overflowOut: number;
  targeted: number;
  saturation: string;
  utilizationPct: number;
  collisionPairs: number;
  manualOverrides: number;
};

type RoomShape = {
  id: string;
  label: string;
  description?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  border: string;
  shape: string;
};

type RunLink = {
  id: string;
  cls: string;
  d: string;
};

type StageBackgroundProps = {
  rooms: RoomShape[];
  roomDebug: Map<string, RoomDebugInfo>;
  runLinks: RunLink[];
  stageWidth: number;
  stageHeight: number;
};

export const StageBackground = memo(function StageBackground({
  rooms,
  roomDebug,
  runLinks,
  stageWidth,
  stageHeight,
}: StageBackgroundProps) {
  return (
    <>
      <div className="office-stage-grid" />

      <svg
        className="office-lines"
        viewBox={`0 0 ${stageWidth} ${stageHeight}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {runLinks.map((link) => (
          <path key={link.id} className={`run-link ${link.cls}`} d={link.d} />
        ))}
      </svg>

      {rooms.map((room) => {
        const debug = roomDebug.get(room.id);
        const overflowCount = (debug?.overflowIn ?? 0) + (debug?.overflowOut ?? 0);
        const occupancyRatio = debug ? debug.assigned / Math.max(1, debug.capacity) : 0;
        const occupancyPercent = Math.round(occupancyRatio * 100);
        const occupancyHeatLevel =
          occupancyRatio >= 1 ? "high" : occupancyRatio >= 0.7 ? "medium" : "low";
        const isEmpty = debug ? debug.assigned === 0 : true;
        return (
          <section
            key={room.id}
            className={`office-room heat-${occupancyHeatLevel}${isEmpty ? " room-empty" : ""}`}
            style={{
              left: room.x,
              top: room.y,
              width: room.width,
              height: room.height,
              background: room.fill,
              borderColor: room.border,
            }}
          >
            <div className={`occupancy-heat heat-${occupancyHeatLevel}`} aria-hidden="true" />
            <header>
              {room.label}
              {room.description ? <small className="room-description">{room.description}</small> : null}
            </header>
            <div className="shape-tag">{room.shape}</div>
            {debug ? (
              <div
                className={`zone-debug ${overflowCount > 0 ? "has-overflow" : ""} ${
                  debug.collisionPairs > 0 ? "has-collision" : ""
                }`}
                aria-hidden="true"
              >
                <span>
                  cap {debug.assigned}/{debug.capacity}
                </span>
                <span>occ {debug.utilizationPct || occupancyPercent}%</span>
                <span>target {debug.targeted}</span>
                <span className={`saturation-${debug.saturation}`}>{debug.saturation}</span>
                {debug.collisionPairs > 0 ? <span>coll {debug.collisionPairs}</span> : null}
                {debug.overflowOut > 0 ? <span>out +{debug.overflowOut}</span> : null}
                {debug.overflowIn > 0 ? <span>in +{debug.overflowIn}</span> : null}
                {debug.manualOverrides > 0 ? <span>override {debug.manualOverrides}</span> : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
});
