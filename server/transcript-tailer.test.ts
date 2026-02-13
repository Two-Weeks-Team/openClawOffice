import { describe, expect, it } from "vitest";
import { buildTranscriptBubble } from "./transcript-tailer";

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
