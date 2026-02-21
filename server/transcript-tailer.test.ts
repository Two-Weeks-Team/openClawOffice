import { describe, expect, it } from "vitest";
import { buildTranscriptBubble, buildTranscriptMeta, classifyToolCategory } from "./transcript-tailer";

function asJsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

describe("buildTranscriptBubble", () => {
  it("prefers recent assistant text over user text in lookback window", () => {
    const bubble = buildTranscriptBubble(
      asJsonl([
        { role: "user", text: "check queue" },
        { role: "assistant", text: "I am checking now." },
        { role: "user", text: "thanks" },
      ]),
    );

    expect(bubble).toBe("I am checking now.");
  });

  it("merges partial stream updates for the same message id", () => {
    const bubble = buildTranscriptBubble(
      asJsonl([
        { id: "m-1", role: "assistant", delta: "Investigating" },
        { id: "m-1", role: "assistant", delta: "Investigating issue on queue worker" },
      ]),
    );

    expect(bubble).toBe("Investigating issue on queue worker");
  });

  it("dedupes repeated consecutive messages", () => {
    const bubble = buildTranscriptBubble(
      asJsonl([
        { role: "assistant", text: "Done." },
        { role: "assistant", text: "Done." },
      ]),
    );

    expect(bubble).toBe("Done.");
  });

  it("returns role fallback when transcript has no extractable text", () => {
    const bubble = buildTranscriptBubble(asJsonl([{ role: "tool", type: "tool_call_start" }]));
    expect(bubble).toBe("🛠 tool activity");
  });

  it("falls back to newest entry when preferred role is outside lookback", () => {
    const bubble = buildTranscriptBubble(
      asJsonl([
        { role: "assistant", text: "old assistant text" },
        { role: "user", text: "new user text" },
      ]),
      { lookback: 1 },
    );

    expect(bubble).toBe("new user text");
  });

  it("ignores malformed lines and normalizes spacing", () => {
    const bubble = buildTranscriptBubble(
      `not-json\n${JSON.stringify({ role: "assistant", content: [{ text: "  hello\\nworld  " }] })}`,
    );
    expect(bubble).toBe("hello world");
  });
});

describe("classifyToolCategory", () => {
  it("classifies file operation tools", () => {
    expect(classifyToolCategory("Read")).toBe("file_op");
    expect(classifyToolCategory("Write")).toBe("file_op");
    expect(classifyToolCategory("Edit")).toBe("file_op");
    expect(classifyToolCategory("Glob")).toBe("file_op");
    expect(classifyToolCategory("Grep")).toBe("file_op");
  });

  it("classifies bash tools", () => {
    expect(classifyToolCategory("Bash")).toBe("bash");
    expect(classifyToolCategory("bash")).toBe("bash");
  });

  it("classifies web tools", () => {
    expect(classifyToolCategory("WebFetch")).toBe("web");
    expect(classifyToolCategory("WebSearch")).toBe("web");
  });

  it("classifies agent call tools", () => {
    expect(classifyToolCategory("Task")).toBe("agent_call");
    expect(classifyToolCategory("spawn")).toBe("agent_call");
  });

  it("classifies unknown tools as other", () => {
    expect(classifyToolCategory("SomeCustomTool")).toBe("other");
    expect(classifyToolCategory("unknown_tool")).toBe("other");
  });
});

describe("buildTranscriptMeta - tool category breakdown", () => {
  function asJsonl(rows: unknown[]): string {
    return rows.map((row) => JSON.stringify(row)).join("\n");
  }

  it("counts tool categories from content blocks", () => {
    const meta = buildTranscriptMeta(
      asJsonl([
        {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Read" },
            { type: "tool_use", name: "Bash" },
            { type: "tool_use", name: "Read" },
            { type: "tool_use", name: "WebFetch" },
          ],
        },
      ]),
    );

    expect(meta.toolCount).toBe(4);
    expect(meta.toolCategoryBreakdown.file_op).toBe(2);
    expect(meta.toolCategoryBreakdown.bash).toBe(1);
    expect(meta.toolCategoryBreakdown.web).toBe(1);
    expect(meta.toolCategoryBreakdown.agent_call).toBe(0);
    expect(meta.toolCategoryBreakdown.other).toBe(0);
  });

  it("returns zeroed breakdown when no tools", () => {
    const meta = buildTranscriptMeta(asJsonl([{ role: "assistant", text: "hello" }]));
    expect(meta.toolCount).toBe(0);
    expect(Object.values(meta.toolCategoryBreakdown).every((v) => v === 0)).toBe(true);
  });
});
