type TranscriptRole = "assistant" | "tool" | "user" | "unknown";

type TranscriptEntry = {
  role: TranscriptRole;
  text: string;
  seq: number;
};

type TranscriptTailState = {
  entries: TranscriptEntry[];
  keyIndex: Map<string, number>;
  lastRoleSeen: TranscriptRole;
};

const MAX_RECURSION_DEPTH = 4;
const DEFAULT_LOOKBACK = 8;
const DEFAULT_MAX_CHARS = 110;
const ROLE_PRIORITY: TranscriptRole[] = ["assistant", "tool", "user", "unknown"];
const ROLE_FALLBACK: Record<Exclude<TranscriptRole, "unknown">, string> = {
  assistant: "🤖 assistant activity",
  tool: "🛠 tool activity",
  user: "🧑 user activity",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.replace(/\\[nr]/g, " ").replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function shorten(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}...`;
}

function normalizeRole(value: unknown): TranscriptRole | undefined {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text.includes("assistant")) {
    return "assistant";
  }
  if (text.includes("tool")) {
    return "tool";
  }
  if (text.includes("user")) {
    return "user";
  }
  return undefined;
}

function resolveRole(row: Record<string, unknown>): TranscriptRole {
  return (
    normalizeRole(row.role) ??
    normalizeRole(row.type) ??
    normalizeRole(row.event) ??
    (isRecord(row.author) ? normalizeRole(row.author.role) : undefined) ??
    (isRecord(row.message) ? normalizeRole(row.message.role) : undefined) ??
    (isRecord(row.payload) ? normalizeRole(row.payload.role) : undefined) ??
    "unknown"
  );
}

function resolveMessageKey(row: Record<string, unknown>, role: TranscriptRole): string | undefined {
  const rawKey =
    normalizeText(row.messageId) ??
    normalizeText(row.message_id) ??
    normalizeText(row.itemId) ??
    normalizeText(row.item_id) ??
    normalizeText(row.id);

  if (!rawKey) {
    return undefined;
  }
  return `${role}:${rawKey}`;
}

function isPartialRow(row: Record<string, unknown>): boolean {
  const type = normalizeText(row.type)?.toLowerCase();
  const event = normalizeText(row.event)?.toLowerCase();
  return Boolean(row.delta) || Boolean(type?.includes("delta")) || Boolean(event?.includes("delta"));
}

function collectTextParts(value: unknown, depth = 0): string[] {
  if (depth > MAX_RECURSION_DEPTH) {
    return [];
  }

  const direct = normalizeText(value);
  if (direct) {
    return [direct];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextParts(item, depth + 1));
  }

  if (!isRecord(value)) {
    return [];
  }

  const out: string[] = [];
  const keys = [
    "text",
    "message",
    "content",
    "delta",
    "output",
    "output_text",
    "input",
    "arguments",
    "summary",
  ];
  for (const key of keys) {
    if (!(key in value)) {
      continue;
    }
    out.push(...collectTextParts(value[key], depth + 1));
  }
  return out;
}

function pickRowText(row: Record<string, unknown>): string | undefined {
  const deduped = new Set<string>();
  const parts = collectTextParts(row);
  for (const part of parts) {
    const normalized = normalizeText(part);
    if (normalized) {
      deduped.add(normalized);
    }
  }
  if (deduped.size === 0) {
    return undefined;
  }
  return normalizeText(Array.from(deduped).join(" "));
}

function mergeText(base: string, incoming: string): string {
  if (base === incoming) {
    return base;
  }
  if (incoming.startsWith(base)) {
    return incoming;
  }
  if (base.startsWith(incoming) || base.endsWith(incoming)) {
    return base;
  }
  if (incoming.endsWith(base)) {
    return incoming;
  }
  return normalizeText(`${base} ${incoming}`) ?? base;
}

function selectEntry(entries: TranscriptEntry[], lookback: number): TranscriptEntry | undefined {
  const recent = entries.slice(-Math.max(1, lookback));
  for (const role of ROLE_PRIORITY) {
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      if (recent[index]?.role === role) {
        return recent[index];
      }
    }
  }
  return recent[recent.length - 1];
}

function processTranscriptLine(line: string, seq: number, state: TranscriptTailState) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    // Skip malformed lines - expected during streaming or partial writes.
    return;
  }

  if (!isRecord(parsed)) {
    return;
  }

  const role = resolveRole(parsed);
  if (role !== "unknown") {
    state.lastRoleSeen = role;
  }

  const text = pickRowText(parsed);
  if (!text) {
    return;
  }

  const key = resolveMessageKey(parsed, role);
  const partial = isPartialRow(parsed);
  const entries = state.entries;

  if (key && state.keyIndex.has(key)) {
    const index = state.keyIndex.get(key);
    if (index !== undefined && entries[index]) {
      entries[index].text = mergeText(entries[index].text, text);
      entries[index].seq = seq;
    }
    return;
  }

  const last = entries[entries.length - 1];
  if (partial && last && last.role === role) {
    last.text = mergeText(last.text, text);
    last.seq = seq;
    if (key) {
      state.keyIndex.set(key, entries.length - 1);
    }
    return;
  }

  if (last && last.role === role && last.text === text) {
    last.seq = seq;
    if (key) {
      state.keyIndex.set(key, entries.length - 1);
    }
    return;
  }

  entries.push({ role, text, seq });
  if (key) {
    state.keyIndex.set(key, entries.length - 1);
  }
}

export type ToolCategory = "file_op" | "bash" | "web" | "agent_call" | "other";
export type ToolCategoryBreakdown = Record<ToolCategory, number>;

/** Classify a Claude tool name into a high-level category. */
export function classifyToolCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase();
  if (
    name === "read" ||
    name === "write" ||
    name === "edit" ||
    name === "multiedit" ||
    name === "glob" ||
    name === "grep" ||
    name === "notebookedit" ||
    name.startsWith("file")
  ) {
    return "file_op";
  }
  if (name === "bash" || name === "shell" || name === "exec" || name === "run") {
    return "bash";
  }
  if (name === "webfetch" || name === "websearch" || name === "browser" || name === "navigate") {
    return "web";
  }
  if (
    name === "task" ||
    name === "agent" ||
    name === "dispatch" ||
    name === "spawn" ||
    name.includes("agent")
  ) {
    return "agent_call";
  }
  return "other";
}

export type TranscriptToolSummary = {
  lastToolName?: string;
  toolCount: number;
  toolCategoryBreakdown: ToolCategoryBreakdown;
  inputTokens: number;
  outputTokens: number;
};

export function buildTranscriptMeta(rawJsonl: string): TranscriptToolSummary {
  let toolCount = 0;
  let lastToolName: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  const toolCategoryBreakdown: ToolCategoryBreakdown = {
    file_op: 0,
    bash: 0,
    web: 0,
    agent_call: 0,
    other: 0,
  };

  const lines = rawJsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }

    // Unwrap potential envelope wrappers (message, payload) used by some transcript formats
    const candidates: Record<string, unknown>[] = [parsed];
    for (const key of ["message", "payload"]) {
      if (isRecord(parsed[key])) {
        candidates.push(parsed[key] as Record<string, unknown>);
      }
    }

    for (const row of candidates) {
      // Extract tool_use from content array
      const content = row.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (isRecord(block) && block.type === "tool_use" && typeof block.name === "string") {
            toolCount++;
            lastToolName = block.name;
            const category = classifyToolCategory(block.name);
            toolCategoryBreakdown[category]++;
          }
        }
      }

      // Extract usage info
      const usage = row.usage;
      if (isRecord(usage)) {
        if (typeof usage.input_tokens === "number") {
          inputTokens += usage.input_tokens;
        }
        if (typeof usage.output_tokens === "number") {
          outputTokens += usage.output_tokens;
        }
      }
    }
  }

  return { lastToolName, toolCount, toolCategoryBreakdown, inputTokens, outputTokens };
}

export function buildTranscriptBubble(
  rawJsonl: string,
  options?: { lookback?: number; maxChars?: number },
): string | undefined {
  const lookback = options?.lookback ?? DEFAULT_LOOKBACK;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  const state: TranscriptTailState = {
    entries: [],
    keyIndex: new Map<string, number>(),
    lastRoleSeen: "unknown",
  };

  const lines = rawJsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let seq = 0; seq < lines.length; seq += 1) {
    const line = lines[seq];
    if (!line) {
      continue;
    }
    processTranscriptLine(line, seq, state);
  }

  const selected = selectEntry(state.entries, lookback);
  if (selected?.text) {
    return shorten(selected.text, maxChars);
  }

  if (state.lastRoleSeen !== "unknown") {
    return ROLE_FALLBACK[state.lastRoleSeen];
  }

  return undefined;
}
