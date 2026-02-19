import type { CSSProperties } from "react";
import { hashString } from "./hash";

// Spritesheet: 54col × 12row, 16px tiles, 1px spacing
const SPRITE_PATH = "/assets/kenney/characters/characters_spritesheet.png";
const TILE_SIZE = 16;
const SPACING = 1;
const STEP = TILE_SIZE + SPACING; // 17

// Row 7 = hooded character (used for AI agents)
const AGENT_ROW = 7;
// Other rows available for subagents
const AVATAR_ROWS = [0, 1, 2, 3, 4, 5, 6, 8];

export function getAvatarStyle(
  agentId: string,
  kind: "agent" | "subagent",
): CSSProperties {
  const hash = hashString(agentId);
  let col: number;
  let row: number;

  if (kind === "agent") {
    // Agent: fixed row 7 (hooded character), vary col for visual variety
    row = AGENT_ROW;
    col = hash % 6;
  } else {
    // Subagent: pick from avatar rows, col 0 (base body)
    row = AVATAR_ROWS[hash % AVATAR_ROWS.length];
    col = 0;
  }

  const bgX = -(col * STEP);
  const bgY = -(row * STEP);

  return {
    backgroundImage: `url(${SPRITE_PATH})`,
    backgroundPosition: `${bgX}px ${bgY}px`,
    width: TILE_SIZE,
    height: TILE_SIZE,
    imageRendering: "pixelated" as const,
  };
}
