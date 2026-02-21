# Memory Leak Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 분석된 4가지 메모리 누수 / 리소스 정리 이슈를 우선순위 순서대로 수정한다.

**Architecture:** SSE 이중 시그널 핸들러는 `startSSEServer()`가 cleanup 함수를 반환하도록 변경하여 `mcp/index.ts`에서 통합 관리한다. InteractiveSession은 named bound 메서드로 리스너를 등록/제거한다. ConnectionManager는 퇴거된 entry에 대한 Promise 완료 시 존재 여부를 확인한다. handleExit는 async로 변경하여 연결 풀을 정상 drain한다.

**Tech Stack:** TypeScript, Node.js `process.on/removeListener`, Knex.js, MCP SDK

---

### Task 1: SSE 이중 시그널 핸들러 수정

**Files:**
- Modify: `src/mcp/transport/sse.ts`
- Modify: `src/mcp/index.ts`

**Step 1: `startSSEServer` 반환 타입 확인**

`src/mcp/transport/sse.ts` 파일을 열어 현재 함수 시그니처(`export function startSSEServer(...)：void`)와 맨 아래 `process.on('SIGINT', cleanup)` / `process.on('SIGTERM', cleanup)` 두 줄을 확인한다.

**Step 2: `sse.ts` — 반환 타입 변경 및 시그널 핸들러 제거**

`startSSEServer` 함수 시그니처 및 마지막 부분을 다음과 같이 수정한다.

```typescript
// 변경 전
export function startSSEServer(...): void {
  ...
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// 변경 후
export function startSSEServer(...): () => Promise<void> {
  ...
  // process.on('SIGINT/SIGTERM') 두 줄 완전 제거
  return cleanup;
}
```

`cleanup` 함수도 `async`가 아니므로, `server.close()` 콜백 방식을 Promise로 감싸 반환 타입이 `() => Promise<void>`와 맞도록 변경한다:

```typescript
const cleanup = (): Promise<void> => {
  return new Promise((resolve) => {
    console.log('\n[MCP] Shutting down server...');

    if (sweepTimer) clearInterval(sweepTimer);

    for (const [sessionId, transport] of transports) {
      console.log(`[MCP] Closing session: ${sessionId}`);
      transport.close().catch(console.error);
    }
    transports.clear();
    sessionLastActivity.clear();

    server.close(() => {
      console.log('[MCP] Server closed');
      resolve();
    });
  });
};

return cleanup;
```

**Step 3: `mcp/index.ts` — SSE cleanup을 통합 핸들러에 포함**

현재 `main()` 함수 안의 SSE 분기와 cleanup 등록 부분을 수정한다:

```typescript
// 변경 전
if (transport === 'sse') {
  startSSEServer(() => createMcpServer(connManager), { port, authToken, sessionIdleTtlMs });
} else {
  ...
}

const cleanup = () => {
  connManager.destroyAll().then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// 변경 후
let sseCleanup: (() => Promise<void>) | null = null;

if (transport === 'sse') {
  sseCleanup = startSSEServer(() => createMcpServer(connManager), { port, authToken, sessionIdleTtlMs });
} else {
  ...
}

const cleanup = async () => {
  if (sseCleanup) await sseCleanup().catch(console.error);
  await connManager.destroyAll().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

**Step 4: 빌드 확인**

```bash
npm run build
```
Expected: 오류 없이 컴파일 성공

**Step 5: Commit**

```bash
git add src/mcp/transport/sse.ts src/mcp/index.ts
git commit -m "fix: remove duplicate SIGINT/SIGTERM handlers in SSE mode"
```

---

### Task 2: InteractiveSession 시그널 리스너 익명 함수 수정

**Files:**
- Modify: `src/cli/modes/interactive.ts`

**Step 1: 현재 constructor 구조 확인**

`src/cli/modes/interactive.ts` 의 `constructor` (약 70-90줄)와 `handleExit` 메서드를 확인한다.
현재 `process.on('SIGINT', () => this.handleExit())` 패턴이 두 줄 있다.

**Step 2: named bound handler 필드 추가 및 constructor 수정**

```typescript
// Class 필드 추가 (constructor 위)
private readonly boundExit = (): void => { void this.handleExit(); };

// constructor 내 기존 두 줄 교체
// 변경 전
process.on('SIGINT', () => this.handleExit());
process.on('SIGTERM', () => this.handleExit());

