# wrapOracleKoreanColumns 스키마 필터링 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `wrapOracleKoreanColumns`가 전체 스키마 대신 SQL에 실제로 참조된 테이블만 필터링하여 LLM 프롬프트의 토큰 소비를 줄인다.

**Architecture:** SQL에서 `FROM/JOIN/UPDATE/INTO` 뒤 테이블명을 regex로 추출하는 `extractTablesFromSQL` 유틸 함수를 `src/utils/sql-parser.ts`에 신규 작성한다. `wrapOracleKoreanColumns`는 이 함수로 테이블명을 추출한 뒤 기존 `filterSchemaByTables`로 스키마를 필터링하고, 줄어든 스키마를 `buildOracleKoreanWrapPrompt`에 전달한다. 추출 결과가 없으면 전체 스키마 fallback.

**Tech Stack:** TypeScript (ESM), Jest, regex (외부 라이브러리 없음)

---

## Task 1: `extractTablesFromSQL` 유틸 함수 — TDD

**Files:**
- Create: `src/utils/sql-parser.ts`
- Create: `tests/unit/sql-parser.test.ts`

---

### Step 1: 실패하는 테스트 작성

`tests/unit/sql-parser.test.ts`를 아래 내용으로 생성한다:

```typescript
import { extractTablesFromSQL } from '../../src/utils/sql-parser.js';

describe('extractTablesFromSQL', () => {
  it('단순 SELECT-FROM에서 테이블명 추출', () => {
    const sql = 'SELECT id, customer_name FROM customers';
    expect(extractTablesFromSQL(sql)).toEqual(['customers']);
  });

  it('다중 JOIN에서 모든 테이블명 추출', () => {
    const sql = `
      SELECT o.id, c.name, p.title
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN products p ON o.product_id = p.id
    `;
    expect(extractTablesFromSQL(sql).sort()).toEqual(
      ['customers', 'orders', 'products'].sort()
    );
  });

  it('schema.table 형식에서 테이블명만 추출', () => {
    const sql = 'SELECT * FROM nl2sql.orders o';
    expect(extractTablesFromSQL(sql)).toEqual(['orders']);
  });

  it('CTE 이름은 결과에서 제외하고 실제 테이블만 추출', () => {
    const sql = `
      WITH active_users AS (
        SELECT * FROM users WHERE is_active = 1
      )
      SELECT * FROM active_users
      JOIN orders o ON active_users.id = o.user_id
    `;
    const result = extractTablesFromSQL(sql).sort();
    expect(result).toEqual(['orders', 'users'].sort());
    expect(result).not.toContain('active_users');
  });

  it('서브쿼리 내부 테이블도 추출', () => {
    const sql = 'SELECT * FROM (SELECT id FROM users WHERE active = 1) t';
    expect(extractTablesFromSQL(sql)).toEqual(['users']);
  });

  it('UPDATE 문에서 테이블명 추출', () => {
    const sql = "UPDATE customers SET name = 'x' WHERE id = 1";
    expect(extractTablesFromSQL(sql)).toEqual(['customers']);
  });

  it('INSERT INTO 문에서 테이블명 추출', () => {
    const sql = 'INSERT INTO orders (id, amount) VALUES (1, 100)';
    expect(extractTablesFromSQL(sql)).toEqual(['orders']);
  });

  it('대소문자 혼용 키워드 처리', () => {
    const sql = 'select id from CUSTOMERS c inner join ORDERS o on c.id = o.cid';
    expect(extractTablesFromSQL(sql).sort()).toEqual(
      ['customers', 'orders'].sort()
    );
  });

  it('유효한 테이블이 없으면 빈 배열 반환', () => {
    const sql = 'SELECT SYSDATE FROM DUAL';
    // DUAL은 특수 Oracle 테이블이지만 추출은 허용 (VARCHAR2 없어 영향 없음)
    // 이 케이스는 실제 추출 결과가 있어도 스키마 필터에서 걸러짐
    const result = extractTablesFromSQL(sql);
    expect(Array.isArray(result)).toBe(true);
  });
});
```

