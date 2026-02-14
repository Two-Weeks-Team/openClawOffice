# Alert Rules Guide

`openClawOffice` 로컬 알림 엔진은 이벤트/런 상태를 매 스냅샷마다 평가해
운영자가 즉시 인지해야 할 패턴을 UI 경고로 제공합니다.

## Rules

1. `consecutive-errors`
- 조건: 최신 스트림 프레임 기준 연속 `error` 이벤트 3개 이상
- 목적: 연쇄 실패 급증 감지

2. `long-active`
- 조건: `active` 상태 run이 8분 이상 지속
- 목적: 장기 정체/교착 후보 감지

3. `cleanup-pending`
- 조건: `cleanup=delete` + `endedAt` 존재 + `cleanupCompletedAt` 없음 상태가 3분 이상 지속
- 목적: 정리 누락/지연 감지

4. `event-stall`
- 조건: active run 존재 + 최근 lifecycle 이벤트 미도착 90초 이상
- 목적: 스트림 정체/중단 조기 감지

## Duplicate Control

- 각 규칙은 `dedupeKey` 기반으로 중복 토스트를 억제합니다.
- 기존 키가 해소(조건 해제)되기 전까지 같은 토스트를 반복 발행하지 않습니다.

## Mute And Snooze

- Alert Center에서 규칙 단위로 `Mute / Snooze 15m / Snooze 1h / Clear` 제어.
- 설정은 브라우저 로컬 스토리지에 저장되어 재시작 후 복원됩니다.

## Tuning Tips

1. 오탐이 많으면 먼저 `Snooze`로 완화하고, 반복 오탐 규칙만 `Mute` 고정.
2. 장애 분석 기간에는 `consecutive-errors`, `event-stall` 규칙을 우선 활성 유지.
3. 운영 부하가 높은 시간대는 `long-active`를 모니터링 우선순위 2순위로 두고,
   `cleanup-pending`은 후속 triage 큐로 처리.
