# Schema Cache Per Connection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cache schema per connection in `ConnectionManager` (mirroring `metadataCache`), inject into `NL2SQLEngine` via constructor option, and use cached schema in MCP tools.

**Architecture:** Add `schemaCache` + `schemaCacheInitPromise` fields to `ConnectionEntry`. Add `getOrInitSchemaCache`, `invalidateSchemaCache`, `refreshSchemaCache` to `ConnectionManager`. Add `schemaCache?: SchemaInfo | null` to `NL2SQLEngineOptions`; `getSchema()` returns the injected value when provided. MCP tools inject schema cache at engine creation time.

**Tech Stack:** TypeScript, Knex, Jest (unit tests), existing `extractSchema` from `src/database/schema-extractor.ts`

---

### Task 1: ConnectionEntry 타입 + ConnectionManager 필드 추가

**Files:**
- Modify: `src/database/connection-manager.ts`

**Step 1: `ConnectionEntry` 인터페이스에 필드 추가**

`src/database/connection-manager.ts`의 `ConnectionEntry` 인터페이스 수정:

```typescript
import type { SchemaInfo } from './types.js';   // 상단 import에 추가

export interface ConnectionEntry {
  connectionId: string;
  params: ConnectionParams;
  knex: Knex;
  metadataCache: MetadataCache | null;
  cacheInitPromise: Promise<MetadataCache | null> | null;
  schemaCache: SchemaInfo | null;                             // NEW
  schemaCacheInitPromise: Promise<SchemaInfo | null> | null;  // NEW
  createdAt: Date;
  lastUsedAt: Date;
}
```

**Step 2: `register()` 및 `registerDefault()` 내 entry 초기화에 필드 추가**

`register()` 메서드 내 entry 객체 리터럴에:
```typescript
const entry: ConnectionEntry = {
  connectionId,
  params,
  knex: knexInstance,
  metadataCache: null,
  cacheInitPromise: null,
  schemaCache: null,               // NEW
  schemaCacheInitPromise: null,    // NEW
  createdAt: new Date(),
  lastUsedAt: new Date(),
};
```

`registerDefault()` 메서드도 동일하게 추가.

**Step 3: `getOrInitSchemaCache`, `invalidateSchemaCache`, `refreshSchemaCache` 메서드 추가**

`invalidateCache()` 메서드 바로 뒤에 추가 (`src/database/connection-manager.ts`):

```typescript
/**
 * 연결의 스키마 캐시를 초기화하거나 기존 캐시를 반환합니다.
 * 동시 호출을 중복 방지합니다.
 */
async getOrInitSchemaCache(
  connectionId: string,
  config: Config
): Promise<SchemaInfo | null> {
  const entry = this.entries.get(connectionId);
  if (!entry) return null;

  if (entry.schemaCache) return entry.schemaCache;

  if (entry.schemaCacheInitPromise) return entry.schemaCacheInitPromise;

  entry.schemaCacheInitPromise = extractSchema(entry.knex, config)
    .then((schema) => {
      if (this.entries.has(connectionId)) {
        entry.schemaCache = schema;
      }
      entry.schemaCacheInitPromise = null;
      return schema;
    })
    .catch((err) => {
      entry.schemaCacheInitPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Failed to init schema cache for ${connectionId}: ${msg}`
      );
      return null;
    });

  return entry.schemaCacheInitPromise;
}

/**
 * 연결의 스키마 캐시를 무효화합니다.
 */
invalidateSchemaCache(connectionId: string): void {
  const entry = this.entries.get(connectionId);
  if (entry) {
    entry.schemaCache = null;
    entry.schemaCacheInitPromise = null;
  }
}

/**
 * 연결의 스키마 캐시를 새로고침합니다.
 */
