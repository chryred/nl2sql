# Memory Leak Fixes Design

**Date**: 2026-02-20
**Status**: Approved

## Overview

4개의 메모리 누수 / 리소스 정리 이슈를 우선순위 순서대로 수정한다.

---

## Fix 1 (🔴): SSE 이중 시그널 핸들러

**파일**: `src/mcp/transport/sse.ts`, `src/mcp/index.ts`
**문제**: SSE 모드 실행 시 `SIGINT/SIGTERM` 핸들러가 두 곳에 등록되어 race condition 발생

**설계**:
- `startSSEServer()`의 반환 타입을 `void → () => Promise<void>`로 변경
- 내부 cleanup 함수를 반환하고, `process.on('SIGINT/SIGTERM')` 등록을 제거
- `mcp/index.ts`의 단일 cleanup 핸들러에서 SSE cleanup + connManager cleanup을 순서대로 실행

---

## Fix 2 (🟠): InteractiveSession 시그널 리스너 익명 함수

**파일**: `src/cli/modes/interactive.ts`
**문제**: 익명 화살표 함수로 등록된 시그널 리스너 → 제거 불가, `this` 캡처로 인스턴스 GC 불가

**설계**:
- 클래스 필드에 `private readonly boundExit = () => this.handleExit()` 저장
- `start()` 진입 시 리스너 등록
- `handleExit()` 내에서 `process.removeListener()` 호출 후 종료

---

## Fix 3 (🟠): 퇴거된 Entry를 cacheInitPromise가 유지

**파일**: `src/database/connection-manager.ts`
**문제**: entry 퇴거 후에도 pending Promise 클로저가 entry 객체를 참조 유지

**설계**:
- `getOrInitCache()`의 `.then()` 핸들러에서 `this.entries.has(connectionId)` 체크 추가
- 퇴거된 entry이면 캐시 설정 건너뜀

---

## Fix 4 (🟡): keepAlive 모드 종료 시 연결 미정리

**파일**: `src/cli/modes/interactive.ts`
**문제**: `process.exit(0)` 직전 Knex 연결 풀 drain 미실행

**설계**:
- `handleExit()`을 `async`로 변경
- `process.exit(0)` 전에 `await closeConnection()` 호출
