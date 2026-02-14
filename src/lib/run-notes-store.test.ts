import { describe, expect, it } from "vitest";
import {
  indexRunKnowledgeByRunId,
  parseRunKnowledgeEntries,
  removeRunKnowledgeEntry,
  upsertRunKnowledgeEntry,
  type RunKnowledgeEntry,
} from "./run-notes-store";

function makeEntry(partial?: Partial<RunKnowledgeEntry>): RunKnowledgeEntry {
  return {
    runId: partial?.runId ?? "run-1",
    note: partial?.note ?? "baseline note",
    tags: partial?.tags ?? ["incident"],
    updatedAt: partial?.updatedAt ?? 1000,
  };
}

describe("run notes store", () => {
  it("parses and deduplicates latest run knowledge records", () => {
    const parsed = parseRunKnowledgeEntries(
      JSON.stringify([
        makeEntry({ runId: "run-1", updatedAt: 1000, note: "old" }),
        makeEntry({ runId: "run-1", updatedAt: 1400, note: "new" }),
        makeEntry({ runId: "run-2", updatedAt: 1200 }),
      ]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ runId: "run-1", note: "new" });
    expect(parsed[1]).toMatchObject({ runId: "run-2" });
  });

  it("ignores invalid or empty records while parsing", () => {
    const parsed = parseRunKnowledgeEntries(
      JSON.stringify([
        makeEntry({ runId: "run-1" }),
        { foo: "bar" },
        { runId: "run-2", note: "   ", tags: [], updatedAt: 1000 },
        { runId: "run-3", note: "x", tags: ["tag"] },
      ]),
    );
    expect(parsed.map((entry) => entry.runId)).toEqual(["run-1"]);
  });

  it("upserts with normalization and removes when note/tags are empty", () => {
    const seeded = [makeEntry({ runId: "run-1", note: "before", tags: ["alpha"] })];
    const updated = upsertRunKnowledgeEntry(seeded, {
      runId: " run-1 ",
      note: " after ",
      tags: ["#Tag-A", "tag-a", " tag-b "],
      updatedAt: 2000,
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual({
      runId: "run-1",
      note: "after",
      tags: ["tag-a", "tag-b"],
      updatedAt: 2000,
    });

    const removed = upsertRunKnowledgeEntry(updated, {
      runId: "run-1",
      note: " ",
      tags: [],
      updatedAt: 2100,
    });
    expect(removed).toEqual([]);
  });

  it("removes a run knowledge record by runId", () => {
    const next = removeRunKnowledgeEntry(
      [
        makeEntry({ runId: "run-1" }),
        makeEntry({ runId: "run-2", updatedAt: 1200 }),
      ],
      " run-2 ",
    );
    expect(next.map((entry) => entry.runId)).toEqual(["run-1"]);
  });

  it("indexes entries by runId", () => {
    const map = indexRunKnowledgeByRunId([
      makeEntry({ runId: "run-1", note: "n1" }),
      makeEntry({ runId: "run-2", note: "n2" }),
    ]);
    expect(map.get("run-1")?.note).toBe("n1");
    expect(map.get("run-2")?.note).toBe("n2");
  });

  it("keeps only the latest capped run knowledge entries", () => {
    let entries: RunKnowledgeEntry[] = [];
    for (let index = 0; index < 410; index += 1) {
      entries = upsertRunKnowledgeEntry(entries, {
        runId: `run-${index}`,
        note: `note-${index}`,
        tags: [],
        updatedAt: index + 1,
      });
    }
    expect(entries.length).toBe(400);
    expect(entries[0]?.runId).toBe("run-409");
    expect(entries.some((entry) => entry.runId === "run-0")).toBe(false);
  });
});
