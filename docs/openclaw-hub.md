# OpenClaw Status Hub

The Hub tab provides a comprehensive dashboard for monitoring the state of the sibling `openclaw` project. It collects git status, gateway health, channels, skills, memory, cron jobs, documentation, and changelog data into a single view with progressive disclosure.

## Architecture

```
openclaw project (../openclaw/)
  │  git commands + file reads (30s cache)
  ▼
server/openclaw-status.ts  →  buildOpenClawHubSnapshot()
  │
  ▼
GET /api/office/openclaw-hub          ← 30s poll from frontend
GET /api/office/openclaw-hub/doc      ← on-demand full document
  │
  ▼
useOpenClawHub() hook  →  <OpenClawHub /> tab panel
```

## Progressive Disclosure

| Level | Interaction | Content |
|-------|------------|---------|
| **L0** | Glance | Card grid with severity dot and one-line summary |
| **L1** | Hover | CSS tooltip showing 3-5 detail lines |
| **L2** | Click | Card expands to reveal full metrics and lists |
| **L3** | "View Details" | Slide-in panel for doc viewer, changelog deep-dive, etc. |

## Cards

| Card | Severity Rules | Data Source |
|------|---------------|-------------|
| **Project** | bad = no package.json; warn = dirty/behind; good = clean | `package.json` + `git status` |
| **Gateway** | bad = offline; good = reachable | `GET 127.0.0.1:{port}/health` |
| **Channels** | neutral = 0; good = 1+ | `src/channels/` + `extensions/` |
| **Skills** | neutral = 0; good = 1+ | `skills/` |
| **Memory** | neutral = not found; good = found | `src/memory/` |
| **Cron** | neutral = not found; good = found | `src/cron/` |
| **Docs** | neutral = 0; good = 1+ | `README.md` + `docs/` |
| **Changelog** | neutral = 0; good = 1+ | `CHANGELOG.md` |

## API Endpoints

### `GET /api/office/openclaw-hub`

Returns the full `OpenClawHubSnapshot` JSON object containing all collected data. Responses are cached server-side for 30 seconds.

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `generatedAt` | `number` | Unix timestamp (ms) of snapshot creation |
| `projectDir` | `string` | Resolved path to the openclaw project |
| `git` | `object \| null` | Branch, commits behind, last commit, dirty files |
| `project` | `object \| null` | Name, version, deps/devDeps count, scripts |
| `gateway` | `object \| null` | Reachable flag, latency, URL, port |
| `channels` | `array` | Channel name, source directory, file count |
| `skills` | `array` | Skill name and path |
| `memory` | `object \| null` | Memory module .ts/.js files |
| `cron` | `object \| null` | Cron module .ts/.js files |
| `docs` | `array` | Document path, title, first paragraph, headings, size |
| `changelog` | `array` | Version, added/fixed/changed counts, highlights |
| `docker` | `object \| null` | Docker Compose service names |
| `diagnostics` | `array` | Info/warning/error messages from collection |

### `GET /api/office/openclaw-hub/doc?path=<relativePath>`

Returns the full content of a markdown document within the openclaw project directory. Path traversal is rejected (no `..`, no absolute paths).

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `path` | Yes | Relative path within the openclaw project (e.g., `README.md`, `docs/guide.md`) |

**Response:** `{ "content": "<full file content>" }`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_PROJECT_DIR` | `../openclaw` (relative to cwd) | Absolute or relative path to the openclaw project root |
| `OPENCLAW_GATEWAY_PORT` | `18789` | Port number for the openclaw gateway health check |

## Caching Strategy

| Data | TTL | Rationale |
|------|-----|-----------|
| Hub snapshot (git, files, docs) | 30 s | File system and git data changes infrequently |
| Gateway health check | 10 s | Health status should reflect near-real-time state |
| Frontend polling | 30 s | Matches server cache to avoid redundant recomputation |

## File Structure

```
server/
├── openclaw-hub-types.ts     # Shared TypeScript type definitions
├── openclaw-status.ts        # Server-side data collection and caching
└── vite-office-plugin.ts     # API route handlers (modified)

src/
├── lib/openclaw-hub.ts       # Severity resolution, formatting, markdown parsing
├── hooks/useOpenClawHub.ts   # Polling hook (30s interval)
└── components/
    ├── OpenClawHub.tsx        # Main hub container with 8 cards
    ├── HubDetailPanel.tsx     # Slide-in detail panel (L3)
    └── HubTooltip.tsx         # CSS tooltip wrapper (L1)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl + H` | Toggle Hub tab |
| `Escape` | Close detail panel |
