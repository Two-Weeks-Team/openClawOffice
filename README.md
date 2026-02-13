# openClawOffice

Web-based visual command center for OpenClaw agents and subagents.

## What this MVP shows

- Isometric-style office zones with shape-based placement (`ring`, `grid`, `line`, `cluster`)
- Agent + subagent entities rendered with Kenney sprite sheet avatars
- Chat-style speech bubbles from latest session text (when available)
- Subagent spawn lifecycle timeline (spawn/start/end/error/cleanup)
- Parent-agent -> subagent link paths in the office map

## Data source

By default, the app reads OpenClaw runtime state from:

- `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- `~/.openclaw/subagents/runs.json`

If no runtime state exists, it automatically falls back to a demo snapshot.

You can override the state directory:

```bash
OPENCLAW_STATE_DIR=/custom/path pnpm dev
```

## Run

```bash
pnpm install
pnpm dev
```

Open: `http://localhost:5179`

## Build

```bash
pnpm build
pnpm preview
```

## API endpoints (dev server)

- `GET /api/office/snapshot`
- `GET /api/office/stream` (SSE)

## Kenney assets

This project expects assets under:

- `public/assets/kenney/characters/characters_spritesheet.png`
- `public/assets/kenney/tiles/city_tilemap.png`
- `public/assets/kenney/interior/interior_tilemap.png`

A curation manifest is included at:

- `public/assets/kenney/kenney-curation.json`
