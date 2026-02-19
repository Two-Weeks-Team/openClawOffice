# OpenClaw 통합 심층 분석 보고서

> 분석일: 2026-02-19
> 대상: OpenClaw, OpenClawOffice, OpenClawWorld

## 1. Architecture Overview

```
┌─────────────────┐     ~/.openclaw/      ┌──────────────────────┐
│    OpenClaw      │ ──── state files ────▶│   OpenClawOffice     │
│  (CLI Agent)     │     sessions.json     │   (Dashboard)        │
│                  │     runs.json         │                      │
│                  │     *.jsonl           │  SSE /api/office/    │
└────────┬────────┘                       │  stream → Frontend   │
         │                                └──────────────────────┘
         │  REST API (AIC v0.1)
         │  POST /register, /observe,
         │  /moveTo, /pollEvents, etc.
         ▼
┌─────────────────┐
│  OpenClawWorld   │
│  (Colyseus:2567) │
│  Virtual World   │
└─────────────────┘
```

**3개의 독립 시스템**:
- **OpenClaw**: CLI 에이전트, `~/.openclaw/`에 런타임 상태 기록
- **OpenClawOffice**: 대시보드, 파일 폴링(400ms) + SSE 스트리밍
- **OpenClawWorld**: Colyseus 가상 세계, REST API 기반 에이전트 통합

---

## 2. Dashboard Data Pipeline (OpenClawOffice)

### 2.1 데이터 소스

| 파일 | 경로 | 내용 |
|------|------|------|
| sessions.json | `~/.openclaw/{agentId}/` | 세션 메타데이터 (updatedAt, model) |
| runs.json | `~/.openclaw/{agentId}/` | 서브에이전트 실행 기록 (status, task, timestamps) |
| {sessionKey}.jsonl | `~/.openclaw/{agentId}/` | 에이전트 트랜스크립트 (JSON Lines) |

### 2.2 데이터 모델 (OfficeEntity)

```typescript
// 필수 필드
id, kind, label, agentId, status, sessions, activeSubagents

// 선택 필드
model, bubble (110자 활동 텍스트), task, expiresAt

// 상태 추론 우선순위
error → active → idle (2분) → offline (8분)
```

### 2.3 SSE 아키텍처

| 구성 요소 | 역할 | 핵심 수치 |
|----------|------|----------|
| OfficeStreamBridge | 이벤트 중복 제거 + 시퀀스 번호 | backfill 1,200개 |
| 폴링 주기 | 서버 → 파일 시스템 | 400ms |
| Fallback | SSE 실패 시 HTTP 폴링 | 4초 간격 |
| 프론트엔드 dedup | seen ID 캐시 | 4,000개 |
| 최대 표시 | MAX_EVENTS | 220개 |

### 2.4 핵심 파일

1. `server/office-state.ts` - buildOfficeSnapshot (핵심 집계)
2. `server/stream-bridge.ts` - OfficeStreamBridge (이벤트 중복 제거)
3. `src/hooks/useOfficeStream.ts` - 프론트엔드 소비 패턴
4. `server/vite-office-plugin.ts` - HTTP/SSE 엔드포인트
5. `server/runtime-parser.ts` - 파일 형식 파싱

### 2.5 대시보드 갭 분석

| 갭 | 설명 | 영향 |
|----|------|------|
| Tool 호출 미파싱 | tool_use/tool_result 무시 | 에이전트 행동 상세 정보 부족 |
| 토큰 카운트 미추출 | usage 필드 미파싱 | 비용/성능 모니터링 불가 |
| 완료 run 만료 | 5분 후 expire | 히스토리 소실 |
| 필드 캐싱 없음 | 400ms마다 전체 재파싱 | CPU 부하 (대규모 시 문제) |

---

## 3. World Movement System (OpenClawWorld)

### 3.1 에이전트 등록 흐름

```
POST /aic/v0.1/register
  { name: "agent-name", roomId: "default" }

→ Response:
  { agentId: "agt_xxx", sessionToken: "tok_xxx", roomId: "default" }

→ 스폰 위치: CENTER_PLAZA (~x:1280, y:720)
→ 인증: Authorization: Bearer {sessionToken}
```

### 3.2 이동 시스템

| 항목 | 값 |
|------|-----|
| 타일 크기 | 16px |
| 기본 속도 | 32px/sec |
| 최대 속도 | 100px/sec |
| 패스파인딩 | **없음** (직선 보간만) |
| 충돌 처리 | 즉시 정지 (우회 없음) |
| 멱등성 | txId로 중복 요청 방지 |

### 3.3 월드 상태 조회

```
POST /aic/v0.1/observe
  { agentId, roomId, radius, detail: "lite"|"full" }

→ self (자기 위치), nearby (주변 엔티티), facilities (상호작용 객체)
→ mapMetadata: zones, mapSize, currentZone
```

### 3.4 이벤트 스트리밍

