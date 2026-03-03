# Oracle UTL_RAW Execute-Aware Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Oracle `oracleDataCharset` 설정 시 `execute=true`일 때만 UTL_RAW.CAST_TO_RAW LLM 후처리를 적용하고, dry-run은 가독성 좋은 SQL을 반환한다.

**Architecture:** 기존 `getDbSpecificNotes()`의 UTL_RAW "ALWAYS" 지시 제거 → `execute=true` + `oracleDataCharset` 조건에서만 새 `wrapOracleKoreanColumns()` LLM 후처리 호출. NL→SQL 흐름과 pre-supplied SQL 흐름 모두 동일한 후처리 메서드 공유.

**Tech Stack:** TypeScript, Jest, Zod (기존 AIProvider.generateSQL 재사용)

---

## Task 1: `getDbSpecificNotes()` 에서 UTL_RAW 지시 제거

**Files:**
- Modify: `src/ai/prompt-builder.ts:76-87`
- Test: `tests/unit/prompt-builder.test.ts`

**Step 1: 기존 테스트 확인 (깨지는 테스트 파악)**

```bash
npm test -- --testPathPattern=prompt-builder
```

Expected: 현재 통과 중인 테스트 목록 확인

**Step 2: UTL_RAW 제거 후 동작을 검증하는 실패 테스트 작성**

`tests/unit/prompt-builder.test.ts` 끝에 추가:

```typescript
describe('buildPrompt - oracle charset UTL_RAW behavior', () => {
  const schema: SchemaInfo = {
    tables: [
      {
        name: 'customers',
        columns: [
          { name: 'customer_name', type: 'VARCHAR2(100)', nullable: true, comment: '고객명' },
          { name: 'id', type: 'NUMBER', nullable: false, comment: 'ID' },
        ],
        constraints: [],
        indexes: [],
      },
    ],
  };

  it('should NOT include UTL_RAW instruction when oracleDataCharset is set (prompt is always UTL_RAW-free)', () => {
    const prompt = buildPrompt({
      tables: schema,
      naturalLanguageQuery: '고객 이름 조회',
      dbType: 'oracle',
      oracleDataCharset: 'ms949',
    });
    expect(prompt).not.toContain('UTL_RAW.CAST_TO_RAW');
    expect(prompt).not.toContain('ALWAYS wrap');
  });

  it('should still include charset info in dbType label when oracleDataCharset is set', () => {
    const prompt = buildPrompt({
      tables: schema,
      naturalLanguageQuery: '고객 이름 조회',
      dbType: 'oracle',
      oracleDataCharset: 'ms949',
    });
    expect(prompt).toContain('ms949');
  });
});
```

**Step 3: 테스트 실행 - 실패 확인**

```bash
npm test -- --testPathPattern=prompt-builder --testNamePattern="UTL_RAW instruction"
```

Expected: FAIL (현재 UTL_RAW 안내가 포함되어 있으므로)

**Step 4: `getDbSpecificNotes()` 에서 charsetNote(UTL_RAW) 제거**

`src/ai/prompt-builder.ts` 의 Oracle 케이스 수정:

```typescript
case 'oracle': {
  // charsetNote 완전 제거 - UTL_RAW wrapping은 execute 시점에 wrapOracleKoreanColumns()가 처리
  return `- Use Oracle-specific syntax (double quotes for case-sensitive identifiers)
- Use appropriate Oracle functions (e.g., NVL, TO_CHAR, TO_DATE, DECODE, etc.)
- Use FETCH FIRST n ROWS ONLY for limiting results (Oracle 12c+) or ROWNUM for older versions
- Use || for string concatenation
- NULL handling: NVL(column, default) or COALESCE
- Date literals: DATE 'YYYY-MM-DD' or TO_DATE('YYYY-MM-DD', 'YYYY-MM-DD')
- Use DUAL for queries without a table (e.g., SELECT SYSDATE FROM DUAL)`;
}
```

> 참고: `oracleDataCharset` 파라미터는 시그니처에서 제거하지 않음 (dbTypeLabel에서 여전히 사용됨)

**Step 5: 테스트 통과 확인**

```bash
npm test -- --testPathPattern=prompt-builder
```

Expected: 모든 테스트 PASS

**Step 6: Commit**

```bash
git add src/ai/prompt-builder.ts tests/unit/prompt-builder.test.ts
git commit -m "refactor: remove UTL_RAW ALWAYS instruction from getDbSpecificNotes - wrapping now handled at execute time"
```

---

## Task 2: `buildOracleKoreanWrapPrompt()` 함수 추가

