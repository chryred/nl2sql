# Natural Language Schema Query Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `nl2sql_schema` MCP 도구에서 자연어 쿼리(`query`)만으로 LLM이 관련 테이블을 추정하고 스키마를 반환하도록 한다.

**Architecture:** `NL2SQLEngine`에 `getSchemaByQuery()` 메서드를 추가해 테이블 선별 로직을 캡슐화한다. MCP 도구 `nl2sql_schema`의 `tables` 파라미터를 optional로 변경하고, `query` 파라미터를 신규 추가한다. `tables` 없이 `query`만 오면 `getSchemaByQuery()`를 호출한다.

**Tech Stack:** TypeScript, Zod, Jest (ESM + `jest.unstable_mockModule`)

---

### Task 1: `NL2SQLEngine.getSchemaByQuery()` 테스트 작성 및 메서드 구현

**Files:**
- Create: `tests/unit/nl2sql-engine-get-schema-by-query.test.ts`
- Modify: `src/core/nl2sql-engine.ts`

---

**Step 1: 실패하는 테스트 작성**

`tests/unit/nl2sql-engine-get-schema-by-query.test.ts` 신규 생성:

```typescript
import { jest } from '@jest/globals';
import type { SchemaInfo } from '../../src/database/types.js';

// AI 클라이언트 mock (동적 import 이전에 설정해야 함)
const mockSelectTables = jest.fn<() => Promise<string>>();
jest.unstable_mockModule('../../src/ai/client-factory.js', () => ({
  createAIClient: () => ({
    generateSQL: jest.fn(),
    selectTables: mockSelectTables,
  }),
}));

// extractSchema mock
jest.unstable_mockModule('../../src/database/schema-extractor.js', () => ({
  extractSchema: jest.fn(),
  formatSchemaSummary: () => 'table summary',
  formatSchemaForPrompt: jest.fn(),
}));

// metadata mock (사용 안 함)
jest.unstable_mockModule('../../src/database/metadata/index.js', () => ({
  getMetadataCache: () => null,
  initializeMetadataCache: jest.fn(),
}));

let NL2SQLEngineClass: typeof import('../../src/core/nl2sql-engine.js').NL2SQLEngine;
let extractSchemaMock: jest.MockedFunction<any>;

beforeAll(async () => {
  const mod = await import('../../src/core/nl2sql-engine.js');
  NL2SQLEngineClass = mod.NL2SQLEngine;
  const schemaMod = await import('../../src/database/schema-extractor.js');
  extractSchemaMock = schemaMod.extractSchema as jest.MockedFunction<any>;
});

const fullSchema: SchemaInfo = {
  tables: [
    { name: 'customers', columns: [], constraints: [], indexes: [] },
    { name: 'orders', columns: [], constraints: [], indexes: [] },
    { name: 'products', columns: [], constraints: [], indexes: [] },
  ],
};

const mockConfig = {
  ai: { provider: 'openai' as const, apiKey: 'sk-test-key', model: 'gpt-4o' },
  database: { type: 'postgresql' as const, host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd' },
} as any;

describe('NL2SQLEngine.getSchemaByQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractSchemaMock.mockResolvedValue(fullSchema);
  });

  it('LLM이 테이블을 선별하면 해당 테이블만 포함된 스키마를 반환한다', async () => {
    mockSelectTables.mockResolvedValue('["customers", "orders"]');

    const engine = new NL2SQLEngineClass({} as any, mockConfig);
    const result = await engine.getSchemaByQuery('고객 주문 조회');

    expect(result.tables).toHaveLength(2);
    expect(result.tables.map((t) => t.name)).toEqual(['customers', 'orders']);
  });

  it('LLM이 빈 배열을 반환하면 전체 스키마로 fallback한다', async () => {
    mockSelectTables.mockResolvedValue('[]');

    const engine = new NL2SQLEngineClass({} as any, mockConfig);
    const result = await engine.getSchemaByQuery('알 수 없는 쿼리');

    expect(result.tables).toHaveLength(3);
  });

  it('LLM 응답 파싱 실패 시 전체 스키마로 fallback한다', async () => {
    mockSelectTables.mockResolvedValue('invalid response');

    const engine = new NL2SQLEngineClass({} as any, mockConfig);
    const result = await engine.getSchemaByQuery('파싱 실패 케이스');

    expect(result.tables).toHaveLength(3);
  });
});
```

