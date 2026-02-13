import type { OfficeEvent } from "../types/office";

type Props = {
  events: OfficeEvent[];
};

function relativeTime(timestamp: number) {
  const ms = Date.now() - timestamp;
  if (ms < 60_000) {
    return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ago`;
  }
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function eventBadge(type: OfficeEvent["type"]) {
  if (type === "spawn") {
    return "SPAWN";
  }
  if (type === "start") {
    return "START";
  }
  if (type === "cleanup") {
    return "CLEAN";
  }
  if (type === "error") {
    return "ERR";
  }
  return "DONE";
}

export function EventRail({ events }: Props) {
  const top = events.slice(0, 24);

  return (
    <aside className="event-rail">
      <header>
        <h2>Spawn Timeline</h2>
        <p>Every subagent spawn, lifecycle step, and cleanup trace.</p>
      </header>
      <ol>
        {top.map((event) => (
          <li key={event.id} className={`event event-${event.type}`}>
            <span className="badge">{eventBadge(event.type)}</span>
            <div className="event-body">
              <strong>
                {event.parentAgentId} {"->"} {event.agentId}
              </strong>
              <p>{event.text}</p>
              <time>{relativeTime(event.at)}</time>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