**Files:**
- Modify: `src/ai/prompt-builder.ts` (함수 추가 및 export)
- Test: `tests/unit/prompt-builder.test.ts`

**Step 1: 실패 테스트 먼저 작성**

`tests/unit/prompt-builder.test.ts` 에 import 추가 및 테스트 추가:

```typescript
// 파일 상단 import에 buildOracleKoreanWrapPrompt 추가
import { buildTableSelectionPrompt, parseSelectedTables, buildPrompt, buildOracleKoreanWrapPrompt } from '../../src/ai/prompt-builder.js';
```

```typescript
describe('buildOracleKoreanWrapPrompt', () => {
  const schema: SchemaInfo = {
    tables: [
      {
        name: 'customers',
        columns: [
          { name: 'customer_name', type: 'VARCHAR2(100)', nullable: true, comment: '고객명' },
          { name: 'grade', type: 'VARCHAR2(10)', nullable: true, comment: '등급' },
          { name: 'id', type: 'NUMBER', nullable: false, comment: 'ID' },
        ],
        constraints: [],
        indexes: [],
      },
    ],
  };

  const sql = "SELECT id, customer_name, grade FROM customers WHERE grade = 'VIP'";

  it('should include the original SQL in prompt', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain(sql);
  });

  it('should instruct LLM to apply UTL_RAW.CAST_TO_RAW', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('UTL_RAW.CAST_TO_RAW');
  });

  it('should include schema column info in prompt', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('customer_name');
    expect(prompt).toContain('VARCHAR2');
  });

  it('should instruct to return SQL only', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('SQL only');
  });

  it('should include charset info', () => {
    const prompt = buildOracleKoreanWrapPrompt(sql, schema, 'ms949');
    expect(prompt).toContain('ms949');
  });
});
```

**Step 2: 실패 확인**

```bash
npm test -- --testPathPattern=prompt-builder --testNamePattern="buildOracleKoreanWrapPrompt"
```

Expected: FAIL (함수 미존재)

**Step 3: `buildOracleKoreanWrapPrompt()` 구현**

`src/ai/prompt-builder.ts` 의 `buildPrompt` 함수 **뒤에** 추가:

```typescript
/**
 * Oracle 한글 컬럼 UTL_RAW 래핑 변환 프롬프트를 생성합니다.
 *
 * @description
 * 기존 Oracle SQL을 받아서 한글 데이터를 저장하는 VARCHAR2 컬럼에
 * UTL_RAW.CAST_TO_RAW()를 적용하는 변환 SQL을 생성하도록 LLM에 지시합니다.
 * execute=true + oracleDataCharset 조합일 때만 호출됩니다.
 *
 * @param sql - 변환할 원본 SQL
 * @param schema - 스키마 정보 (컬럼 타입/코멘트 참조용)
 * @param charset - Oracle DB 데이터 캐릭터셋 (예: ms949)
 * @returns LLM 변환 요청 프롬프트
 */
export function buildOracleKoreanWrapPrompt(
  sql: string,
  schema: SchemaInfo,
  charset: string
): string {
  // 스키마에서 VARCHAR2 컬럼 목록 생성 (LLM 판단 보조용)
  const columnInfo = schema.tables
    .map((table) => {
      const varchar2Cols = table.columns
        .filter((col) => col.type?.toUpperCase().includes('VARCHAR2'))
        .map((col) => `  ${col.name} (${col.type})${col.comment ? ` -- ${col.comment}` : ''}`)
        .join('\n');
      return varchar2Cols ? `Table ${table.name}:\n${varchar2Cols}` : null;
    })
    .filter(Boolean)
    .join('\n\n');

  return `You are an Oracle SQL expert. The Oracle database stores data in ${charset} charset (not UTF-8).
VARCHAR2 columns containing Korean text must be wrapped with UTL_RAW.CAST_TO_RAW() to prevent garbled output.

Below is the database schema showing VARCHAR2 columns (which may store Korean text):
${columnInfo || '(no VARCHAR2 columns found in schema)'}