// 변경 후 — start()에서 등록할 것이므로 constructor에서 제거
// (등록은 start()에서)
```

**Step 3: `start()` 메서드에 리스너 등록 추가**

```typescript
async start(showWelcome: boolean = true): Promise<void> {
  // 시그널 핸들러 등록 (start 시점에만)
  process.on('SIGINT', this.boundExit);
  process.on('SIGTERM', this.boundExit);

  if (showWelcome) {
    this.printWelcome();
  }
  ...
}
```

**Step 4: `handleExit()` 에서 리스너 제거**

```typescript
private handleExit(): void {
  process.removeListener('SIGINT', this.boundExit);
  process.removeListener('SIGTERM', this.boundExit);
  console.log(chalk.cyan('\n안녕히 가세요! 👋'));
  this.isRunning = false;
  this.rl.close();
  process.exit(0);
}
```

**Step 5: 빌드 확인**

```bash
npm run build
```
Expected: 오류 없이 컴파일 성공

**Step 6: Commit**

```bash
git add src/cli/modes/interactive.ts
git commit -m "fix: use named bound handler for SIGINT/SIGTERM in InteractiveSession"
```

---

### Task 3: 퇴거된 Entry를 cacheInitPromise가 유지하는 문제 수정

**Files:**
- Modify: `src/database/connection-manager.ts`

**Step 1: `getOrInitCache` 메서드 확인**

`src/database/connection-manager.ts`의 `getOrInitCache` 메서드(약 220-260줄)를 확인한다.
`.then((cache) => { entry.metadataCache = cache; ... })` 부분을 찾는다.

**Step 2: `.then()` 핸들러에 존재 여부 체크 추가**

```typescript
// 변경 전
entry.cacheInitPromise = loadMetadataCacheIsolated(entry.knex, entry.params.type)
  .then((cache) => {
    entry.metadataCache = cache;
    entry.cacheInitPromise = null;
    return cache;
  })
  .catch((err) => {
    entry.cacheInitPromise = null;
    ...
    return null;
  });

// 변경 후
entry.cacheInitPromise = loadMetadataCacheIsolated(entry.knex, entry.params.type)
  .then((cache) => {
    // 퇴거된 entry라면 캐시 설정 건너뜀
    if (this.entries.has(connectionId)) {
      entry.metadataCache = cache;
    }
    entry.cacheInitPromise = null;
    return cache;
  })
  .catch((err) => {
    entry.cacheInitPromise = null;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to init metadata cache for ${connectionId}: ${msg}`);
    return null;
  });
```

**Step 3: 빌드 확인**

```bash
npm run build
```
Expected: 오류 없이 컴파일 성공

**Step 4: Commit**

```bash
git add src/database/connection-manager.ts
git commit -m "fix: skip cache assignment for evicted connections in getOrInitCache"
```

---

### Task 4: keepAlive 모드 종료 시 연결 미정리 수정

**Files:**
- Modify: `src/cli/modes/interactive.ts`

**Step 1: `handleExit` 메서드 async 변경**

Task 2에서 이미 `handleExit`를 수정했으므로, 동일 메서드에 `closeConnection` 호출을 추가한다.

`src/cli/modes/interactive.ts` 상단 import에 `closeConnection`이 없으면 추가한다:

```typescript
import { closeConnection } from '../../database/connection.js';
```

**Step 2: `handleExit()` async 변환 및 연결 정리 추가**

```typescript
// 변경 전 (Task 2에서 수정된 상태)
private handleExit(): void {
  process.removeListener('SIGINT', this.boundExit);
  process.removeListener('SIGTERM', this.boundExit);
  console.log(chalk.cyan('\n안녕히 가세요! 👋'));
  this.isRunning = false;
  this.rl.close();
  process.exit(0);
}

// 변경 후
private handleExit(): void {
  process.removeListener('SIGINT', this.boundExit);
  process.removeListener('SIGTERM', this.boundExit);
  console.log(chalk.cyan('\n안녕히 가세요! 👋'));
  this.isRunning = false;
  this.rl.close();
  // Knex 연결 풀 정상 drain 후 종료
  closeConnection().finally(() => process.exit(0));
}
```

> **Note**: `handleExit`는 `process.on` 핸들러에 연결되어 있어 반환 Promise가 무시된다. `async/await` 대신 `.finally()` 체인을 사용해야 종료가 보장된다.

**Step 3: 빌드 확인**

```bash
npm run build
```
Expected: 오류 없이 컴파일 성공

**Step 4: Lint 확인**

```bash
npm run lint
```
Expected: 오류 없음

**Step 5: Commit**

```bash
git add src/cli/modes/interactive.ts
git commit -m "fix: drain knex connection pool before process exit in interactive mode"
```

---

### Task 5: README / MCP 문서 업데이트 (CLAUDE.md 규칙)

**Files:**
- Modify: `README.md`
- Modify: `.claude/rules/mcp.md`

**Step 1: README에 버전 히스토리 항목 추가**

README.md에서 버전 히스토리 섹션을 찾아 다음을 추가한다:

```markdown
### v1.5.1
- 메모리 누수 수정: SSE 모드 이중 SIGINT/SIGTERM 핸들러 제거
- 메모리 누수 수정: InteractiveSession 시그널 리스너 정상 해제
- 메모리 누수 수정: 퇴거된 연결의 cacheInitPromise 참조 유지 방지
- 메모리 누수 수정: interactive 모드 종료 시 Knex 연결 풀 정상 drain
```

**Step 2: `.claude/rules/mcp.md` 버전 히스토리 업데이트**

`mcp.md`의 Version History 섹션에 v1.5.1 항목 추가:

```markdown
### v1.5.1
- SSE 모드 이중 SIGINT/SIGTERM 핸들러 race condition 수정
- `startSSEServer()` cleanup 함수 반환으로 시그널 핸들러 통합 관리
```

**Step 3: Commit**

```bash
git add README.md .claude/rules/mcp.md
git commit -m "docs: update version history for v1.5.1 memory leak fixes"
```