---

**Step 2: 테스트 실행 → FAIL 확인**

```bash
npx jest tests/unit/nl2sql-engine-get-schema-by-query.test.ts --no-coverage
```

Expected: `TypeError: engine.getSchemaByQuery is not a function`

---

**Step 3: `getSchemaByQuery()` 메서드 구현**

`src/core/nl2sql-engine.ts`의 `clearSchemaCache()` 메서드 바로 앞에 추가:

```typescript
/**
 * 자연어 쿼리로 연관 테이블의 스키마를 반환합니다.
 *
 * @description
 * LLM을 사용해 자연어 설명과 관련된 테이블을 추정하고,
 * 해당 테이블만 포함된 스키마를 반환합니다.
 * 테이블 선별에 실패하면 전체 스키마를 반환합니다.
 *
 * @param naturalLanguageQuery - 연관 테이블을 추정할 자연어 설명
 * @returns 선별된 테이블의 스키마 (선별 실패 시 전체 스키마)
 */
async getSchemaByQuery(naturalLanguageQuery: string): Promise<SchemaInfo> {
  const schema = await this.getSchema();
  const metadata = await this.getMetadata();

  const tableSummary = formatSchemaSummary(schema);
  const selectionPrompt = buildTableSelectionPrompt(
    tableSummary,
    metadata?.glossaryTerms ?? [],
    metadata?.glossaryAliases ?? [],
    metadata?.relationships ?? [],
    metadata?.queryPatterns ?? [],
    metadata?.patternKeywords ?? [],
    naturalLanguageQuery
  );

  const selectionResponse = await this.aiClient.selectTables(selectionPrompt);
  const selectedTables = parseSelectedTables(selectionResponse);

  return selectedTables.length > 0
    ? filterSchemaByTables(schema, selectedTables)
    : schema;
}
```

> **참고:** `formatSchemaSummary`는 이미 `src/core/nl2sql-engine.ts` 상단에 import되어 있음 (`'../database/schema-extractor.js'`).

---

**Step 4: 테스트 실행 → PASS 확인**

```bash
npx jest tests/unit/nl2sql-engine-get-schema-by-query.test.ts --no-coverage
```

Expected: 3 tests PASS

---

**Step 5: 커밋**

```bash
git add tests/unit/nl2sql-engine-get-schema-by-query.test.ts src/core/nl2sql-engine.ts
git commit -m "feat: add NL2SQLEngine.getSchemaByQuery() for natural language table selection"
```

---

### Task 2: `nl2sqlSchemaInputSchema` 변경 (MCP 입력 스키마)

**Files:**
- Modify: `src/mcp/tools/nl2sql-schema.ts:29-47`

---

**Step 1: 스키마 validation 테스트 작성**

`tests/unit/nl2sql-schema-input.test.ts` 신규 생성:

```typescript
import { z } from 'zod';

// nl2sqlSchemaInputSchema를 직접 import
import { nl2sqlSchemaInputSchema } from '../../src/mcp/tools/nl2sql-schema.js';

describe('nl2sqlSchemaInputSchema', () => {
  it('tables만 제공해도 유효하다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({ tables: ['users'] });
    expect(result.success).toBe(true);
  });

  it('query만 제공해도 유효하다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({ query: 'vip그룹고객조회' });
    expect(result.success).toBe(true);
  });

  it('tables와 query 모두 없으면 유효하지 않다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('tables가 빈 배열이고 query도 없으면 유효하지 않다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({ tables: [] });
    expect(result.success).toBe(false);
  });

  it('tables와 query 모두 제공해도 유효하다', () => {
    const result = nl2sqlSchemaInputSchema.safeParse({
      tables: ['users'],
      query: '사용자 조회',
    });
    expect(result.success).toBe(true);
  });
});
```

