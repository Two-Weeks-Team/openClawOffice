# openClawOffice

Web-based visual command center for OpenClaw agents and subagents.

## Overview

`openClawOffice` is a real-time visual operations dashboard for monitoring OpenClaw agent/subagent state. It renders agents in an isometric office layout with zone-based placement, live status updates via SSE, and comprehensive debugging tools.

**Key Features:**
- Real-time agent/subagent monitoring via SSE stream
- Zone-based layout with configurable room placement
- Entity detail panel with session/run/message inspection
- Timeline debugger with playback and filtering
- Command palette with keyboard shortcuts
- Alert rules engine with notification controls
- **OpenClaw Hub**: comprehensive project status dashboard with progressive disclosure

## Quick Start

### Prerequisites

- **Node.js** 18+ (20+ recommended)
- **pnpm** 8+ (install: `npm install -g pnpm`)
- **OpenClaw** runtime installed at `~/.openclaw/`

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/openClawOffice.git
cd openClawOffice

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open: **http://127.0.0.1:5179**

### Custom State Directory

If your OpenClaw state is in a different location:

```bash
OPENCLAW_STATE_DIR=/path/to/openclaw pnpm dev
```

## Office Zones

The office is divided into functional zones, each serving a specific purpose:

| Zone | Description | Agent Status |
|------|-------------|--------------|
| **Strategy Room** | Active agents executing primary tasks | `active` |
| **Ops Floor** | Standby agents ready for assignments | `ok`, `offline` |
| **Spawn Lab** | Running subagents spawned by agents | `active`, `idle` (subagents) |
| **Build Pods** | Idle agents awaiting task queue | `idle` |
| **Recovery Lounge** | Completed or errored runs awaiting review | `ok`, `error` |

Zone layout is configured via `public/assets/layout/zone-config.json`. Changes are hot-reloaded every 10 seconds.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl + K` | Open command palette |
| `⌘/Ctrl + H` | Toggle OpenClaw Hub |
| `⌘/Ctrl + Shift + A` | Open alert center |
| `Escape` | Close panel / Clear selection |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom |
| `F` | Fit view to content |

## Data Sources

The app reads OpenClaw runtime state from:

```
~/.openclaw/
├── agents/<agentId>/sessions/sessions.json   # Agent session data
└── subagents/runs.json                        # Subagent run data
```

**Behavior:**
- Live data: If valid agent/subagent data is found
- Demo mode: Falls back to demo snapshot if no data
- Graceful degradation: Invalid JSON becomes diagnostic warnings

## API Endpoints

All endpoints are available on the dev server (`127.0.0.1:5179`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/office/snapshot` | GET | Full office state snapshot |
| `/api/office/stream` | GET | SSE stream for real-time updates |
| `/api/office/metrics` | GET | Server metrics and diagnostics |
| `/api/office/openclaw-hub` | GET | OpenClaw project status snapshot |
| `/api/office/openclaw-hub/doc` | GET | Full document content (`?path=`) |

### SSE Stream Protocol

```javascript
// Connect to SSE stream
const source = new EventSource('/api/office/stream');

source.addEventListener('snapshot', (e) => {
  const data = JSON.parse(e.data);  // Full OfficeSnapshot
});

source.addEventListener('lifecycle', (e) => {
  const { seq, event } = JSON.parse(e.data);
  // event: spawn | start | end | error | cleanup
});
```

## Configuration

### Zone Layout (`public/assets/layout/zone-config.json`)

Customize room positions, sizes, and routing rules:

```json
{
  "rooms": [
    {
      "id": "strategy",
      "label": "Strategy Room",
      "description": "Active agents executing primary tasks",
      "shape": "ring",
      "capacity": 10,
      "routing": {
        "statuses": ["active"],
        "kinds": ["agent"]
      }
    }
  ]
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | OpenClaw state directory |
| `OPENCLAW_PROJECT_DIR` | `../openclaw` | OpenClaw project root for Hub dashboard |
| `OPENCLAW_GATEWAY_PORT` | `18789` | OpenClaw gateway port for health checks |
| `PORT` | `5179` | Dev server port |

## Development

### Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm lint         # Run ESLint
pnpm test         # Run unit tests
pnpm ci:local     # Full CI pipeline (lint + test + build)
```

### Project Structure

```
openClawOffice/
├── src/
│   ├── components/    # React components (OfficeStage, EventRail, etc.)
│   ├── hooks/         # Custom hooks (useOfficeStream)
│   ├── lib/           # Core logic (layout, timeline, alerts)
│   └── types/         # TypeScript types
├── server/            # Vite plugin API (embedded middleware)
├── public/assets/     # Static assets and configuration
└── docs/              # Documentation
```

## Troubleshooting

### "No agents found" / Demo mode

1. Verify OpenClaw is installed: `ls ~/.openclaw/agents/`
2. Check state directory: `OPENCLAW_STATE_DIR=... pnpm dev`
3. Ensure at least one agent has session data

### SSE connection issues

1. Check browser console for connection errors
2. Verify server is running: `curl http://127.0.0.1:5179/api/office/snapshot`
3. The app falls back to polling if SSE fails

### Layout issues (overlapping agents)

1. Zone config auto-reloads every 10s
2. Edit `public/assets/layout/zone-config.json`
3. Increase room `capacity` or adjust `spacing`

## Operating Constraints

- **Local-only**: Binds to `127.0.0.1` only (not `0.0.0.0`)
- **Capacity**: Designed for up to 50 active agents
- **Security**: Minimal hardening (local single-user use)

## Documentation

- [Alert Rules Guide](docs/alert-rules.md)
- [Capacity Baseline](docs/capacity-baseline.md)
- [Operator Playbook](docs/operator-playbook.md)
- [Quality Gate](docs/quality-gate.md)
- [Room Blueprint](docs/room-blueprint.md)
- [OpenClaw Hub](docs/openclaw-hub.md)

## License

MIT
