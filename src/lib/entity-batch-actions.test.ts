import { describe, expect, it } from "vitest";
import {
  applyBatchAction,
  normalizeBatchActionState,
  type BatchActionState,
} from "./entity-batch-actions";

const EMPTY_STATE: BatchActionState = {
  pinnedEntityIds: [],
  watchedEntityIds: [],
  mutedEntityIds: [],
};

describe("entity batch actions", () => {
  it("normalizes storage payload safely", () => {
    const normalized = normalizeBatchActionState({
      pinnedEntityIds: ["agent:main", " agent:main ", "", 1],
      watchedEntityIds: ["subagent:run-1"],
      mutedEntityIds: "bad",
    });
    expect(normalized).toEqual({
      pinnedEntityIds: ["agent:main"],
      watchedEntityIds: ["subagent:run-1"],
      mutedEntityIds: [],
    });
  });

  it("applies pin/watch/mute batch operations", () => {
    let state = applyBatchAction(EMPTY_STATE, ["agent:main", "subagent:run-2"], "pin");
    state = applyBatchAction(state, ["agent:main"], "watch");
    state = applyBatchAction(state, ["subagent:run-2"], "mute");
    expect(state).toEqual({
      pinnedEntityIds: ["agent:main", "subagent:run-2"],
      watchedEntityIds: ["agent:main"],
      mutedEntityIds: ["subagent:run-2"],
    });
  });

  it("removes selected ids via unpin/unwatch/unmute and clear", () => {
    const state: BatchActionState = {
      pinnedEntityIds: ["agent:main", "subagent:run-2"],
      watchedEntityIds: ["agent:main", "subagent:run-2"],
      mutedEntityIds: ["agent:main"],
    };
    const step1 = applyBatchAction(state, ["agent:main"], "unpin");
    const step2 = applyBatchAction(step1, ["subagent:run-2"], "unwatch");
    const step3 = applyBatchAction(step2, ["agent:main"], "unmute");
    const step4 = applyBatchAction(step3, ["subagent:run-2"], "clear");
    expect(step4).toEqual({
      pinnedEntityIds: [],
      watchedEntityIds: ["agent:main"],
      mutedEntityIds: [],
    });
  });
});