---

**Step 2: 테스트 실행 → FAIL 확인**

```bash
npx jest tests/unit/nl2sql-schema-input.test.ts --no-coverage
```

Expected: `query만 제공해도 유효하다` FAIL (현재 `tables` required)

---

**Step 3: `nl2sqlSchemaInputSchema` 수정**

`src/mcp/tools/nl2sql-schema.ts`의 `nl2sqlSchemaInputSchema` 상수를 아래로 교체:

```typescript
export const nl2sqlSchemaInputSchema = z
  .object({
    tables: z
      .array(z.string())
      .optional()
      .describe(
        'Table names to retrieve schema for (case-insensitive). e.g. ["vip_grp_cust_inf"]. Optional if query is provided.'
      ),
    query: z
      .string()
      .optional()
      .describe(
        'Natural language description to infer related tables (e.g. "vip그룹고객조회"). Optional if tables is provided.'
      ),
    format: z
      .enum(['json', 'prompt', 'summary'])
      .default('json')
      .describe(
        'Output format: json (full schema), prompt (AI-friendly text), summary (table list)'
      ),
    connectionId: z
      .string()
      .optional()
      .describe(
        'Connection ID from db_connect (optional, uses default if omitted)'
      ),
  })
  .refine((data) => (data.tables && data.tables.length > 0) || data.query, {
    message: 'Either tables (non-empty array) or query must be provided',
  });
```

---

**Step 4: 테스트 실행 → PASS 확인**

```bash
npx jest tests/unit/nl2sql-schema-input.test.ts --no-coverage
```

Expected: 5 tests PASS

---

**Step 5: 커밋**

```bash
git add tests/unit/nl2sql-schema-input.test.ts src/mcp/tools/nl2sql-schema.ts
git commit -m "feat: make tables optional and add query param to nl2sql_schema input schema"
```

---

### Task 3: `nl2sqlSchema` 핸들러 분기 추가 (ConnectionManager 경로)

**Files:**
- Modify: `src/mcp/tools/nl2sql-schema.ts` (함수 `nl2sqlSchema`, 라인 125-159)

---

**Step 1: import 추가**

`src/mcp/tools/nl2sql-schema.ts` 상단 import 블록에 추가:

```typescript
import { NL2SQLEngine } from '../../core/nl2sql-engine.js';
```

> `connManager.getOrInitCache`, `connManager.getOrInitSchemaCache`는 이미 `nl2sqlSchema` 함수가 `connManager`를 받으므로 사용 가능.
> `nl2sql-query.ts`의 engine 생성 패턴과 동일하게 적용.

---

**Step 2: `nl2sqlSchema` 함수 내 ConnectionManager 경로 수정**

현재 `nl2sqlSchema` 함수의 `if (entry)` 블록 내부를 아래로 교체:

```typescript
if (entry) {
  try {
    const config = buildConfigFromEntry(entry);

    if (input.tables && input.tables.length > 0) {
      // 기존 경로: 명시적 테이블명으로 필터링
      const rawSchema =
        (await connManager.getOrInitSchemaCache(entry.connectionId, config)) ??
        (await extractSchema(entry.knex, config));
      const schema = filterSchemaByTables(rawSchema, input.tables);
      const data = formatSchema(schema, input.format);
      return { success: true, format: input.format, data };
    } else {
      // 신규 경로: 자연어 쿼리로 LLM 테이블 선별
      const [metadataCache, schemaCache] = await Promise.all([
        connManager.getOrInitCache(entry.connectionId),
        connManager.getOrInitSchemaCache(entry.connectionId, config),
      ]);
      const engine = new NL2SQLEngine(entry.knex, config, {
        metadataCache,
        schemaCache,
      });
      const schema = await engine.getSchemaByQuery(input.query!);
      const data = formatSchema(schema, input.format);
      return { success: true, format: input.format, data };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      format: input.format,
      error: `Schema extraction error: ${maskSensitiveInfo(message)}`,
    };
  }
}
```

