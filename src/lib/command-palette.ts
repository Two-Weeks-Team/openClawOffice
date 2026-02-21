export type ShortcutPlatform = "mac" | "other";

export type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export type CommandSearchEntry = {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
};

const MODIFIER_ORDER_WITH_MOD = ["mod", "ctrl", "meta", "alt", "shift"] as const;
const MODIFIER_ORDER = ["ctrl", "meta", "alt", "shift"] as const;
const MODIFIER_KEYS = new Set<string>(["shift", "ctrl", "control", "alt", "meta"]);

const SHORTCUT_MODIFIER_ALIASES = new Map<string, (typeof MODIFIER_ORDER_WITH_MOD)[number]>([
  ["mod", "mod"],
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["meta", "meta"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
]);

const KEY_SYNONYMS = new Map<string, string>([
  ["esc", "escape"],
  ["return", "enter"],
  ["spacebar", "space"],
  ["del", "delete"],
  ["up", "arrowup"],
  ["down", "arrowdown"],
  ["left", "arrowleft"],
  ["right", "arrowright"],
]);

const CODE_TO_KEY = new Map<string, string>([
  ["Space", "space"],
  ["Slash", "/"],
  ["Backslash", "\\"],
  ["BracketLeft", "["],
  ["BracketRight", "]"],
  ["Minus", "-"],
  ["Equal", "="],
  ["Comma", ","],
  ["Period", "."],
  ["Semicolon", ";"],
  ["Quote", "'"],
  ["Backquote", "`"],
  ["Escape", "escape"],
  ["Enter", "enter"],
  ["Tab", "tab"],
  ["Backspace", "backspace"],
  ["Delete", "delete"],
  ["ArrowUp", "arrowup"],
  ["ArrowDown", "arrowdown"],
  ["ArrowLeft", "arrowleft"],
  ["ArrowRight", "arrowright"],
  ["Home", "home"],
  ["End", "end"],
  ["PageUp", "pageup"],
  ["PageDown", "pagedown"],
]);

const DISPLAY_KEY_LABEL = new Map<string, string>([
  ["space", "Space"],
  ["escape", "Esc"],
  ["enter", "Enter"],
  ["tab", "Tab"],
  ["backspace", "Backspace"],
  ["delete", "Del"],
  ["arrowup", "Up"],
  ["arrowdown", "Down"],
  ["arrowleft", "Left"],
  ["arrowright", "Right"],
  ["pageup", "PgUp"],
  ["pagedown", "PgDn"],
  ["home", "Home"],
  ["end", "End"],
]);

const DISPLAY_KEY_LABEL_MAC = new Map<string, string>([
  ["arrowup", "↑"],
  ["arrowdown", "↓"],
  ["arrowleft", "←"],
  ["arrowright", "→"],
  ["delete", "⌦"],
  ["backspace", "⌫"],
  ["space", "Space"],
  ["enter", "↩"],
  ["tab", "⇥"],
  ["escape", "Esc"],
]);

const SPECIAL_KEYS = new Set<string>([
  "space",
  "escape",
  "enter",
  "tab",
  "backspace",
  "delete",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "home",
  "end",
  "pageup",
  "pagedown",
]);

function canonicalizeShortcut(
  modifiers: Iterable<string>,
  key: string,
  includeMod: boolean,
): string {
  const modifierSet = new Set(modifiers);
  const orderedModifiers = includeMod ? MODIFIER_ORDER_WITH_MOD : MODIFIER_ORDER;
  const normalizedModifiers = orderedModifiers.filter((token) => modifierSet.has(token));
  return [...normalizedModifiers, key].join("+");
}

function normalizeKeyToken(token: string): string | null {
  const lower = token.trim().toLowerCase();
  if (!lower) {
    return null;
  }

  if (lower === "?") {
    return "/";
  }

  const synonym = KEY_SYNONYMS.get(lower);
  if (synonym) {
    return synonym;
  }

  if (SPECIAL_KEYS.has(lower)) {
    return lower;
  }

  if (/^f([1-9]|1[0-2])$/.test(lower)) {
    return lower;
  }

  if (lower.length === 1) {
    return lower;
  }

  return null;
}

function keyTokenFromEvent(event: ShortcutEvent): string | null {
  if (event.code.startsWith("Key") && event.code.length === 4) {
    return event.code.slice(3).toLowerCase();
  }
  if (event.code.startsWith("Digit") && event.code.length === 6) {
    return event.code.slice(5);
  }
  if (event.code.startsWith("Numpad") && event.code.length === 7) {
    const key = event.code.slice(6);
    if (/^[0-9]$/.test(key)) {
      return key;
    }
  }
  if (CODE_TO_KEY.has(event.code)) {
    return CODE_TO_KEY.get(event.code) ?? null;
  }

  const fallback = normalizeKeyToken(event.key);
  if (!fallback) {
    return null;
  }
  if (MODIFIER_KEYS.has(fallback)) {
    return null;
  }
  return fallback;
}

export function normalizeShortcut(raw: string): string | null {
  const tokens = raw
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const modifiers = new Set<string>();
  let key: string | null = null;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const modifier = SHORTCUT_MODIFIER_ALIASES.get(lower);
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }

    const normalizedKey = normalizeKeyToken(token);
    if (!normalizedKey) {
      return null;
    }
    if (key !== null) {
      return null;
    }
    key = normalizedKey;

    if (lower === "?") {
      modifiers.add("shift");
    }
  }

  if (!key) {
    return null;
  }
  return canonicalizeShortcut(modifiers, key, true);
}