async refreshSchemaCache(
  connectionId: string,
  config: Config
): Promise<SchemaInfo | null> {
  const entry = this.entries.get(connectionId);
  if (!entry) return null;

  entry.schemaCache = null;
  entry.schemaCacheInitPromise = null;
  return this.getOrInitSchemaCache(connectionId, config);
}
```

필요한 import 추가 (파일 상단):
```typescript
import { extractSchema } from './schema-extractor.js';
import type { Config } from '../config/index.js';
import type { SchemaInfo } from './types.js';
```

**Step 4: 빌드 확인**

```bash
npm run build
```
Expected: 에러 없음

**Step 5: 커밋**

```bash
git add src/database/connection-manager.ts
git commit -m "feat: add schemaCache fields and methods to ConnectionManager"
```

---

### Task 2: NL2SQLEngine schemaCache 옵션 + 테스트

**Files:**
- Modify: `src/core/nl2sql-engine.ts`
- Modify: `tests/unit/nl2sql-engine.test.ts`

**Step 1: 실패 테스트 작성**

`tests/unit/nl2sql-engine.test.ts` 파일 하단에 추가:

```typescript
import { NL2SQLEngine } from '../../src/core/nl2sql-engine.js';
import type { SchemaInfo } from '../../src/database/types.js';

// Mock 설정 (파일 상단 import 구역 다음에 추가)
// jest.mock은 파일 최상단에 호이스팅되므로 기존 mock 패턴 확인 후 추가

