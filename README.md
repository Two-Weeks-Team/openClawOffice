# openClawOffice

Web-based visual command center for OpenClaw agents and subagents.

## Purpose

`openClawOffice`는 로컬 OpenClaw 런타임의 에이전트/서브에이전트 상태를
아이소메트릭 오피스 형태로 가시화하는 운영 도구입니다.

## Intent

- 텍스트 로그 중심 운영을 공간 중심 운영으로 전환
- spawn/start/end/error 흐름을 실시간으로 추적
- 문제 상황에서 원인 파악 시간을 줄이는 관제 UX 제공

## Vision

\"로컬 단독 환경에서 최대 50개 에이전트를 안정적으로 운영/관찰할 수 있는
시각적 오퍼레이션 콘솔\"을 목표로 합니다.

## Operating Constraints

- Local-only: 단일 사용자 로컬 실행 전제
- Network bind: `127.0.0.1` 루프백 바인딩만 지원
- Capacity target: 활성 에이전트 최대 `50`
- Security scope: 로컬 단독 사용 전제로 보안 하드닝은 최소 범위로 제한

## What this MVP shows

- Isometric-style office zones with shape-based placement (`ring`, `grid`, `line`, `cluster`)
- Agent + subagent entities rendered with Kenney sprite sheet avatars
- Chat-style speech bubbles from latest session text (when available)
- Subagent spawn lifecycle timeline (spawn/start/end/error/cleanup)
- Parent-agent -> subagent link paths in the office map
- Layered stage rendering model (`floor -> wall -> object -> entity -> overlay`)
- Y-axis depth sort for entities + wall-side occlusion dimming
- Responsive LOD policy (desktop: full layers, smaller viewport: object/wall detail reduction)
- Zone rule engine (JSON DSL) with priority routing + room capacity overflow policy
- Room-level debug overlay (`cap/target/overflow`) for layout diagnostics
- Lifecycle motion tokens for spawn/start/end/error/cleanup + reduced-motion fallback
- Entity detail panel (`Overview / Sessions / Runs / Messages / Metrics`) with copy actions

## Motion Lifecycle Guide

`OfficeStage` 상태 전이는 CSS 모션 토큰으로 정의되며, 중복 이벤트가 들어와도
최근 윈도우 기반으로 모션 강도를 제한합니다.

- `spawn`: 서브에이전트 생성 직후 pulse ring (`motion-spawn`)
- `start`: 실행 시작 직후 orbit boost (`motion-start`)
- `run-active`: 실행 중 궤도/연결선 흐름 유지 (`motion-run`, `run-link.run-active`)
- `end`: 종료 직후 settle pulse (`motion-end`)
- `error`: shake + glow 경고 (`motion-error`)
- `cleanup`: 정리 단계 fade-out (`motion-cleanup`)

연결선은 run age에 따라 recent/stale 클래스를 분리해 강조를 조정합니다.
접근성 모드(`prefers-reduced-motion: reduce`)에서는 stage 애니메이션을 최소화하고
정적 스타일로 상태만 유지합니다.

## Detail Panel Scenarios

운영자가 1~2회 클릭으로 원인에 접근할 수 있도록 아래 시나리오를 기준으로 설계했습니다.

1. `agent` 선택 후 Overview에서 상태/모델/lastUpdated를 확인하고 Sessions에서 로그 경로를 즉시 복사
2. `subagent` 선택 후 Runs에서 parent->child 링크와 원문 task를 확인해 실행 의도를 복원
3. 장애 상태 엔티티 선택 후 Messages에서 `error/end/cleanup` 순서를 시간축으로 추적
4. Session key/run ID를 복사해 터미널/로그 검색으로 즉시 전환
5. Metrics에서 run/error/event 밀도를 확인해 타임라인 대비 병목 후보를 빠르게 좁힘

## Data source

By default, the app reads OpenClaw runtime state from:

- `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- `~/.openclaw/subagents/runs.json`

Live/demo transition rules:

- If at least one valid agent session or subagent run is parsed, the snapshot is treated as live runtime data.
- If no valid runtime rows are parsed, it falls back to a demo snapshot.
- Demo entities are never mixed into a live snapshot.
- Invalid JSON or malformed rows are degraded into diagnostics (warning codes) instead of crashing the app.

Kenney tile coordinates and spacing are resolved from
`public/assets/kenney/kenney-curation.json` so city/interior tile atlases follow
one standardized source contract.

Room layout policy is resolved from `public/assets/layout/zone-config.json`.
The client reloads this config periodically (10s) and recalculates placements,
so policy edits can be reflected without restarting the app.

You can override the state directory:

```bash
OPENCLAW_STATE_DIR=/custom/path pnpm dev
```

## Run

```bash
pnpm install
pnpm dev
```

Open: `http://127.0.0.1:5179`

## Build

```bash
pnpm build
pnpm preview
```

## API endpoints (dev server)

- `GET /api/office/snapshot`
- `GET /api/office/stream` (SSE)

### Stream Protocol (`/api/office/stream`)

- `snapshot` event: full `OfficeSnapshot` payload (initial sync + resync after lifecycle bursts)
- `lifecycle` event: incremental payload `{ seq, event }`
  - `seq`: monotonic stream cursor for reconnect/backfill
  - `event`: lifecycle event (`spawn | start | end | error | cleanup`)
- Reconnect/backfill:
  - client can resume with SSE `Last-Event-ID` or `?lastEventId=<seq>`
  - server keeps an in-memory lifecycle queue and replays missed frames after reconnect

## Kenney assets

This project expects assets under:

- `public/assets/kenney/characters/characters_spritesheet.png`
- `public/assets/kenney/tiles/city_tilemap.png`
- `public/assets/kenney/interior/interior_tilemap.png`

A curation manifest is included at:

- `public/assets/kenney/kenney-curation.json`

## Issue Policy

모든 구현 이슈는 아래 정렬 기준을 따라야 합니다.

- README의 Purpose/Intent/Vision에 정렬
- `127.0.0.1` 로컬 바인딩 전제 유지
- 50-agent 운영 한계를 기준으로 목표/완료조건 정의
- 보안 이슈는 로컬 단독 사용 전제에서 우선순위 제외
