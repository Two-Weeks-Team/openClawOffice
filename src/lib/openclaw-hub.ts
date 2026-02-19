/**
 * Frontend utilities for the OpenClaw Hub dashboard.
 * Provides severity resolution, formatting helpers, and markdown parsing.
 * @module openclaw-hub
 */
import type { OpenClawHubSnapshot } from "../../server/openclaw-hub-types";

export type HubCardSeverity = "good" | "warn" | "bad" | "neutral";

export type HubCardId =
  | "project"
  | "gateway"
  | "channels"
  | "skills"
  | "memory"
  | "cron"
  | "docs"
  | "changelog";

/** Map a hub card to its severity level based on current snapshot data. */
export function resolveCardSeverity(
  snapshot: OpenClawHubSnapshot,
  cardId: HubCardId,
): HubCardSeverity {
  switch (cardId) {
    case "project": {
      if (!snapshot.project) return "bad";
      if (!snapshot.git) return "warn";
      if (snapshot.git.isDirty) return "warn";
      if (snapshot.git.commitsBehind > 50) return "warn";
      return "good";
    }
    case "gateway":
      return snapshot.gateway?.reachable ? "good" : "bad";
    case "channels":
      return snapshot.channels.length > 0 ? "good" : "neutral";
    case "skills":
      return snapshot.skills.length > 0 ? "good" : "neutral";
    case "memory":
      return snapshot.memory ? "good" : "neutral";
    case "cron":
      return snapshot.cron ? "good" : "neutral";
    case "docs":
      return snapshot.docs.length > 0 ? "good" : "neutral";
    case "changelog":
      return snapshot.changelog.length > 0 ? "good" : "neutral";
    default:
      return "neutral";
  }
}

/** Format a "commits behind" count into a human-readable string. */
export function formatCommitsBehind(n: number): string {
  if (n === 0) return "up to date";
  return `${n} commit${n === 1 ? "" : "s"} behind`;
}

/** Format a latency value (ms) for display, returning "-" when null. */
export function formatLatencyMs(ms: number | null): string {
  if (ms === null) return "-";
  return `${ms}ms`;
}

export type MarkdownSection = {
  heading: string;
  body: string;
};

/** Split markdown content into heading/body sections for structured rendering. */
export function parseMarkdownToSections(content: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const lines = content.split("\n");
  let currentHeading = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentBody.length > 0) {
        sections.push({
          heading: currentHeading,
          body: currentBody.join("\n").trim(),
        });
      }
      currentHeading = headingMatch[2].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeading || currentBody.length > 0) {
    sections.push({
      heading: currentHeading,
      body: currentBody.join("\n").trim(),
    });
  }

  return sections;
}