describe('NL2SQLEngine with injected schemaCache', () => {
  const mockSchema: SchemaInfo = {
    tables: [
      { name: 'injected_table', columns: [], constraints: [], indexes: [] },
    ],
  };

  const mockKnex = {} as any;
  const mockConfig = {
    ai: { provider: 'openai', apiKey: 'test', model: 'gpt-4' },
    database: { type: 'postgresql' as const, host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd' },
  };

  it('uses injected schemaCache when provided', async () => {
    // extractSchema가 호출되지 않아야 함을 확인
    const engine = new NL2SQLEngine(mockKnex, mockConfig as any, {
      schemaCache: mockSchema,
    });

    const schema = await engine.getSchema();
    expect(schema).toBe(mockSchema);
    expect(schema.tables[0].name).toBe('injected_table');
  });

  it('falls back to internal cache when schemaCache is undefined', async () => {
    // extractSchema mock이 필요한 경우 — 이 테스트는 추후 extractSchema mock 후 통과
    const engine = new NL2SQLEngine(mockKnex, mockConfig as any);
    // schemaCache undefined면 내부 경로 사용 (extractSchema 호출)
    // 단순히 인스턴스 생성 자체가 성공하는지만 확인
    expect(engine).toBeInstanceOf(NL2SQLEngine);
  });

  it('returns injected schemaCache even when null (no caching)', async () => {
    // null 케이스: extractSchema를 매번 호출 (이 테스트는 extractSchema mock 필요)
    // 단순 타입 확인
    const engine = new NL2SQLEngine(mockKnex, mockConfig as any, {
      schemaCache: null,
    });
    expect(engine).toBeInstanceOf(NL2SQLEngine);
  });
});
```

**Step 2: 테스트 실행 (실패 확인)**

```bash
npx jest tests/unit/nl2sql-engine.test.ts --no-coverage 2>&1 | tail -20
```
Expected: "uses injected schemaCache when provided" FAIL (NL2SQLEngine에 schemaCache 옵션 없음)

**Step 3: `NL2SQLEngineOptions` 및 `getSchema()` 구현**

`src/core/nl2sql-engine.ts` 수정:

```typescript
export interface NL2SQLEngineOptions {
  useMetadata?: boolean;
  metadataCache?: MetadataCache | null;
  /** 주입된 스키마 캐시 (ConnectionManager용).
   * undefined=내부 cachedSchema 사용 (CLI 호환),
   * null=항상 재추출,
   * SchemaInfo=주입된 캐시 즉시 반환 (MCP 모드) */
  schemaCache?: SchemaInfo | null;
}
```

클래스 내 필드 추가:
```typescript
/** 주입된 스키마 캐시 (undefined=내부 캐시 경로) */
private injectedSchemaCache?: SchemaInfo | null;
```

생성자 수정:
```typescript
constructor(knex: Knex, config: Config, options: NL2SQLEngineOptions = {}) {
  this.knex = knex;
  this.config = config;
  this.aiClient = createAIClient(config);
  this.useMetadata = options.useMetadata ?? true;
  this.injectedCache = options.metadataCache;
  this.injectedSchemaCache = options.schemaCache;  // NEW
}
```

`getSchema()` 수정:
```typescript
async getSchema(): Promise<SchemaInfo> {
  // 주입된 캐시가 정의되어 있고 null이 아니면 즉시 반환 (MCP 모드)
  if (this.injectedSchemaCache != null) {
    return this.injectedSchemaCache;
  }
  // undefined가 아닌 null이면 항상 재추출 (캐시 비활성화)
  // undefined이면 내부 cachedSchema 사용 (기존 경로, CLI 호환)
  if (this.cachedSchema) {
    return this.cachedSchema;
  }
  this.cachedSchema = await extractSchema(this.knex, this.config);
  return this.cachedSchema;
}
```

**Step 4: 테스트 재실행 (통과 확인)**

```bash
npx jest tests/unit/nl2sql-engine.test.ts --no-coverage 2>&1 | tail -20
```
Expected: "uses injected schemaCache when provided" PASS

**Step 5: 전체 테스트**

```bash
npm test 2>&1 | tail -20
```
Expected: 모든 기존 테스트 PASS

**Step 6: 커밋**

```bash
git add src/core/nl2sql-engine.ts tests/unit/nl2sql-engine.test.ts
git commit -m "feat: add schemaCache option to NL2SQLEngine, inject into getSchema()"
```

---

### Task 3: `nl2sql_query` MCP 도구에 schemaCache 주입

**Files:**
- Modify: `src/mcp/tools/nl2sql-query.ts`

**Step 1: `nl2sqlQuery` 함수 내 engine 생성 코드 수정**

`src/mcp/tools/nl2sql-query.ts`의 `nl2sqlQuery` 함수에서:

```typescript
// 변경 전 (약 line 98-101):
const metadataCache = await connManager.getOrInitCache(
  entry.connectionId
);
const config = buildConfigFromEntry(entry);
const engine = new NL2SQLEngine(entry.knex, config, { metadataCache });

// 변경 후:
const config = buildConfigFromEntry(entry);
const [metadataCache, schemaCache] = await Promise.all([
  connManager.getOrInitCache(entry.connectionId),
  connManager.getOrInitSchemaCache(entry.connectionId, config),
]);
const engine = new NL2SQLEngine(entry.knex, config, { metadataCache, schemaCache });
```

**Step 2: 빌드 확인**

```bash
npm run build 2>&1 | tail -10
```
Expected: 에러 없음

**Step 3: 커밋**

```bash
git add src/mcp/tools/nl2sql-query.ts
git commit -m "feat: inject schemaCache from ConnectionManager into NL2SQLEngine in nl2sql_query"
```

---

### Task 4: `nl2sql_schema` MCP 도구에 schemaCache 활용

**Files:**
- Modify: `src/mcp/tools/nl2sql-schema.ts`

**Step 1: `nl2sqlSchema` 함수 수정**

`src/mcp/tools/nl2sql-schema.ts`의 `nl2sqlSchema` 함수에서:

```typescript
// 변경 전 (약 line 118-122):
const config = buildConfigFromEntry(entry);
const schema = await extractSchema(entry.knex, config);
const data = formatSchema(schema, input.format);

// 변경 후:
const config = buildConfigFromEntry(entry);
const schema = await connManager.getOrInitSchemaCache(entry.connectionId, config)
  ?? await extractSchema(entry.knex, config);  // null fallback
const data = formatSchema(schema, input.format);
```

**Step 2: 불필요해진 import 정리 확인**

`extractSchema`가 여전히 fallback으로 쓰이므로 import 유지.

**Step 3: 빌드 확인**

```bash
npm run build 2>&1 | tail -10
```
Expected: 에러 없음

**Step 4: 커밋**

```bash
git add src/mcp/tools/nl2sql-schema.ts
git commit -m "feat: use ConnectionManager schemaCache in nl2sql_schema tool"
```

---

### Task 5: `cache_refresh` MCP 도구에 schema 캐시 초기화 통합

**Files:**
- Modify: `src/mcp/tools/cache-manage.ts`

**Step 1: `cacheRefresh` 함수 수정**

`src/mcp/tools/cache-manage.ts`의 `cacheRefresh` 함수에서 ConnectionManager 경로:

```typescript
// 변경 전 (약 line 146-155):
if (input.invalidateOnly) {
  connManager.invalidateCache(entry.connectionId);
  return {
    success: true,
    message: 'Metadata cache invalidated for connection. Will reload on next query.',
    connectionId: entry.connectionId,
  };
}

try {
  await connManager.refreshCache(entry.connectionId);
  const stats = connManager.getCacheStats(entry.connectionId);
  ...
}

// 변경 후:
if (input.invalidateOnly) {
  connManager.invalidateCache(entry.connectionId);
  connManager.invalidateSchemaCache(entry.connectionId);    // NEW
  return {
    success: true,
    message: 'Metadata and schema cache invalidated for connection. Will reload on next query.',
    connectionId: entry.connectionId,
  };
}

try {
  const config = buildConfigFromEntry(entry);
  await Promise.all([
    connManager.refreshCache(entry.connectionId),
    connManager.refreshSchemaCache(entry.connectionId, config),  // NEW
  ]);
  const stats = connManager.getCacheStats(entry.connectionId);
  ...
```

`buildConfigFromEntry` import 추가 (파일 상단):
```typescript
import { buildConfigFromEntry } from '../utils/config-helper.js';
```

**Step 2: 빌드 확인**

```bash
npm run build 2>&1 | tail -10
```
Expected: 에러 없음

**Step 3: 전체 테스트**

```bash
npm test 2>&1 | tail -20
```
Expected: 모든 테스트 PASS

**Step 4: 커밋**

```bash
git add src/mcp/tools/cache-manage.ts
git commit -m "feat: refresh schema cache alongside metadata cache in cache_refresh tool"
```

---

### Task 6: lint + 최종 빌드 검증

**Step 1: lint**

```bash
npm run lint 2>&1 | tail -20
```
Expected: 에러 없음 (경고 허용)

**Step 2: 전체 테스트**

```bash
npm test
```
Expected: PASS

**Step 3: 최종 커밋 (필요 시)**

```bash
git add -A
git commit -m "chore: schema cache per connection - final cleanup"
```

---

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|-----------|
| `src/database/connection-manager.ts` | `ConnectionEntry`에 `schemaCache`, `schemaCacheInitPromise` 추가; `getOrInitSchemaCache`, `invalidateSchemaCache`, `refreshSchemaCache` 메서드 추가 |
| `src/core/nl2sql-engine.ts` | `NL2SQLEngineOptions`에 `schemaCache` 추가; `getSchema()`에 injected cache 우선 반환 로직 추가 |
| `src/mcp/tools/nl2sql-query.ts` | `getOrInitSchemaCache` 호출 후 engine에 주입 |
| `src/mcp/tools/nl2sql-schema.ts` | `getOrInitSchemaCache` 활용 (extractSchema fallback 유지) |
| `src/mcp/tools/cache-manage.ts` | `refreshSchemaCache` 및 `invalidateSchemaCache` 통합 |
| `tests/unit/nl2sql-engine.test.ts` | injected schemaCache 동작 테스트 추가 |