Original SQL to transform:
\`\`\`sql
${sql}
\`\`\`

Task:
1. Analyze the SQL and identify VARCHAR2 columns in SELECT list and WHERE conditions that likely store Korean text.
   - Use column names, comments, and context to judge (e.g., name, address, description columns are likely Korean).
   - Numeric ID columns, date columns, and clearly non-Korean columns should NOT be wrapped.
2. In the SELECT list: wrap each Korean VARCHAR2 column as UTL_RAW.CAST_TO_RAW(column_name) AS column_name.
3. In WHERE conditions: if comparing a Korean VARCHAR2 column against a Korean string literal, wrap appropriately.
4. Return ONLY the modified SQL query with no explanation, no markdown, no code blocks. SQL only.
5. If no Korean VARCHAR2 columns are found, return the original SQL unchanged.`;
}
```

**Step 4: 테스트 통과 확인**

```bash
npm test -- --testPathPattern=prompt-builder
```

Expected: 모든 테스트 PASS

**Step 5: Commit**

```bash
git add src/ai/prompt-builder.ts tests/unit/prompt-builder.test.ts
git commit -m "feat: add buildOracleKoreanWrapPrompt for execute-time UTL_RAW transformation"
```

---

## Task 3: `NL2SQLEngine.wrapOracleKoreanColumns()` 메서드 추가

**Files:**
- Modify: `src/core/nl2sql-engine.ts`
- Test: `tests/unit/nl2sql-engine.test.ts`

**Step 1: 실패 테스트 작성**

`tests/unit/nl2sql-engine.test.ts` 에 추가 (기존 import 확인 후):

```typescript
import { NL2SQLEngine, filterSchemaByTables, filterMetadataByTables } from '../../src/core/nl2sql-engine.js';
import type { SchemaInfo } from '../../src/database/types.js';

describe('NL2SQLEngine.wrapOracleKoreanColumns', () => {
  const mockSchema: SchemaInfo = {
    tables: [
      {
        name: 'customers',
        columns: [
          { name: 'customer_name', type: 'VARCHAR2(100)', nullable: true, comment: '고객명' },
          { name: 'id', type: 'NUMBER', nullable: false, comment: 'ID' },
        ],
        constraints: [],
        indexes: [],
      },
    ],
  };

  const originalSql = "SELECT id, customer_name FROM customers";
  const wrappedSql = "SELECT id, UTL_RAW.CAST_TO_RAW(customer_name) AS customer_name FROM customers";

  const mockKnex = {} as any;
  const mockConfig = {
    database: { type: 'oracle' as const, oracleDataCharset: 'ms949' },
    ai: { provider: 'openai' as const, model: 'gpt-4o', apiKey: 'test-key' },
  } as any;

  it('should call aiClient.generateSQL with wrap prompt and return parsed SQL', async () => {
    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(wrappedSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, mockConfig, {
      schemaCache: mockSchema,
    });
    // aiClient를 mock으로 교체 (private 접근)
    (engine as any).aiClient = mockAiClient;

    const result = await engine.wrapOracleKoreanColumns(originalSql);

    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1);
    const promptArg = mockAiClient.generateSQL.mock.calls[0][0] as string;
    expect(promptArg).toContain('UTL_RAW.CAST_TO_RAW');
    expect(promptArg).toContain(originalSql);
    expect(result).toBe(wrappedSql);
  });

  it('should return original sql if aiClient returns empty response', async () => {
    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(''),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, mockConfig, {
      schemaCache: mockSchema,
    });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.wrapOracleKoreanColumns(originalSql);
    expect(result).toBe(originalSql);
  });
});
```

**Step 2: 실패 확인**

```bash
npm test -- --testPathPattern=nl2sql-engine.test --testNamePattern="wrapOracleKoreanColumns"
```

Expected: FAIL (메서드 미존재)

**Step 3: `wrapOracleKoreanColumns()` 구현**

`src/core/nl2sql-engine.ts` 에서 `clearSchemaCache()` 메서드 **앞에** 추가:

```typescript
/**
 * Oracle 한글 깨짐 방지를 위해 한글 VARCHAR2 컬럼에 UTL_RAW.CAST_TO_RAW를 적용합니다.
 *
 * @description
 * execute=true + oracleDataCharset 조합일 때 호출됩니다.
 * LLM이 스키마를 참조하여 한글 VARCHAR2 컬럼을 판단하고 UTL_RAW로 래핑합니다.
 * 실패 시 원본 SQL을 반환합니다 (graceful degradation).
 *
 * @param sql - 변환할 원본 SQL
 * @returns UTL_RAW 적용된 SQL (변환 불필요 시 원본 반환)
 */