---

### Step 2: 테스트 실행 — 실패 확인

```bash
npx jest tests/unit/sql-parser.test.ts --no-coverage
```

Expected: `Cannot find module '../../src/utils/sql-parser.js'` 오류로 실패

---

### Step 3: `src/utils/sql-parser.ts` 구현

아래 내용으로 파일 생성:

```typescript
/**
 * SQL 파서 유틸리티
 *
 * @module utils/sql-parser
 */

/**
 * SQL 쿼리에서 참조된 테이블명을 추출합니다.
 *
 * @description
 * FROM, JOIN(모든 유형), UPDATE, INTO 키워드 뒤 테이블명을 추출합니다.
 * - schema.table 형식은 table 부분만 추출
 * - 별칭(alias)은 제거
 * - WITH ... AS (CTE) 이름은 실제 테이블이 아니므로 결과에서 제외
 * - 추출 결과가 없으면 빈 배열 반환 (호출부에서 전체 스키마 fallback 처리)
 *
 * @param sql - 분석할 SQL 쿼리 문자열
 * @returns 추출된 테이블명 배열 (소문자, 중복 제거)
 */
export function extractTablesFromSQL(sql: string): string[] {
  const normalized = sql.replace(/\s+/g, ' ');

  // Step 1: CTE 이름 수집 — 실제 테이블이 아니므로 결과에서 제외
  const cteNames = new Set<string>();
  const cteRe = /\bWITH\s+([\w$]+)\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = cteRe.exec(normalized)) !== null) {
    cteNames.add(m[1].toLowerCase());
  }

  // Step 2: FROM / 모든 JOIN 유형 / UPDATE / INTO 뒤 테이블명 추출
  // schema.table 형식도 캡처 ([\w$]+(?:\.[\w$]+)?)
  const tableRe = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\w$]+(?:\.[\w$]+)?)/gi;
  const tables = new Set<string>();
  while ((m = tableRe.exec(normalized)) !== null) {
    const raw = m[1];
    // schema.table → table 정규화 (마지막 .뒤 부분만 사용)
    const name = raw.includes('.') ? raw.split('.').pop()! : raw;
    const lower = name.toLowerCase();
    // CTE 이름 제외
    if (!cteNames.has(lower)) {
      tables.add(lower);
    }
  }

  return Array.from(tables);
}
```

---

### Step 4: 테스트 실행 — 통과 확인

```bash
npx jest tests/unit/sql-parser.test.ts --no-coverage
```

Expected: 모든 테스트 PASS

---

### Step 5: 커밋

```bash
git add src/utils/sql-parser.ts tests/unit/sql-parser.test.ts
git commit -m "feat: add extractTablesFromSQL utility to src/utils/sql-parser.ts"
```

---

## Task 2: `wrapOracleKoreanColumns` 스키마 필터링 적용 — TDD

**Files:**
- Modify: `src/core/nl2sql-engine.ts` (import 추가 + `wrapOracleKoreanColumns` 수정)
- Modify: `tests/unit/nl2sql-engine-wrap-oracle.test.ts` (테스트 추가)

---

### Step 1: 실패하는 테스트 작성

`tests/unit/nl2sql-engine-wrap-oracle.test.ts`에 아래 테스트 케이스를 추가한다. 기존 테스트 맨 아래 `}); // describe 닫기` 직전에 삽입:

```typescript
  it('should pass only SQL-referenced tables schema to wrap prompt (not full schema)', async () => {
    // 전체 스키마에는 customers와 unrelated_table 두 테이블이 있음
    const fullSchema: SchemaInfo = {
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
        {
          name: 'unrelated_table',
          columns: [
            { name: 'some_col', type: 'VARCHAR2(200)', nullable: true, comment: '무관한 컬럼' },
          ],
          constraints: [],
          indexes: [],
        },
      ],
    };

    const mockAiClient = {
      generateSQL: jest.fn().mockResolvedValue(wrappedSql),
      selectTables: jest.fn(),
      generateInferFK: jest.fn(),
      generateComment: jest.fn(),
    };

    // SQL: customers만 참조
    const engine = new NL2SQLEngine(mockKnex, mockConfig, {
      schemaCache: fullSchema,
    });
    (engine as any).aiClient = mockAiClient;

    await engine.wrapOracleKoreanColumns(originalSql); // FROM customers

    expect(mockAiClient.generateSQL).toHaveBeenCalledTimes(1);
    const promptArg = mockAiClient.generateSQL.mock.calls[0][0] as string;
    // 프롬프트에 customers 테이블 정보 포함
    expect(promptArg).toContain('customers');
    // 프롬프트에 unrelated_table 정보 미포함
    expect(promptArg).not.toContain('unrelated_table');
  });
```

---

### Step 2: 테스트 실행 — 실패 확인

```bash
npx jest tests/unit/nl2sql-engine-wrap-oracle.test.ts --no-coverage
```

Expected: 새로 추가한 테스트가 FAIL — `unrelated_table`이 프롬프트에 포함됨

---

### Step 3: `wrapOracleKoreanColumns` 수정

`src/core/nl2sql-engine.ts` 상단 import 블록에 아래 import를 추가한다.
기존 import 마지막 줄 (`import type { MetadataCache } from ...`) 다음에 삽입:

```typescript
import { extractTablesFromSQL } from '../utils/sql-parser.js';
```

그 다음 `wrapOracleKoreanColumns` 메서드 본문을 아래로 교체한다:

```typescript
async wrapOracleKoreanColumns(sql: string): Promise<string> {
  const schema = await this.getSchema();
  const charset = this.config.database.oracleDataCharset;
  if (!charset) return sql;

  // SQL에서 참조 테이블만 추출하여 스키마 필터링 (토큰 절감)
  const tableNames = extractTablesFromSQL(sql);
  const filteredSchema =
    tableNames.length > 0 ? filterSchemaByTables(schema, tableNames) : schema;

  const prompt = buildOracleKoreanWrapPrompt(sql, filteredSchema, charset);
  try {
    const response = await this.aiClient.generateSQL(prompt);
    const transformed = parseSQL(response);
    return transformed || sql;
  } catch {
    return sql;
  }
}
```

---

### Step 4: 테스트 실행 — 통과 확인

```bash
npx jest tests/unit/nl2sql-engine-wrap-oracle.test.ts --no-coverage
```

Expected: 모든 테스트 PASS (기존 3개 + 신규 1개)

---

### Step 5: 커밋

```bash
git add src/core/nl2sql-engine.ts tests/unit/nl2sql-engine-wrap-oracle.test.ts
git commit -m "feat: filter schema to SQL-referenced tables in wrapOracleKoreanColumns"
```

---

## Task 3: 전체 테스트 & 빌드 통과 확인

**Files:** 없음 (검증 단계)

---

### Step 1: 전체 테스트 실행

```bash
npm test
```

Expected: 모든 테스트 PASS, 실패 없음

---

### Step 2: TypeScript 빌드 확인

```bash
npm run build
```

Expected: 에러 없음

---

### Step 3: (실패 시) 타입 오류 수정 후 재실행

빌드 또는 테스트 실패 시:
- 오류 메시지를 확인하고 원인 파악
- `import` 경로 `.js` 확장자 누락 여부 확인
- `extractTablesFromSQL` 반환 타입 `string[]` 확인
- 수정 후 다시 Step 1~2 반복

---

### Step 4: 완료 커밋 (변경사항 있을 경우)

```bash
git add -p
git commit -m "fix: resolve build issues for schema filter optimization"
```