> `connManager.getOrInitCache`가 `nl2sql-schema.ts`에 없으면 `ConnectionManager`에서 해당 메서드를 import할 필요 없이 타입을 통해 접근 가능 (이미 `connManager: ConnectionManager` 파라미터로 받음).

---

**Step 3: 빌드 확인**

```bash
npm run build
```

Expected: 에러 없음

---

**Step 4: 커밋**

```bash
git add src/mcp/tools/nl2sql-schema.ts
git commit -m "feat: add natural language table selection to nl2sql_schema (ConnectionManager path)"
```

---

### Task 4: `nl2sqlSchemaLegacy` 핸들러 분기 추가 (환경변수 경로)

**Files:**
- Modify: `src/mcp/tools/nl2sql-schema.ts` (함수 `nl2sqlSchemaLegacy`, 라인 164-203)

---

**Step 1: `nl2sqlSchemaLegacy` 함수 수정**

현재 `nl2sqlSchemaLegacy` 함수의 `try` 블록 내부를 아래로 교체:

```typescript
try {
  const knex = createConnection(config);

  if (input.tables && input.tables.length > 0) {
    // 기존 경로: 명시적 테이블명으로 필터링
    const rawSchema = await extractSchema(knex, config);
    const schema = filterSchemaByTables(rawSchema, input.tables);
    const data = formatSchema(schema, input.format);
    return { success: true, format: input.format, data };
  } else {
    // 신규 경로: 자연어 쿼리로 LLM 테이블 선별
    const engine = new NL2SQLEngine(knex, config);
    const schema = await engine.getSchemaByQuery(input.query!);
    const data = formatSchema(schema, input.format);
    return { success: true, format: input.format, data };
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    success: false,
    format: input.format,
    error: `Schema extraction error: ${maskSensitiveInfo(message)}`,
  };
} finally {
  await closeConnection();
}
```

---

**Step 2: 빌드 + 전체 테스트**

```bash
npm run build && npm test
```

Expected: 빌드 성공, 기존 테스트 모두 PASS

---

**Step 3: lint 확인**

```bash
npm run lint
```

Expected: 에러 없음

---

**Step 4: 커밋**

```bash
git add src/mcp/tools/nl2sql-schema.ts
git commit -m "feat: add natural language table selection to nl2sql_schema (legacy path)"
```

---

### Task 5: README 및 MCP 문서 업데이트

**Files:**
- Modify: `README.md`
- Modify: `.claude/rules/mcp.md`

---

**Step 1: `.claude/rules/mcp.md` 업데이트**

`nl2sql_schema` 도구 설명 행을 아래로 수정:

```markdown
| `nl2sql_schema` | 스키마 조회 (json/prompt/summary). `tables`(테이블명 배열) 또는 `query`(자연어)로 조회 가능 |
```

Version History에 신규 항목 추가 (v1.8.0 위에):

```markdown
### v1.9.0

- `nl2sql_schema`: 자연어 쿼리(`query` 파라미터)로 연관 테이블 스키마 자동 조회
- `tables` 파라미터 optional로 변경 — `query`만으로 호출 가능
- `NL2SQLEngine.getSchemaByQuery()` 신규 메서드 추가 (LLM 기반 테이블 선별)
- 예시: `{ query: "vip그룹고객조회" }` → LLM이 관련 테이블 추정 후 스키마 반환
```

---

**Step 2: `README.md` 업데이트**

README의 `nl2sql_schema` 관련 설명에 `query` 파라미터 사용 예시 추가 (README 구조에 맞게 위치 찾아 추가).

---

**Step 3: 최종 커밋**

```bash
git add README.md .claude/rules/mcp.md
git commit -m "docs: update README and mcp.md for v1.9.0 natural language schema query"
```