async wrapOracleKoreanColumns(sql: string): Promise<string> {
  const schema = await this.getSchema();
  const charset = this.config.database.oracleDataCharset;
  if (!charset) return sql;

  const prompt = buildOracleKoreanWrapPrompt(sql, schema, charset);
  try {
    const response = await this.aiClient.generateSQL(prompt);
    const transformed = parseSQL(response);
    return transformed || sql;
  } catch {
    // LLM 호출 실패 시 원본 SQL fallback
    return sql;
  }
}
```

`src/core/nl2sql-engine.ts` 상단 import에 추가:

```typescript
import {
  buildPrompt,
  buildTableSelectionPrompt,
  parseSelectedTables,
  buildOracleKoreanWrapPrompt,   // ← 추가
} from '../ai/prompt-builder.js';
```

**Step 4: 테스트 통과 확인**

```bash
npm test -- --testPathPattern=nl2sql-engine.test
```

Expected: 모든 테스트 PASS

**Step 5: Commit**

```bash
git add src/core/nl2sql-engine.ts tests/unit/nl2sql-engine.test.ts
git commit -m "feat: add NL2SQLEngine.wrapOracleKoreanColumns() for execute-time UTL_RAW wrapping"
```

---

## Task 4: `NL2SQLEngine.process()` 에 UTL_RAW 후처리 적용

**Files:**
- Modify: `src/core/nl2sql-engine.ts:380-394` (process 메서드)
- Test: `tests/unit/nl2sql-engine.test.ts`

**Step 1: 실패 테스트 작성**

`tests/unit/nl2sql-engine.test.ts` 에 추가:

```typescript
describe('NL2SQLEngine.process - oracle UTL_RAW wrapping', () => {
  const mockSchema: SchemaInfo = {
    tables: [
      {
        name: 'customers',
        columns: [
          { name: 'customer_name', type: 'VARCHAR2(100)', nullable: true, comment: '고객명' },
          { name: 'id', type: 'NUMBER', nullable: false, comment: 'ID' },
        ],
        constraints: [],
        indexes: [],
      },
    ],
  };

  const cleanSql = 'SELECT id, customer_name FROM customers';
  const wrappedSql = 'SELECT id, UTL_RAW.CAST_TO_RAW(customer_name) AS customer_name FROM customers';

  const mockKnex = { raw: jest.fn().mockResolvedValue([]) } as any;
  const mockConfig = {
    database: { type: 'oracle' as const, oracleDataCharset: 'ms949' },
    ai: { provider: 'openai' as const, model: 'gpt-4o', apiKey: 'test-key' },
  } as any;

  it('should wrap Korean columns and execute with wrapped SQL when execute=true and oracleDataCharset set', async () => {
    const mockAiClient = {
      // generateSQL 첫 호출: 원본 SQL 생성, 두 번째 호출: UTL_RAW 래핑
      generateSQL: jest.fn()
        .mockResolvedValueOnce(cleanSql)       // 1st call: NL→SQL
        .mockResolvedValueOnce(wrappedSql),    // 2nd call: wrapOracleKoreanColumns
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, mockConfig, { schemaCache: mockSchema });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.process('고객 이름 조회', true);

    // output.sql은 항상 clean SQL (가독성)
    expect(result.sql).toBe(cleanSql);
    // executeSQL은 wrappedSql로 호출
    expect(mockKnex.raw).toHaveBeenCalledWith(wrappedSql);
    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(2);
  });

  it('should NOT call wrapOracleKoreanColumns when execute=false', async () => {
    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(cleanSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, mockConfig, { schemaCache: mockSchema });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.process('고객 이름 조회', false);

    expect(result.sql).toBe(cleanSql);
    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1); // wrap 호출 없음
  });

  it('should NOT call wrapOracleKoreanColumns for non-oracle DB', async () => {
    const postgresConfig = {
      database: { type: 'postgresql' as const },
      ai: { provider: 'openai' as const, model: 'gpt-4o', apiKey: 'test-key' },
    } as any;

    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(cleanSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    const engine = new NL2SQLEngine(mockKnex, postgresConfig, { schemaCache: mockSchema });
    (engine as any).aiClient = mockAiClient;

    const result = await engine.process('고객 이름 조회', true);

    expect(result.sql).toBe(cleanSql);
    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: 실패 확인**

```bash
npm test -- --testPathPattern=nl2sql-engine.test --testNamePattern="process - oracle"
```

Expected: FAIL

**Step 3: `process()` 메서드 수정**

`src/core/nl2sql-engine.ts` 의 `process()` 메서드 교체:

```typescript
async process(
  naturalLanguageQuery: string,
  execute = false
): Promise<NL2SQLResult> {
  const schema = await this.getSchema();
  const sql = await this.generateSQL(naturalLanguageQuery);

  const result: NL2SQLResult = { sql, schema };

  if (execute) {
    const shouldWrap =
      this.config.database.type === 'oracle' &&
      !!this.config.database.oracleDataCharset;

    const sqlToExecute = shouldWrap
      ? await this.wrapOracleKoreanColumns(sql)
      : sql;

    result.executionResult = await this.executeSQL(sqlToExecute);
    // result.sql은 항상 원본 가독성 SQL 유지
  }

  return result;
}
```

**Step 4: 테스트 통과 확인**

```bash
npm test -- --testPathPattern=nl2sql-engine.test
```

Expected: 모든 테스트 PASS

**Step 5: Commit**

```bash
git add src/core/nl2sql-engine.ts tests/unit/nl2sql-engine.test.ts
git commit -m "feat: apply UTL_RAW wrapping in process() when execute=true and oracleDataCharset set"
```

---

## Task 5: `nl2sql-query.ts` pre-supplied SQL 경로에 UTL_RAW 후처리 추가

**Files:**
- Modify: `src/mcp/tools/nl2sql-query.ts:106-118` (ConnectionManager 경로)
- Modify: `src/mcp/tools/nl2sql-query.ts:189-201` (Legacy 경로)

> 참고: Legacy 경로(`nl2sqlQueryLegacy`)는 환경변수 기반으로 `engine.wrapOracleKoreanColumns()`를 동일하게 사용.

**Step 1: ConnectionManager 경로 수정**

`src/mcp/tools/nl2sql-query.ts` 의 `input.sql` 처리 블록 (line 106-118) 교체:

```typescript
if (input.sql) {
  // 이미 생성된 SQL이 있으면 AI 호출 스킵
  const sqlValidation = validateSQL(input.sql);
  if (!sqlValidation.valid) {
    return {
      success: false,
      error: `SQL validation failed: ${sqlValidation.error}`,
    };
  }
  sql = input.sql;  // output.sql은 원본 유지

  if (input.execute) {
    const shouldWrap =
      entry.params.type === 'oracle' &&
      !!entry.params.oracleDataCharset;

    const sqlToExecute = shouldWrap
      ? await engine.wrapOracleKoreanColumns(sql)
      : sql;

    executionResult = await engine.executeSQL(sqlToExecute);
  }
}
```

**Step 2: Legacy 경로 수정**

`nl2sqlQueryLegacy()` 함수의 `input.sql` 처리 블록 (line 189-201) 교체:

```typescript
if (input.sql) {
  const sqlValidation = validateSQL(input.sql);
  if (!sqlValidation.valid) {
    return {
      success: false,
      error: `SQL validation failed: ${sqlValidation.error}`,
    };
  }
  sql = input.sql;  // output.sql은 원본 유지

  if (input.execute) {
    const shouldWrap =
      config.database.type === 'oracle' &&
      !!config.database.oracleDataCharset;

    const sqlToExecute = shouldWrap
      ? await engine.wrapOracleKoreanColumns(sql)
      : sql;

    executionResult = await engine.executeSQL(sqlToExecute);
  }
}
```

**Step 3: 빌드 및 타입 오류 확인**

```bash
npm run build
```

Expected: 빌드 성공, 타입 오류 없음

**Step 4: 전체 테스트 실행**

```bash
npm test
```

Expected: 모든 테스트 PASS

**Step 5: Commit**

```bash
git add src/mcp/tools/nl2sql-query.ts
git commit -m "feat: apply UTL_RAW wrapping for pre-supplied sql when execute=true and oracleDataCharset set"
```

---

## Task 6: 최종 검증 및 문서 업데이트

**Step 1: 전체 테스트 + lint 실행**

```bash
npm run lint && npm test
```

Expected: lint 경고 없음, 모든 테스트 PASS

**Step 2: `mcp.md` 버전 히스토리 업데이트**

`.claude/rules/mcp.md` 상단 버전 섹션에 추가:

```markdown
### v1.11.0

- Oracle `oracleDataCharset` 설정 시 UTL_RAW 처리 방식 개선
- `execute=false` (dry-run): UTL_RAW 없는 가독성 좋은 SQL 반환
- `execute=true`: LLM이 SELECT/WHERE 한글 VARCHAR2 컬럼에 UTL_RAW.CAST_TO_RAW 자동 적용
- pre-supplied `sql` + execute=true 시 동일한 LLM 후처리 적용
- `NL2SQLEngine.wrapOracleKoreanColumns()` 신규 메서드 추가
- `buildOracleKoreanWrapPrompt()` 신규 프롬프트 빌더 함수 추가
```

**Step 3: `README.md` 업데이트** (Oracle charset 섹션이 있다면 동작 변경 반영)

**Step 4: 최종 commit**

```bash
git add .claude/rules/mcp.md README.md
git commit -m "docs: update mcp.md and README for Oracle UTL_RAW execute-aware behavior (v1.11.0)"
```
