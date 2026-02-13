import type { OfficeEvent, OfficeSnapshot } from "../types/office";

export const MAX_STREAM_EVENTS = 220;

function compareEvents(left: OfficeEvent, right: OfficeEvent): number {
  if (left.at !== right.at) {
    return right.at - left.at;
  }
  return left.id.localeCompare(right.id);
}

export function mergeLifecycleEvent(
  snapshot: OfficeSnapshot,
  event: OfficeEvent,
  maxEvents: number = MAX_STREAM_EVENTS,
): OfficeSnapshot {
  const existing = snapshot.events;
  const deduped = existing.filter((entry) => entry.id !== event.id);

  let left = 0;
  let right = deduped.length;
  while (left < right) {
    const middle = (left + right) >> 1;
    const candidate = deduped[middle];
    if (!candidate) {
      break;
    }
    const comparison = compareEvents(event, candidate);
    if (comparison < 0) {
      right = middle;
    } else {
      left = middle + 1;
    }
  }

  deduped.splice(left, 0, event);
  if (deduped.length > maxEvents) {
    deduped.length = maxEvents;
  }

  return {
    ...snapshot,
    generatedAt: Math.max(snapshot.generatedAt, event.at),
    events: deduped,
  };
}