export function resolveShortcutForPlatform(
  shortcut: string,
  platform: ShortcutPlatform,
): string | null {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) {
    return null;
  }
  const parts = normalized.split("+");
  const key = parts.pop();
  if (!key) {
    return null;
  }
  const modifiers = new Set(
    parts.map((token) => {
      if (token === "mod") {
        return platform === "mac" ? "meta" : "ctrl";
      }
      return token;
    }),
  );
  return canonicalizeShortcut(modifiers, key, false);
}

export function keyboardEventToShortcut(event: ShortcutEvent): string | null {
  const key = keyTokenFromEvent(event);
  if (!key) {
    return null;
  }

  const modifiers = new Set<string>();
  if (event.ctrlKey) {
    modifiers.add("ctrl");
  }
  if (event.metaKey) {
    modifiers.add("meta");
  }
  if (event.altKey) {
    modifiers.add("alt");
  }
  if (event.shiftKey) {
    modifiers.add("shift");
  }

  return canonicalizeShortcut(modifiers, key, false);
}

export function shortcutMatchesEvent(
  shortcut: string,
  event: ShortcutEvent,
  platform: ShortcutPlatform,
): boolean {
  const resolvedShortcut = resolveShortcutForPlatform(shortcut, platform);
  if (!resolvedShortcut) {
    return false;
  }
  return keyboardEventToShortcut(event) === resolvedShortcut;
}

function displayKeyToken(key: string, platform: ShortcutPlatform): string {
  if (platform === "mac") {
    const macLabel = DISPLAY_KEY_LABEL_MAC.get(key);
    if (macLabel) {
      return macLabel;
    }
  }
  const commonLabel = DISPLAY_KEY_LABEL.get(key);
  if (commonLabel) {
    return commonLabel;
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key.toUpperCase();
}

export function formatShortcut(shortcut: string, platform: ShortcutPlatform): string {
  const resolved = resolveShortcutForPlatform(shortcut, platform);
  if (!resolved) {
    return "";
  }
  const tokens = resolved.split("+");
  const key = tokens.pop();
  if (!key) {
    return "";
  }

  if (platform === "mac") {
    const symbols = [
      tokens.includes("ctrl") ? "⌃" : "",
      tokens.includes("meta") ? "⌘" : "",
      tokens.includes("alt") ? "⌥" : "",
      tokens.includes("shift") ? "⇧" : "",
    ]
      .filter(Boolean)
      .join("");
    return `${symbols}${displayKeyToken(key, platform)}`;
  }

  const names = [
    tokens.includes("ctrl") ? "Ctrl" : "",
    tokens.includes("meta") ? "Meta" : "",
    tokens.includes("alt") ? "Alt" : "",
    tokens.includes("shift") ? "Shift" : "",
  ].filter(Boolean);
  names.push(displayKeyToken(key, platform));
  return names.join("+");
}

/**
 * Computes a fuzzy match score for a pattern against a text string.
 * Returns -1 if the pattern is not a subsequence of text.
 * Higher scores indicate better matches.
 *
 * Scoring:
 * - Exact substring match: high base score with position bonus
 * - Consecutive character matches: +20 per pair
 * - Word-boundary start matches: +15 per character
 * - Each matched character: +10
 */
function fuzzyScore(pattern: string, text: string): number {
  if (!pattern) return 0;

  // Exact substring match: highest priority
  const substringIndex = text.indexOf(pattern);
  if (substringIndex !== -1) {
    // Earlier matches in the string score slightly higher; clamp to 1 so exact
    // matches deep in very long labels still outrank non-exact subsequences.
    return Math.max(1, 1000 + pattern.length * 10 - substringIndex);
  }

  // Subsequence match with bonuses
  let score = 0;
  let textIndex = 0;
  let prevMatchIndex = -1;

  for (let pi = 0; pi < pattern.length; pi++) {
    const pChar = pattern[pi];
    let found = false;

    for (let ti = textIndex; ti < text.length; ti++) {
      if (text[ti] === pChar) {
        score += 10;
        if (ti === prevMatchIndex + 1) {
          score += 20; // Consecutive match bonus
        }
        if (ti === 0 || /[\s\-_/]/.test(text[ti - 1])) {
          score += 15; // Word-boundary start bonus
        }
        prevMatchIndex = ti;
        textIndex = ti + 1;
        found = true;
        break;
      }
    }

    if (!found) return -1; // Pattern not a subsequence
  }

  return score;
}

export function filterCommandIds(entries: CommandSearchEntry[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries.map((entry) => entry.id);
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);

  type ScoredEntry = { id: string; score: number };
  const scored: ScoredEntry[] = [];

  for (const entry of entries) {
    const searchFields = [
      entry.label,
      entry.description ?? "",
      ...(entry.keywords ?? []),
      entry.id,
    ].map((s) => s.toLowerCase());

    let totalScore = 0;
    let allTokensMatch = true;

    for (const token of tokens) {
      let bestTokenScore = -1;
      for (const field of searchFields) {
        const s = fuzzyScore(token, field);
        if (s > bestTokenScore) bestTokenScore = s;
      }
      if (bestTokenScore < 0) {
        allTokensMatch = false;
        break;
      }
      totalScore += bestTokenScore;
    }

    if (allTokensMatch) {
      scored.push({ id: entry.id, score: totalScore });
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((item) => item.id);
}

export function pushRecentCommand(history: string[], commandId: string, limit = 8): string[] {
  const maxItems = Math.max(1, limit);
  const deduped = [commandId, ...history.filter((value) => value !== commandId)];
  return deduped.slice(0, maxItems);
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
