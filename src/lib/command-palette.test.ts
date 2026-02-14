import { describe, expect, it } from "vitest";
import {
  filterCommandIds,
  formatShortcut,
  keyboardEventToShortcut,
  normalizeShortcut,
  pushRecentCommand,
  resolveShortcutForPlatform,
  shortcutMatchesEvent,
} from "./command-palette";

function shortcutEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("shortcut normalization", () => {
  it("normalizes modifier aliases and token order", () => {
    expect(normalizeShortcut("shift + cmd + K")).toBe("meta+shift+k");
    expect(normalizeShortcut("control+alt+ArrowRight")).toBe("ctrl+alt+arrowright");
  });

  it("converts question token into slash + shift", () => {
    expect(normalizeShortcut("mod+?")).toBe("mod+shift+/");
  });

  it("returns null on invalid shortcut strings", () => {
    expect(normalizeShortcut("")).toBeNull();
    expect(normalizeShortcut("cmd+ctrl")).toBeNull();
    expect(normalizeShortcut("cmd+alt+foo+bar")).toBeNull();
  });
});

describe("shortcut platform resolution", () => {
  it("resolves mod token based on platform", () => {
    expect(resolveShortcutForPlatform("mod+k", "mac")).toBe("meta+k");
    expect(resolveShortcutForPlatform("mod+k", "other")).toBe("ctrl+k");
  });
});

describe("keyboard event matching", () => {
  it("normalizes keyboard events into shortcut chords", () => {
    expect(
      keyboardEventToShortcut(
        shortcutEvent({
          key: "?",
          code: "Slash",
          shiftKey: true,
        }),
      ),
    ).toBe("shift+/");

    expect(
      keyboardEventToShortcut(
        shortcutEvent({
          key: "k",
          code: "KeyK",
          metaKey: true,
        }),
      ),
    ).toBe("meta+k");
  });

  it("matches resolved shortcuts with events", () => {
    const event = shortcutEvent({
      key: "k",
      code: "KeyK",
      ctrlKey: true,
    });
    expect(shortcutMatchesEvent("mod+k", event, "other")).toBe(true);
    expect(shortcutMatchesEvent("mod+k", event, "mac")).toBe(false);
  });
});

describe("shortcut display labels", () => {
  it("formats shortcuts for mac and non-mac layouts", () => {
    expect(formatShortcut("mod+shift+k", "mac")).toBe("⌘⇧K");
    expect(formatShortcut("mod+shift+k", "other")).toBe("Ctrl+Shift+K");
  });
});

describe("command palette helpers", () => {
  it("filters commands by label/description/keywords/id", () => {
    const ids = filterCommandIds(
      [
        {
          id: "filters.clear",
          label: "Clear Filters",
          description: "Reset all ops filters",
          keywords: ["reset", "ops"],
        },
        {
          id: "timeline.next",
          label: "Timeline Next Event",
          description: "Move to the next event in playback order",
          keywords: ["timeline", "playback"],
        },
      ],
      "next playback",
    );
    expect(ids).toEqual(["timeline.next"]);
  });

  it("tracks recent commands with de-duplication and max length", () => {
    expect(pushRecentCommand(["b", "a"], "b", 4)).toEqual(["b", "a"]);
    expect(pushRecentCommand(["d", "c", "b", "a"], "x", 3)).toEqual(["x", "d", "c"]);
  });
});