```
POST /aic/v0.1/pollEvents
  { agentId, roomId, sinceCursor, limit: 50, waitMs: 0-1000 }

이벤트 유형:
  presence.join/leave, proximity.enter/exit,
  zone.enter/exit, chat.message, object.state_changed
```

### 3.5 존 시스템 (8개 존)

lobby, office, central-park, arcade, meeting, lounge-cafe, plaza, lake

### 3.6 월드 갭 분석

| 우선순위 | 갭 | 설명 |
|---------|-----|------|
| **P1 - Blocking** | A* 패스파인딩 없음 | 장애물에 걸리면 이동 불가, 클라이언트 측 구현 필요 |
| **P1 - Blocking** | 세션 복구 없음 | 연결 끊기면 재등록 필수 |
| **P1 - Blocking** | Heartbeat 미정의 | observe/pollEvents를 5-10초마다 호출해야 presence 유지 |
| **P2 - Important** | 충돌 예측 없음 | 이동 전 충돌 체크 불가 |
| **P2 - Important** | 엔티티 상태 보간 없음 | 다른 에이전트 위치 예측 불가 |
| **P3 - Nice** | 미팅 시스템 미완성 | 에이전트가 미팅 참여 불가 |
| **P3 - Nice** | 존 동적 생성 불가 | 서버 코드 변경 필요 |

---

## 4. 통합 요구사항 매트릭스

### OpenClaw → OpenClawOffice (대시보드 표시)

| 요구사항 | 현재 상태 | 필요 작업 |
|---------|----------|----------|
| 에이전트 상태 표시 | ✅ 동작 | - |
| 서브에이전트 run 표시 | ✅ 동작 | - |
| 활동 버블 (bubble) | ✅ 동작 | 110자 제한 |
| Tool 호출 상세 | ❌ 미구현 | runtime-parser에 tool_use 파싱 추가 |
| 토큰 사용량 | ❌ 미구현 | usage 필드 추출 로직 추가 |
| 에러 상세 정보 | ⚠️ 부분 | error status만, stack trace 미표시 |
| 모델 정보 | ✅ 동작 | sessions.json의 model 필드 |
| 월드 위치 연동 | ❌ 미구현 | OpenClawWorld 상태를 OfficeEntity에 통합 |

### OpenClaw → OpenClawWorld (자유 이동)

| 요구사항 | 현재 상태 | 필요 작업 |
|---------|----------|----------|
| 등록/인증 | ✅ 동작 | register → sessionToken |
| 기본 이동 | ✅ 동작 | moveTo API |
| 장애물 우회 | ❌ 미구현 | 클라이언트 A* 패스파인딩 |
| 존 인식 이동 | ⚠️ 부분 | observe에서 zone 정보 제공, 계획은 에이전트 몫 |
| 시설 상호작용 | ✅ 동작 | interact API |
| 채팅 | ✅ 동작 | chat_send/chat_observe |
| 자동 재연결 | ❌ 미구현 | 세션 복구 메커니즘 필요 |
| 이벤트 처리 | ✅ 동작 | pollEvents + cursor 기반 |

---

## 5. 구현 로드맵

### Phase 1: 핵심 통합 (P1)
1. **클라이언트 A* 패스파인딩** - OpenClaw 플러그인에 collision grid 기반 경로 탐색
2. **Heartbeat 루프** - 5초 간격 observe 호출로 presence 유지
3. **세션 복구** - 토큰 만료 시 자동 재등록 + 상태 복원

### Phase 2: 대시보드 강화 (P2)
4. **Tool 호출 파싱** - runtime-parser에 tool_use/tool_result 처리
5. **토큰 사용량 추적** - usage 필드 추출 + 대시보드 표시
6. **월드 위치 연동** - OfficeEntity에 worldPosition 필드 추가

### Phase 3: 고급 기능 (P3)
7. **충돌 예측** - 이동 전 경로 검증
8. **미팅 시스템 완성** - 에이전트 미팅 참여/퇴장
9. **에이전트 히스토리** - 완료 run 영구 보존

---

## 6. 설정 체크리스트

```yaml
OpenClawOffice:
  환경변수:
    OPENCLAW_STATE_DIR: "~/.openclaw/"  # 기본값
  확인사항:
    - [ ] ~/.openclaw/ 디렉토리 존재
    - [ ] 에이전트가 sessions.json 생성 중
    - [ ] pnpm dev로 대시보드 실행 (Vite)
    - [ ] SSE 연결 확인 (/api/office/stream)

OpenClawWorld:
  서버:
    PORT: 2567 (Colyseus)
  에이전트 설정:
    baseUrl: "http://localhost:2567/aic/v0.1"
    defaultRoomId: "default"
  확인사항:
    - [ ] Colyseus 서버 실행 (pnpm dev)
    - [ ] POST /register 응답 확인
    - [ ] observe로 맵 메타데이터 수신
    - [ ] pollEvents 커서 기반 이벤트 수신
```
