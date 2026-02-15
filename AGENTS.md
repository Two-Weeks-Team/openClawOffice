# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-15
**Commit:** 0967c1e
**Branch:** main

## OVERVIEW

Visual command center for OpenClaw agents. Renders agent/subagent state as isometric office with real-time SSE updates. React 19 + Vite 7 + TypeScript.

## STRUCTURE

```
openClawOffice/
├── src/
│   ├── components/     # OfficeStage (isometric map), EventRail (timeline)
│   ├── hooks/          # useOfficeStream (SSE consumer)
│   ├── lib/            # layout.ts (room placement algorithms)
│   ├── types/          # office.ts (OfficeSnapshot, Entity, Run, Event)
│   └── App.tsx         # Root component, stats bar, workspace layout
├── server/             # Vite plugin API (NOT a separate backend)
│   ├── office-state.ts     # Reads ~/.openclaw/, builds snapshots
│   └── vite-office-plugin.ts # Middleware: /api/office/snapshot, /stream
└── public/assets/kenney/   # Sprite sheets (characters, tiles, interior)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new room type | `src/lib/layout.ts` | Modify `ROOMS` array, add to `classifyRoom()` |
| Change entity rendering | `src/components/OfficeStage.tsx` | `spriteStyle()` for avatars, `statusClass()` for states |
| Modify API response | `server/office-state.ts` | `buildOfficeSnapshot()` is the main builder |
| Add API endpoint | `server/vite-office-plugin.ts` | Add route in `attachOfficeRoutes()` |
| Change data source | `server/office-state.ts` | `resolveStateDir()`, `loadAgentSnapshots()` |
| Add new event type | `src/types/office.ts` | Update `OfficeEventType`, then `EventRail.tsx` |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `buildOfficeSnapshot` | function | server/office-state.ts | Main API: reads fs, builds response |
| `OfficeSnapshot` | type | src/types/office.ts | Primary data structure |
| `useOfficeStream` | hook | src/hooks/useOfficeStream.ts | SSE consumer with polling fallback |
| `buildPlacements` | function | src/lib/layout.ts | Places entities in rooms by shape |
| `OfficeStage` | component | src/components/OfficeStage.tsx | Isometric renderer with SVG links |
| `openClawOfficeApiPlugin` | function | server/vite-office-plugin.ts | Vite plugin factory |

## CONVENTIONS

| Area | Convention |
|------|------------|
| Package manager | **pnpm** (not npm/yarn) |
| TypeScript | Strict mode, no unused vars, `verbatimModuleSyntax` |
| Network | **127.0.0.1 ONLY** - hardcoded in vite.config.ts |
| Ports | Dev: 5179, Preview: 5180 |
| State source | `~/.openclaw/` or `OPENCLAW_STATE_DIR` env |
| Fallback | Demo snapshot auto-generated when no live data |

## ANTI-PATTERNS (THIS PROJECT)

| Forbidden | Why |
|-----------|-----|
| External network binding | Local-only by design (README Operating Constraints) |
| Type assertions without validation | `JSON.parse(raw) as T` exists but should use runtime validation |
| Empty catch blocks | Already present - avoid adding more; add logging |
| Deploying without demo indicator | UI shows "Demo Snapshot" pill - preserve this distinction |
| Exceeding 50 agents | Capacity target per README; layout algorithms may degrade |

## UNIQUE STYLES

- **API-as-Plugin**: No separate backend process. `server/` is a Vite middleware plugin, runs inside `vite dev` only
- **Room-based layout**: Entities classified to rooms (`strategy`, `ops`, `build`, `spawn`, `lounge`) by status
- **Shape algorithms**: Each room uses `ring`, `grid`, `line`, or `cluster` placement
- **Hash-based sprites**: `hashString(entityId)` picks deterministic avatar from Kenney spritesheet
- **Bubble extraction**: Latest JSONL line from session files becomes speech bubble

## COMMANDS

```bash
# Development
pnpm install
pnpm dev                    # http://127.0.0.1:5179

# Build
pnpm build                  # tsc -b && vite build
pnpm preview                # http://127.0.0.1:5180

# Lint
pnpm lint                   # ESLint (TypeScript + React hooks)

# Custom state dir
OPENCLAW_STATE_DIR=/path pnpm dev
```

## DATA FLOW

```
~/.openclaw/agents/<id>/sessions/sessions.json  ─┐
~/.openclaw/subagents/runs.json                  ├─► office-state.ts
                                                 │   buildOfficeSnapshot()
Demo fallback (when no data) ────────────────────┘         │
                                                           ▼
                                                  OfficeSnapshot JSON
                                                           │
        ┌──────────────────────────────────────────────────┤
        ▼                                                  ▼
/api/office/snapshot (one-shot)              /api/office/stream (SSE 2.5s)
        │                                                  │
        └──────────────────┬───────────────────────────────┘
                           ▼
                  useOfficeStream hook
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   OfficeStage        EventRail           Stats bar
   (isometric)        (timeline)          (counts)
```

## NOTES

- **No tests**: Testing not configured. Recommend Vitest if adding
- **No CI/CD**: Local dev tool, no deployment pipeline
- **Kenney assets required**: See `public/assets/kenney/kenney-curation.json` for manifest
- **SSE polling fallback**: If EventSource fails, falls back to 4s fetch polling
- **README alignment**: All issues must align with Purpose/Intent/Vision in README.md
